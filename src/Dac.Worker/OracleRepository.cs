using Oracle.ManagedDataAccess.Client;
namespace Dac.Worker;
public sealed class OracleRepository(IConfiguration config) : IDataRepository {
 async Task<List<T>> Read<T>(string table, string columns, QueryFilter f, Func<OracleDataReader,T> map, CancellationToken ct) {
  Validation.Filter(f);
  using var c = new OracleConnection(config.GetConnectionString("Oracle") ?? throw new InvalidOperationException("Oracle connection not configured"));
  await c.OpenAsync(ct);
  using var cmd=c.CreateCommand(); cmd.BindByName=true;
  cmd.CommandText=$"SELECT {columns} FROM {table} WHERE (:lot IS NULL OR LOT_ID=:lot) AND (:wafer IS NULL OR WAFER_ID=:wafer) ORDER BY {columns.Split(',')[0]}, WAFER_ID FETCH FIRST :n ROWS ONLY";
  cmd.Parameters.Add("lot",OracleDbType.Varchar2).Value=(object?)f.LotId??DBNull.Value;
  cmd.Parameters.Add("wafer",OracleDbType.Varchar2).Value=(object?)f.WaferId??DBNull.Value;
  cmd.Parameters.Add("n",OracleDbType.Int32).Value=f.Limit;
  using var reader=(OracleDataReader)await cmd.ExecuteReaderAsync(ct); var rows=new List<T>();
  while(await reader.ReadAsync(ct)) rows.Add(map(reader)); return rows;
 }
 public async Task<IReadOnlyList<Eds>> GetEds(QueryFilter f,CancellationToken ct)=>await Read("DAC_EDS_DATA","LOT_ID,WAFER_ID,PRODUCT,TESTED_DIES,GOOD_DIES,YIELD_PCT,INSPECTED_AT",f,r=>new Eds(r.GetString(0),r.GetString(1),r.GetString(2),r.GetInt32(3),r.GetInt32(4),r.GetDecimal(5),r.IsDBNull(6)?null:DateTime.SpecifyKind(r.GetDateTime(6),DateTimeKind.Utc)),ct);
 public async Task<IReadOnlyList<Defect>> GetDefects(QueryFilter f,CancellationToken ct)=>await Read("(SELECT d.*,e.INSPECTED_AT FROM DAC_DEFECT_DATA d LEFT JOIN DAC_EDS_DATA e ON e.LOT_ID=d.LOT_ID AND e.WAFER_ID=d.WAFER_ID)","DEFECT_ID,LOT_ID,WAFER_ID,DEFECT_TYPE,SEVERITY,DEFECT_COUNT,INSPECTED_AT",f,r=>new Defect(r.GetString(0),r.GetString(1),r.GetString(2),r.GetString(3),r.GetString(4),r.GetInt32(5),r.IsDBNull(6)?null:DateTime.SpecifyKind(r.GetDateTime(6),DateTimeKind.Utc)),ct);
}
