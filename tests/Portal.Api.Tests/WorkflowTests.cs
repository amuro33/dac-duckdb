using Portal.Api;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;
namespace Portal.Api.Tests;

public class WorkflowTests
{
    static JsonObject O(string s) => JsonNode.Parse(s)!.AsObject();
    static WorkflowDefinition Simple() => new([new("q", "query", O("""{"queryId":"EDS_BY_LOT","queryVersion":1,"body":{"database_name":"oracle","query_id":"EDS_BY_LOT","lot_id":{"$input":"lot"}}}""")), new("out", "output", new())], [new("q", "out")], O("""{"lot":"LOT-101"}"""));
    static WorkflowData Data(string json) => WorkflowEngine.FromResponse(JsonSerializer.Deserialize<JsonElement>(json));
    static WorkflowData Left() => Data("""{"data":[{"id":1,"value":95,"label":"a"},{"id":2,"value":90,"label":null},{"id":null,"value":80,"label":"b"}]}""");
    static WorkflowData Right() => Data("""{"data":[{"id":1,"defect":"A"},{"id":1,"defect":"B"},{"id":3,"defect":"C"},{"id":null,"defect":"N"}]}""");
    static WorkflowNode Join(string kind) => new("j", "join", O($$"""{"joinType":"{{kind}}","keys":[{"left":"id","right":"id"}]}"""));
    [Fact]
    public void Orders_dependencies_and_preserves_inputs()
    {
        var d = Simple();
        d.Nodes.Reverse();
        Assert.Equal(new[] { "q", "out" }, WorkflowRules.Validate(d).Select(n => n.Id));
        var result = WorkflowRules.Resolve(d.Nodes[1].Config["body"], d.Inputs, new Dictionary<string, WorkflowData>())!;
        Assert.Equal("LOT-101", result["lot_id"]!.GetValue<string>());
        Assert.NotNull(d.Nodes[1].Config["body"]!["lot_id"]!["$input"]);
    }
    [Fact]
    public void Rejects_cycle()
    {
        var d = Simple();
        d.Nodes.Add(new("q2", "query", (JsonObject)d.Nodes[0].Config.DeepClone()));
        d.Edges.Add(new("q", "q2", "after"));
        d.Edges.Add(new("q2", "q", "after"));
        Assert.Throws<ArgumentException>(() => WorkflowRules.Validate(d));
    }
    [Fact]
    public void Rejects_orphan()
    {
        var d = Simple();
        d.Nodes.Add(new("q2", "query", (JsonObject)d.Nodes[0].Config.DeepClone()));
        Assert.Throws<ArgumentException>(() => WorkflowRules.Validate(d));
    }
    [Fact]
    public void Rejects_duplicate_ports()
    {
        var d = Simple();
        d.Edges.Add(new("q", "out"));
        Assert.Throws<ArgumentException>(() => WorkflowRules.Validate(d));
    }
    [Fact]
    public void Rejects_missing_input_reference()
    {
        var d = Simple();
        d.Inputs.Clear();
        Assert.Throws<ArgumentException>(() => WorkflowRules.Validate(d));
    }
    [Fact]
    public void Rejects_unconnected_reference()
    {
        var d = Simple();
        d.Nodes[0].Config["body"]!["lot_id"] = O("""{"$node":"other","column":"id"}""");
        Assert.Throws<ArgumentException>(() => WorkflowRules.Validate(d));
    }
    [Fact]
    public void Resolves_upstream_value_with_original_type()
    {
        var outputs = new Dictionary<string, WorkflowData> { { "q", Left() } };
        var v = WorkflowRules.Resolve(O("""{"$node":"q","column":"value","row":0}"""), new(), outputs)!;
        Assert.Equal(95, v.GetValue<decimal>());
        Assert.Throws<ArgumentException>(() => WorkflowRules.Resolve(O("""{"$node":"q","column":"value","row":50}"""), new(), outputs));
    }
    [Theory]
    [InlineData("inner", 2)]
    [InlineData("left", 4)]
    [InlineData("full", 6)]
    public void Join_preserves_multiplicity_and_null_semantics(string kind, int count)
    {
        var result = new WorkflowEngine().Transform(Join(kind), Left(), Right(), default);
        Assert.Equal(count, result.Rows.Count);
        Assert.Contains(result.Columns, c => c.Name == "right_id");
        Assert.Equal(2, result.Rows.Count(r => r["id"] is decimal d && d == 1));
    }
    [Fact]
    public void Merge_aligns_columns_and_keeps_duplicates()
    {
        var r = new WorkflowEngine().Transform(new("m", "merge", new()), Left(), Right(), default);
        Assert.Equal(7, r.Rows.Count);
        Assert.Contains(r.Columns, c => c.Name == "defect");
        Assert.Null(r.Rows[0]["defect"]);
    }
    [Fact]
    public void Merge_rejects_incompatible_types()
    {
        var right = Data("""{"data":[{"id":"1"}]}""");
        Assert.Throws<ArgumentException>(() => new WorkflowEngine().Transform(new("m", "merge", new()), Left(), right, default));
    }
    [Theory]
    [InlineData("gte", 95, 1)]
    [InlineData("lt", 95, 2)]
    [InlineData("eq", 90, 1)]
    [InlineData("ne", 90, 2)]
    public void Numeric_filter(string op, int value, int count)
    {
        var n = new WorkflowNode("f", "filter", O($$"""{"rules":[{"column":"value","op":"{{op}}","value":{{value}}}]}"""));
        Assert.Equal(count, new WorkflowEngine().Transform(n, Left(), null, default).Rows.Count);
    }
    [Fact]
    public void Filter_null()
    {
        var n = new WorkflowNode("f", "filter", O("""{"rules":[{"column":"label","op":"isNull"}]}"""));
        Assert.Single(new WorkflowEngine().Transform(n, Left(), null, default).Rows);
    }
    [Fact]
    public void Injection_literal_is_not_sql()
    {
        var n = new WorkflowNode("f", "filter", O("""{"rules":[{"column":"label","op":"eq","value":"' OR 1=1 --"}]}"""));
        Assert.Empty(new WorkflowEngine().Transform(n, Left(), null, default).Rows);
    }
    [Fact]
    public void Invalid_column_and_type_are_rejected()
    {
        var engine = new WorkflowEngine();
        Assert.Throws<ArgumentException>(() => engine.Transform(new("f", "filter", O("""{"rules":[{"column":"missing","op":"eq","value":1}]}""")), Left(), null, default));
        Assert.Throws<ArgumentException>(() => engine.Transform(new("f", "filter", O("""{"rules":[{"column":"id","op":"eq","value":"1"}]}""")), Left(), null, default));
    }
    [Fact]
    public void Empty_data_preserves_schema()
    {
        var empty = Data("""{"columns":[{"name":"id","type":"number"},{"name":"label","type":"string"}],"data":[]}""");
        var r = new WorkflowEngine().Transform(new("m", "merge", new()), empty, empty, default);
        Assert.Empty(r.Rows);
        Assert.Equal(2, r.Columns.Count);
    }
    [Fact]
    public void Join_expansion_limit_is_enforced()
    {
        var d = new WorkflowData([new("id", "number")], Enumerable.Range(0, 101).Select(_ => new Dictionary<string, object?> { { "id", 1m } }).ToList());
        Assert.Throws<ArgumentException>(() => new WorkflowEngine().Transform(Join("inner"), d, d, default));
    }
    [Fact]
    public void Cancellation_is_observed()
    {
        using var c = new CancellationTokenSource();
        c.Cancel();
        Assert.Throws<OperationCanceledException>(() => new WorkflowEngine().Transform(Join("inner"), Left(), Right(), c.Token));
    }

    [Fact] public void Malformed_config_returns_validation_error()
    {
        var d=Simple();d.Nodes[0].Config["queryVersion"]="not-a-number";
        Assert.Throws<ArgumentException>(()=>WorkflowRules.Validate(d));
    }
    [Fact] public void Excess_decimal_precision_is_rejected_without_rounding()
    {
        var d = new WorkflowData([new("id","number")], [new Dictionary<string, object?>{{"id",0.12345678901m}}]);
        Assert.Throws<ArgumentException>(()=>new WorkflowEngine().Transform(new("m","merge",new()),d,d,default));
    }
}
