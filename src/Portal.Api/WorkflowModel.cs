using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace Portal.Api;

public record WorkflowNode(string Id, string Kind, JsonObject Config, double X = 0, double Y = 0);
public record WorkflowEdge(string Source, string Target, string Port = "input");
public record WorkflowDefinition(List<WorkflowNode> Nodes, List<WorkflowEdge> Edges, JsonObject Inputs);
public record WorkflowSave(string Name, WorkflowDefinition Definition, int Revision = 0);
public record WorkflowStart(int? Version, JsonObject Inputs);
public record WorkflowColumn(string Name, string Type);
public record WorkflowData(List<WorkflowColumn> Columns, List<Dictionary<string, object?>> Rows);

public static class WorkflowRules
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaxRows = 10000;
    public static string Text(JsonObject c, string key, string fallback = "") => c[key]?.GetValue<string>() ?? fallback;
    public static bool Id(string? id) => id != null && Regex.IsMatch(id, "\\A[a-zA-Z][a-zA-Z0-9_-]{0,79}\\z");
    public static List<WorkflowNode> Validate(WorkflowDefinition d)
    {
        try
        {
            return ValidateCore(d);
        }
        catch (InvalidOperationException) { throw new ArgumentException("노드 설정의 JSON 타입을 확인하세요."); }
        catch (FormatException) { throw new ArgumentException("노드 설정의 값 형식을 확인하세요."); }
    }
    static List<WorkflowNode> ValidateCore(WorkflowDefinition d)
    {
        if (d?.Nodes == null || d.Edges == null || d.Inputs == null || d.Nodes.Count is < 1 or > 30 || d.Edges.Count > 100)
            throw new ArgumentException("워크플로우는 1~30개 노드로 구성하세요.");
        if (d.Nodes.Any(n => n == null || !Id(n.Id) || n.Config == null) || d.Nodes.Select(n => n.Id).Distinct().Count() != d.Nodes.Count)
            throw new ArgumentException("노드 ID가 중복되거나 올바르지 않습니다.");
        var map = d.Nodes.ToDictionary(n => n.Id);
        if (d.Nodes.Count(n => n.Kind == "output") != 1)
            throw new ArgumentException("Output 노드는 정확히 하나 필요합니다.");
        if (d.Edges.Any(e => e == null || e.Source == null || e.Target == null || !map.ContainsKey(e.Source) || !map.ContainsKey(e.Target) || e.Source == e.Target || map[e.Source].Kind == "output"))
            throw new ArgumentException("존재하지 않는 노드 또는 잘못된 연결입니다.");
        foreach (var n in d.Nodes)
        {
            var incoming = d.Edges.Where(e => e.Target == n.Id).ToList();
            var ports = n.Kind switch
            {
                "query" => new[] { "after" },
                "join" or "merge" => new[] { "left", "right" },
                "filter" or "output" => new[] { "input" },
                _ => throw new ArgumentException("지원하지 않는 노드: " + n.Kind)
            };
            if (incoming.Any(e => !ports.Contains(e.Port)) || incoming.Select(e => e.Port).Distinct().Count() != incoming.Count || (n.Kind != "query" && incoming.Count != ports.Length) || (n.Kind == "query" && incoming.Count > 1))
                throw new ArgumentException(n.Id + ": 입력 포트 연결을 확인하세요.");
            if (n.Kind == "query")
            {
                if (!Id(Text(n.Config, "queryId")) || n.Config["body"] is not JsonObject body || Text(body, "query_id") != Text(n.Config, "queryId") || string.IsNullOrEmpty(Text(body, "database_name")) || (n.Config["queryVersion"]?.GetValue<int>() ?? 0) < 1)
                    throw new ArgumentException(n.Id + ": query_id, 버전, 요청 바디를 확인하세요.");
                ValidateRefs(body, d, incoming.Select(e => e.Source).ToHashSet());
            }
            if (n.Kind == "join" && (!new[] { "inner", "left", "full" }.Contains(Text(n.Config, "joinType")) || n.Config["keys"] is not JsonArray keys || keys.Count is < 1 or > 8 || keys.Any(k => k is not JsonObject o || string.IsNullOrWhiteSpace(Text(o, "left")) || string.IsNullOrWhiteSpace(Text(o, "right")))))
                throw new ArgumentException(n.Id + ": 조인 방식과 키가 필요합니다.");
            if (n.Kind == "filter")
            {
                if (n.Config["rules"] is not JsonArray rules || rules.Count is < 1 or > 20)
                    throw new ArgumentException(n.Id + ": 필터 조건이 필요합니다.");
                foreach (var rule in rules)
                    if (rule is not JsonObject o || string.IsNullOrWhiteSpace(Text(o, "column")) || !new[] { "eq", "ne", "gt", "gte", "lt", "lte", "contains", "isNull", "notNull" }.Contains(Text(o, "op")) || (o["value"] is JsonObject or JsonArray))
                        throw new ArgumentException(n.Id + ": 필터 조건을 확인하세요.");
            }
        }
        var ordered = new List<WorkflowNode>();
        while (ordered.Count < d.Nodes.Count)
        {
            var next = d.Nodes.FirstOrDefault(n => !ordered.Contains(n) && d.Edges.Where(e => e.Target == n.Id).All(e => ordered.Any(x => x.Id == e.Source)));
            if (next == null)
                throw new ArgumentException("순환 연결은 실행할 수 없습니다.");
            ordered.Add(next);
        }
        var used = new HashSet<string> { d.Nodes.Single(n => n.Kind == "output").Id };
        for (int i = 0; i < d.Nodes.Count; i++)
        foreach (var e in d.Edges)
        if (used.Contains(e.Target))
            used.Add(e.Source);
        if (used.Count != d.Nodes.Count)
            throw new ArgumentException("모든 노드를 Output까지 연결하세요.");
        return ordered;
    }
    static void ValidateRefs(JsonNode? value, WorkflowDefinition d, HashSet<string> parents)
    {
        if (value is JsonObject o)
        {
            if (o.ContainsKey("$input"))
            {
                if (o.Count != 1 || !d.Inputs.ContainsKey(Text(o, "$input")))
                    throw new ArgumentException("존재하지 않는 실행 입력입니다.");
                return;
            }
            if (o.ContainsKey("$node"))
            {
                if (!parents.Contains(Text(o, "$node")) || !o.ContainsKey("column") || (o["row"]?.GetValue<int>() ?? 0) < 0 || o.Any(p => p.Key is not ("$node" or "column" or "row")))
                    throw new ArgumentException("앞 노드 참조에는 after 연결과 column, 0 이상의 row가 필요합니다.");
                return;
            }
            foreach (var p in o)
                ValidateRefs(p.Value, d, parents);
        }
        else if (value is JsonArray a)
        foreach (var v in a)
            ValidateRefs(v, d, parents);
    }
    public static JsonNode? Resolve(JsonNode? value, JsonObject inputs, IReadOnlyDictionary<string, WorkflowData> outputs)
    {
        if (value is JsonObject o)
        {
            if (o.ContainsKey("$input"))
            {
                var key = Text(o, "$input");
                if (!inputs.ContainsKey(key))
                    throw new ArgumentException("실행 입력이 없습니다: " + key);
                return inputs[key]?.DeepClone();
            }
            if (o.ContainsKey("$node"))
            {
                var id = Text(o, "$node");
                var row = o["row"]?.GetValue<int>() ?? 0;
                var col = Text(o, "column");
                if (!outputs.TryGetValue(id, out var data) || row < 0 || row >= data.Rows.Count || !data.Rows[row].TryGetValue(col, out var cell))
                    throw new ArgumentException($"{id}[{row}].{col}: 참조할 데이터가 없습니다.");
                return JsonSerializer.SerializeToNode(cell, Json);
            }
            var copy = new JsonObject();
            foreach (var p in o)
                copy[p.Key] = Resolve(p.Value, inputs, outputs);
            return copy;
        }
        if (value is JsonArray a)
            return new JsonArray(a.Select(v => Resolve(v, inputs, outputs)).ToArray());
        return value?.DeepClone();
    }
}
