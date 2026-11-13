using Confluent.Kafka;
using Confluent.Kafka.Admin;
using Microsoft.Extensions.Configuration;
namespace Streaming.Core;
public sealed class KafkaBus(IConfiguration config) : IDisposable
{
    public string Bootstrap => config["Kafka__BootstrapServers"] ?? config["Kafka:BootstrapServers"] ?? "kafka:9092";
    IProducer<string,string>? producer;
    public IProducer<string,string> Producer => producer ??= new ProducerBuilder<string,string>(new ProducerConfig {
        BootstrapServers=Bootstrap,EnableIdempotence=true,Acks=Acks.All,CompressionType=CompressionType.Zstd,
        LingerMs=10,MessageTimeoutMs=60000,MessageMaxBytes=1000000,ClientId=config["ServiceRole"]??"waferscope"
    }).Build();
    public async Task Init()
    {
        using var admin=new AdminClientBuilder(new AdminClientConfig{BootstrapServers=Bootstrap}).Build();
        try { await admin.CreateTopicsAsync(Wire.Topics.Append(Wire.CompletedTopic).Select(t=>new TopicSpecification{Name=t,NumPartitions=3,ReplicationFactor=1,Configs=new(){{"retention.ms","604800000"},{"max.message.bytes","1000000"}}})); }
        catch(CreateTopicsException e) when(e.Results.All(r=>r.Error.Code is ErrorCode.NoError or ErrorCode.TopicAlreadyExists)) { }
    }
    public IConsumer<string,string> Consumer(string group)=>new ConsumerBuilder<string,string>(new ConsumerConfig {
        BootstrapServers=Bootstrap,GroupId=group,AutoOffsetReset=AutoOffsetReset.Earliest,EnableAutoCommit=false,
        EnableAutoOffsetStore=false,MaxPollIntervalMs=900000,SessionTimeoutMs=45000,PartitionAssignmentStrategy=PartitionAssignmentStrategy.CooperativeSticky
    }).Build();
    public Task Send(string topic,string key,string body,CancellationToken ct)
    {
        if(System.Text.Encoding.UTF8.GetByteCount(body)>900000)throw new InvalidDataException("Batch exceeds 900 KB safety bound");
        return Producer.ProduceAsync(topic,new Message<string,string>{Key=key,Value=body},ct);
    }
    public object Health() {
        try { using var admin=new AdminClientBuilder(new AdminClientConfig{BootstrapServers=Bootstrap}).Build();var metadata=admin.GetMetadata(TimeSpan.FromSeconds(2));return new{connected=metadata.Brokers.Count>0,brokers=metadata.Brokers.Count}; }
        catch(KafkaException){return new{connected=false,brokers=0};}
    }
    public void Dispose(){producer?.Flush(TimeSpan.FromSeconds(5));producer?.Dispose();}
}
