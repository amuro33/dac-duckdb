using Streaming.Core;
using Confluent.Kafka;
using System.Text.Json;
namespace Data.Transform;
public sealed class Consumer(StreamStore store,KafkaBus bus,IConfiguration config,ILogger<Consumer> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var observer=config["ServiceRole"]=="observer";var group=observer?Wire.ObserverGroup:Wire.TransformGroup;
        using var consumer=bus.Consumer(group);consumer.Subscribe(Wire.Topics);var heartbeat=DateTime.MinValue;
        try
        {
            while(!ct.IsCancellationRequested)
            {
                ConsumeResult<string,string>? record=null;StreamBatch? batch=null;
                try
                {
                    if(DateTime.UtcNow-heartbeat>TimeSpan.FromSeconds(5)){await store.Heartbeat(observer?"observer":"transform-consumer");heartbeat=DateTime.UtcNow;}
                    record=consumer.Consume(TimeSpan.FromMilliseconds(250));if(record is null){await Task.Delay(20,ct);continue;}
                    batch=Wire.Deserialize<StreamBatch>(record.Message.Value);
                    await store.Ingest(group,batch,record.Message.Value,record.Topic,record.Partition.Value,record.Offset.Value);
                    consumer.Commit(record); // Durable ingest/deduplication completed before Kafka offset commit.
                }
                catch(Exception e) when(e is InvalidDataException or JsonException or ArgumentException)
                {
                    if(record is null)throw;
                    await store.Execute("INSERT INTO stream_failures VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT DO NOTHING",group,record.Topic,record.Partition.Value,record.Offset.Value,e.Message);
                    if(batch is not null&&!observer)await store.Fail(batch.DatasetId,e.Message);
                    consumer.Commit(record); // Poison record is durably quarantined, never silently dropped.
                    log.LogWarning("Quarantined {Topic}/{Partition}/{Offset}: {Error}",record.Topic,record.Partition,record.Offset,e.Message);
                }
                catch(OperationCanceledException) when(ct.IsCancellationRequested){break;}
                catch(Exception e)
                {
                    log.LogError(e,"Consumer retrying without skipping offset");
                    if(record is not null)consumer.Seek(record.TopicPartitionOffset);
                    await Task.Delay(2000,ct);
                }
            }
        }
        finally{consumer.Close();}
    }
}
