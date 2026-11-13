using System.Text.Json;
using Chart.Worker;
using Xunit;
namespace Chart.Worker.Tests;

public class AppearanceTests
{
    private readonly ChartBuilder builder = new();
    private static Dataset Data => ChartTests.Data("""[{"lotId":"A","product":"P","waferId":"W2","yieldPct":92,"n":2},{"lotId":"A","product":"P","waferId":"W1","yieldPct":91,"n":1}]""");

    [Fact]
    public void LabelsFollowPointsAfterSortingAndCarryStyle()
    {
        var result = builder.Build(Data, new(X: "n", XType: "number", PointSize: 12.5, ShowLabels: true, LabelColumn: "waferId", LabelFontSize: 14));
        Assert.Equal(12.5, result.PointSize);
        Assert.True(result.ShowLabels);
        Assert.Equal(14, result.LabelFontSize);
        Assert.Equal(new[] { "W1", "W2" }, result.Charts[0].Series[0].Points.Select(p => p.Label));
    }
    [Fact]
    public void DefaultLabelsAreYValues() => Assert.Equal("92", builder.Build(Data, new(ShowLabels: true)).Charts[0].Series[0].Points[0].Label);
    [Fact]
    public void DisabledLabelsDoNotIncreasePointPayload()
    {
        var point = builder.Build(Data, new(LabelColumn: "waferId")).Charts[0].Series[0].Points[0];
        Assert.Null(point.Label);
        Assert.DoesNotContain("Label", JsonSerializer.Serialize(point));
    }
    [Fact]
    public void NullLabelsDoNotDropCoordinates()
    {
        var result = builder.Build(ChartTests.Data("""[{"x":1,"y":2,"label":null},{"x":2,"y":3,"label":"ok"}]"""), new(Category: null, Legend: null, X: "x", XType: "number", Y: "y", ShowLabels: true, LabelColumn: "label"));
        Assert.Equal(2, result.PlottedRows);
        Assert.Null(result.Charts[0].Series[0].Points[0].Label);
    }
    [Fact]
    public void UnknownLabelColumnIsRejected() => Assert.Throws<ArgumentException>(() => builder.Build(Data, new(ShowLabels: true, LabelColumn: "missing")));
    [Theory]
    [InlineData(1)] [InlineData(21)] [InlineData(double.NaN)] [InlineData(double.PositiveInfinity)]
    public void UnsafePointSizeIsRejected(double size) => Assert.Throws<ArgumentException>(() => builder.Build(Data, new(PointSize: size)));
    [Theory]
    [InlineData(7)] [InlineData(21)]
    public void UnsafeFontSizeIsRejected(int size) => Assert.Throws<ArgumentException>(() => builder.Build(Data, new(LabelFontSize: size)));
    [Fact]
    public void EmptyResultKeepsAppearance() => Assert.True(builder.Build(ChartTests.Data("[]"), new(ShowLabels: true)).ShowLabels);
    [Fact]
    public void LongLabelsAreBounded()
    {
        var data = ChartTests.Data(JsonSerializer.Serialize(new[] { new { x = 1, y = 2, text = new string('한', 200) } }));
        var point = builder.Build(data, new(Category: null, Legend: null, X: "x", Y: "y", ShowLabels: true, LabelColumn: "text")).Charts[0].Series[0].Points[0];
        Assert.Equal(120, point.Label!.Length);
        Assert.EndsWith("…", point.Label);
    }
}
