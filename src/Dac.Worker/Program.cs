using Dac.Worker;
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<IDataRepository, OracleRepository>();

builder.Services.AddSingleton<BenchmarkRepository>();
builder.Services.AddSingleton<StoredQueries>();
builder.Services.AddHttpClient("transform", c => { c.BaseAddress = new Uri(builder.Configuration["TransformApiBaseUrl"] ?? "http://data-transform-service:8080/"); c.Timeout = TimeSpan.FromSeconds(180); });
builder.Services.AddProblemDetails();
var app = builder.Build();
app.UseExceptionHandler();
app.Use(async (context, next) => { try { await next(context); } catch (BadHttpRequestException ex) { await Results.Problem(ex.Message, statusCode: ex.StatusCode).ExecuteAsync(context); } catch (HttpRequestException) { await Results.Problem("Transform service unavailable", statusCode: 502).ExecuteAsync(context); } catch (ArgumentException ex) { await Results.Problem(ex.Message, statusCode: 400).ExecuteAsync(context); } });
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/health/live", () => Results.Ok(new { status = "ok", service = "dac-worker" }));
app.MapGet("/health/ready", async (IDataRepository repo, CancellationToken ct) => { await repo.GetEds(new(Limit: 1), ct); return Results.Ok(new { status = "ready" }); });
app.MapGet("/api/dac/get_eds_data", async (string? lotId, string? waferId, int? limit, IDataRepository repo, CancellationToken ct) => await repo.GetEds(new(lotId, waferId, limit ?? 100), ct));
app.MapGet("/api/dac/get_defect_data", async (string? lotId, string? waferId, int? limit, IDataRepository repo, CancellationToken ct) => await repo.GetDefects(new(lotId, waferId, limit ?? 100), ct));
app.MapGet("/api/dac/lots", async (IDataRepository repo, CancellationToken ct) => (await repo.GetEds(new(Limit: 1000), ct)).Select(x => x.LotId).Distinct().Order());
app.MapGet("/api/dac/summary", async (IDataRepository repo, CancellationToken ct) => { var e = await repo.GetEds(new(Limit: 1000), ct); var d = await repo.GetDefects(new(Limit: 1000), ct); return new { waferCount = e.Count, defectRecordCount = d.Count, totalDefects = d.Sum(x => x.DefectCount), averageYield = e.Count == 0 ? 0 : e.Average(x => x.YieldPct) }; });
app.MapPost("/api/dac/transform", async (TransformRequest request, IHttpClientFactory clients, CancellationToken ct) =>
{
    Validation.Transform(request);
    using var response = await clients.CreateClient("transform").PostAsJsonAsync("api/transform/execute", request, ct);
    return Results.Content(await response.Content.ReadAsStringAsync(ct), "application/json", statusCode: (int)response.StatusCode);
});
app.MapGet("/api/dac/chart_samples", async (string? source, int size, int? limit, string? lotId, int? afterId, BenchmarkRepository repo, CancellationToken ct) => await repo.Read(source ?? "eds", size, limit ?? size, lotId, ct, afterId ?? 0));
app.MapGet("/api/dac/queries", async (StoredQueries queries, CancellationToken ct) => (await queries.List(ct)).Select(q => new {
    query_id = q.QueryId, database_name = q.DatabaseName, name = q.Name, description = q.Description, query_version = q.Version,
    route = "/api/dac/select/" + q.QueryId, method = "POST", default_body = q.DefaultBody, bindings = q.Bindings
}));
app.MapPost("/api/dac/select/{query_id}", async (string query_id, System.Text.Json.JsonElement body, StoredQueries queries, CancellationToken ct) => {
    var result = await queries.Execute(query_id, body, ct);
    return result is null ? Results.Problem("Unknown or disabled query_id", statusCode:404) : Results.Ok(result);
});
app.Run();
public partial class Program
{
}
