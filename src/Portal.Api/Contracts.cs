using System.Text.Json;
namespace Portal.Api;

public record ViewInput(string Name, string Description, JsonElement Config, bool Pinned = false, int Version = 0);
public record ExecuteInput(string Path, string Method = "GET", JsonElement? Body = null, bool Record = true);
public record ExportInput(JsonElement Config, string Format = "png", int CategoryIndex = 0);
public static class Guard
{
    public static string Target(ExecuteInput r)
    {
        if (string.IsNullOrWhiteSpace(r.Path) || r.Path.Length > 2048 || !r.Path.StartsWith("/api/") || r.Path.Contains('#') || r.Path.Contains('\\'))
            throw new ArgumentException("Invalid API path");
        var path = r.Path.Split('?')[0];
        var gets = new[] { "/api/dac/get_eds_data", "/api/dac/get_defect_data", "/api/dac/lots", "/api/dac/summary", "/api/dac/chart_samples", "/api/chart/columns" };
        var posts = new[] { "/api/dac/transform", "/api/chart/scatter" };
        if (!(r.Method == "GET" && gets.Contains(path) || r.Method == "POST" && posts.Contains(path)))
            throw new ArgumentException("Only registered data and chart endpoints are allowed");
        return path.StartsWith("/api/dac/") ? "dac" : "chart";
    }
    public static void View(ViewInput v)
    {
        if (string.IsNullOrWhiteSpace(v.Name) || v.Name.Length > 80)
            throw new ArgumentException("View name must be 1–80 characters");
        if (v.Description is null || v.Description.Length > 1000)
            throw new ArgumentException("Description too long");
        Config(v.Config);
    }
    public static void Config(JsonElement c)
    {
        if (c.ValueKind != JsonValueKind.Object || c.GetRawText().Length > 8000)
            throw new ArgumentException("Invalid chart configuration");
        foreach (var field in new[] { "source", "x", "y", "xType" })
        if (!c.TryGetProperty(field, out var v) || v.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(v.GetString()) || v.GetString()!.Length > 80)
            throw new ArgumentException("Missing or invalid " + field);
        if (c.GetProperty("source").GetString() is not ("eds" or "defects" or "joined"))
            throw new ArgumentException("Invalid source");
        if (c.GetProperty("xType").GetString() is not ("string" or "number" or "date"))
            throw new ArgumentException("Invalid X axis type");
        foreach (var field in new[] { "category", "legend", "lotId", "labelColumn" })
        if (c.TryGetProperty(field, out var v) && v.ValueKind != JsonValueKind.Null && (v.ValueKind != JsonValueKind.String || v.GetString()!.Length > 80))
            throw new ArgumentException("Invalid " + field);
        if (c.TryGetProperty("pointSize", out var pointSize) && pointSize.ValueKind != JsonValueKind.Null && (pointSize.ValueKind != JsonValueKind.Number || !pointSize.TryGetDouble(out var sizeValue) || !double.IsFinite(sizeValue) || sizeValue < 2 || sizeValue > 20))
            throw new ArgumentException("pointSize must be between 2 and 20 pixels");
        if (c.TryGetProperty("showLabels", out var showLabels) && showLabels.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new ArgumentException("showLabels must be boolean");
        if (c.TryGetProperty("labelFontSize", out var fontSize) && (fontSize.ValueKind != JsonValueKind.Number || !fontSize.TryGetInt32(out var fontValue) || fontValue < 8 || fontValue > 20))
            throw new ArgumentException("labelFontSize must be between 8 and 20 pixels");
        if (c.TryGetProperty("sampleSize", out var n) && n.ValueKind != JsonValueKind.Null && (n.ValueKind != JsonValueKind.Number || !n.TryGetInt32(out var size) || size is not (1000 or 10000 or 100000 or 1000000)))
            throw new ArgumentException("Invalid sample size");
    }
}
