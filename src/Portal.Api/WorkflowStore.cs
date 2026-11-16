using Npgsql;
using NpgsqlTypes;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace Portal.Api;

public sealed class WorkflowStore(NpgsqlDataSource db)
{
    public async Task Init()
    {
        await Exec("""
        CREATE TABLE IF NOT EXISTS wf_definitions(id uuid PRIMARY KEY,name varchar(80) NOT NULL,revision int NOT NULL DEFAULT 1,published_version int NOT NULL DEFAULT 0,definition jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
        ALTER TABLE wf_definitions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE TABLE IF NOT EXISTS wf_versions(workflow_id uuid NOT NULL REFERENCES wf_definitions(id),version int NOT NULL,definition jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workflow_id,version));
        CREATE TABLE IF NOT EXISTS wf_runs(id uuid PRIMARY KEY,workflow_id uuid NOT NULL REFERENCES wf_definitions(id),version int,definition jsonb NOT NULL,inputs jsonb NOT NULL,status text NOT NULL DEFAULT 'queued',cancel_requested boolean NOT NULL DEFAULT false,error text,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz);
        CREATE INDEX IF NOT EXISTS wf_runs_recent ON wf_runs(workflow_id,created_at DESC);
        CREATE TABLE IF NOT EXISTS wf_node_runs(run_id uuid NOT NULL REFERENCES wf_runs(id),node_id text NOT NULL,status text NOT NULL,request jsonb,query_version int,duration_ms double precision,columns jsonb,rows jsonb,error text,PRIMARY KEY(run_id,node_id));
        """, CancellationToken.None);
    }
    public static void Params(NpgsqlCommand c, object?[] args)
    {
        foreach (var a in args)
        {
            if (a is JsonNode n)
                c.Parameters.AddWithValue(NpgsqlDbType.Jsonb, n.ToJsonString());
            else
                c.Parameters.AddWithValue(a ?? DBNull.Value);
        }
    }
    public async Task<int> Exec(string sql, CancellationToken ct, params object?[] args)
    {
        using var c = db.CreateCommand(sql);
        Params(c, args);
        return await c.ExecuteNonQueryAsync(ct);
    }
    public async Task<List<JsonObject>> Query(string sql, CancellationToken ct, params object?[] args)
    {
        using var c = db.CreateCommand(sql);
        Params(c, args);
        using var r = await c.ExecuteReaderAsync(ct);
        var rows = new List<JsonObject>();
        while (await r.ReadAsync(ct))
            rows.Add(JsonNode.Parse(r.GetString(0))!.AsObject());
        return rows;
    }
    public async Task<JsonObject?> Get(Guid id, CancellationToken ct) => (await Query("SELECT to_jsonb(w)::text FROM wf_definitions w WHERE id=$1 AND deleted_at IS NULL", ct, id)).FirstOrDefault();
    public async Task<JsonObject> Save(Guid? id, WorkflowSave input, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 80)
            throw new ArgumentException("이름은 1~80자입니다.");
        // Drafts may have incomplete connections, but must remain a bounded, well-formed document.
        if (input.Definition?.Nodes == null || input.Definition.Edges == null || input.Definition.Inputs == null || input.Definition.Nodes.Count > 30 || input.Definition.Edges.Count > 100 || input.Definition.Nodes.Any(n => n == null || !WorkflowRules.Id(n.Id) || n.Config == null) || input.Definition.Nodes.Select(n => n.Id).Distinct().Count() != input.Definition.Nodes.Count)
            throw new ArgumentException("올바르지 않은 초안입니다.");
        var definition = JsonSerializer.SerializeToNode(input.Definition, WorkflowRules.Json)!;
        var key = id ?? Guid.NewGuid();
        var count = id == null ? await Exec("INSERT INTO wf_definitions(id,name,definition) VALUES($1,$2,$3)", ct, key, input.Name.Trim(), definition) : await Exec("UPDATE wf_definitions SET name=$2,definition=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$4 AND deleted_at IS NULL", ct, key, input.Name.Trim(), definition, input.Revision);
        if (count == 0)
            throw new WorkflowConflict("다른 탭에서 변경되었습니다. 다시 불러온 후 저장하세요.");
        return (await Get(key, ct))!;
    }
    public async Task<JsonObject> Publish(Guid id, int revision, CancellationToken ct)
    {
        await using var connection = await db.OpenConnectionAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        using var read = new NpgsqlCommand("SELECT definition::text FROM wf_definitions WHERE id=$1 AND revision=$2 AND deleted_at IS NULL FOR UPDATE", connection, tx);
        read.Parameters.AddWithValue(id);
        read.Parameters.AddWithValue(revision);
        var text = (string?)await read.ExecuteScalarAsync(ct);
        if (text == null)
            throw new WorkflowConflict("변경되었거나 존재하지 않는 초안입니다.");
        WorkflowRules.Validate(JsonSerializer.Deserialize<WorkflowDefinition>(text, WorkflowRules.Json)!);
        using var command = new NpgsqlCommand("UPDATE wf_definitions SET published_version=published_version+1,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING published_version", connection, tx);
        command.Parameters.AddWithValue(id);
        var version = (int)(await command.ExecuteScalarAsync(ct))!;
        using var insert = new NpgsqlCommand("INSERT INTO wf_versions(workflow_id,version,definition) VALUES($1,$2,$3)", connection, tx);
        Params(insert, [id, version, JsonNode.Parse(text)]);
        await insert.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
        return (await Get(id, ct))!;
    }
    public async Task<Guid> Enqueue(Guid id, WorkflowStart input, bool draft, CancellationToken ct)
    {
        if (input.Inputs == null)
            throw new ArgumentException("inputs 객체가 필요합니다.");
        await using var c = await db.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        using (var gate = new NpgsqlCommand("SELECT pg_advisory_xact_lock(8172402)", c, tx))
            await gate.ExecuteNonQueryAsync(ct);
        using (var count = new NpgsqlCommand("SELECT count(*) FROM wf_runs WHERE status IN ('queued','running')", c, tx))
        if ((long)(await count.ExecuteScalarAsync(ct))! >= 20)
            throw new WorkflowConflict("실행 대기열이 가득 찼습니다. 잠시 후 실행하세요.");
        using var find = new NpgsqlCommand(draft ? "SELECT definition::text, NULL::int FROM wf_definitions WHERE id=$1 AND deleted_at IS NULL" : "SELECT v.definition::text,v.version FROM wf_versions v JOIN wf_definitions w ON w.id=v.workflow_id WHERE w.id=$1 AND w.deleted_at IS NULL AND v.version=coalesce($2,w.published_version)", c, tx);
        find.Parameters.AddWithValue(id);
        if (!draft)
            find.Parameters.AddWithValue(NpgsqlDbType.Integer, (object?)input.Version ?? DBNull.Value);
        string text;
        int? version;
        using (var r = await find.ExecuteReaderAsync(ct))
        {
            if (!await r.ReadAsync(ct))
                throw new WorkflowMissing("워크플로우 또는 게시 버전이 없습니다.");
            text = r.GetString(0);
            version = r.IsDBNull(1) ? null : r.GetInt32(1);
        }
        var definition = JsonSerializer.Deserialize<WorkflowDefinition>(text, WorkflowRules.Json)!;
        WorkflowRules.Validate(definition);
        var inputs = (JsonObject)definition.Inputs.DeepClone();
        foreach (var pair in input.Inputs)
        {
            if (!inputs.ContainsKey(pair.Key))
                throw new ArgumentException("알 수 없는 입력: " + pair.Key);
            inputs[pair.Key] = pair.Value?.DeepClone();
        }
        var run = Guid.NewGuid();
        using var insert = new NpgsqlCommand("INSERT INTO wf_runs(id,workflow_id,version,definition,inputs) VALUES($1,$2,$3,$4,$5)", c, tx);
        insert.Parameters.AddWithValue(run);
        insert.Parameters.AddWithValue(id);
        insert.Parameters.AddWithValue(NpgsqlDbType.Integer, (object?)version ?? DBNull.Value);
        insert.Parameters.AddWithValue(NpgsqlDbType.Jsonb, text);
        insert.Parameters.AddWithValue(NpgsqlDbType.Jsonb, inputs.ToJsonString());
        await insert.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
        return run;
    }
    public async Task Delete(Guid id, int revision, CancellationToken ct)
    {
        await using var c = await db.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        using (var gate = new NpgsqlCommand("SELECT pg_advisory_xact_lock(8172402)", c, tx)) await gate.ExecuteNonQueryAsync(ct);
        using var command = new NpgsqlCommand("UPDATE wf_definitions SET deleted_at=now(),updated_at=now(),revision=revision+1 WHERE id=$1 AND revision=$2 AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM wf_runs WHERE workflow_id=$1 AND status IN ('queued','running'))", c, tx);
        Params(command, [id, revision]);
        if (await command.ExecuteNonQueryAsync(ct) != 1) throw new WorkflowConflict("실행 중이거나 다른 곳에서 변경·삭제된 워크플로우입니다. 실행 종료 후 목록을 새로고침하세요.");
        await tx.CommitAsync(ct);
    }
    public async Task<JsonObject?> Run(Guid id, CancellationToken ct)
    {
        var run = (await Query("SELECT to_jsonb(r)::text FROM wf_runs r WHERE id=$1", ct, id)).FirstOrDefault();
        if (run != null)
            run["nodes"] = JsonSerializer.SerializeToNode(await Query("SELECT (to_jsonb(n)-'rows') || jsonb_build_object('row_count',jsonb_array_length(rows),'preview',(SELECT coalesce(jsonb_agg(value),'[]') FROM (SELECT value FROM jsonb_array_elements(coalesce(n.rows,'[]')) LIMIT 10) p)) FROM wf_node_runs n WHERE run_id=$1 ORDER BY node_id", ct, id));
        return run;
    }
}
public sealed class WorkflowMissing(string message) : Exception(message);
public sealed class WorkflowConflict(string message) : Exception(message);

