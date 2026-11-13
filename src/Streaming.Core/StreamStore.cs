using Npgsql;
using System.Text.Json;
using System.Security.Cryptography;
namespace Streaming.Core;

public sealed class StreamStore(NpgsqlDataSource db)
{
    public async Task Init()
    {
        await using var c = await db.OpenConnectionAsync();
        await using var tx = await c.BeginTransactionAsync();
        await using var cmd = new NpgsqlCommand("""
        SELECT pg_advisory_xact_lock(70210550);
        CREATE TABLE IF NOT EXISTS stream_feeds(
            id uuid PRIMARY KEY,name varchar(80) NOT NULL,config jsonb NOT NULL,enabled bool NOT NULL,
            runs int NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),last_error text,
            created_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS stream_datasets(
            id uuid PRIMARY KEY,feed_id uuid NOT NULL REFERENCES stream_feeds(id),config jsonb NOT NULL,
            status text NOT NULL DEFAULT 'publishing',created_at timestamptz NOT NULL DEFAULT now(),
            published_at timestamptz,ready_at timestamptz,error text,result_rows int,result_path text,transform_ms double precision);
        CREATE INDEX IF NOT EXISTS stream_datasets_recent ON stream_datasets(created_at DESC);
        ALTER TABLE stream_datasets ADD COLUMN IF NOT EXISTS input_dataset_id uuid REFERENCES stream_datasets(id);
        ALTER TABLE stream_datasets ADD COLUMN IF NOT EXISTS execution jsonb;
        CREATE TABLE IF NOT EXISTS stream_batches(
            consumer_group text NOT NULL,dataset_id uuid NOT NULL REFERENCES stream_datasets(id),source text NOT NULL,
            sequence int NOT NULL,total_batches int NOT NULL,total_rows int NOT NULL,row_count int NOT NULL,
            checksum text NOT NULL,payload jsonb,topic text NOT NULL,partition_id int NOT NULL,kafka_offset bigint NOT NULL,
            received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(consumer_group,dataset_id,source,sequence));
        CREATE TABLE IF NOT EXISTS stream_failures(
            consumer_group text NOT NULL,topic text NOT NULL,partition_id int NOT NULL,kafka_offset bigint NOT NULL,
            error text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(consumer_group,topic,partition_id,kafka_offset));
        CREATE TABLE IF NOT EXISTS stream_heartbeats(role text PRIMARY KEY,updated_at timestamptz NOT NULL,error text);
        CREATE TABLE IF NOT EXISTS stream_outbox(id uuid PRIMARY KEY,dataset_id uuid NOT NULL UNIQUE,payload jsonb NOT NULL,published_at timestamptz);
        """, c, tx);
        await cmd.ExecuteNonQueryAsync(); await tx.CommitAsync();
    }
    static NpgsqlCommand Command(NpgsqlConnection c, string sql, params object?[] values)
    {
        var cmd = new NpgsqlCommand(sql, c);
        foreach(var value in values) cmd.Parameters.Add(new NpgsqlParameter { Value = value ?? DBNull.Value });
        return cmd;
    }
    public async Task<int> Execute(string sql, params object?[] args)
    { await using var c=await db.OpenConnectionAsync(); await using var cmd=Command(c,sql,args);return await cmd.ExecuteNonQueryAsync(); }
    public async Task<List<Dictionary<string,object?>>> Query(string sql, params object?[] args)
    {
        await using var c=await db.OpenConnectionAsync(); await using var cmd=Command(c,sql,args);await using var r=await cmd.ExecuteReaderAsync();
        var list=new List<Dictionary<string,object?>>();
        while(await r.ReadAsync())
        {
            var row=new Dictionary<string,object?>();
            for(int i=0;i<r.FieldCount;i++)
            {
                var parts=r.GetName(i).Split('_');var name=parts[0]+string.Concat(parts.Skip(1).Select(p=>char.ToUpperInvariant(p[0])+p[1..]));
                row[name]=r.IsDBNull(i)?null:r.GetDataTypeName(i)=="jsonb"?JsonSerializer.Deserialize<JsonElement>(r.GetString(i)):r.GetValue(i);
            }
            list.Add(row);
        }
        return list;
    }
    public Task Heartbeat(string role, string? error=null)=>Execute("INSERT INTO stream_heartbeats VALUES($1,now(),$2) ON CONFLICT(role) DO UPDATE SET updated_at=now(),error=EXCLUDED.error",role,error);
    public async Task<Guid> CreateFeed(FeedConfig config)
    {
        config.Validate();var id=Guid.NewGuid();
        await Execute("INSERT INTO stream_feeds(id,name,config,enabled) VALUES($1,$2,$3::jsonb,$4)",id,config.Name,Wire.Serialize(config),config.Enabled);return id;
    }
    public async Task<Dataset?> GetDataset(Guid id)
    {
        await using var c=await db.OpenConnectionAsync();await using var cmd=Command(c,"SELECT id,feed_id,config::text,status,created_at,input_dataset_id FROM stream_datasets WHERE id=$1",id);
        await using var r=await cmd.ExecuteReaderAsync();return await r.ReadAsync()?new(r.GetGuid(0),r.GetGuid(1),Wire.Deserialize<FeedConfig>(r.GetString(2)),r.GetString(3),r.GetDateTime(4),r.IsDBNull(5)?null:r.GetGuid(5)):null;
    }
    public async Task<bool> Ingest(string group, StreamBatch batch, string body, string topic, int partition, long offset)
    {
        batch.Validate();if(topic!="dac."+batch.Source+".v1")throw new InvalidDataException("Topic/source mismatch");
        var checksum=Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(body)));
        await using var c=await db.OpenConnectionAsync();await using var tx=await c.BeginTransactionAsync();
        await using(var gate=Command(c,"SELECT pg_advisory_xact_lock(hashtext($1));",batch.DatasetId.ToString()))await gate.ExecuteNonQueryAsync();
        await using(var dataset=Command(c,"SELECT feed_id FROM stream_datasets WHERE id=$1",batch.DatasetId))
        {var feed=await dataset.ExecuteScalarAsync();if(feed is not Guid f||f!=batch.FeedId)throw new InvalidDataException("Unknown dataset/feed");}
        await using(var existing=Command(c,"SELECT checksum FROM stream_batches WHERE consumer_group=$1 AND dataset_id=$2 AND source=$3 AND sequence=$4",group,batch.DatasetId,batch.Source,batch.Sequence))
        {
            var hash=await existing.ExecuteScalarAsync();
            if(hash is string h){if(h!=checksum)throw new InvalidDataException("Conflicting duplicate batch");await tx.CommitAsync();return false;}
        }
        await using(var manifest=Command(c,"SELECT count(*) FROM stream_batches WHERE consumer_group=$1 AND dataset_id=$2 AND source=$3 AND (total_rows<>$4 OR total_batches<>$5)",group,batch.DatasetId,batch.Source,batch.TotalRows,batch.TotalBatches))
            if((long)(await manifest.ExecuteScalarAsync())!>0)throw new InvalidDataException("Dataset manifest changed");
        await using(var insert=Command(c,"INSERT INTO stream_batches(consumer_group,dataset_id,source,sequence,total_batches,total_rows,row_count,checksum,payload,topic,partition_id,kafka_offset) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)",group,batch.DatasetId,batch.Source,batch.Sequence,batch.TotalBatches,batch.TotalRows,batch.Rows.Length,checksum,group==Wire.TransformGroup?Wire.Serialize(batch.Rows):null,topic,partition,offset))await insert.ExecuteNonQueryAsync();
        await tx.CommitAsync();return true;
    }
    public async Task<bool> Complete(Guid id, string group=Wire.TransformGroup)
    {
        var dataset = await GetDataset(id);
        id = dataset?.InputDatasetId ?? id;
        var rows=await Query("SELECT source,count(*) AS batches,max(total_batches) AS expected_batches,sum(row_count) AS rows,max(total_rows) AS expected_rows,min(sequence) AS first,max(sequence) AS last FROM stream_batches WHERE dataset_id=$1 AND consumer_group=$2 GROUP BY source",id,group);
        return rows.Count==2&&rows.All(r=>Convert.ToInt64(r["batches"])==Convert.ToInt64(r["expectedBatches"])&&Convert.ToInt64(r["rows"])==Convert.ToInt64(r["expectedRows"])&&Convert.ToInt32(r["first"])==0&&Convert.ToInt32(r["last"])==Convert.ToInt32(r["expectedBatches"])-1);
    }
    public async Task WriteInput(Guid id,string source,string path,CancellationToken ct)
    {
        await using var c=await db.OpenConnectionAsync(ct);await using var cmd=Command(c,"SELECT payload::text FROM stream_batches WHERE consumer_group=$1 AND dataset_id=$2 AND source=$3 ORDER BY sequence",Wire.TransformGroup,id,source);
        await using var r=await cmd.ExecuteReaderAsync(ct);await using var file=new StreamWriter(path,false);
        while(await r.ReadAsync(ct)){using var doc=JsonDocument.Parse(r.GetString(0));foreach(var row in doc.RootElement.EnumerateArray())await file.WriteLineAsync(row.GetRawText().AsMemory(),ct);}
    }
    public async Task Finish(Dataset dataset,int count,string path,double ms,object? execution = null)
    {
        await using var c=await db.OpenConnectionAsync();await using var tx=await c.BeginTransactionAsync();
        var eventId=Guid.NewGuid();var body=Wire.Serialize(new{schemaVersion=1,eventId,datasetId=dataset.Id,feedId=dataset.FeedId,rowCount=count,completedAt=DateTime.UtcNow});
        await using(var cmd=Command(c,"UPDATE stream_datasets SET status='ready',result_rows=$2,result_path=$3,transform_ms=$4,ready_at=now(),error=NULL,execution=$5::jsonb WHERE id=$1 AND status='processing'",dataset.Id,count,path,ms,Wire.Serialize(execution)))if(await cmd.ExecuteNonQueryAsync()!=1)throw new InvalidDataException("Dataset invalidated while transforming");
        await using(var cmd=Command(c,"INSERT INTO stream_outbox(id,dataset_id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(dataset_id) DO NOTHING",eventId,dataset.Id,body))await cmd.ExecuteNonQueryAsync();
        await tx.CommitAsync();
    }
    public Task Fail(Guid id,string message)=>Execute("UPDATE stream_datasets SET status='failed',error=$2 WHERE id=$1 AND status<>'ready'",id,message[..Math.Min(message.Length,1000)]);
    public async Task<Guid> Analyze(Guid id, string engine)
    {
        Engines.Validate(engine);
        var original = await GetDataset(id) ?? throw new KeyNotFoundException("Dataset not found");
        if (original.Status != "ready" || !await Complete(id))
            throw new InvalidOperationException("A complete ready dataset is required for engine comparison");
        var next = Guid.NewGuid();
        await Execute("INSERT INTO stream_datasets(id,feed_id,config,status,published_at,input_dataset_id) VALUES($1,$2,$3::jsonb,'published',now(),$4)",
            next, original.FeedId, Wire.Serialize(original.Config with { Engine = engine }), original.InputDatasetId ?? original.Id);
        return next;
    }
}
