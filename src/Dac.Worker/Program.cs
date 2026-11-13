using Dac.Worker;
var builder=WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<IDataRepository,OracleRepository>();
builder.Services.AddSingleton<TransformEngine>();
builder.Services.AddSingleton<BenchmarkRepository>();
builder.Services.AddHttpClient<ApiDatasetSource>(c=> {c.BaseAddress=new Uri(builder.Configuration["DacApiBaseUrl"] ?? "http://127.0.0.1:8080/");c.Timeout=TimeSpan.FromSeconds(20);});
builder.Services.AddProblemDetails();
var app=builder.Build();
app.UseExceptionHandler();
app.Use(async(context,next)=> {try {await next(context);} catch(BadHttpRequestException ex) {await Results.Problem(ex.Message,statusCode:ex.StatusCode).ExecuteAsync(context);} catch(ArgumentException ex) {await Results.Problem(ex.Message,statusCode:400).ExecuteAsync(context);} });
app.UseDefaultFiles(); app.UseStaticFiles();
app.MapGet("/health/live",()=>Results.Ok(new {status="ok",service="dac-worker"}));
app.MapGet("/health/ready",async(IDataRepository repo,CancellationToken ct)=> {await repo.GetEds(new(Limit:1),ct);return Results.Ok(new{status="ready"});});
app.MapGet("/api/dac/get_eds_data",async(string? lotId,string? waferId,int? limit,IDataRepository repo,CancellationToken ct)=>await repo.GetEds(new(lotId,waferId,limit??100),ct));
app.MapGet("/api/dac/get_defect_data",async(string? lotId,string? waferId,int? limit,IDataRepository repo,CancellationToken ct)=>await repo.GetDefects(new(lotId,waferId,limit??100),ct));
app.MapGet("/api/dac/lots",async(IDataRepository repo,CancellationToken ct)=>(await repo.GetEds(new(Limit:1000),ct)).Select(x=>x.LotId).Distinct().Order());
app.MapGet("/api/dac/summary",async(IDataRepository repo,CancellationToken ct)=> {var e=await repo.GetEds(new(Limit:1000),ct);var d=await repo.GetDefects(new(Limit:1000),ct);return new{waferCount=e.Count,defectRecordCount=d.Count,totalDefects=d.Sum(x=>x.DefectCount),averageYield=e.Count==0?0:e.Average(x=>x.YieldPct)};});
app.MapPost("/api/dac/transform",async(TransformRequest request,ApiDatasetSource source,TransformEngine engine,CancellationToken ct)=> {
 Validation.Transform(request);
 // Bounded prototype snapshot: fail on overflow rather than silently transform partial source data.
 var (e,d)=await source.Read(request.LotId,ct);
 if(e.Count>=1000||d.Count>=1000) return Results.Problem("Source snapshot reached 1000 rows; narrow lotId before transforming.",statusCode:422);
 var data=engine.Execute(e,d,request);return Results.Ok(new{operation=request.Operation,engine="DuckDB",source="Oracle API datasets",sourceCounts=new{eds=e.Count,defects=d.Count},count=data.Count,data});
});
app.MapGet("/api/dac/chart_samples",async(string? source,int size,int? limit,string? lotId,int? afterId,BenchmarkRepository repo,CancellationToken ct)=>await repo.Read(source??"eds",size,limit??size,lotId,ct,afterId??0));
app.Run();
public partial class Program { }