public static class WorkflowRoutes
{
    public static void MapWorkflows(this WebApplication app)
    {
        app.MapGet("/api/workflows", (WorkflowStore s, CancellationToken ct) => s.Query("SELECT (to_jsonb(w)-'definition')::text FROM wf_definitions w WHERE deleted_at IS NULL ORDER BY updated_at DESC", ct));
        app.MapGet("/api/workflows/{id:guid}", async (Guid id, WorkflowStore s, CancellationToken ct) => await s.Get(id, ct) is { } w ? Results.Ok(w) : Results.NotFound());
        app.MapPost("/api/workflows", (WorkflowSave w, WorkflowStore s, CancellationToken ct) => s.Save(null, w, ct));
        app.MapPut("/api/workflows/{id:guid}", (Guid id, WorkflowSave w, WorkflowStore s, CancellationToken ct) => s.Save(id, w, ct));
        app.MapDelete("/api/workflows/{id:guid}", async (Guid id, int revision, WorkflowStore s, CancellationToken ct) => { await s.Delete(id, revision, ct); return Results.NoContent(); });
        app.MapPost("/api/workflow/{id:guid}", async (Guid id, WorkflowStart r, WorkflowStore s, CancellationToken ct) => { var run = await s.Enqueue(id, r, false, ct); return Results.Accepted("/api/workflow-runs/" + run, new { runId = run }); });
        app.MapPost("/api/workflows/validate", (WorkflowDefinition d) => Results.Ok(new { order = WorkflowRules.Validate(d).Select(n => n.Id) }));
        app.MapPost("/api/workflows/{id:guid}/publish", (Guid id, PublishRequest r, WorkflowStore s, CancellationToken ct) => s.Publish(id, r.Revision, ct));
        app.MapGet("/api/workflows/{id:guid}/versions", (Guid id, WorkflowStore s, CancellationToken ct) => s.Query("SELECT (to_jsonb(v)-'definition')::text FROM wf_versions v WHERE workflow_id=$1 ORDER BY version DESC", ct, id));
        app.MapGet("/api/workflows/{id:guid}/runs", (Guid id, WorkflowStore s, CancellationToken ct) => s.Query("SELECT (to_jsonb(r)-'definition')::text FROM wf_runs r WHERE workflow_id=$1 ORDER BY created_at DESC LIMIT 50", ct, id));
        app.MapPost("/api/workflows/{id:guid}/runs", async (Guid id, WorkflowStart r, WorkflowStore s, CancellationToken ct) => { var run = await s.Enqueue(id, r, false, ct); return Results.Accepted("/api/workflow-runs/" + run, new { runId = run }); });
        app.MapPost("/api/workflows/{id:guid}/test", async (Guid id, WorkflowStart r, WorkflowStore s, CancellationToken ct) => { var run = await s.Enqueue(id, r, true, ct); return Results.Accepted("/api/workflow-runs/" + run, new { runId = run }); });
        app.MapGet("/api/workflow-runs/{id:guid}", async (Guid id, WorkflowStore s, CancellationToken ct) => await s.Run(id, ct) is { } r ? Results.Ok(r) : Results.NotFound());
        app.MapPost("/api/workflow-runs/{id:guid}/cancel", async (Guid id, WorkflowStore s, CancellationToken ct) => await s.Exec("UPDATE wf_runs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END WHERE id=$1 AND status IN ('queued','running')", ct, id) > 0 ? Results.Accepted() : Results.Conflict(new { detail = "이미 종료되었거나 존재하지 않는 실행입니다." }));
        app.MapGet("/api/workflow-runs/{id:guid}/nodes/{node}/data", async (Guid id, string node, int? offset, int? limit, WorkflowStore s, CancellationToken ct) =>
        {
            var rows = await s.Query("SELECT jsonb_build_object('columns',columns,'total',jsonb_array_length(rows),'rows',(SELECT coalesce(jsonb_agg(value),'[]') FROM (SELECT value FROM jsonb_array_elements(n.rows) WITH ORDINALITY ORDER BY ordinality OFFSET $3 LIMIT $4) p))::text FROM wf_node_runs n WHERE run_id=$1 AND node_id=$2 AND status='succeeded'", ct, id, node, Math.Max(0, offset ?? 0), Math.Clamp(limit ?? 100, 1, 1000));
            return rows.Count == 0 ? Results.NotFound() : Results.Ok(rows[0]);
        });
    }
    public record PublishRequest(int Revision);
}
