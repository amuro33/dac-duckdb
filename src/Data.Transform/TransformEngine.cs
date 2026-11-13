using DuckDB.NET.Data;
using Dac.Worker;
namespace Data.Transform;
public sealed class TransformEngine {
 public List<Dictionary<string,object?>> Execute(IReadOnlyList<Eds> eds,IReadOnlyList<Defect> defects,TransformRequest r) {
  Validation.Transform(r);
  using var db=new DuckDBConnection("DataSource=:memory:"); db.Open();
  void Run(string sql, params object?[] args) { using var c=db.CreateCommand(); c.CommandText=sql; foreach(var v in args) {var p=c.CreateParameter();p.Value=v??DBNull.Value;c.Parameters.Add(p);} c.ExecuteNonQuery(); }
  Run("CREATE TABLE eds(lot_id VARCHAR,wafer_id VARCHAR,product VARCHAR,tested_dies INTEGER,good_dies INTEGER,yield_pct DECIMAL(6,2),inspected_at TIMESTAMP); CREATE TABLE defects(defect_id VARCHAR,lot_id VARCHAR,wafer_id VARCHAR,defect_type VARCHAR,severity VARCHAR,defect_count INTEGER,inspected_at TIMESTAMP)");
  foreach(var e in eds) Run("INSERT INTO eds VALUES (?,?,?,?,?,?,?)",e.LotId,e.WaferId,e.Product,e.TestedDies,e.GoodDies,e.YieldPct,e.InspectedAt);
  foreach(var d in defects) Run("INSERT INTO defects VALUES (?,?,?,?,?,?,?)",d.DefectId,d.LotId,d.WaferId,d.DefectType,d.Severity,d.DefectCount,d.InspectedAt);
  // Merge is a vertical UNION ALL with a common schema; join preserves defect detail.
  var source=r.Operation=="merge"
   ? "SELECT 'eds' AS source_type,lot_id,wafer_id,product,yield_pct,NULL::VARCHAR defect_id,NULL::VARCHAR defect_type,NULL::VARCHAR severity,NULL::INTEGER defect_count,inspected_at FROM eds UNION ALL SELECT 'defect',lot_id,wafer_id,NULL,NULL,defect_id,defect_type,severity,defect_count,inspected_at FROM defects"
   : $"SELECT coalesce(e.lot_id,d.lot_id) lot_id,coalesce(e.wafer_id,d.wafer_id) wafer_id,e.product,e.yield_pct,d.defect_id,d.defect_type,d.severity,d.defect_count,coalesce(e.inspected_at,d.inspected_at) inspected_at FROM eds e {r.JoinType.ToUpperInvariant()} JOIN defects d ON e.lot_id=d.lot_id AND e.wafer_id=d.wafer_id";
  using var cmd=db.CreateCommand(); cmd.CommandText=$"SELECT * FROM ({source}) t WHERE (? IS NULL OR lot_id=?) AND (? IS NULL OR yield_pct>=?) AND (? IS NULL OR severity=?) ORDER BY lot_id,wafer_id,defect_id NULLS FIRST LIMIT ?";
  foreach(var v in new object?[]{r.LotId,r.LotId,r.MinYield,r.MinYield,r.Severity,r.Severity,r.Limit}) {var p=cmd.CreateParameter();p.Value=v??DBNull.Value;cmd.Parameters.Add(p);}
  using var reader=cmd.ExecuteReader(); var result=new List<Dictionary<string,object?>>();
  while(reader.Read()) {var row=new Dictionary<string,object?>();for(int i=0;i<reader.FieldCount;i++) row[reader.GetName(i)]=reader.IsDBNull(i)?null:reader.GetValue(i);result.Add(row);} return result;
 }
}
