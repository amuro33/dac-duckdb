namespace Dac.Worker;
public record Eds(string LotId, string WaferId, string Product, int TestedDies, int GoodDies, decimal YieldPct, DateTime? InspectedAt = null);
public record Defect(string DefectId, string LotId, string WaferId, string DefectType, string Severity, int DefectCount, DateTime? InspectedAt = null);
public record TransformRequest(string Operation = "join", string JoinType = "left", string? LotId = null, decimal? MinYield = null, string? Severity = null, int Limit = 100);
public record QueryFilter(string? LotId = null, string? WaferId = null, int Limit = 100);
public interface IDataRepository {
 Task<IReadOnlyList<Eds>> GetEds(QueryFilter filter, CancellationToken ct);
 Task<IReadOnlyList<Defect>> GetDefects(QueryFilter filter, CancellationToken ct);
}
public static class Validation {
 public static void Filter(QueryFilter f) { if(f.Limit is < 1 or > 1000) throw new ArgumentException("limit must be 1..1000"); if(f.LotId?.Length > 40 || f.WaferId?.Length > 40) throw new ArgumentException("identifier too long"); }
 public static void Transform(TransformRequest r) {
  Filter(new(r.LotId, Limit:r.Limit));
  if(r.Operation is not ("join" or "merge" or "filter")) throw new ArgumentException("operation must be join, merge or filter");
  if(r.JoinType is not ("inner" or "left" or "full")) throw new ArgumentException("joinType must be inner, left or full");
  if(r.MinYield is < 0 or > 100) throw new ArgumentException("minYield must be 0..100");
  if(r.Severity is not (null or "LOW" or "MEDIUM" or "HIGH" or "CRITICAL")) throw new ArgumentException("invalid severity");
 }
}
