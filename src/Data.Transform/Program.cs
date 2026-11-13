using Streaming.Core;
using Data.Transform;
using Dac.Worker;
using Npgsql;
var builder=WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(NpgsqlDataSource.Create(builder.Configuration.GetConnectionString("Postgres")??"Host=localhost;Database=unused;Username=unused"));
builder.Services.AddSingleton<RemoteEngines>();
builder.Services.AddHttpClient("engines", c => { c.BaseAddress = new Uri(builder.Configuration["EnginesBaseUrl"] ?? "http://analytics-engines:8095/"); c.Timeout = TimeSpan.FromMinutes(25); });
builder.Services.AddSingleton<StreamStore>();builder.Services.AddSingleton<KafkaBus>();builder.Services.AddSingleton<DatasetEngine>();builder.Services.AddSingleton<TransformEngine>();
builder.Services.AddHttpClient<ApiDatasetSource>(c=>{c.BaseAddress=new Uri(builder.Configuration["DataApiBaseUrl"]??"http://dac-worker:8080/");c.Timeout=TimeSpan.FromSeconds(30);});
if(!builder.Environment.IsEnvironment("Testing"))
{
    builder.Services.AddHostedService<Consumer>();
    if(builder.Configuration["ServiceRole"]!="observer"){builder.Services.AddHostedService<TransformRunner>();builder.Services.AddHostedService<Outbox>();}
}
var app=builder.Build();
app.Use(async(ctx,next)=>{try{await next(ctx);}catch(ArgumentException e){await Results.Problem(e.Message,statusCode:400).ExecuteAsync(ctx);}catch(KeyNotFoundException e){await Results.Problem(e.Message,statusCode:404).ExecuteAsync(ctx);}catch(InvalidOperationException e){await Results.Problem(e.Message,statusCode:409).ExecuteAsync(ctx);}catch(HttpRequestException){await Results.Problem("Data source unavailable",statusCode:502).ExecuteAsync(ctx);}});
if(!app.Environment.IsEnvironment("Testing")){await app.Services.GetRequiredService<StreamStore>().Init();await app.Services.GetRequiredService<KafkaBus>().Init();}
app.MapGet("/health/live",()=>new{status="ok",service=app.Configuration["ServiceRole"]=="observer"?"stream-observer":"data-transform-service"});
app.MapGet("/health/ready",async(StreamStore store)=>{await store.Query("SELECT 1 AS ready");return Results.Ok(new{status="ready"});});
app.MapGet("/api/streams/status",async(StreamStore store,KafkaBus bus)=>new{
    kafka=bus.Health(),topics=Wire.Topics,groups=new[]{Wire.TransformGroup,Wire.ObserverGroup},delivery="at-least-once / durable deduplication",mode="periodic complete snapshots / actual rows in Kafka",
    services=await store.Query("SELECT role,updated_at,error FROM stream_heartbeats ORDER BY role"),
    consumers=await store.Query("SELECT consumer_group,count(*) AS batches,coalesce(sum(row_count),0) AS rows,max(received_at) AS last_received_at FROM stream_batches GROUP BY consumer_group"),
    quarantine=await store.Query("SELECT consumer_group,count(*) AS records FROM stream_failures GROUP BY consumer_group")});
app.MapGet("/api/streams/engines", async (RemoteEngines engines, CancellationToken ct) => new { duckdb = new { available = true, mode = "single process", threads = 2 }, remote = await engines.Status(ct) });
app.MapPost("/api/streams/datasets/{id:guid}/analyze", async (Guid id, AnalyzeRequest request, StreamStore store) => Results.Json(new { id = await store.Analyze(id, request.Engine) }, statusCode:202));
app.MapGet("/api/streams/feeds",(StreamStore store)=>store.Query("SELECT * FROM stream_feeds ORDER BY created_at DESC LIMIT 100"));
app.MapPost("/api/streams/feeds",async(FeedConfig request,StreamStore store)=>Results.Json(new{id=await store.CreateFeed(request)},statusCode:201));
app.MapPost("/api/streams/feeds/{id:guid}/start",async(Guid id,StreamStore store)=>await store.Execute("UPDATE stream_feeds SET enabled=true,next_at=now() WHERE id=$1",id)>0?Results.Ok(new{enabled=true}):Results.NotFound());
app.MapPost("/api/streams/feeds/{id:guid}/stop",async(Guid id,StreamStore store)=>await store.Execute("UPDATE stream_feeds SET enabled=false WHERE id=$1",id)>0?Results.Ok(new{enabled=false,note="In-flight snapshot completes; subsequent snapshots stop"}):Results.NotFound());
app.MapGet("/api/streams/datasets",(StreamStore store)=>store.Query("SELECT d.id,d.feed_id,f.name,d.config,d.status,d.created_at,d.published_at,d.ready_at,d.result_rows,d.transform_ms,d.error,d.input_dataset_id,d.execution FROM stream_datasets d JOIN stream_feeds f ON f.id=d.feed_id ORDER BY d.created_at DESC LIMIT 100"));
app.MapGet("/api/streams/datasets/{id:guid}",async(Guid id,StreamStore store)=>{
    var dataset=await store.GetDataset(id);if(dataset is null)return Results.NotFound();
    return Results.Ok(new{dataset,consumers=await store.Query("SELECT consumer_group,source,count(*) AS batches,max(total_batches) AS expected_batches,sum(row_count) AS received_rows,max(total_rows) AS expected_rows FROM stream_batches WHERE dataset_id=$1 GROUP BY consumer_group,source ORDER BY consumer_group,source",dataset.InputDatasetId ?? id),result=await store.Query("SELECT result_rows,transform_ms,error,ready_at,execution FROM stream_datasets WHERE id=$1",id)});
});
app.MapGet("/api/streams/datasets/{id:guid}/rows",(Guid id,int? afterId,int? limit,DatasetEngine engine,CancellationToken ct)=>engine.Read(id,afterId??0,limit??1000,ct));
app.MapPost("/api/streams/datasets/{id:guid}/retry",async(Guid id,StreamStore store)=>{
    var dataset=await store.GetDataset(id);if(dataset is null)return Results.NotFound();
    if(dataset.Status!="failed"||!await store.Complete(id))return Results.Conflict(new{detail="Only failed transforms with complete inputs can retry; publish a new snapshot for incomplete inputs"});
    await store.Execute("UPDATE stream_datasets SET status='published',error=NULL WHERE id=$1",id);return Results.Accepted();
});
// Compatibility API: calculation now lives in this service, not in dac-worker.
app.MapPost("/api/transform/execute",async(TransformRequest request,ApiDatasetSource source,TransformEngine engine,CancellationToken ct)=>{
    Validation.Transform(request);var(e,d)=await source.Read(request.LotId,ct);
    if(e.Count>=1000||d.Count>=1000)return Results.Problem("Source snapshot reached 1000 rows; narrow lotId before transforming.",statusCode:422);
    var data=engine.Execute(e,d,request);return Results.Ok(new{operation=request.Operation,engine="DuckDB",service="data-transform-service",source="Oracle API datasets",sourceCounts=new{eds=e.Count,defects=d.Count},count=data.Count,data});
});
app.Run();
public partial class Program { }
