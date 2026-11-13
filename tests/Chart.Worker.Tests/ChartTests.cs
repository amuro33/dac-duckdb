using System.Text.Json;
using Chart.Worker;
using Xunit;
namespace Chart.Worker.Tests;
public class ChartTests {
 public static Dataset Data(string json){var rows=JsonSerializer.Deserialize<List<Dictionary<string,JsonElement>>>(json)!;return new(rows,DataApiClient.InferColumns(rows));}
 const string Json="""[{"lotId":"A","product":"P1","waferId":"W1","yieldPct":91,"n":1,"date":"2026-11-10T01:00:00Z"},{"lotId":"A","product":"P2","waferId":"W2","yieldPct":92,"n":2,"date":"2026-11-11T01:00:00Z"},{"lotId":"B","product":"P1","waferId":"W1","yieldPct":93,"n":3,"date":"2026-11-12T01:00:00Z"}]""";
 readonly ChartBuilder builder=new();
 [Fact]public void CategoriesMakeIndependentPanels(){var r=builder.Build(Data(Json),new());Assert.Equal(2,r.Charts.Count);Assert.Equal(2,r.Charts[0].Series.Count);Assert.Equal(3,r.PlottedRows);}
 [Fact]public void LegendIsGroupedWithinCategory(){var r=builder.Build(Data(Json),new(Category:null));Assert.Single(r.Charts);Assert.Equal(2,r.Charts[0].Series.Count);Assert.Equal(2,r.Charts[0].Series[0].Points.Count);}
 [Fact]public void NoLegendMakesOneSeriesPerPanel(){var r=builder.Build(Data(Json),new(Legend:null));Assert.All(r.Charts,c=>Assert.Single(c.Series));}
 [Fact]public void ReassignCategoryChangesPanelCount(){var r=builder.Build(Data(Json),new(Category:"waferId",Legend:"lotId"));Assert.Equal(2,r.Charts.Count);Assert.Equal(2,r.Charts[0].Series.Count);}
 [Fact]public void NumericXStaysNumeric(){var r=builder.Build(Data(Json),new(X:"n",XType:"number"));Assert.IsType<double>(r.Charts[0].Series[0].Points[0].X);}
 [Fact]public void StringXStaysString(){var r=builder.Build(Data(Json),new());Assert.Equal("W1",r.Charts[0].Series[0].Points[0].X);}
 [Fact]public void DatesBecomeUtcMilliseconds(){var r=builder.Build(Data(Json),new(X:"date",XType:"date"));Assert.Equal(1794272400000L,r.Charts[0].Series[0].Points[0].X);}
 [Fact]public void NumericColumnCanBeStringX(){var r=builder.Build(Data(Json),new(X:"n"));Assert.Equal("1",r.Charts[0].Series[0].Points[0].X);}
 [Fact]public void NullCoordinatesAreReported(){var d=Data("""[{"x":"W1","y":2},{"x":null,"y":3},{"x":"W2","y":null}]""");var r=builder.Build(d,new(Category:null,Legend:null,X:"x",Y:"y"));Assert.Equal(1,r.PlottedRows);Assert.Equal(2,r.SkippedRows);}
 [Fact]public void NullAndLiteralNullGroupsStayDistinct(){var d=Data("""[{"g":null,"x":"A","y":1},{"g":"(null)","x":"A","y":2}]""");var r=builder.Build(d,new(Category:"g",Legend:null,X:"x",Y:"y"));Assert.Equal(2,r.Charts.Count);Assert.NotEqual(r.Charts[0].Key,r.Charts[1].Key);}
 [Fact]public void NumericCategorySupported(){var r=builder.Build(Data(Json),new(Category:"n"));Assert.Equal(3,r.Charts.Count);}
 [Fact]public void EmptySourceReturnsEmptyCharts()=>Assert.Empty(builder.Build(Data("[]"),new()).Charts);
 [Theory][InlineData("unknown")][InlineData("<script>")]
 public void UnknownColumnsRejected(string x)=>Assert.Throws<ArgumentException>(()=>builder.Build(Data(Json),new(X:x)));
 [Fact]public void StringYRejected()=>Assert.Throws<ArgumentException>(()=>builder.Build(Data(Json),new(Y:"product")));
 [Fact]public void StringColumnCannotBeNumericX()=>Assert.Throws<ArgumentException>(()=>builder.Build(Data(Json),new(XType:"number")));
 [Fact]public void NonDateColumnCannotBeDateX()=>Assert.Throws<ArgumentException>(()=>builder.Build(Data(Json),new(XType:"date")));
 [Fact]public void InvalidAxisTypeRejected()=>Assert.Throws<ArgumentException>(()=>builder.Build(Data(Json),new(XType:"log")));
 [Fact]public void NumericAndDateColumnsInferred(){var d=Data(Json);Assert.Equal("date",d.Columns.Single(c=>c.Name=="date").Type);Assert.Equal("number",d.Columns.Single(c=>c.Name=="n").Type);}
 [Theory][InlineData("2026-11-10")][InlineData("2026-11-10T00:00:00+09:00")]
 public void IsoDatesAccepted(string value)=>Assert.True(ChartBuilder.TryDate(value,out _));
 [Theory][InlineData("11/10/2026")][InlineData("2026-99-99")][InlineData("1234")]
 public void AmbiguousDatesRejected(string value)=>Assert.False(ChartBuilder.TryDate(value,out _));
 [Fact]public void CategoryLimitEnforced(){var d=Data(JsonSerializer.Serialize(Enumerable.Range(0,51).Select(n=>new{g=n,x=n,y=n})));Assert.Throws<ArgumentException>(()=>builder.Build(d,new(Category:"g",Legend:null,X:"x",Y:"y")));}
 [Fact]public void LegendLimitEnforced(){var d=Data(JsonSerializer.Serialize(Enumerable.Range(0,51).Select(n=>new{g=n,x=n,y=n})));Assert.Throws<ArgumentException>(()=>builder.Build(d,new(Category:null,Legend:"g",X:"x",Y:"y")));}
}
