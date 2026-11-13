using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace Chart.Worker;
public sealed class ChartBuilder {
 public static bool TryDate(string value,out long timestamp) {
  timestamp=0;
  if(!Regex.IsMatch(value,@"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})?)?$"))return false;
  if(!DateTimeOffset.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out var date))return false;
  timestamp=date.ToUnixTimeMilliseconds();return true;
 }
 public async Task<ScatterSpec> BuildAllAsync(IAsyncEnumerable<Dataset> pages,ChartRequest request,CancellationToken ct) {
  var groups=new Dictionary<string,(string Name,Dictionary<string,(string Name,List<Point> Points)> Series)>();
  ScatterSpec? result=null;int read=0,plotted=0,skipped=0;int? expected=null;
  await foreach(var page in pages.WithCancellation(ct)){
   expected??=page.TotalRows;
   var part=Build(page with{TotalRows=null,Sampling="none"},request);
   result??=part;read+=page.Rows.Count;plotted+=part.PlottedRows;skipped+=part.SkippedRows;
   foreach(var chart in part.Charts){
    if(!groups.TryGetValue(chart.Key,out var group)){if(groups.Count>=50)throw new ArgumentException("Too many categories (maximum 50)");group=(chart.Name,new());groups.Add(chart.Key,group);}
    foreach(var series in chart.Series){
     if(!group.Series.TryGetValue(series.Key,out var target)){if(group.Series.Count>=50)throw new ArgumentException("Too many legend groups (maximum 50 per chart)");target=(series.Name,new());group.Series.Add(series.Key,target);}
     target.Points.AddRange(series.Points);
    }
   }
  }
  if(expected is not null&&read!=expected)throw new InvalidOperationException("Full dataset was not read");
  result??=Build(new([],[]),request);
  var charts=groups.Select(g=>new ChartPanel(g.Key,g.Value.Name,g.Value.Series.Select(s=>{
   if(request.XType!="string")s.Value.Points.Sort((a,b)=>Convert.ToDouble(a.X,CultureInfo.InvariantCulture).CompareTo(Convert.ToDouble(b.X,CultureInfo.InvariantCulture)));
   return new ChartSeries(s.Key,s.Value.Name,s.Value.Points);
  }).ToList())).ToList();
  return result with{SourceRows=read,PlottedRows=plotted,SkippedRows=skipped,SampledOutRows=0,Sampling="none",Charts=charts};
 }
 public ScatterSpec Build(Dataset dataset,ChartRequest request) {
  if(request.PointSize is double size && (!double.IsFinite(size)||size<2||size>20))throw new ArgumentException("pointSize must be between 2 and 20 pixels");
  if(request.LabelFontSize<8||request.LabelFontSize>20)throw new ArgumentException("labelFontSize must be between 8 and 20 pixels");
  if(request.LabelColumn is not null&&(string.IsNullOrWhiteSpace(request.LabelColumn)||request.LabelColumn.Length>80))throw new ArgumentException("Invalid label column");
  if(request.XType is not("string" or "number" or "date"))throw new ArgumentException("xType must be string, number or date");
  if(string.IsNullOrWhiteSpace(request.X)||string.IsNullOrWhiteSpace(request.Y))throw new ArgumentException("X and Y columns are required");
  if(dataset.Rows.Count==0)return new("1","scatter",request.Source,request.X,request.Y,request.XType,request.Category,request.Legend,0,0,0,[],0,dataset.RequestedSampleSize,dataset.Sampling,request.PointSize,request.ShowLabels,request.LabelColumn,request.LabelFontSize);
  foreach(var key in new[]{request.X,request.Y,request.Category,request.Legend,request.ShowLabels?request.LabelColumn:null}.Where(k=>k is not null)) {
   if(string.IsNullOrWhiteSpace(key)||!dataset.Columns.Any(c=>c.Name==key))throw new ArgumentException("Unknown column: "+key);
   if(dataset.Columns.Single(c=>c.Name==key).Type=="other")throw new ArgumentException("Only scalar columns can be selected");
  }
  var y=dataset.Columns.First(c=>c.Name==request.Y);if(y.Type!="number")throw new ArgumentException("Y must be a numeric column");
  var x=dataset.Columns.First(c=>c.Name==request.X);
  if(request.XType=="number"&&x.Type!="number")throw new ArgumentException("Numeric X requires a numeric column");
  if(request.XType=="date"&&x.Type!="date")throw new ArgumentException("Date X requires an ISO date column");
  var panels=new Dictionary<string,(string Name,Dictionary<string,(string Name,List<Point> Points)> Series)>();int skipped=0,plotted=0;
  (string Key,string Label) Group(Dictionary<string,JsonElement> row,string? col) {
   if(col is null)return("all","전체");
   if(!row.TryGetValue(col,out var v)||v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)return("null","(null)");
   return(v.ValueKind+":"+v.GetRawText(),v.ValueKind==JsonValueKind.String?v.GetString()!:v.GetRawText());
  }
  foreach(var row in dataset.Rows) {
   if(!row.TryGetValue(request.X,out var xv)||!row.TryGetValue(request.Y,out var yv)||xv.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined||yv.ValueKind!=JsonValueKind.Number||!yv.TryGetDouble(out var yn)||!double.IsFinite(yn)){skipped++;continue;}
   object xx;
   if(request.XType=="number") {if(!xv.TryGetDouble(out var n)||!double.IsFinite(n)){skipped++;continue;}xx=n;}
   else if(request.XType=="date") {if(xv.ValueKind!=JsonValueKind.String||!TryDate(xv.GetString()!,out var time)){skipped++;continue;}xx=time;}
   else xx=xv.ValueKind==JsonValueKind.String?xv.GetString()!:xv.GetRawText();
   var cat=Group(row,request.Category);var leg=Group(row,request.Legend);
   if(!panels.TryGetValue(cat.Key,out var panel)){if(panels.Count>=50)throw new ArgumentException("Too many categories (maximum 50). Narrow lotId or change category.");panel=(cat.Label,new());panels.Add(cat.Key,panel);}
   if(!panel.Series.TryGetValue(leg.Key,out var series)){if(panel.Series.Count>=50)throw new ArgumentException("Too many legend groups (maximum 50 per chart)");series=(leg.Label,[]);panel.Series.Add(leg.Key,series);}
   string? label=null;
   if(request.ShowLabels){
    if(row.TryGetValue(request.LabelColumn??request.Y,out var lv)&&lv.ValueKind is not(JsonValueKind.Null or JsonValueKind.Undefined)){
     label=lv.ValueKind==JsonValueKind.String?lv.GetString():lv.GetRawText();
     if(label?.Length>120)label=label[..119]+"…";
    }
   }
   series.Points.Add(new(xx,yn,label));plotted++;
  }
  var charts=panels.Select(p=>new ChartPanel(p.Key,p.Value.Name,p.Value.Series.Select(s=>new ChartSeries(s.Key,s.Value.Name,request.XType=="string"?s.Value.Points:s.Value.Points.OrderBy(p=>Convert.ToDouble(p.X,CultureInfo.InvariantCulture)).ToList())).ToList())).ToList();
  return new("1","scatter",request.Source,request.X,request.Y,request.XType,request.Category,request.Legend,dataset.TotalRows??dataset.Rows.Count,plotted,skipped,charts,0,dataset.RequestedSampleSize,"none",request.PointSize,request.ShowLabels,request.LabelColumn,request.LabelFontSize);
 }
}
