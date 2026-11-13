using System.Net;
using System.Net.Http.Json;
using Chart.Worker;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
namespace Chart.Worker.Tests;
public class ChartFactory:WebApplicationFactory<Program>{
 protected override void ConfigureWebHost(IWebHostBuilder b)=>b.ConfigureServices(s=>{s.AddHttpClient<DataApiClient>().ConfigurePrimaryHttpMessageHandler(()=>new Upstream());s.AddHttpClient("renderer").ConfigurePrimaryHttpMessageHandler(()=>new Renderer());});
}
public class Upstream:HttpMessageHandler {
 protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req,CancellationToken ct){
  if(req.RequestUri!.Query.Contains("FAIL"))return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
  if(req.RequestUri.Query.Contains("EMPTY"))return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=JsonContent.Create(Array.Empty<object>())});
  if(req.RequestUri.Query.Contains("OVERFLOW"))return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=JsonContent.Create(Enumerable.Range(0,1000).Select(n=>new{lotId="A",product="P1",waferId="W1",yieldPct=n}))});
  var data=new[]{new{lotId="A",product="P1",waferId="W1",yieldPct=95}};
  return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=JsonContent.Create(data)});
 }
}
public class Renderer:HttpMessageHandler {
 protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r,CancellationToken ct)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent("<svg/>")});
}
public class ApiTests:IClassFixture<ChartFactory>{
 readonly HttpClient http;public ApiTests(ChartFactory factory)=>http=factory.CreateClient();
 [Theory][InlineData("/health/live")][InlineData("/health/ready")][InlineData("/api/chart/columns?source=eds")]
 public async Task GetRoutesWork(string path)=>Assert.Equal(HttpStatusCode.OK,(await http.GetAsync(path)).StatusCode);
 [Fact]public async Task ScatterEndpointReturnsNeutralSpec(){var r=await http.PostAsJsonAsync("/api/chart/scatter",new ChartRequest());r.EnsureSuccessStatusCode();var spec=await r.Content.ReadFromJsonAsync<ScatterSpec>();Assert.Single(spec!.Charts);Assert.Equal("scatter",spec.ChartType);}
 [Theory][InlineData("svg")][InlineData("png")][InlineData("html")]
 public async Task RenderRoutesWork(string format)=>Assert.Equal(HttpStatusCode.OK,(await http.PostAsJsonAsync("/api/chart/render?format="+format,new ChartRequest())).StatusCode);
 [Theory][InlineData("/api/chart/render?format=gif")][InlineData("/api/chart/render?categoryIndex=99")][InlineData("/api/chart/render?width=10")]
 public async Task RenderValidation(string path)=>Assert.Equal(HttpStatusCode.BadRequest,(await http.PostAsJsonAsync(path,new ChartRequest())).StatusCode);
 [Fact]public async Task UnknownSourceCannotFetchArbitraryUrl()=>Assert.Equal(HttpStatusCode.BadRequest,(await http.GetAsync("/api/chart/columns?source=http://example.com")).StatusCode);
 [Fact]public async Task UnknownColumnReturns400()=>Assert.Equal(HttpStatusCode.BadRequest,(await http.PostAsJsonAsync("/api/chart/scatter",new ChartRequest(X:"missing"))).StatusCode);
 [Fact]public async Task StringYReturns400()=>Assert.Equal(HttpStatusCode.BadRequest,(await http.PostAsJsonAsync("/api/chart/scatter",new ChartRequest(Y:"product"))).StatusCode);
 [Fact]public async Task UpstreamFailureReturns502()=>Assert.Equal(HttpStatusCode.BadGateway,(await http.PostAsJsonAsync("/api/chart/scatter",new ChartRequest(LotId:"FAIL"))).StatusCode);
 [Fact]public async Task OverflowFailsInsteadOfTruncating()=>Assert.Equal(HttpStatusCode.BadRequest,(await http.PostAsJsonAsync("/api/chart/scatter",new ChartRequest(LotId:"OVERFLOW"))).StatusCode);
 [Fact]public async Task EmptyApiResultHasNoCharts(){var r=await http.PostAsJsonAsync("/api/chart/scatter",new ChartRequest(LotId:"EMPTY"));r.EnsureSuccessStatusCode();Assert.Empty((await r.Content.ReadFromJsonAsync<ScatterSpec>())!.Charts);}

}
