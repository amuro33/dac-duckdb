using System.Text.Json;
using Dac.Worker;
using Xunit;
namespace Dac.Worker.Tests;
public class StoredQueryTests
{
    static readonly StoredQuery Query = new("EDS_BY_LOT", "oracle", "EDS", "Test", 1, "SELECT 1 FROM dual", JsonSerializer.SerializeToElement(new {}), [new("lot_id", "string", true, MaxLength:40),new("limit", "integer", false, 1, 1000),new("min_yield", "number", true, 0, 100)]);
    static JsonElement Body(object? lot = null, object? limit = null, object? min = null, string id = "EDS_BY_LOT", string database = "oracle") => JsonSerializer.SerializeToElement(new {database_name=database,query_id=id,lot_id=lot,limit=limit??100,min_yield=min});
    [Fact] public void BoundValuesPreserveTypes() { var b=StoredQueryInput.Bind(Query,Body("LOT-101",25,90.5));Assert.Equal("LOT-101",b["lot_id"]);Assert.IsType<int>(b["limit"]);Assert.Equal(90.5m,b["min_yield"]); }
    [Fact] public void InjectionIsOnlyAStringValue() => Assert.Equal("' OR 1=1 --",StoredQueryInput.Bind(Query,Body("' OR 1=1 --"))["lot_id"]);
    [Fact] public void NullableValueIsPreserved() => Assert.Null(StoredQueryInput.Bind(Query,Body())["lot_id"]);
    [Theory][InlineData(0)][InlineData(1001)][InlineData(1.5)] public void InvalidLimitRejected(double n) => Assert.Throws<ArgumentException>(()=>StoredQueryInput.Bind(Query,Body(limit:n)));
    [Fact] public void NumericStringRejected() => Assert.Throws<ArgumentException>(()=>StoredQueryInput.Bind(Query,Body(limit:"100")));
    [Fact] public void QueryIdMustMatchRoute() => Assert.Throws<ArgumentException>(()=>StoredQueryInput.Bind(Query,Body(id:"OTHER")));
    [Fact] public void DatabaseMustBeRegistered() => Assert.Throws<ArgumentException>(()=>StoredQueryInput.Bind(Query,Body(database:"external")));
    [Fact] public void UnknownBindingRejected() => Assert.Throws<ArgumentException>(()=>StoredQueryInput.Bind(Query,JsonSerializer.SerializeToElement(new {database_name="oracle",query_id="EDS_BY_LOT",sql="SELECT 1"})));
    [Fact] public void MissingBindingRejected() => Assert.Throws<ArgumentException>(()=>StoredQueryInput.Bind(Query,JsonSerializer.SerializeToElement(new {database_name="oracle",query_id="EDS_BY_LOT"})));
    [Fact] public void DuplicateFieldsRejected() { using var d=JsonDocument.Parse("{\"query_id\":\"A\",\"query_id\":\"B\"}");Assert.Throws<ArgumentException>(()=>StoredQueryInput.Bind(Query,d.RootElement)); }
    [Fact] public void InvalidBodyRejected() => Assert.Throws<ArgumentException>(()=>StoredQueryInput.Bind(Query,JsonSerializer.SerializeToElement(new[]{1,2})));
    [Theory][InlineData("../admin")][InlineData("query/id")][InlineData("")] public void UnsafeIdsRejected(string id) => Assert.False(StoredQueryInput.ValidId(id));
}
