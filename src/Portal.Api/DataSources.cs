using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace Portal.Api;

public record SourceInput(string Kind, string? QueryId, JsonObject? Body, Guid? RunId);
public sealed class DataSources(WorkflowStore store, Store history, IHttpClientFactory clients)
{
    public async Task Init() => await store.Exec("""
    CREATE TABLE IF NOT EXISTS source_snapshots(id uuid PRIMARY KEY,name text NOT NULL,kind text NOT NULL,origin jsonb NOT NULL,columns jsonb NOT NULL,rows jsonb NOT NULL,row_count integer NOT NULL,checksum text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS source_comparisons(id uuid PRIMARY KEY,config jsonb NOT NULL,status text NOT NULL DEFAULT 'queued',results jsonb NOT NULL DEFAULT '{}',error text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
    ALTER TABLE source_comparisons ADD COLUMN IF NOT EXISTS workflow_payload jsonb;
    """, CancellationToken.None);
    public async Task<JsonObject?> Get(Guid id, CancellationToken ct, bool withRows=false) => (await store.Query(withRows?"SELECT to_jsonb(s)::text FROM source_snapshots s WHERE id=$1":"SELECT (to_jsonb(s)-'rows')::text FROM source_snapshots s WHERE id=$1",ct,id)).FirstOrDefault();
    public async Task<JsonObject> Capture(SourceInput input,CancellationToken ct)
    {
        JsonNode columns, rows;JsonObject origin;string name;
        if(input.Kind=="workflow")
        {
            if(input.RunId==null)throw new ArgumentException("완료된 워크플로우 실행을 선택하세요.");
            var run=await store.Run(input.RunId.Value,ct)??throw new WorkflowMissing("실행 기록이 없습니다.");
            if(run["status"]!.GetValue<string>()!="succeeded")throw new ArgumentException("성공한 실행만 데이터 소스로 사용할 수 있습니다.");
            var definition=run["definition"]!.Deserialize<WorkflowDefinition>(WorkflowRules.Json)!;
            var output=definition.Nodes.Single(n=>n.Kind=="output");
            var node=(await store.Query("SELECT jsonb_build_object('columns',columns,'rows',rows)::text FROM wf_node_runs WHERE run_id=$1 AND node_id=$2 AND status='succeeded'",ct,input.RunId.Value,output.Id)).Single();
            columns=node["columns"]!.DeepClone();rows=node["rows"]!.DeepClone();
            var w=await store.Get(Guid.Parse(run["workflow_id"]!.GetValue<string>()),ct);
            name=(w?["name"]?.GetValue<string>()??"보관된 워크플로우")+" · "+(run["version"]==null?"초안":"v"+run["version"]);
            origin=new(){["workflowId"]=run["workflow_id"]!.DeepClone(),["version"]=run["version"]?.DeepClone(),["runId"]=input.RunId.Value.ToString(),["nodeId"]=output.Id,["inputs"]=run["inputs"]!.DeepClone()};
        }
        else if(input.Kind=="api")
        {
            if(input.QueryId==null||!System.Text.RegularExpressions.Regex.IsMatch(input.QueryId,@"\A[A-Za-z0-9_-]{1,80}\z")||input.Body==null)throw new ArgumentException("query_id와 바디가 필요합니다.");
            var watch=Stopwatch.StartNew();var id=Guid.NewGuid();
            using var response=await clients.CreateClient("dac").PostAsJsonAsync("api/dac/select/"+input.QueryId,input.Body,ct);
            var data=await UpstreamJson.Read(response.Content,ct);
            int? version=data.TryGetProperty("query_version",out var v)?v.GetInt32():null;
            await history.Run(id,new("/api/dac/select/"+input.QueryId,"POST",JsonSerializer.SerializeToElement(input.Body)),(int)response.StatusCode,watch.Elapsed.TotalMilliseconds,data.TryGetProperty("count",out var n)?n.GetInt32():null,ct,version);
            if(!response.IsSuccessStatusCode)throw new ArgumentException(data.TryGetProperty("detail",out var error)?error.GetString():"DAC 조회 실패");
            var parsed=WorkflowEngine.FromResponse(data);columns=JsonSerializer.SerializeToNode(parsed.Columns,WorkflowRules.Json)!;rows=JsonNode.Parse(data.GetProperty("data").GetRawText())!;
            origin=new(){["queryId"]=input.QueryId,["queryVersion"]=version,["request"]=input.Body.DeepClone(),["runId"]=id.ToString()};name=input.QueryId+" · SQL v"+version;
        }
        else throw new ArgumentException("소스는 workflow 또는 api입니다.");
        if(rows.AsArray().Count>10000||Encoding.UTF8.GetByteCount(rows.ToJsonString())>8_000_000)throw new ArgumentException("소스는 최대 1만 행 / 8MB입니다.");
        var checksum=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(columns.ToJsonString()+"\n"+rows.ToJsonString()))).ToLowerInvariant();
        var key=Guid.NewGuid();await store.Exec("INSERT INTO source_snapshots(id,name,kind,origin,columns,rows,row_count,checksum) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",ct,key,name,input.Kind,origin,columns,rows,rows.AsArray().Count,checksum);
        return (await Get(key,ct))!;
    }
}
public static class SourceRoutes
{
    public static void MapSources(this WebApplication app)
    {
        app.MapGet("/api/sources",(WorkflowStore s,CancellationToken ct)=>s.Query("SELECT (to_jsonb(s)-'rows')::text FROM source_snapshots s ORDER BY created_at DESC LIMIT 100",ct));
        app.MapPost("/api/sources",(SourceInput input,DataSources s,CancellationToken ct)=>s.Capture(input,ct)).RequireRateLimiting("work");
        app.MapGet("/api/sources/{id:guid}",async(Guid id,DataSources s,CancellationToken ct)=>await s.Get(id,ct) is {} r?Results.Ok(r):Results.NotFound());
        app.MapGet("/api/sources/{id:guid}/rows",async(Guid id,int? offset,int? limit,WorkflowStore s,CancellationToken ct)=>{
            var rows=await s.Query("SELECT jsonb_build_object('columns',columns,'totalRows',row_count,'data',(SELECT coalesce(jsonb_agg(value),'[]') FROM (SELECT value FROM jsonb_array_elements(s.rows) WITH ORDINALITY ORDER BY ordinality OFFSET $2 LIMIT $3) p))::text FROM source_snapshots s WHERE id=$1",ct,id,Math.Max(0,offset??0),Math.Clamp(limit??100,1,10000));return rows.Count==0?Results.NotFound():Results.Ok(rows[0]);
        });
        app.MapGet("/api/workflows/{id:guid}/versions/{version:int}",async(Guid id,int version,WorkflowStore s,CancellationToken ct)=>{
            var rows=await s.Query("SELECT to_jsonb(v)::text FROM wf_versions v JOIN wf_definitions w ON w.id=v.workflow_id WHERE workflow_id=$1 AND version=$2 AND w.deleted_at IS NULL",ct,id,version);return rows.Count==0?Results.NotFound():Results.Ok(rows[0]);
        });
        app.MapWorkflowBenchmarks();
        app.MapGet("/api/source-comparisons",(WorkflowStore s,CancellationToken ct)=>s.Query("SELECT (to_jsonb(c)-'workflow_payload')::text FROM source_comparisons c ORDER BY created_at DESC LIMIT 30",ct));
        app.MapGet("/api/source-comparisons/{id:guid}",async(Guid id,WorkflowStore s,CancellationToken ct)=>{var rows=await s.Query("SELECT (to_jsonb(c)-'workflow_payload')::text FROM source_comparisons c WHERE id=$1",ct,id);return rows.Count==0?Results.NotFound():Results.Ok(rows[0]);});
        app.MapPost("/api/source-comparisons",async(JsonObject config,DataSources sources,WorkflowStore store,CancellationToken ct)=>{
            if(!Guid.TryParse(config["left"]?.ToString(),out var left)||await sources.Get(left,ct)==null)throw new ArgumentException("왼쪽 데이터 소스를 선택하세요.");
            var op=WorkflowRules.Text(config,"operation");if(op is not("aggregate" or "filter" or "join" or "merge"))throw new ArgumentException("Invalid operation");
            if(op is "join" or "merge"&&(!Guid.TryParse(config["right"]?.ToString(),out var right)||await sources.Get(right,ct)==null))throw new ArgumentException("오른쪽 데이터 소스를 선택하세요.");
            if((await store.Query("SELECT jsonb_build_object('count',count(*))::text FROM source_comparisons WHERE status IN ('queued','running')",ct))[0]["count"]!.GetValue<int>()>=10)throw new WorkflowConflict("비교 대기열이 가득 찼습니다.");
            var id=Guid.NewGuid();await store.Exec("INSERT INTO source_comparisons(id,config) VALUES($1,$2)",ct,id,config);return Results.Accepted("/api/source-comparisons/"+id,new{id});
        });
    }
}
