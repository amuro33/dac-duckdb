using DuckDB.NET.Data;
using Streaming.Core;
using System.Diagnostics;
namespace Data.Transform;

public sealed class DatasetEngine(StreamStore store,IConfiguration config,RemoteEngines remote)
{
    readonly SemaphoreSlim readers=new(2);
    public string Root => config["ResultDirectory"]??"/data/results";
    static string Quote(string value)=>"'"+value.Replace("'","''")+"'";
    static DuckDBConnection Open()
    {
        var db=new DuckDBConnection("DataSource=:memory:");db.Open();
        using var cmd=db.CreateCommand();cmd.CommandText="SET memory_limit='768MB'; SET threads=2;";cmd.ExecuteNonQuery();return db;
    }
    public async Task Build(Dataset dataset,CancellationToken ct)
    {
        var sw=Stopwatch.StartNew();var dir=Path.Combine(Root,dataset.Id.ToString("N"));Directory.CreateDirectory(dir);
        var eds=Path.Combine(dir,"eds.ndjson");var defects=Path.Combine(dir,"defects.ndjson");var partial=Path.Combine(dir,"result.partial.parquet");var final=Path.Combine(dir,"result.parquet");
        dataset.Config.Validate();
        await store.WriteInput(dataset.InputDatasetId ?? dataset.Id,"eds",eds,ct);await store.WriteInput(dataset.InputDatasetId ?? dataset.Id,"defects",defects,ct);
        using var db=Open();using var cmd=db.CreateCommand();
        cmd.CommandText=$$"""
        SET temp_directory={{Quote(Path.Combine(dir,"spill"))}};
        CREATE TABLE eds AS SELECT lotId AS lot_id,waferId AS wafer_id,product,testedDies AS tested_dies,goodDies AS good_dies,yieldPct AS yield_pct,inspectedAt AS inspected_at
          FROM read_json({{Quote(eds)}},format='newline_delimited',columns={lotId:'VARCHAR',waferId:'VARCHAR',product:'VARCHAR',testedDies:'INTEGER',goodDies:'INTEGER',yieldPct:'DOUBLE',inspectedAt:'TIMESTAMP'});
        CREATE TABLE defects AS SELECT defectId AS defect_id,lotId AS lot_id,waferId AS wafer_id,defectType AS defect_type,severity,defectCount AS defect_count,inspectedAt AS inspected_at
          FROM read_json({{Quote(defects)}},format='newline_delimited',columns={defectId:'VARCHAR',lotId:'VARCHAR',waferId:'VARCHAR',defectType:'VARCHAR',severity:'VARCHAR',defectCount:'INTEGER',inspectedAt:'TIMESTAMP'});
        ALTER TABLE eds ADD PRIMARY KEY(lot_id,wafer_id);
        ALTER TABLE defects ADD PRIMARY KEY(defect_id);
        """;
        cmd.ExecuteNonQuery();ct.ThrowIfCancellationRequested();
        if (dataset.Config.Engine != "duckdb")
        {
            foreach (var name in new[] { "eds", "defects" })
            {
                var input = Path.Combine(dir, name + ".parquet");
                File.Delete(input);
                cmd.CommandText = $"COPY {name} TO {Quote(input)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 65536)";
                cmd.ExecuteNonQuery();
            }
            db.Close();
            var preparationMs = sw.Elapsed.TotalMilliseconds;
            var manifest = await remote.Execute(dataset, dir, ct);
            var totalMs = sw.Elapsed.TotalMilliseconds;
            await store.Finish(dataset, checked((int)manifest.RowCount), Path.Combine(dir, "parts", "manifest.json"), totalMs,
                new { engine = manifest.Engine, preparationMs, engineMs = manifest.EngineMs,
                    transferAndCoordinationMs = Math.Max(0, totalMs - preparationMs - manifest.EngineMs),
                    totalMs, resultFiles = manifest.Files.Count, details = manifest.Details });
            foreach (var input in new[] { eds, defects, Path.Combine(dir,"eds.parquet"), Path.Combine(dir,"defects.parquet") }) File.Delete(input);
            return;
        }
        var prepareMs = sw.Elapsed.TotalMilliseconds;
        dataset.Config.Validate();var r=dataset.Config;
        var source=r.Operation=="merge"
          ? "SELECT 'eds' AS source_type,lot_id,wafer_id,product,yield_pct,NULL::VARCHAR defect_id,NULL::VARCHAR defect_type,NULL::VARCHAR severity,NULL::INTEGER defect_count,inspected_at FROM eds UNION ALL SELECT 'defect',lot_id,wafer_id,NULL,NULL,defect_id,defect_type,severity,defect_count,inspected_at FROM defects"
          : $"SELECT coalesce(e.lot_id,d.lot_id) lot_id,coalesce(e.wafer_id,d.wafer_id) wafer_id,e.product,e.yield_pct,d.defect_id,d.defect_type,d.severity,d.defect_count,coalesce(e.inspected_at,d.inspected_at) inspected_at FROM eds e {r.JoinType.ToUpperInvariant()} JOIN defects d ON e.lot_id=d.lot_id AND e.wafer_id=d.wafer_id";
        cmd.CommandText=$"CREATE TABLE result AS SELECT row_number() OVER(ORDER BY lot_id,wafer_id,defect_id NULLS FIRST) AS row_id,* FROM ({source}) t WHERE (? IS NULL OR yield_pct>=?) AND (? IS NULL OR severity=?)";
        foreach(var value in new object?[]{r.MinYield,r.MinYield,r.Severity,r.Severity}){var p=cmd.CreateParameter();p.Value=value??DBNull.Value;cmd.Parameters.Add(p);}cmd.ExecuteNonQuery();cmd.Parameters.Clear();
        cmd.CommandText="SELECT count(*) FROM result";var count=Convert.ToInt32(cmd.ExecuteScalar());
        cmd.CommandText=$"COPY result TO {Quote(partial)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 16384)";cmd.ExecuteNonQuery();ct.ThrowIfCancellationRequested();
        db.Close(); // Release spill files before cleanup; the Parquet writer has completed.
        File.Move(partial,final,true);
        var total = sw.Elapsed.TotalMilliseconds;
        await store.Finish(dataset,count,final,total,new { engine = "duckdb", preparationMs = prepareMs, engineMs = total - prepareMs, totalMs = total, resultFiles = 1, threads = 2 });
        File.Delete(eds);File.Delete(defects);var spill=Path.Combine(dir,"spill");if(Directory.Exists(spill))Directory.Delete(spill,true);
    }
    public async Task<object> Read(Guid id,int afterId,int limit,CancellationToken ct)
    {
        if(afterId<0||limit<1||limit>10000)throw new ArgumentException("afterId must be nonnegative and limit 1..10000");
        var rows=await store.Query("SELECT status,result_rows,result_path FROM stream_datasets WHERE id=$1",id);
        if(rows.Count==0)throw new KeyNotFoundException("Dataset not found");
        if((string)rows[0]["status"]! !="ready")throw new InvalidOperationException("Dataset is not ready");
        var count=Convert.ToInt32(rows[0]["resultRows"]);var path=(string)rows[0]["resultPath"]!;
        await readers.WaitAsync(ct);
        try
        {
            if (path.EndsWith("manifest.json", StringComparison.Ordinal))
                return await ReadParts(id, path, count, afterId, limit, ct);
            using var db=Open();using var cmd=db.CreateCommand();cmd.CommandText=$"SELECT * FROM read_parquet({Quote(path)}) WHERE row_id>? AND row_id<=? ORDER BY row_id";
            cmd.Parameters.Add(new DuckDBParameter{Value=(long)afterId});cmd.Parameters.Add(new DuckDBParameter{Value=(long)afterId+limit});
            using var reader=cmd.ExecuteReader();var data=new List<Dictionary<string,object?>>();
            while(reader.Read()){ct.ThrowIfCancellationRequested();var item=new Dictionary<string,object?>();for(int i=0;i<reader.FieldCount;i++){var value=reader.IsDBNull(i)?null:reader.GetValue(i);item[reader.GetName(i)]=value is DateTime date?DateTime.SpecifyKind(date,DateTimeKind.Utc):value;}data.Add(item);}
            return new{datasetId=id,totalRows=count,returnedRows=data.Count,hasMore=(long)afterId+data.Count<count,sampling="none",data};
        }
        finally{readers.Release();}
    }

