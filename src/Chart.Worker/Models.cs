namespace Chart.Worker;

public record ChartRequest(string Source = "eds", string? Category = "lotId", string? Legend = "product", string X = "waferId", string Y = "yieldPct", string XType = "string", string? LotId = null, int? SampleSize = null, double? PointSize = null, bool ShowLabels = false, string? LabelColumn = null, int LabelFontSize = 11, Guid? DatasetId = null);
public record ColumnInfo(string Name, string Type, bool Nullable);
public record Point(object X, double Y, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Label = null);
public record ChartSeries(string Key, string Name, IReadOnlyList<Point> Points);
public record ChartPanel(string Key, string Name, IReadOnlyList<ChartSeries> Series);
public record ScatterSpec(string Version, string ChartType, string Source, string X, string Y, string XType, string? Category, string? Legend, int SourceRows, int PlottedRows, int SkippedRows, IReadOnlyList<ChartPanel> Charts, int SampledOutRows = 0, int? RequestedSampleSize = null, string Sampling = "none", double? PointSize = null, bool ShowLabels = false, string? LabelColumn = null, int LabelFontSize = 11);
public record Dataset(IReadOnlyList<Dictionary<string, System.Text.Json.JsonElement>> Rows, IReadOnlyList<ColumnInfo> Columns, int? TotalRows = null, int? RequestedSampleSize = null, string Sampling = "none");
