using DuckDB.NET.Data;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace Portal.Api;

public sealed class WorkflowEngine
{
    static string Q(string name) => "\"" + name.Replace("\"", "\"\"") + "\"";
    public static object? Scalar(JsonElement v) => v.ValueKind switch { JsonValueKind.Null => null, JsonValueKind.Number => v.GetDecimal(), JsonValueKind.True => true, JsonValueKind.False => false, JsonValueKind.String => v.GetString(), _ => throw new ArgumentException("중첩된 객체·배열 컬럼은 지원하지 않습니다.") };
    public static WorkflowData FromResponse(JsonElement response)
    {
        var rows = response.GetProperty("data").EnumerateArray().Select(row => row.EnumerateObject().ToDictionary(p => p.Name, p => Scalar(p.Value))).ToList();
        if (rows.Count > WorkflowRules.MaxRows)
            throw new ArgumentException("노드당 최대 10,000행입니다.");
        List<WorkflowColumn> columns;
        if (response.TryGetProperty("columns", out var schema))
            columns = schema.EnumerateArray().Select(c => new WorkflowColumn(c.GetProperty("name").GetString()!, c.GetProperty("type").GetString()!)).ToList();
        else
            columns = rows.SelectMany(r => r.Keys).Distinct().Select(k => new WorkflowColumn(k, rows.Select(r => r.GetValueOrDefault(k)).FirstOrDefault(v => v != null) switch { decimal => "number", bool => "boolean", _ => "string" })).ToList();
        if (columns.Count is < 1 or > 128 || columns.Select(c => c.Name.ToLowerInvariant()).Distinct().Count() != columns.Count)
            throw new ArgumentException("결과 컬럼이 없거나 중복되었습니다. DAC의 컬럼 메타데이터를 확인하세요.");
        return new(columns, rows);
    }
    public WorkflowData Transform(WorkflowNode node, WorkflowData left, WorkflowData? right, CancellationToken ct)
    {
        if (node.Kind == "output")
            return left;
        using var db = new DuckDBConnection("DataSource=:memory:");
        db.Open();
        using (var setup = db.CreateCommand())
        {
            setup.CommandText = "SET memory_limit='256MB'; SET threads=2; SET max_temp_directory_size='0B'";
            setup.ExecuteNonQuery();
        }
        void Load(string name, WorkflowData data)
        {
            using var create = db.CreateCommand();
            create.CommandText = $"CREATE TABLE {name} ({string.Join(',', data.Columns.Select(c => Q(c.Name) + " " + (c.Type switch { "number" => "DECIMAL(38,10)", "boolean" => "BOOLEAN", _ => "VARCHAR" })))})";
            create.ExecuteNonQuery();
            using var tx = db.BeginTransaction();
            using var insert = db.CreateCommand();
            insert.CommandText = $"INSERT INTO {name} VALUES ({string.Join(',', data.Columns.Select(_ => "?"))})";
            foreach (var c in data.Columns)
                insert.Parameters.Add(new DuckDBParameter());
            foreach (var row in data.Rows)
            {
                ct.ThrowIfCancellationRequested();
                for (int i = 0; i < data.Columns.Count; i++)
                {
                    var cell = row.GetValueOrDefault(data.Columns[i].Name);
                    if (cell is decimal number && decimal.Round(number, 10) != number)
                        throw new ArgumentException("숫자 소수점 10자리 초과: " + data.Columns[i].Name);
                    insert.Parameters[i].Value = cell ?? DBNull.Value;
                }
                insert.ExecuteNonQuery();
            }
            tx.Commit();
        }
        Load("l", left);
        if (right != null)
            Load("r", right);
        using var cmd = db.CreateCommand();
        cmd.CommandTimeout = 30;
        using var cancel = ct.Register(() => { try { cmd.Cancel(); } catch { } });
        var columns = left.Columns.ToList();
        WorkflowColumn Column(WorkflowData data, string name) => data.Columns.FirstOrDefault(c => c.Name == name) ?? throw new ArgumentException("컬럼이 없습니다: " + name);
        string sql;
        if (node.Kind == "filter")
        {
            var clauses = new List<string>();
            foreach (var item in (JsonArray)node.Config["rules"]!)
            {
                var rule = item!.AsObject();
                var col = Column(left, WorkflowRules.Text(rule, "column"));
                var op = WorkflowRules.Text(rule, "op");
                var value = rule["value"] == null ? null : Scalar(JsonSerializer.SerializeToElement(rule["value"]));
                if (op is "isNull" or "notNull")
                {
                    clauses.Add(Q(col.Name) + (op == "isNull" ? " IS NULL" : " IS NOT NULL"));
                    continue;
                }
                if (value == null)
                    throw new ArgumentException("null 비교에는 isNull/notNull을 사용하세요.");
                if ((col.Type == "number" && value is not decimal) || (col.Type == "boolean" && value is not bool) || (col.Type is "string" or "date" && value is not string))
                    throw new ArgumentException("필터 값의 타입이 컬럼과 다릅니다: " + col.Name);
                if (op == "contains")
                {
                    if (col.Type is not ("string" or "date"))
                        throw new ArgumentException("contains는 문자열 컬럼에만 사용하세요.");
                    clauses.Add($"contains({Q(col.Name)}, ?)");
                }
                else
                    clauses.Add(Q(col.Name) + " " + (op switch
                    {
                        "eq" => "=",
                        "ne" => "<>",
                        "gt" => ">",
                        "gte" => ">=",
                        "lt" => "<",
                        "lte" => "<=",
                        _ => throw new ArgumentException("Invalid operator")
                    }) + " ?");
                cmd.Parameters.Add(new DuckDBParameter { Value = value });
            }
            sql = "SELECT * FROM l WHERE " + string.Join(" AND ", clauses);
        }
        else if (node.Kind == "merge")
        {
            foreach (var c in right!.Columns)
            {
                var same = columns.FirstOrDefault(x => x.Name == c.Name);
                if (same != null && same.Type != c.Type)
                    throw new ArgumentException("Merge 컬럼 타입이 다릅니다: " + c.Name);
                if (same == null)
                    columns.Add(c);
            }
            if (columns.Select(c => c.Name.ToLowerInvariant()).Distinct().Count() != columns.Count)
                throw new ArgumentException("대소문자만 다른 컬럼은 병합할 수 없습니다.");
            sql = "SELECT * FROM l UNION ALL BY NAME SELECT * FROM r";
        }
        else if (node.Kind == "join")
        {
            var keys = ((JsonArray)node.Config["keys"]!).Select(k => k!.AsObject()).Select(k => (l: Column(left, WorkflowRules.Text(k, "left")), r: Column(right!, WorkflowRules.Text(k, "right")))).ToList();
            if (keys.Any(k => k.l.Type != k.r.Type))
                throw new ArgumentException("조인 키의 타입이 다릅니다.");
            var selections = left.Columns.Select(c => "l." + Q(c.Name)).ToList();
            foreach (var c in right!.Columns)
            {
                var alias = "right_" + c.Name;
                while (columns.Any(x => x.Name.Equals(alias, StringComparison.OrdinalIgnoreCase)))
                    alias = "right_" + alias;
                columns.Add(new(alias, c.Type));
                selections.Add("r." + Q(c.Name) + " AS " + Q(alias));
            }
            var type = WorkflowRules.Text(node.Config, "joinType") switch
            {
                "inner" => "INNER",
                "left" => "LEFT",
                "full" => "FULL OUTER",
                _ => throw new ArgumentException("Invalid join")
            };
            sql = $"SELECT {string.Join(',', selections)} FROM l {type} JOIN r ON " + string.Join(" AND ", keys.Select(k => "l." + Q(k.l.Name) + "=r." + Q(k.r.Name)));
        }
        else
            throw new ArgumentException("Invalid transform");
        cmd.CommandText = "SELECT * FROM (" + sql + ") workflow_result LIMIT " + (WorkflowRules.MaxRows + 1);
        var result = new List<Dictionary<string, object?>>();
        ct.ThrowIfCancellationRequested();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            ct.ThrowIfCancellationRequested();
            if (result.Count == WorkflowRules.MaxRows)
                throw new ArgumentException("결과가 10,000행을 초과했습니다. 조인 키 중복 또는 필터 범위를 확인하세요.");
            var row = new Dictionary<string, object?>();
            for (int i = 0; i < reader.FieldCount; i++)
                row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            result.Add(row);
        }
        return new(columns, result);
    }
}