    async Task<object> ReadParts(Guid id, string path, int count, int afterId, int limit, CancellationToken ct)
    {
        var manifest = Wire.Deserialize<ResultManifest>(await File.ReadAllTextAsync(path, ct));
        RemoteEngines.ValidateManifest(manifest, manifest.Engine);
        if (manifest.RowCount != count) throw new InvalidDataException("Result metadata mismatch");
        var data = new List<Dictionary<string, object?>>();
        using var db = Open();
        foreach (var part in manifest.Files.Where(p => p.Offset < (long)afterId + limit && p.Offset + p.Rows > afterId))
        {
            // Names in this local manifest are generated by RemoteEngines, never supplied by the browser.
            if (Path.GetFileName(part.Name) != part.Name) throw new InvalidDataException("Invalid result part name");
            using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT file_row_number + {part.Offset + 1} AS row_id, * EXCLUDE(file_row_number) FROM read_parquet({Quote(Path.Combine(Path.GetDirectoryName(path)!, part.Name))}, file_row_number=true) WHERE file_row_number>=? AND file_row_number<? ORDER BY file_row_number";
            cmd.Parameters.Add(new DuckDBParameter { Value = Math.Max(0, afterId - part.Offset) });
            cmd.Parameters.Add(new DuckDBParameter { Value = Math.Min(part.Rows, (long)afterId + limit - part.Offset) });
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                ct.ThrowIfCancellationRequested();
                var row = new Dictionary<string, object?>();
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    var value = reader.IsDBNull(i) ? null : reader.GetValue(i);
                    row[reader.GetName(i)] = value is DateTime date ? DateTime.SpecifyKind(date, DateTimeKind.Utc) : value;
                }
                data.Add(row);
            }
        }
        if (data.Count != Math.Min(limit, Math.Max(0, count - afterId)))
            throw new InvalidDataException("Incomplete Parquet result page");
        return new { datasetId = id, engine = manifest.Engine, totalRows = count, returnedRows = data.Count, hasMore = (long)afterId + data.Count < count, sampling = "none", data };
    }
}
