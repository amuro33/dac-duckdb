using System.Net;
using System.Net.Http.Json;
using Chart.Worker;
using Xunit;
namespace Chart.Worker.Tests;

public class SnapshotTests
{
    sealed class Response(HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
    {
        public Uri? Requested;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requested = request.RequestUri;
            return Task.FromResult(new HttpResponseMessage(status) { Content = JsonContent.Create(new {
                totalRows = 0, data = Array.Empty<object>(),
                columns = new[] { new { name = "event_time", type = "date" }, new { name = "measurement", type = "number" } }
            }) });
        }
    }
    [Fact] public async Task EmptySnapshotPreservesDeclaredSchemaAndIdentity()
    {
        var handler = new Response(); var id = Guid.NewGuid();
        var client = new DataApiClient(new HttpClient(handler));
        var pages = new List<Dataset>();
        await foreach (var page in client.ReadBatches("snapshot", null, null, CancellationToken.None, id)) pages.Add(page);
        var result = Assert.Single(pages);
        Assert.Empty(result.Rows); Assert.Equal(0, result.TotalRows);
        Assert.Equal("date", result.Columns.Single(c => c.Name == "event_time").Type);
        Assert.Contains($"api/sources/{id}/rows?offset=0&limit=10000", handler.Requested!.ToString());
    }
    [Fact] public async Task MissingSnapshotReturnsActionableError()
    {
        var client = new DataApiClient(new HttpClient(new Response(HttpStatusCode.NotFound)));
        await Assert.ThrowsAsync<ArgumentException>(() => client.Read("snapshot", null, CancellationToken.None, datasetId: Guid.NewGuid()));
    }
    [Fact] public async Task SnapshotRequiresIdentityBeforeNetworkRequest()
    {
        var handler = new Response(); var client = new DataApiClient(new HttpClient(handler));
        await Assert.ThrowsAsync<ArgumentException>(() => client.Read("snapshot", null, CancellationToken.None));
        Assert.Null(handler.Requested);
    }
}
