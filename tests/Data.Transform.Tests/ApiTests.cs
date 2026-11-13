using System.Net;
using System.Net.Http.Json;
using Dac.Worker;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
namespace Data.Transform.Tests;
public class TransformFactory:WebApplicationFactory<Program>
{
 protected override void ConfigureWebHost(IWebHostBuilder b){b.UseEnvironment("Testing");b.ConfigureServices(s=>s.AddHttpClient<ApiDatasetSource>().ConfigurePrimaryHttpMessageHandler(()=>new SourceHandler()));}
}
public class SourceHandler:HttpMessageHandler
{
 protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct){object rows=request.RequestUri!.AbsolutePath.EndsWith("get_eds_data")?new Eds[]{new("L1","W1","DRAM",100,95,95)}:new Defect[]{new("D1","L1","W1","SCRATCH","HIGH",2)};return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=JsonContent.Create(rows)});}
}
public class TransformApiTests:IClassFixture<TransformFactory>
{
 readonly HttpClient client;
 public TransformApiTests(TransformFactory factory)=>client=factory.CreateClient();
 [Theory][InlineData("join")][InlineData("merge")][InlineData("filter")]
 public async Task CompatibilityCalculationLivesInSeparateService(string operation){var response=await client.PostAsJsonAsync("/api/transform/execute",new TransformRequest(Operation:operation));response.EnsureSuccessStatusCode();Assert.Contains("data-transform-service",await response.Content.ReadAsStringAsync());}
 [Fact]public async Task InvalidTransformRejected()=>Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/transform/execute",new TransformRequest(Operation:"sql"))).StatusCode);
}
