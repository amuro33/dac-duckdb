using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace Portal.Api;
public record WorkflowBenchmarkInput(Guid? RunId, Guid? WorkflowId, int? Version, JsonObject? Inputs);
public static class WorkflowBenchmarkRoutes
{
    public static void MapWorkflowBenchmarks(this WebApplication app)
    {
        app.MapPost("/api/workflow-benchmarks",async(WorkflowBenchmarkInput input,WorkflowStore store,CancellationToken ct)=>{
            if((await store.Query("SELECT jsonb_build_object('count',count(*))::text FROM source_comparisons WHERE status IN ('queued','running')",ct))[0]["count"]!.GetValue<int>()>=10)throw new WorkflowConflict("벤치마크 대기열이 가득 찼습니다.");
            JsonObject config; JsonObject? payload=null;
            if(input.RunId is {} previous) (config,payload)=await Capture(store,previous,ct);
            else {
                if(input.WorkflowId is not {} workflowId || input.Version is not >0)throw new ArgumentException("워크플로우와 게시 버전을 선택하세요.");
                var runId=await store.Enqueue(workflowId,new WorkflowStart(input.Version,input.Inputs??new()),false,ct);
                var w=await store.Get(workflowId,ct);
                config=new JsonObject{["operation"]="workflow",["workflowId"]=workflowId.ToString(),["workflowName"]=w?["name"]?.DeepClone(),["version"]=input.Version,["runId"]=runId.ToString(),["inputs"]=input.Inputs?.DeepClone()??new JsonObject()};
            }
            var id=Guid.NewGuid();
            await store.Exec("INSERT INTO source_comparisons(id,config,workflow_payload) VALUES($1,$2,$3)",ct,id,config,payload);
            return Results.Accepted("/api/source-comparisons/"+id,new{id});
        }).RequireRateLimiting("work");
    }
    public static async Task<(JsonObject Config,JsonObject Payload)> Capture(WorkflowStore store,Guid runId,CancellationToken ct)
    {
            var run=await store.Run(runId,ct)??throw new WorkflowMissing("워크플로우 실행 기록이 없습니다.");
            if(run["status"]?.ToString()!="succeeded")throw new ArgumentException("성공한 워크플로우 실행을 선택하세요.");
            if(run["version"]==null)throw new ArgumentException("게시 버전의 실행을 선택하세요. 초안은 벤치마크할 수 없습니다.");
            var definition=run["definition"]!.Deserialize<WorkflowDefinition>(WorkflowRules.Json)!;
            var nodes=WorkflowRules.Validate(definition);
            var captured=await store.Query("SELECT jsonb_build_object('nodeId',node_id,'columns',columns,'rows',rows,'durationMs',duration_ms)::text FROM wf_node_runs WHERE run_id=$1 AND status='succeeded'",ct,runId);
            var queries=new JsonObject();
            foreach(var n in nodes.Where(n=>n.Kind=="query")) {
                var data=captured.Single(x=>x["nodeId"]!.ToString()==n.Id);
                queries[n.Id]=new JsonObject{["columns"]=data["columns"]!.DeepClone(),["rows"]=data["rows"]!.DeepClone()};
            }
            var output=captured.Single(x=>x["nodeId"]!.ToString()==nodes.Single(n=>n.Kind=="output").Id);
            var payload=new JsonObject{["definition"]=run["definition"]!.DeepClone(),["queries"]=queries,["baseline"]=new JsonObject{["columns"]=output["columns"]!.DeepClone(),["rows"]=output["rows"]!.DeepClone()}};
            if(Encoding.UTF8.GetByteCount(payload.ToJsonString())>19_000_000)throw new ArgumentException("벤치마크 입력 합계가 19MB를 초과했습니다. API 조회 범위를 줄이세요.");
            var workflowId=Guid.Parse(run["workflow_id"]!.ToString());
            var w=await store.Get(workflowId,ct);
            var config=new JsonObject{["operation"]="workflow",["workflowId"]=workflowId.ToString(),["workflowName"]=w?["name"]?.DeepClone()??JsonValue.Create("보관된 워크플로우"),["version"]=run["version"]!.DeepClone(),["runId"]=runId.ToString(),["inputs"]=run["inputs"]!.DeepClone(),["definition"]=run["definition"]!.DeepClone(),["queryRows"]=queries.Sum(q=>q.Value!["rows"]!.AsArray().Count),["baselineNodeMs"]=captured.Sum(n=>n["durationMs"]?.GetValue<double>()??0)};
        return (config,payload);
    }

}
