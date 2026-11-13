using System.Net;
using System.Net.Http.Json;
using Chart.Worker;
using Xunit;
namespace Chart.Worker.Tests;
public class PagingTests
{
    private sealed class Pages(bool repeat=false):HttpMessageHandler
    {
        public List<string> Requests {get;}=[];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            Requests.Add(request.RequestUri!.Query);
            var ids=request.RequestUri.Query.Contains("afterId=2")&&!repeat?new[]{3}:new[]{1,2};
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=JsonContent.Create(new{totalRows=3,sampling="none",data=ids.Select(id=>new{sampleId=id,x=id,y=id})})});
        }
    }
    [Fact]public async Task FollowsCursorUntilExactTotalWithoutDroppingRows()
    {
        var handler=new Pages();var api=new DataApiClient(new HttpClient(handler){BaseAddress=new Uri("http://test/")});
        var ids=new List<int>();await foreach(var page in api.ReadBatches("eds",null,1000,default))ids.AddRange(page.Rows.Select(r=>r["sampleId"].GetInt32()));
        Assert.Equal(new[]{1,2,3},ids);Assert.Equal(2,handler.Requests.Count);Assert.Contains("afterId=2",handler.Requests[1]);
    }
    [Fact]public async Task RepeatedCursorIsAnErrorInsteadOfInfiniteLoop()
    {
        var api=new DataApiClient(new HttpClient(new Pages(true)){BaseAddress=new Uri("http://test/")});
        await Assert.ThrowsAsync<InvalidOperationException>(async()=>{await foreach(var page in api.ReadBatches("eds",null,1000,default)){} });
    }
}
