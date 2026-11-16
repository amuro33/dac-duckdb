using Microsoft.AspNetCore.RateLimiting;
using Portal.Api;
using Npgsql;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
var b = WebApplication.CreateBuilder(args);
b.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 65536);
b.Services.AddSingleton(_ => NpgsqlDataSource.Create(b.Configuration.GetConnectionString("Postgres") ?? throw new InvalidOperationException("PostgreSQL is required")));
b.Services.AddSingleton<Store>();
b.Services.AddSingleton<WorkflowStore>();
b.Services.AddSingleton<DataSources>();
b.Services.AddHostedService<SourceComparisonRunner>();
b.Services.AddHttpClient("source-engines", c => { c.BaseAddress=new Uri(b.Configuration["EnginesBaseUrl"] ?? "http://analytics-engines:8095/"); c.Timeout=TimeSpan.FromMinutes(4); });
b.Services.AddSingleton<WorkflowEngine>();
b.Services.AddHostedService<WorkflowRunner>();
foreach (var (name, key, fallback) in new[] { ("dac", "DacUrl", "http://dac-worker:8080/"), ("chart", "ChartUrl", "http://chart-worker:8080/") }) b.Services.AddHttpClient(name, c => { c.BaseAddress = new Uri(b.Configuration[key] ?? fallback); c.Timeout = TimeSpan.FromSeconds(240); });
b.Services.AddProblemDetails();
b.Services.AddRateLimiter(o => { o.RejectionStatusCode = 429; o.AddConcurrencyLimiter("work", p => { p.PermitLimit = 2; p.QueueLimit = 8; p.QueueProcessingOrder = QueueProcessingOrder.OldestFirst; }); });
b.Services.AddHttpClient("transform", c => { c.BaseAddress = new Uri(b.Configuration["TransformApiBaseUrl"] ?? "http://data-transform-service:8080/"); c.Timeout = TimeSpan.FromSeconds(240); });
var app = b.Build();
await app.Services.GetRequiredService<Store>().Init();
await app.Services.GetRequiredService<WorkflowStore>().Init();
await app.Services.GetRequiredService<DataSources>().Init();
app.UseExceptionHandler();
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["X-Request-Id"] = ctx.TraceIdentifier;
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["Referrer-Policy"] = "same-origin";
    ctx.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'";
    if (ctx.Request.Method is "POST" or "PUT" or "DELETE" && ctx.Request.Headers.Origin.Count > 0 && (!Uri.TryCreate(ctx.Request.Headers.Origin.ToString(), UriKind.Absolute, out var origin) || origin.Authority != ctx.Request.Host.Value))
    {
        ctx.Response.StatusCode = 403;
        return;
    }
    try
    {
        await next(ctx);
    }
    catch (WorkflowMissing e) { await Results.Problem(e.Message, statusCode: 404).ExecuteAsync(ctx); }
    catch (WorkflowConflict e) { await Results.Problem(e.Message, statusCode: 409).ExecuteAsync(ctx); }
    catch (JsonException e) { await Results.Problem(e.Message, statusCode: 400).ExecuteAsync(ctx); }
    catch (ArgumentException e) { await Results.Problem(e.Message, statusCode: 400).ExecuteAsync(ctx); }
    catch (BadHttpRequestException e) { await Results.Problem(e.Message, statusCode: e.StatusCode).ExecuteAsync(ctx); }
});
app.UseRateLimiter();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/health/live", () => new { status = "ok", service = "waferscope" });
app.MapGet("/health/ready", async (Store store, CancellationToken ct) => { await store.Metrics(ct); return new { status = "ready" }; });
app.MapGet("/api/workspace/views", (Store s, CancellationToken ct) => s.Views(ct));
app.MapPost("/api/workspace/views", async (ViewInput v, Store s, CancellationToken ct) => Results.Json(new { id = await s.Create(v, ct) }, statusCode: 201));
app.MapPut("/api/workspace/views/{id:guid}", async (Guid id, ViewInput v, Store s, CancellationToken ct) => await s.Update(id, v, ct) ? Results.Ok(new { updated = true }) : Results.Problem("다른 탭에서 변경되었거나 삭제된 뷰입니다. 새로고침 후 다시 시도하세요.", statusCode: 409));
app.MapDelete("/api/workspace/views/{id:guid}", async (Guid id, int version, Store s, CancellationToken ct) => await s.Delete(id, version, ct) ? Results.NoContent() : Results.Problem("View changed or no longer exists", statusCode: 409));
app.MapGet("/api/workspace/runs", (int? limit, Store s, CancellationToken ct) => s.Runs(limit ?? 100, ct));
app.MapGet("/api/workspace/runs/{id:guid}", async (Guid id, Store store, CancellationToken ct) => {
    var rows = await store.Runs(1, ct, id);
    return rows.Count == 0 ? Results.NotFound() : Results.Ok(rows[0]);
});
app.MapGet("/api/workspace/metrics", (Store s, CancellationToken ct) => s.Metrics(ct));
app.MapGet("/api/workspace/health", async (IHttpClientFactory factory, Store store, CancellationToken ct) =>
{
    async Task<object> Probe(string name)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            using var r = await factory.CreateClient(name).GetAsync("health/ready", ct);
            return new
            {
                name,
                healthy = r.IsSuccessStatusCode,
                latencyMs = sw.ElapsedMilliseconds
            };
        }
        catch { return new { name, healthy = false, latencyMs = sw.ElapsedMilliseconds }; }
    }
    var probes = await Task.WhenAll(Probe("dac"), Probe("chart"));
    var timer = Stopwatch.StartNew();
    var pg = true;
    try
    {
        await store.Metrics(ct);
    }
    catch { pg = false; }
    return new
    {
        checkedAt = DateTimeOffset.UtcNow,
        services = probes.Append(new
        {
            name = "postgres",
            healthy = pg,
            latencyMs = timer.ElapsedMilliseconds
        })
    };
});
app.MapPost("/api/execute", async (ExecuteInput input, IHttpClientFactory clients, Store store, CancellationToken ct) =>
{
    var target = Guard.Target(input);
    var id = Guid.NewGuid();
    var sw = Stopwatch.StartNew();
    int status;
    JsonElement data;
    int? count = null;
    try
    {
        using var message = new HttpRequestMessage(new HttpMethod(input.Method), input.Path);
        if (input.Method == "POST")
            message.Content = new StringContent(input.Body?.GetRawText() ?? "{}", Encoding.UTF8, "application/json");
        using var response = await clients.CreateClient(target).SendAsync(message, ct);
        status = (int)response.StatusCode;
        data = await UpstreamJson.Read(response.Content, ct);
        if (data.ValueKind == JsonValueKind.Array)
            count = data.GetArrayLength();
        else if (data.ValueKind == JsonValueKind.Object)
        {
            if (data.TryGetProperty("plottedRows", out var n) || data.TryGetProperty("count", out n) || data.TryGetProperty("returnedRows", out n))
                count = n.GetInt32();
        }
    }
    catch (HttpRequestException) { status = 502; data = JsonSerializer.SerializeToElement(new { detail = "Upstream service unavailable" }); }
    catch (JsonException) { status = 502; data = JsonSerializer.SerializeToElement(new { detail = "Upstream returned an invalid JSON response" }); }
    catch (TaskCanceledException) when (!ct.IsCancellationRequested) { status = 504; data = JsonSerializer.SerializeToElement(new { detail = "Upstream service timed out" }); }
    var ms = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
    int? queryVersion = data.ValueKind == JsonValueKind.Object && data.TryGetProperty("query_version", out var version) && version.TryGetInt32(out var v) ? v : null;
    if (input.Record || input.Path.StartsWith("/api/dac/select/", StringComparison.Ordinal))
        await store.Run(id, input, status, ms, count, ct, queryVersion);
    return Results.Ok(new
    {
        runId = id,
        status,
        durationMs = ms,
        rowCount = count,
        data
    });
}).RequireRateLimiting("work");
app.MapPost("/api/export", async (ExportInput input, IHttpClientFactory clients, Store store, CancellationToken ct) =>
{
    Guard.Config(input.Config);
    if (input.Format is not ("svg" or "png" or "html") || input.CategoryIndex < 0)
        throw new ArgumentException("Invalid export options");
    var path = $"/api/chart/render?format={input.Format}&categoryIndex={input.CategoryIndex}";
    var sw = Stopwatch.StartNew();
    using var r = await clients.CreateClient("chart").PostAsJsonAsync(path, input.Config, ct);
    await store.Run(Guid.NewGuid(), new(path, "POST", input.Config), (int)r.StatusCode, sw.Elapsed.TotalMilliseconds, null, ct);
    if (!r.IsSuccessStatusCode)
        return Results.Problem("이미지를 생성하지 못했습니다. 데이터와 서비스 상태를 확인하세요.", statusCode: (int)r.StatusCode);
    return Results.File(await r.Content.ReadAsByteArrayAsync(ct), r.Content.Headers.ContentType?.ToString() ?? "application/octet-stream", "waferscope." + input.Format);
}).RequireRateLimiting("work");
app.MapWorkflows();
app.MapSources();
app.MapFallback("/api/{**path}", () => Results.Problem("Unknown API route", statusCode: 404));
app.MapFallbackToFile("index.html");
app.Run();
public partial class Program
{
}
