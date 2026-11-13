using Oracle.ManagedDataAccess.Client;
using System.Runtime.CompilerServices;
namespace Dac.Worker;

public sealed class BenchmarkRepository(IConfiguration config)
{
    public static void Validate(string source, int size, int limit, string? lotId)
    {
        if (source is not ("eds" or "defects" or "joined")) throw new ArgumentException("Invalid source");
        if (size is not (1000 or 10000 or 100000 or 1000000)) throw new ArgumentException("Invalid sampleSize");
        if (limit < 1 || limit > 1000000) throw new ArgumentException("Page limit must be 1..1000000");
        if (lotId?.Length > 40) throw new ArgumentException("lotId too long");
    }
    public async Task<object> Read(string source, int size, int limit, string? lotId, CancellationToken ct, int afterId = 0)
    {
        Validate(source, size, limit, lotId);
        if (afterId < 0 || afterId > size) throw new ArgumentException("Invalid afterId cursor");
        using var connection = new OracleConnection(config.GetConnectionString("Oracle"));
        await connection.OpenAsync(ct);
        using var count = connection.CreateCommand();
        count.BindByName = true;
        count.CommandText = "SELECT COUNT(*),COUNT(CASE WHEN SAMPLE_ID>:after_id THEN 1 END) FROM DAC_CHART_BENCHMARK WHERE SAMPLE_ID<=:row_count AND (:lot IS NULL OR LOT_ID=:lot)";
        count.Parameters.Add("after_id", OracleDbType.Int32).Value = afterId;
        count.Parameters.Add("row_count", OracleDbType.Int32).Value = size;
        count.Parameters.Add("lot", OracleDbType.Varchar2).Value = (object?)lotId ?? DBNull.Value;
        using var reader = (OracleDataReader)await count.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);
        var total = reader.GetInt32(0);
        var remaining = reader.GetInt32(1);
        return new { requestedSize = size, totalRows = total, returnedRows = Math.Min(remaining, limit), hasMore = remaining > limit, sampling = "none", data = ReadRows(source, size, limit, lotId, afterId, ct) };
    }
    private async IAsyncEnumerable<object> ReadRows(string source, int size, int limit, string? lotId, int afterId, [EnumeratorCancellation] CancellationToken ct)
    {
        using var connection = new OracleConnection(config.GetConnectionString("Oracle"));
        await connection.OpenAsync(ct);
        using var cmd = connection.CreateCommand();
        cmd.BindByName = true;
        cmd.CommandTimeout = 180;
        cmd.CommandText = "SELECT SAMPLE_ID,LOT_ID,WAFER_ID,PRODUCT,TESTED_DIES,GOOD_DIES,YIELD_PCT,INSPECTED_AT,DEFECT_TYPE,SEVERITY,DEFECT_COUNT FROM DAC_CHART_BENCHMARK WHERE SAMPLE_ID<=:row_count AND SAMPLE_ID>:after_id AND (:lot IS NULL OR LOT_ID=:lot) ORDER BY SAMPLE_ID FETCH FIRST :lim ROWS ONLY";
        cmd.Parameters.Add("row_count", OracleDbType.Int32).Value = size;
        cmd.Parameters.Add("after_id", OracleDbType.Int32).Value = afterId;
        cmd.Parameters.Add("lot", OracleDbType.Varchar2).Value = (object?)lotId ?? DBNull.Value;
        cmd.Parameters.Add("lim", OracleDbType.Int32).Value = limit;
        using var r = (OracleDataReader)await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            var id = r.GetInt32(0); var lot = r.GetString(1); var wafer = r.GetString(2); var product = r.GetString(3);
            var tested = r.GetInt32(4); var good = r.GetInt32(5); var yield = r.GetDecimal(6);
            var date = DateTime.SpecifyKind(r.GetDateTime(7), DateTimeKind.Utc);
            var type = r.GetString(8); var severity = r.GetString(9); var defects = r.GetInt32(10);
            yield return source switch
            {
                "eds" => new { sampleId = id, lotId = lot, waferId = wafer, product, testedDies = tested, goodDies = good, yieldPct = yield, inspectedAt = date },
                "defects" => (object)new { sampleId = id, defectId = "B" + id, lotId = lot, waferId = wafer, defectType = type, severity, defectCount = defects, inspectedAt = date },
                _ => new { sample_id = id, lot_id = lot, wafer_id = wafer, product, yield_pct = yield, inspected_at = date, defect_id = "B" + id, defect_type = type, severity, defect_count = defects }
            };
        }
    }
}
