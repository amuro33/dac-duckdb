using System.Net;
using System.Net.Http.Json;
using Dac.Worker;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;
namespace Dac.Worker.Tests;
public class ApiFactory:WebApplicationFactory<Program> {
 protected override void ConfigureWebHost(IWebHostBuilder builder)=>builder.ConfigureServices(s=>{s.RemoveAll<IDataRepository>();s.AddSingleton<IDataRepository,FakeRepository>();s.AddHttpClient<ApiDatasetSource>().ConfigurePrimaryHttpMessageHandler(()=>new DatasetHandler());});
}
public class FakeRepository:IDataRepository {
 public Task<IReadOnlyList<Eds>> GetEds(QueryFilter f,CancellationToken ct){Validation.Filter(f);return Task.FromResult<IReadOnlyList<Eds>>([new("L1","W1","DRAM",100,95,95)]);}
 public Task<IReadOnlyList<Defect>> GetDefects(QueryFilter f,CancellationToken ct){Validation.Filter(f);return Task.FromResult<IReadOnlyList<Defect>>([new("D1","L1","W1","SCRATCH","HIGH",2)]);}
}
public class ApiTests:IClassFixture<ApiFactory> {
 readonly HttpClient client;
 public ApiTests(ApiFactory f)=>client=f.CreateClient();
 [Theory][InlineData("/health/live")][InlineData("/health/ready")][InlineData("/api/dac/get_eds_data")][InlineData("/api/dac/get_defect_data")][InlineData("/api/dac/lots")][InlineData("/api/dac/summary")]
 public async Task RoutesRespond(string path)=>Assert.Equal(HttpStatusCode.OK,(await client.GetAsync(path)).StatusCode);
 [Theory][InlineData("join")][InlineData("merge")][InlineData("filter")]
 public async Task TransformRoutesRespond(string operation)=>Assert.Equal(HttpStatusCode.OK,(await client.PostAsJsonAsync("/api/dac/transform",new TransformRequest(Operation:operation))).StatusCode);
 [Fact]public async Task BadQueryReturns400()=>Assert.Equal(HttpStatusCode.BadRequest,(await client.GetAsync("/api/dac/get_eds_data?limit=0")).StatusCode);
 [Fact]public async Task BadOperationReturns400()=>Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/dac/transform",new TransformRequest(Operation:"sql"))).StatusCode);
 [Fact]public async Task InvalidJsonReturns400(){var r=await client.PostAsync("/api/dac/transform",new StringContent("{bad",System.Text.Encoding.UTF8,"application/json"));Assert.Equal(HttpStatusCode.BadRequest,r.StatusCode);}
}

public class DatasetHandler:HttpMessageHandler {
 protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct) {
  object rows=request.RequestUri!.AbsolutePath.EndsWith("get_eds_data") ? new Eds[]{new("L1","W1","DRAM",100,95,95)} : new Defect[]{new("D1","L1","W1","SCRATCH","HIGH",2)};
  return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=JsonContent.Create(rows)});
 }
}
