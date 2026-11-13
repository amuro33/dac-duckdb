using System.Net;
using System.Net.Http.Json;
using Chart.Worker;
using Xunit;
namespace Chart.Worker.Tests;

public class TransformedTests
{
    sealed class Pages : HttpMessageHandler
    {
        public List<string> Requests = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request.RequestUri!.ToString());
            var second = request.RequestUri.Query.Contains("afterId=2");
            object[] rows = second ? [new { row_id = 3, lot_id = "L2", yield_pct = 96, inspected_at = "2026-11-13T00:00:03Z" }] : [new { row_id = 1, lot_id = "L1", yield_pct = 95, inspected_at = "2026-11-13T00:00:01Z" }, new { row_id = 2, lot_id = "L1", yield_pct = 94, inspected_at = "2026-11-13T00:00:02Z" }];
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { totalRows = 3, data = rows }) });
        }
    }
    [Fact]
    public async Task ReadsEveryPersistedResultPageAndBuildsDateCharts()
    {
        var handler = new Pages();
        var client = new DataApiClient(new HttpClient(handler));
        var id = Guid.NewGuid();
        var request = new ChartRequest(Source: "transformed", Category: "lot_id", Legend: null, X: "inspected_at", Y: "yield_pct", XType: "date", DatasetId: id);
        var result = await new ChartBuilder().BuildAllAsync(client.ReadBatches("transformed", null, null, CancellationToken.None, id), request, CancellationToken.None);
        Assert.Equal(3, result.PlottedRows);
        Assert.Equal(2, result.Charts.Count);
        Assert.Equal("none", result.Sampling);
        Assert.Equal(2, handler.Requests.Count);
        Assert.All(handler.Requests, r => Assert.Contains(id.ToString(), r));
        Assert.Contains("afterId=2", handler.Requests[1]);
    }
    [Fact] public async Task DatasetIdentityRequired() => await Assert.ThrowsAsync<ArgumentException>(() => new DataApiClient(new HttpClient(new Pages())).Read("transformed", null, CancellationToken.None));
}
