using Npgsql;
using System.Text.Json.Nodes;
namespace Portal.Api;
public sealed class SourceComparisonRunner(WorkflowStore store,DataSources sources,NpgsqlDataSource db,IHttpClientFactory clients,ILogger<SourceComparisonRunner> log):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while(!stop.IsCancellationRequested)
        {
            try
            {
                await using var lease=await db.OpenConnectionAsync(stop);using var gate=new NpgsqlCommand("SELECT pg_try_advisory_lock(8172403)",lease);
                if(!(bool)(await gate.ExecuteScalarAsync(stop))!){await Task.Delay(1000,stop);continue;}
                try
                {
                    await store.Exec("UPDATE source_comparisons SET status='interrupted',error='실행 서비스가 재시작되었습니다. 새 비교를 시작하세요.',finished_at=now() WHERE status='running'",stop);
                    while(!stop.IsCancellationRequested)
                    {
                        var job=(await store.Query("UPDATE source_comparisons SET status='running' WHERE id=(SELECT id FROM source_comparisons WHERE status='queued' ORDER BY created_at LIMIT 1) RETURNING to_jsonb(source_comparisons)::text",stop)).FirstOrDefault();
                        if(job==null){await Task.Delay(500,stop);continue;}
                        var id=Guid.Parse(job["id"]!.GetValue<string>());var results=new JsonObject();
                        try
                        {
                            var config=job["config"]!.AsObject();
                            bool workflow=WorkflowRules.Text(config,"operation")=="workflow";
                            if(workflow && job["workflow_payload"]==null) {
                                var workflowRun=Guid.Parse(config["runId"]!.ToString());
                                while(true) {
                                    var prepared=await store.Run(workflowRun,stop)??throw new Exception("Workflow run missing");
                                    var state=prepared["status"]!.ToString();
                                    if(state=="succeeded")break;
                                    if(state is not("queued" or "running"))throw new Exception("준비 실행 실패: "+prepared["error"]);
                                    await Task.Delay(500,stop);
                                }
                                var preparedPayload=await WorkflowBenchmarkRoutes.Capture(store,workflowRun,stop);
                                config=preparedPayload.Config; job["workflow_payload"]=preparedPayload.Payload;
                                await store.Exec("UPDATE source_comparisons SET config=$2,workflow_payload=$3 WHERE id=$1",stop,id,config,preparedPayload.Payload);
                            }
                            JsonObject? left=null,right=null;
                            if(!workflow) {
                                left=await sources.Get(Guid.Parse(config["left"]!.GetValue<string>()),stop,true)??throw new Exception("Source missing");
                                if(WorkflowRules.Text(config,"operation") is "join" or "merge")right=await sources.Get(Guid.Parse(config["right"]!.GetValue<string>()),stop,true);
                            }
                            var offset=id.ToByteArray()[0]%3;string[] all=["duckdb","spark","datafusion"];var order=all.Skip(offset).Concat(all.Take(offset)).ToArray();
                            results["order"]=new JsonArray(order.Select(e=>JsonValue.Create(e)).ToArray());
                            if(!workflow) results["sourceIds"]=new JsonArray(left!["id"]!.DeepClone(),right?["id"]?.DeepClone());
                            foreach(var engine in order)
                            {
                                results[engine]=new JsonObject{["state"]="running"};await Persist(id,results,stop);
                                try
                                {
                                    object payload=workflow ? new {comparisonId=id,engine,workflow=job["workflow_payload"]} : new {comparisonId=id,engine,config,left,right};
                                    using var response=await clients.CreateClient("source-engines").PostAsJsonAsync(workflow?"workflow-benchmark":"source-compare",payload,stop);
                                    var value=JsonNode.Parse(await response.Content.ReadAsStringAsync(stop))!.AsObject();
                                    if(!response.IsSuccessStatusCode)throw new Exception(value["detail"]?.ToString()??"Engine failed");
                                    value["state"]="succeeded";results[engine]=value;
                                }
                                catch(Exception e)when(!stop.IsCancellationRequested){results[engine]=new JsonObject{["state"]="failed",["error"]=e.Message[..Math.Min(e.Message.Length,1000)]};}
                                await Persist(id,results,stop);
                            }
                            var hashes=all.Select(e=>results[e]?["resultHash"]?.GetValue<string>()).ToArray();results["equivalent"]=hashes.All(h=>h!=null)&&hashes.Distinct().Count()==1;
                            await Persist(id,results,stop);await store.Exec("UPDATE source_comparisons SET status=$2,finished_at=now() WHERE id=$1",stop,id,all.All(e=>results[e]?["state"]?.ToString()=="succeeded")?"succeeded":all.All(e=>results[e]?["state"]?.ToString()=="failed")?"failed":"partial");
                        }
                        catch(Exception e){await store.Exec("UPDATE source_comparisons SET status=$2,error=$3,finished_at=now() WHERE id=$1",CancellationToken.None,id,stop.IsCancellationRequested?"interrupted":"failed",e.Message[..Math.Min(e.Message.Length,1000)]);}
                    }
                }
                finally{using var unlock=new NpgsqlCommand("SELECT pg_advisory_unlock(8172403)",lease);await unlock.ExecuteScalarAsync(CancellationToken.None);}
            }
            catch(OperationCanceledException)when(stop.IsCancellationRequested){break;}
            catch(Exception e){log.LogError(e,"Source comparison worker failed");await Task.Delay(2000,stop);}
        }
    }
    Task<int> Persist(Guid id,JsonObject results,CancellationToken ct)=>store.Exec("UPDATE source_comparisons SET results=$2 WHERE id=$1",ct,id,results);
}
