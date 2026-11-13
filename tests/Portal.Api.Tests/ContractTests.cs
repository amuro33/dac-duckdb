using Portal.Api;
using Xunit;
using System.Text.Json;
namespace Portal.Api.Tests;

public class ContractTests
{
    JsonElement Config(string source = "eds", int? size = null) => JsonSerializer.SerializeToElement(new { source, x = "waferId", y = "yieldPct", xType = "string", sampleSize = size });
    [Theory]
    [InlineData("/api/dac/get_eds_data?limit=100", "GET", "dac")]
    [InlineData("/api/chart/scatter", "POST", "chart")]
    [InlineData("/api/dac/transform", "POST", "dac")]
    public void RegisteredEndpointsWork(string path, string method, string expected) => Assert.Equal(expected, Guard.Target(new(path, method)));
    [Theory]
    [InlineData("http://evil.example/api/dac/lots", "GET")]
    [InlineData("//evil.example/api/dac/lots", "GET")]
    [InlineData("/api/dac/lots", "DELETE")]
    [InlineData("/api/dac/lots#x", "GET")]
    [InlineData("/api/dac/../admin", "GET")]
    [InlineData("/api/chart/render", "POST")]
    public void UnregisteredRoutesRejected(string path, string method) => Assert.Throws<ArgumentException>(() => Guard.Target(new(path, method)));
    [Theory][InlineData(1000)][InlineData(10000)][InlineData(100000)][InlineData(1000000)] public void SizesAccepted(int n) => Guard.Config(Config(size: n));
    [Fact] public void UnknownSourceRejected() => Assert.Throws<ArgumentException>(() => Guard.Config(Config("external")));
    [Fact] public void InvalidSizeRejected() => Assert.Throws<ArgumentException>(() => Guard.Config(Config(size: 999)));
    [Theory][InlineData("")][InlineData("   ")] public void BlankNameRejected(string name) => Assert.Throws<ArgumentException>(() => Guard.View(new(name, "", Config())));
    [Fact] public void LongNameRejected() => Assert.Throws<ArgumentException>(() => Guard.View(new(new string('a', 81), "", Config())));
    [Fact] public void IncompleteConfigRejected() => Assert.Throws<ArgumentException>(() => Guard.Config(JsonSerializer.SerializeToElement(new { x = "x" })));
    [Fact] public void NullPathReturnsValidationError() => Assert.Throws<ArgumentException>(() => Guard.Target(new(null!)));
    [Fact] public void WrongScalarTypesAreRejected() => Assert.Throws<ArgumentException>(() => Guard.Config(JsonSerializer.SerializeToElement(new { source = "eds", x = "x", y = "y", xType = "number", sampleSize = "1000" })));
    [Fact] public void ArrayCategoryIsRejected() => Assert.Throws<ArgumentException>(() => Guard.Config(JsonSerializer.SerializeToElement(new { source = "eds", x = "x", y = "y", xType = "number", category = new[] { "a" } })));


    [Theory]
    [InlineData("pointSize", "21")]
    [InlineData("pointSize", "\"6\"")]
    [InlineData("showLabels", "1")]
    [InlineData("labelFontSize", "11.5")]
    [InlineData("labelFontSize", "30")]
    public void InvalidAppearanceCannotBeSaved(string field, string value)
    {
        using var doc = JsonDocument.Parse("{\"source\":\"eds\",\"x\":\"inspectedAt\",\"y\":\"yieldPct\",\"xType\":\"date\",\"" + field + "\":" + value + "}");
        Assert.Throws<ArgumentException>(() => Guard.Config(doc.RootElement));
    }
}

public class StreamingRoutesTests
{
    [Xunit.Theory]
    [Xunit.InlineData("GET", "/api/streams/status")]
    [Xunit.InlineData("GET", "/api/streams/engines")]
    [Xunit.InlineData("POST", "/api/streams/datasets/11111111-1111-1111-1111-111111111111/analyze")]
    [Xunit.InlineData("GET", "/api/streams/feeds")]
    [Xunit.InlineData("POST", "/api/streams/feeds")]
    [Xunit.InlineData("GET", "/api/streams/datasets/11111111-1111-1111-1111-111111111111/rows?limit=1000")]
    [Xunit.InlineData("POST", "/api/streams/feeds/11111111-1111-1111-1111-111111111111/stop")]
    public void ExplicitStreamRoutesAllowed(string method, string path) => Xunit.Assert.Equal("transform", Portal.Api.Guard.Target(new(path, method)));
    [Xunit.Theory]
    [Xunit.InlineData("DELETE", "/api/streams/feeds")]
    [Xunit.InlineData("POST", "/api/streams/engines")]
    [Xunit.InlineData("GET", "/api/streams/datasets/11111111-1111-1111-1111-111111111111/analyze")]
    [Xunit.InlineData("POST", "/api/streams/datasets")]
    [Xunit.InlineData("GET", "/api/streams/datasets/not-a-guid/rows")]
    [Xunit.InlineData("POST", "/api/streams/feeds/11111111-1111-1111-1111-111111111111/delete")]
    public void UnregisteredRoutesRejected(string method, string path) => Xunit.Assert.Throws<ArgumentException>(() => Portal.Api.Guard.Target(new(path, method)));

    [Theory][InlineData("duckdb")][InlineData("spark")][InlineData("drill")][InlineData("datafusion")]
    public void SavedViewsRetainSupportedEngines(string engine) => Guard.Config(JsonSerializer.SerializeToElement(new { source="joined",x="inspected_at",y="yield_pct",xType="date",engine }));
    [Fact] public void UnknownSavedEngineRejected() => Assert.Throws<ArgumentException>(() => Guard.Config(JsonSerializer.SerializeToElement(new { source="joined",x="inspected_at",y="yield_pct",xType="date",engine="fake" })));
}
