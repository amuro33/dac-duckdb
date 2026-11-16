using Npgsql;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace Portal.Api;

public sealed class WorkflowRunner(WorkflowStore store, Store history, NpgsqlDataSource db, IHttpClientFactory clients, WorkflowEngine engine, ILogger<WorkflowRunner> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // One database lease across replicas. A replacement never repeats an in-flight API call.
                await using var lease = await db.OpenConnectionAsync(stoppingToken);
                using var gate = new NpgsqlCommand("SELECT pg_try_advisory_lock(8172401)", lease);
                if (!(bool)(await gate.ExecuteScalarAsync(stoppingToken))!)
                {
                    await Task.Delay(2000, stoppingToken);
                    continue;
                }
                try
                {
                    await store.Exec("UPDATE wf_node_runs SET status='interrupted',error='실행 서비스가 재시작되었습니다.' WHERE status='running'; UPDATE wf_node_runs SET status='skipped' WHERE status='pending' AND run_id IN (SELECT id FROM wf_runs WHERE status='running'); UPDATE wf_runs SET status='interrupted',error='실행 서비스 재시작: 새 실행으로 다시 시작하세요.',finished_at=now() WHERE status='running'", stoppingToken);
                    while (!stoppingToken.IsCancellationRequested)
                    {
                        using (var heartbeat = new NpgsqlCommand("SELECT 1", lease))
                            await heartbeat.ExecuteScalarAsync(stoppingToken);
                        var next = (await store.Query("UPDATE wf_runs SET status='running',started_at=now() WHERE id=(SELECT id FROM wf_runs WHERE status='queued' AND NOT cancel_requested ORDER BY created_at LIMIT 1) RETURNING to_jsonb(wf_runs)::text", stoppingToken)).FirstOrDefault();
                        if (next == null)
                        {
                            await Task.Delay(500, stoppingToken);
                            continue;
                        }
                        await Run(next, stoppingToken);
                    }
                }
                finally { using var unlock = new NpgsqlCommand("SELECT pg_advisory_unlock(8172401)", lease); await unlock.ExecuteScalarAsync(CancellationToken.None); }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e) { logger.LogError(e, "Workflow worker retry"); await Task.Delay(2000, stoppingToken); }
        }
    }
    async Task Run(JsonObject record, CancellationToken stop)
    {
        var id = Guid.Parse(record["id"]!.GetValue<string>());
        var d = record["definition"]!.Deserialize<WorkflowDefinition>(WorkflowRules.Json)!;
        var inputs = record["inputs"]!.AsObject();
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(3));
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(stop, timeout.Token);
        using var monitorStop = new CancellationTokenSource();
        bool userCancel = false;
        var monitor = Task.Run(async () => { while (!monitorStop.IsCancellationRequested) { try { var check = (await store.Query("SELECT jsonb_build_object('cancel',cancel_requested)::text FROM wf_runs WHERE id=$1", monitorStop.Token, id))[0]; if (check["cancel"]!.GetValue<bool>()) { userCancel = true; cancel.Cancel(); break; } await Task.Delay(300, monitorStop.Token); } catch (OperationCanceledException) { break; } catch (Exception e) { logger.LogWarning(e, "Workflow cancellation poll failed"); cancel.Cancel(); break; } } });
        string? active = null;
        var clock = Stopwatch.StartNew();
        try
        {
            var order = WorkflowRules.Validate(d);
            var outputs = new Dictionary<string, WorkflowData>();
            foreach (var n in order)
                await store.Exec("INSERT INTO wf_node_runs(run_id,node_id,status) VALUES($1,$2,'pending')", cancel.Token, id, n.Id);
            foreach (var n in order)
            {
                cancel.Token.ThrowIfCancellationRequested();
                active = n.Id;
                clock.Restart();
                await store.Exec("UPDATE wf_node_runs SET status='running' WHERE run_id=$1 AND node_id=$2", cancel.Token, id, n.Id);
                WorkflowData result;
                if (n.Kind == "query")
                {
                    var body = WorkflowRules.Resolve(n.Config["body"], inputs, outputs)!;
                    var queryId = WorkflowRules.Text(n.Config, "queryId");
                    var version = n.Config["queryVersion"]!.GetValue<int>();
                    using var nodeTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancel.Token);
                    nodeTimeout.CancelAfter(TimeSpan.FromSeconds(40));
                    var ct = nodeTimeout.Token;
                    var client = clients.CreateClient("dac");
                    using (var catalog = await client.GetAsync("api/dac/queries", ct))
                    {
                        catalog.EnsureSuccessStatusCode();
                        var json = await catalog.Content.ReadFromJsonAsync<JsonElement>(ct);
                        var queries = json.ValueKind == JsonValueKind.Array ? json : json.GetProperty("queries");
                        var found = queries.EnumerateArray().FirstOrDefault(q => q.GetProperty("query_id").GetString() == queryId);
                        if (found.ValueKind == JsonValueKind.Undefined || found.GetProperty("query_version").GetInt32() != version)
                            throw new ArgumentException(queryId + ": 쿼리 버전이 변경되었거나 삭제되었습니다. 노드를 갱신한 뒤 다시 게시하세요.");
                    }
                    await store.Exec("UPDATE wf_node_runs SET request=$3,query_version=$4 WHERE run_id=$1 AND node_id=$2", ct, id, n.Id, body, version);
                    using var response = await client.PostAsJsonAsync("api/dac/select/" + queryId, body, ct);
                    var data = await UpstreamJson.Read(response.Content, ct);
                    await history.Run(Guid.NewGuid(), new("/api/dac/select/" + queryId, "POST", JsonSerializer.SerializeToElement(body)), (int)response.StatusCode, clock.Elapsed.TotalMilliseconds, data.TryGetProperty("count", out var count) ? count.GetInt32() : null, ct, data.TryGetProperty("query_version", out var actual) ? actual.GetInt32() : null);
                    if (!response.IsSuccessStatusCode)
                        throw new ArgumentException(data.TryGetProperty("detail", out var detail) ? detail.GetString() : "DAC 조회 실패: " + response.StatusCode);
                    if (data.GetProperty("query_version").GetInt32() != version)
                        throw new ArgumentException("실행 중 쿼리 버전이 변경되었습니다.");
                    result = WorkflowEngine.FromResponse(data);
                }
                else
                {
                    WorkflowData Input(string port) => outputs[d.Edges.Single(e => e.Target == n.Id && e.Port == port).Source];
                    result = engine.Transform(n, Input(n.Kind is "join" or "merge" ? "left" : "input"), n.Kind is "join" or "merge" ? Input("right") : null, cancel.Token);
                }
                cancel.Token.ThrowIfCancellationRequested();
                var rows = JsonSerializer.SerializeToNode(result.Rows, WorkflowRules.Json)!;
                if (System.Text.Encoding.UTF8.GetByteCount(rows.ToJsonString()) > 8_000_000)
                    throw new ArgumentException("노드 결과가 8MB를 초과했습니다. 조회 범위를 줄이세요.");
                await store.Exec("UPDATE wf_node_runs SET status='succeeded',duration_ms=$3,columns=$4,rows=$5 WHERE run_id=$1 AND node_id=$2", cancel.Token, id, n.Id, clock.Elapsed.TotalMilliseconds, JsonSerializer.SerializeToNode(result.Columns, WorkflowRules.Json), rows);
                outputs[n.Id] = result;
                active = null;
            }
            // Atomically respect cancellation even if it arrived after the final node finished.
            await store.Exec("UPDATE wf_runs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'succeeded' END,finished_at=now() WHERE id=$1", CancellationToken.None, id);
        }
        catch (Exception e)
        {
            var status = userCancel ? "cancelled" : stop.IsCancellationRequested ? "interrupted" : "failed";
            var message = userCancel ? "사용자가 실행을 취소했습니다." : stop.IsCancellationRequested ? "실행 서비스가 종료되었습니다." : timeout.IsCancellationRequested ? "전체 실행 제한 시간(3분)을 초과했습니다." : e is OperationCanceledException ? "노드 실행 시간이 초과되었거나 실행을 계속할 수 없습니다." : e.Message;
            if (message.Length > 1000)
                message = message[..1000];
            logger.LogWarning(e, "Workflow {Run} ended: {Status}", id, status);
            if (active != null)
                await store.Exec("UPDATE wf_node_runs SET status=$3,error=$4,duration_ms=$5 WHERE run_id=$1 AND node_id=$2", CancellationToken.None, id, active, status, message, clock.Elapsed.TotalMilliseconds);
            await store.Exec("UPDATE wf_node_runs SET status='skipped' WHERE run_id=$1 AND status='pending'", CancellationToken.None, id);
            await store.Exec("UPDATE wf_runs SET status=$2,error=$3,finished_at=now() WHERE id=$1", CancellationToken.None, id, status, message);
        }
        finally { monitorStop.Cancel(); await monitor; }
    }
}
