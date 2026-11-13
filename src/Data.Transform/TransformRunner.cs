using Streaming.Core;
using Npgsql;
using System.Text.Json;
namespace Data.Transform;
public sealed class TransformRunner(StreamStore store,DatasetEngine engine,NpgsqlDataSource db,ILogger<TransformRunner> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while(!ct.IsCancellationRequested)
        {
            try
            {
                await store.Heartbeat("transform-engine");
                var pending=await store.Query("SELECT id FROM stream_datasets WHERE status IN ('published','processing') ORDER BY created_at LIMIT 20");
                foreach(var row in pending)
                {
                    var id=(Guid)row["id"]!;if(!await store.Complete(id))continue;
                    await using var c=await db.OpenConnectionAsync(ct);await using var gate=new NpgsqlCommand("SELECT pg_try_advisory_lock(hashtext($1))",c);gate.Parameters.AddWithValue("transform:"+id);
                    if(!(bool)(await gate.ExecuteScalarAsync(ct))!)continue;
                    try
                    {
                        var dataset=await store.GetDataset(id);if(dataset is null||dataset.Status is not("published" or "processing"))continue;
                        await store.Execute("UPDATE stream_datasets SET status='processing' WHERE id=$1",id);
                        await engine.Build(dataset,ct);log.LogInformation("Transformed complete dataset {Dataset}",id);
                    }
                    catch(OperationCanceledException) when(ct.IsCancellationRequested){throw;}
                    catch(Exception e){log.LogError(e,"Transform failed for {Dataset}",id);await store.Fail(id,e.Message);}
                }
                await Task.Delay(1000,ct);
            }
            catch(OperationCanceledException) when(ct.IsCancellationRequested){break;}
            catch(Exception e){log.LogError(e,"Transform scheduler retrying");await Task.Delay(3000,ct);}
        }
    }
}
public sealed class Outbox(StreamStore store,KafkaBus bus,ILogger<Outbox> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while(!ct.IsCancellationRequested)
        {
            try
            {
                var pending=await store.Query("SELECT id,dataset_id,payload FROM stream_outbox WHERE published_at IS NULL LIMIT 20");
                foreach(var row in pending){await bus.Send(Wire.CompletedTopic,row["datasetId"]!.ToString()!,((JsonElement)row["payload"]!).GetRawText(),ct);await store.Execute("UPDATE stream_outbox SET published_at=now() WHERE id=$1",row["id"]);}
                await Task.Delay(1000,ct);
            }
            catch(OperationCanceledException) when(ct.IsCancellationRequested){break;}
            catch(Exception e){log.LogWarning(e,"Completion outbox will retry");await Task.Delay(3000,ct);}
        }
    }
}
