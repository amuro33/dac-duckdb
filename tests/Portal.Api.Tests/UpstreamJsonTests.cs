using System.Text;
using System.Text.Json;
using Portal.Api;
using Xunit;

namespace Portal.Api.Tests;

public class UpstreamJsonTests
{
    [Fact] public async Task EmptyRetryAcknowledgmentIsValid()
    {
        using var content=new ByteArrayContent([]);
        Assert.Equal(JsonValueKind.Null,(await UpstreamJson.Read(content,default)).ValueKind);
    }
    [Fact] public async Task NonemptyJsonRetainsErrorDetails()
    {
        using var content=new StringContent("{\"detail\":\"engine offline\"}",Encoding.UTF8,"application/json");
        Assert.Equal("engine offline",(await UpstreamJson.Read(content,default)).GetProperty("detail").GetString());
    }
    [Fact] public async Task MalformedResponseIsNotAnEmptySuccess()
    {
        using var content=new StringContent("not json",Encoding.UTF8,"application/json");
        await Assert.ThrowsAsync<JsonException>(()=>UpstreamJson.Read(content,default));
    }
}
