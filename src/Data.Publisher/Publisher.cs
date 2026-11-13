using Streaming.Core;
using Npgsql;
using System.Text.Json;
namespace Data.Publisher;
public sealed class Publisher(StreamStore store,KafkaBus bus,NpgsqlDataSource db,IHttpClientFactory clients,ILogger<Publisher> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // A session lock prevents overlapping publishers. It is released automatically on process/connection loss.
        while(!ct.IsCancellationRequested)
        {
            try
            {
                await using var leader=await db.OpenConnectionAsync(ct);
                await using var gate=new NpgsqlCommand("SELECT pg_try_advisory_lock(70210551)",leader);
                if(!(bool)(await gate.ExecuteScalarAsync(ct))!){await Task.Delay(3000,ct);continue;}
                await store.Execute("UPDATE stream_datasets SET status='failed',error='Publisher restarted before snapshot completed; start a new snapshot' WHERE status='publishing'");
                while(!ct.IsCancellationRequested)
                {
                    // Detect a dropped session before issuing work under a lost leadership lock.
                    await using(var ping=new NpgsqlCommand("SELECT 1",leader))await ping.ExecuteScalarAsync(ct);
                    await store.Heartbeat("publisher");
                    var feeds=await store.Query("SELECT id,config FROM stream_feeds WHERE enabled AND next_at<=now() ORDER BY next_at LIMIT 1");
                    if(feeds.Count==0){await Task.Delay(2000,ct);continue;}
                    var id=(Guid)feeds[0]["id"]!;var config=((JsonElement)feeds[0]["config"]!).Deserialize<FeedConfig>(Wire.Json)!;
                    var dataset=Guid.NewGuid();var captured=DateTime.UtcNow;
                    await store.Execute("INSERT INTO stream_datasets(id,feed_id,config,created_at) VALUES($1,$2,$3::jsonb,$4)",dataset,id,Wire.Serialize(config),captured);
                    try
                    {
                        foreach(var source in new[]{"eds","defects"})await PublishSource(dataset,id,config,captured,source,ct);
                        await store.Execute("UPDATE stream_datasets SET status='published',published_at=now() WHERE id=$1 AND status='publishing'",dataset);
                        await store.Execute("UPDATE stream_feeds SET runs=runs+1,next_at=now()+make_interval(secs=>$2),last_error=NULL,enabled=enabled AND ($3::int IS NULL OR runs+1<$3) WHERE id=$1",id,config.IntervalSeconds,config.MaxRuns);
                        log.LogInformation("Published dataset {Dataset}",dataset);
                    }
                    catch(OperationCanceledException) when(ct.IsCancellationRequested){throw;}
                    catch(Exception e)
                    {
                        log.LogError(e,"Publication failed for {Dataset}",dataset);await store.Fail(dataset,e.Message);
                        await store.Execute("UPDATE stream_feeds SET next_at=now()+make_interval(secs=>$2),last_error=$3 WHERE id=$1",id,config.IntervalSeconds,e.Message[..Math.Min(e.Message.Length,1000)]);
                    }
                }
            }
            catch(OperationCanceledException) when(ct.IsCancellationRequested){break;}
            catch(Exception e){log.LogError(e,"Publisher loop reconnecting");await Task.Delay(3000,ct);}
        }
    }
    async Task PublishSource(Guid dataset,Guid feed,FeedConfig config,DateTime captured,string source,CancellationToken ct)
    {
        var client=clients.CreateClient("dac");var cursor=0;var sequence=0;int? expected=null;var read=0;
        while(true)
        {
            string path=config.SampleSize is int size?$"api/dac/chart_samples?source={source}&size={size}&limit=10000&afterId={cursor}":$"api/dac/get_{(source=="eds"?"eds":"defect")}_data?limit=1000";
            if(config.LotId is not null)path+="&lotId="+Uri.EscapeDataString(config.LotId);
            using var response=await client.GetAsync(path,ct);response.EnsureSuccessStatusCode();
            using var doc=await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct),cancellationToken:ct);
            var root=doc.RootElement;var rows=(config.SampleSize is null?root:root.GetProperty("data")).EnumerateArray().Select(x=>x.Clone()).ToArray();
            var total=config.SampleSize is null?rows.Length:root.GetProperty("totalRows").GetInt32();
            if(config.SampleSize is null&&total>=1000)throw new InvalidDataException("Base source reached 1000-row boundary; narrow Lot or use benchmark");
            expected??=total;if(total!=expected)throw new InvalidDataException("Source changed during publication");
            if(config.SampleSize is not null)foreach(var row in rows){var next=row.GetProperty("sampleId").GetInt32();if(next<=cursor)throw new InvalidDataException("Non-advancing source cursor");cursor=next;}
            foreach(var chunk in rows.Length==0?new[]{rows}:rows.Chunk(1000)) {
                var batch=new StreamBatch(1,dataset,feed,source,sequence,Math.Max(1,(total+999)/1000),total,captured,chunk);batch.Validate();
                await bus.Send("dac."+source+".v1",dataset.ToString(),Wire.Serialize(batch),ct);
                read+=chunk.Length;sequence++;
            }
            await store.Heartbeat("publisher");
            if(read==total)break;if(rows.Length==0||read>total)throw new InvalidDataException("Incomplete source snapshot");
        }
    }
}
