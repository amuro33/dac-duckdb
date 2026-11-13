using System.Text.Json;
namespace Chart.Worker;

public sealed class DataApiClient(HttpClient http, IConfiguration? config = null)
{
    public static readonly string[] Sources = ["eds", "defects", "joined", "transformed"];
    public async Task<Dataset> Read(string source, string? lotId, CancellationToken ct, int? sampleSize = null, int pageSize = 10000, int afterId = 0, Guid? datasetId = null)
    {
        if (!Sources.Contains(source))
            throw new ArgumentException("source must be eds, defects or joined");
        if (lotId?.Length > 40)
            throw new ArgumentException("lotId is too long");
        if (source == "transformed")
        {
            if (datasetId is null || datasetId == Guid.Empty)
                throw new ArgumentException("datasetId required");
            var baseUrl = config?["TransformApiBaseUrl"] ?? "http://data-transform-service:8080/";
            using var result = await http.GetAsync(new Uri(new Uri(baseUrl), $"api/streams/datasets/{datasetId}/rows?afterId={afterId}&limit={pageSize}"), ct);
            if (result.StatusCode == System.Net.HttpStatusCode.Conflict)
                throw new ArgumentException("Transform dataset is not ready");
            result.EnsureSuccessStatusCode();
            using var document = await JsonDocument.ParseAsync(await result.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            var value = document.RootElement;
            var points = value.GetProperty("data").Deserialize<List<Dictionary<string, JsonElement>>>() ?? [];
            return new(points, InferColumns(points.Take(100).ToList()), value.GetProperty("totalRows").GetInt32(), null, "none");
        }
        if (sampleSize is not null)
        {
            if (sampleSize is not (1000 or 10000 or 100000 or 1000000))
                throw new ArgumentException("Invalid sampleSize");
            var url = $"api/dac/chart_samples?source={source}&size={sampleSize}&limit={pageSize}&afterId={afterId}" + (lotId is null ? "" : "&lotId=" + Uri.EscapeDataString(lotId));
            using var sampleResponse = await http.GetAsync(url, ct);
            sampleResponse.EnsureSuccessStatusCode();
            using var sampleJson = await JsonDocument.ParseAsync(await sampleResponse.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            var root = sampleJson.RootElement;
            var sampleRows = root.GetProperty("data").Deserialize<List<Dictionary<string, JsonElement>>>() ?? [];
            return new(sampleRows, InferColumns(sampleRows.Take(100).ToList()), root.GetProperty("totalRows").GetInt32(), sampleSize, root.GetProperty("sampling").GetString()!);
        }
        string query = "?limit=1000" + (lotId is null ? "" : "&lotId=" + Uri.EscapeDataString(lotId));
        using var response = source == "joined" ? await http.PostAsJsonAsync("api/dac/transform", new
        {
            operation = "join",
            joinType = "full",
            lotId,
            limit = 1000
        }, ct) : await http.GetAsync("api/dac/" + (source == "eds" ? "get_eds_data" : "get_defect_data") + query, ct);
        if (response.StatusCode == System.Net.HttpStatusCode.UnprocessableEntity)
            throw new ArgumentException("Data snapshot limit reached. Narrow lotId.");
        response.EnsureSuccessStatusCode();
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var array = source == "joined" ? json.RootElement.GetProperty("data") : json.RootElement;
        var rows = array.Deserialize<List<Dictionary<string, JsonElement>>>() ?? [];
        if (rows.Count >= 1000)
            throw new ArgumentException("Data snapshot limit reached (1000). Narrow lotId.");
        return new(rows, InferColumns(rows));
    }
    public async IAsyncEnumerable<Dataset> ReadBatches(string source, string? lotId, int? sampleSize, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct, Guid? datasetId = null)
    {
        if (sampleSize is null && source != "transformed")
        {
            yield return await Read(source, lotId, ct);
            yield break;
        }
        int cursor = 0, read = 0;
        int? expected = null;
        while (true)
        {
            var page = await Read(source, lotId, ct, sampleSize, 10000, cursor, datasetId);
            expected ??= page.TotalRows;
            if (page.TotalRows != expected)
                throw new InvalidOperationException("Dataset changed while reading; retry the analysis");
            if (page.Rows.Count == 0)
            {
                if (read != expected)
                    throw new InvalidOperationException("Incomplete dataset response");
                yield return page;
                yield break;
            }
            var idColumn = source == "transformed" ? "row_id" : source == "joined" ? "sample_id" : "sampleId";
            foreach (var row in page.Rows)
            {
                var id = row[idColumn].GetInt32();
                if (id <= cursor)
                    throw new InvalidOperationException("Non-advancing data cursor");
                cursor = id;
            }
            read += page.Rows.Count;
            if (read > expected)
                throw new InvalidOperationException("Unexpected extra data rows");
            yield return page;
            if (read == expected)
                yield break;
        }
    }
    public static IReadOnlyList<ColumnInfo> InferColumns(IReadOnlyList<Dictionary<string, JsonElement>> rows) => rows.SelectMany(r => r.Keys).Distinct().Select(key =>
    {
        var values = rows.Select(r => r.TryGetValue(key, out var v) ? v : default).ToList();
        var types = values.Where(v => v.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)).Select(v => v.ValueKind == JsonValueKind.Number ? "number" : v.ValueKind == JsonValueKind.String && ChartBuilder.TryDate(v.GetString()!, out _) ? "date" : v.ValueKind == JsonValueKind.String ? "string" : "other").Distinct().ToArray();
        return new ColumnInfo(key, types.Length == 1 ? types[0] : types.Length == 0 ? "unknown" : "mixed", values.Any(v => v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined));
    }).ToArray();
}
