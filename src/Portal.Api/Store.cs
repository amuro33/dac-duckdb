using Npgsql;
using NpgsqlTypes;
using System.Text.Json;
namespace Portal.Api;

public sealed class Store(NpgsqlDataSource db)
{
    public async Task Init()
    {
        using var c = db.CreateCommand("""
 CREATE TABLE IF NOT EXISTS ws_views(id uuid PRIMARY KEY,name varchar(80) NOT NULL,description text NOT NULL,config jsonb NOT NULL,pinned boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS ws_runs(id uuid PRIMARY KEY,path text NOT NULL,method varchar(8) NOT NULL,request jsonb,status integer NOT NULL,duration_ms double precision NOT NULL,row_count integer,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS ws_runs_recent ON ws_runs(created_at DESC);
 """);
        await c.ExecuteNonQueryAsync();
    }
    public async Task<object> Views(CancellationToken ct)
    {
        using var c = db.CreateCommand("SELECT id,name,description,config::text,pinned,version,created_at,updated_at FROM ws_views ORDER BY pinned DESC,updated_at DESC");
        using var r = await c.ExecuteReaderAsync(ct);
        var items = new List<object>();
        while (await r.ReadAsync(ct))
            items.Add(new
            {
                id = r.GetGuid(0),
                name = r.GetString(1),
                description = r.GetString(2),
                config = JsonSerializer.Deserialize<JsonElement>(r.GetString(3)),
                pinned = r.GetBoolean(4),
                version = r.GetInt32(5),
                createdAt = r.GetDateTime(6),
                updatedAt = r.GetDateTime(7)
            });
        return items;
    }
    public async Task<Guid> Create(ViewInput v, CancellationToken ct)
    {
        Guard.View(v);
        var id = Guid.NewGuid();
        using var c = db.CreateCommand("INSERT INTO ws_views(id,name,description,config,pinned) VALUES($1,$2,$3,$4,$5)");
        c.Parameters.AddWithValue(id);
        c.Parameters.AddWithValue(v.Name.Trim());
        c.Parameters.AddWithValue(v.Description);
        c.Parameters.AddWithValue(NpgsqlDbType.Jsonb, v.Config.GetRawText());
        c.Parameters.AddWithValue(v.Pinned);
        await c.ExecuteNonQueryAsync(ct);
        return id;
    }
    public async Task<bool> Update(Guid id, ViewInput v, CancellationToken ct)
    {
        Guard.View(v);
        using var c = db.CreateCommand("UPDATE ws_views SET name=$2,description=$3,config=$4,pinned=$5,version=version+1,updated_at=now() WHERE id=$1 AND version=$6");
        c.Parameters.AddWithValue(id);
        c.Parameters.AddWithValue(v.Name.Trim());
        c.Parameters.AddWithValue(v.Description);
        c.Parameters.AddWithValue(NpgsqlDbType.Jsonb, v.Config.GetRawText());
        c.Parameters.AddWithValue(v.Pinned);
        c.Parameters.AddWithValue(v.Version);
        return await c.ExecuteNonQueryAsync(ct) == 1;
    }
    public async Task<bool> Delete(Guid id, int version, CancellationToken ct)
    {
        using var c = db.CreateCommand("DELETE FROM ws_views WHERE id=$1 AND version=$2");
        c.Parameters.AddWithValue(id);
        c.Parameters.AddWithValue(version);
        return await c.ExecuteNonQueryAsync(ct) == 1;
    }
    public async Task Run(Guid id, ExecuteInput input, int status, double ms, int? count, CancellationToken ct)
    {
        using var c = db.CreateCommand("INSERT INTO ws_runs(id,path,method,request,status,duration_ms,row_count) VALUES($1,$2,$3,$4,$5,$6,$7)");
        c.Parameters.AddWithValue(id);
        c.Parameters.AddWithValue(input.Path);
        c.Parameters.AddWithValue(input.Method);
        c.Parameters.AddWithValue(NpgsqlDbType.Jsonb, (object?)input.Body?.GetRawText() ?? DBNull.Value);
        c.Parameters.AddWithValue(status);
        c.Parameters.AddWithValue(ms);
        c.Parameters.AddWithValue(NpgsqlDbType.Integer, (object?)count ?? DBNull.Value);
        await c.ExecuteNonQueryAsync(ct);
    }
    public async Task<object> Runs(int limit, CancellationToken ct)
    {
        using var c = db.CreateCommand("SELECT id,path,method,request::text,status,duration_ms,row_count,created_at FROM ws_runs ORDER BY created_at DESC LIMIT $1");
        c.Parameters.AddWithValue(Math.Clamp(limit, 1, 200));
        using var r = await c.ExecuteReaderAsync(ct);
        var list = new List<object>();
        while (await r.ReadAsync(ct))
            list.Add(new
            {
                id = r.GetGuid(0),
                path = r.GetString(1),
                method = r.GetString(2),
                request = r.IsDBNull(3) ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(r.GetString(3)),
                status = r.GetInt32(4),
                durationMs = Math.Round(r.GetDouble(5), 1),
                rowCount = r.IsDBNull(6) ? (int?)null : r.GetInt32(6),
                createdAt = r.GetDateTime(7)
            });
        return list;
    }
    public async Task<object> Metrics(CancellationToken ct)
    {
        using var c = db.CreateCommand("SELECT count(*),count(*) FILTER(WHERE status>=400),percentile_cont(0.95) WITHIN GROUP(ORDER BY duration_ms),(SELECT count(*) FROM ws_views) FROM ws_runs WHERE created_at>=now()-interval '24 hours'");
        using var r = await c.ExecuteReaderAsync(ct);
        await r.ReadAsync(ct);
        return new
        {
            runs = r.GetInt64(0),
            errors = r.GetInt64(1),
            p95Ms = r.IsDBNull(2) ? (double?)null : Math.Round(r.GetDouble(2), 1),
            views = r.GetInt64(3)
        };
    }
}
