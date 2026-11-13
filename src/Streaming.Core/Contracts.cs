using System.Text.Json;
using Dac.Worker;
namespace Streaming.Core;

public record FeedConfig(string Name, int? SampleSize = 1000, string? LotId = null, int IntervalSeconds = 60,
    string Operation = "join", string JoinType = "left", decimal? MinYield = null, string? Severity = null,
    bool Enabled = true, int? MaxRuns = null)
{
    public TransformRequest Transform => new(Operation, JoinType, LotId, MinYield, Severity, 1000);
    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Name) || Name.Length > 80) throw new ArgumentException("Name must be 1–80 characters");
        if (SampleSize is not (null or 1000 or 10000 or 100000 or 1000000)) throw new ArgumentException("Invalid dataset size");
        if (IntervalSeconds is < 10 or > 86400) throw new ArgumentException("Interval must be 10–86400 seconds");
        if (MaxRuns is < 1 or > 10000) throw new ArgumentException("Invalid run count");
        Validation.Transform(Transform);
    }
}
public record StreamBatch(int SchemaVersion, Guid DatasetId, Guid FeedId, string Source, int Sequence,
    int TotalBatches, int TotalRows, DateTime CapturedAt, JsonElement[] Rows)
{
    public string EventId => $"{DatasetId}:{Source}:{Sequence}";
    public void Validate()
    {
        if (SchemaVersion != 1 || DatasetId == Guid.Empty || FeedId == Guid.Empty) throw new InvalidDataException("Invalid event identity/version");
        if (Source is not ("eds" or "defects") || Sequence < 0 || TotalBatches < 1 || Sequence >= TotalBatches || TotalRows < 0 || TotalRows > 1000000)
            throw new InvalidDataException("Invalid event manifest");
        if (Rows is null || Rows.Length > 1000 || TotalBatches != Math.Max(1, (TotalRows + 999) / 1000)) throw new InvalidDataException("Invalid batch size");
        var expected = TotalRows == 0 ? 0 : Math.Min(1000, TotalRows - Sequence * 1000);
        if (Rows.Length != expected) throw new InvalidDataException("Incomplete batch");
        foreach (var row in Rows)
        {
            if (row.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Invalid row");
            foreach (var key in Source == "eds" ? new[]{"lotId","waferId","product"} : new[]{"lotId","waferId","defectId","defectType","severity"})
                if (!row.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(value.GetString()) || value.GetString()!.Length > 80)
                    throw new InvalidDataException("Invalid source identifier: " + key);
            foreach (var key in Source == "eds" ? new[]{"testedDies","goodDies","yieldPct"} : new[]{"defectCount"})
                if (!row.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.Number) throw new InvalidDataException("Invalid numeric column: " + key);
        }
    }
}
public record Dataset(Guid Id, Guid FeedId, FeedConfig Config, string Status, DateTime CreatedAt);
public static class Wire
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static readonly string[] Topics = ["dac.eds.v1", "dac.defects.v1"];
    public const string CompletedTopic = "dac.transform.completed.v1";
    public const string TransformGroup = "waferscope-transform-v1";
    public const string ObserverGroup = "waferscope-observer-v1";
    public static string Serialize<T>(T item) => JsonSerializer.Serialize(item, Json);
    public static T Deserialize<T>(string text) => JsonSerializer.Deserialize<T>(text, Json) ?? throw new InvalidDataException("Empty message");
}
