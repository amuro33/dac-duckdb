using Dac.Worker;
namespace Data.Transform;
// The workflow adapter consumes the two public API contracts, not Oracle directly.
public sealed class ApiDatasetSource(HttpClient http) {
 public async Task<(IReadOnlyList<Eds> Eds,IReadOnlyList<Defect> Defects)> Read(string? lotId,CancellationToken ct) {
  var query="?limit=1000"+(lotId is null?"":"&lotId="+Uri.EscapeDataString(lotId));
  var eds=await http.GetFromJsonAsync<List<Eds>>("api/dac/get_eds_data"+query,ct) ?? throw new InvalidOperationException("Empty EDS response");
  var defects=await http.GetFromJsonAsync<List<Defect>>("api/dac/get_defect_data"+query,ct) ?? throw new InvalidOperationException("Empty defect response");
  return(eds,defects);
 }
}
