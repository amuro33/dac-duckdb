using System.Text.Json;
using System.Text.RegularExpressions;
using Oracle.ManagedDataAccess.Client;
namespace Dac.Worker;

public record QueryBinding(string Name, string Type, bool Nullable = false, decimal? Min = null, decimal? Max = null, int MaxLength = 100);
public record StoredQuery(string QueryId, string DatabaseName, string Name, string Description, int Version, string Sql, JsonElement DefaultBody, QueryBinding[] Bindings);
public static class StoredQueryInput
{
    public static bool ValidId(string id) => Regex.IsMatch(id, @"\A[A-Za-z0-9_-]{1,80}\z");
    public static Dictionary<string, object?> Bind(StoredQuery query, JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object) throw new ArgumentException("Request body must be a JSON object");
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in body.EnumerateObject())
        {
            if (!names.Add(field.Name)) throw new ArgumentException("Duplicate field: " + field.Name);
            if (field.Name is not ("database_name" or "query_id") && !query.Bindings.Any(b => b.Name == field.Name)) throw new ArgumentException("Unknown binding: " + field.Name);
        }
        foreach (var (name, expected) in new[] { ("database_name", query.DatabaseName), ("query_id", query.QueryId) })
            if (!body.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String || value.GetString() != expected)
                throw new ArgumentException(name + " must match the selected query: " + expected);
        var values = new Dictionary<string, object?>();
        foreach (var binding in query.Bindings)
        {
            if (!body.TryGetProperty(binding.Name, out var value)) throw new ArgumentException("Missing binding: " + binding.Name);
            if (value.ValueKind == JsonValueKind.Null && binding.Nullable) { values[binding.Name] = null; continue; }
            if (binding.Type == "string" && value.ValueKind == JsonValueKind.String && value.GetString()!.Length <= binding.MaxLength)
                values[binding.Name] = value.GetString();
            else if (binding.Type == "integer" && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var n) && (binding.Min is null || n >= binding.Min) && (binding.Max is null || n <= binding.Max))
                values[binding.Name] = n;
            else if (binding.Type == "number" && value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number) && (binding.Min is null || number >= binding.Min) && (binding.Max is null || number <= binding.Max))
                values[binding.Name] = number;
            else throw new ArgumentException("Invalid value/type/range for binding: " + binding.Name);
        }
        return values;
    }
}
public sealed class StoredQueries(IConfiguration config)
{
    static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    OracleConnection Connection() => new(config.GetConnectionString("Oracle") ?? throw new InvalidOperationException("Oracle connection not configured"));
    public async Task<List<StoredQuery>> List(CancellationToken ct)
    {
        using var connection = Connection(); await connection.OpenAsync(ct);
        using var command = connection.CreateCommand(); command.CommandTimeout = 15;
        command.CommandText = "SELECT QUERY_ID,DATABASE_NAME,NAME,DESCRIPTION,QUERY_VERSION,SQL_TEXT,DEFAULT_BODY,BINDINGS_JSON FROM DAC_QUERY_CATALOG WHERE ENABLED=1 ORDER BY QUERY_ID";
        using var reader = (OracleDataReader)await command.ExecuteReaderAsync(ct);
        var queries = new List<StoredQuery>();
        while (await reader.ReadAsync(ct)) queries.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4), reader.GetString(5), JsonSerializer.Deserialize<JsonElement>(reader.GetString(6)), JsonSerializer.Deserialize<QueryBinding[]>(reader.GetString(7), JsonOptions)!));
        return queries;
    }
    public async Task<object?> Execute(string id, JsonElement body, CancellationToken ct)
    {
        if (!StoredQueryInput.ValidId(id)) throw new ArgumentException("Invalid query_id");
        var query = (await List(ct)).SingleOrDefault(q => q.QueryId == id);
        if (query is null) return null;
        if (query.DatabaseName != "oracle") throw new ArgumentException("Database is not configured: " + query.DatabaseName);
        var values = StoredQueryInput.Bind(query, body);
        if (!query.Sql.TrimStart().StartsWith("SELECT ", StringComparison.OrdinalIgnoreCase) || query.Sql.Contains(';')) throw new InvalidOperationException("Only registered SELECT queries are supported");
        using var connection = Connection(); await connection.OpenAsync(ct);
        // Catalog SQL is administrator-owned. A read-only transaction also prevents mutation from SELECT functions.
        using var transactionCommand = connection.CreateCommand(); transactionCommand.CommandText = "SET TRANSACTION READ ONLY"; await transactionCommand.ExecuteNonQueryAsync(ct);
        using var command = connection.CreateCommand(); command.BindByName = true; command.CommandTimeout = 30; command.CommandText = query.Sql;
        foreach (var binding in query.Bindings)
        {
            var type = binding.Type switch { "integer" => OracleDbType.Int32, "number" => OracleDbType.Decimal, _ => OracleDbType.Varchar2 };
            command.Parameters.Add(binding.Name, type).Value = values[binding.Name] ?? DBNull.Value;
        }
        using var reader = (OracleDataReader)await command.ExecuteReaderAsync(ct);
        var columns = Enumerable.Range(0, reader.FieldCount).Select(i => new { name = reader.GetName(i).ToLowerInvariant(), type = reader.GetFieldType(i) == typeof(DateTime) ? "date" : reader.GetFieldType(i) == typeof(string) ? "string" : "number" }).ToArray();
        var rows = new List<Dictionary<string, object?>>();
        while (await reader.ReadAsync(ct))
        {
            if (rows.Count >= 10000) throw new ArgumentException("Query exceeds 10,000 rows; narrow the bindings");
            var row = new Dictionary<string, object?>();
            for (var i = 0; i < reader.FieldCount; i++)
            {
                object? value = reader.IsDBNull(i) ? null : reader.GetValue(i);
                row[reader.GetName(i).ToLowerInvariant()] = value is DateTime date ? DateTime.SpecifyKind(date, DateTimeKind.Utc) : value;
            }
            rows.Add(row);
        }
        return new { database_name = query.DatabaseName, query_id = query.QueryId, query_version = query.Version, count = rows.Count, columns, data = rows };
    }
}
