using Chart.Worker;
var builder=WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<ChartBuilder>();
builder.Services.AddHttpClient<DataApiClient>(c=>{c.BaseAddress=new Uri(builder.Configuration["DataApiBaseUrl"]??"http://dac-worker:8080/");c.Timeout=TimeSpan.FromSeconds(180);});
builder.Services.AddHttpClient("renderer",c=>{c.BaseAddress=new Uri(builder.Configuration["RendererBaseUrl"]??"http://127.0.0.1:8091/");c.Timeout=TimeSpan.FromSeconds(180);});
builder.Services.AddProblemDetails();
var app=builder.Build();app.UseExceptionHandler();
app.Use(async(ctx,next)=>{try{await next(ctx);}catch(ArgumentException e){await Results.Problem(e.Message,statusCode:400).ExecuteAsync(ctx);}catch(BadHttpRequestException e){await Results.Problem(e.Message,statusCode:e.StatusCode).ExecuteAsync(ctx);}catch(HttpRequestException){await Results.Problem("Data API or renderer is unavailable",statusCode:502).ExecuteAsync(ctx);}catch(TaskCanceledException) when(!ctx.RequestAborted.IsCancellationRequested){await Results.Problem("Upstream request timed out",statusCode:504).ExecuteAsync(ctx);}});
app.UseDefaultFiles();app.UseStaticFiles();
app.MapGet("/health/live",()=>new{service="chart-worker",status="ok"});
app.MapGet("/health/ready",async(DataApiClient api,IHttpClientFactory clients,CancellationToken ct)=>{await api.Read("eds",null,ct);using var r=await clients.CreateClient("renderer").GetAsync("health",ct);r.EnsureSuccessStatusCode();return Results.Ok(new{status="ready"});});
app.MapGet("/api/chart/columns",async(string? source,string? lotId,int? sampleSize,DataApiClient api,CancellationToken ct)=>{var data=await api.Read(source??"eds",lotId,ct,sampleSize,100);return new{source=source??"eds",rowCount=data.TotalRows??data.Rows.Count,columns=data.Columns};});
app.MapPost("/api/chart/scatter",async(ChartRequest request,DataApiClient api,ChartBuilder charts,CancellationToken ct)=>await charts.BuildAllAsync(api.ReadBatches(request.Source,request.LotId,request.SampleSize,ct),request,ct));
app.MapPost("/api/chart/render",async(ChartRequest request,string? format,int? categoryIndex,int? width,int? height,DataApiClient api,ChartBuilder charts,IHttpClientFactory clients,CancellationToken ct)=>{
 var fmt=format??"svg";if(fmt is not("svg" or "png" or "html"))throw new ArgumentException("format must be svg, png or html");
 int w=width??1000,h=height??500,index=categoryIndex??0;
 if(w<320||w>2400||h<240||h>1600)throw new ArgumentException("Invalid image dimensions");
 var spec=await charts.BuildAllAsync(api.ReadBatches(request.Source,request.LotId,request.SampleSize,ct),request,ct);
 if(fmt!="html"&&(index<0||index>=spec.Charts.Count))throw new ArgumentException("categoryIndex is out of range or chart has no points");
 if(fmt!="html"){spec=spec with{Charts=new[]{spec.Charts[index]}};index=0;}
 using var response=await clients.CreateClient("renderer").PostAsJsonAsync("render",new{spec,format=fmt,categoryIndex=index,width=w,height=h},ct);response.EnsureSuccessStatusCode();
 return Results.File(await response.Content.ReadAsByteArrayAsync(ct),fmt=="svg"?"image/svg+xml":fmt=="png"?"image/png":"text/html; charset=utf-8",$"scatter.{fmt}");
});
app.Run();
public partial class Program { }
