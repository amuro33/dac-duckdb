using Streaming.Core;
using System.Text.Json;
using Xunit;
namespace Data.Transform.Tests;
public class StreamContractTests
{
    static JsonElement Row=>JsonSerializer.SerializeToElement(new{lotId="L1",waferId="W1",product="DRAM",testedDies=100,goodDies=95,yieldPct=95,inspectedAt="2026-11-13T00:00:00Z"});
    static StreamBatch Batch(int total=1)=>new(1,Guid.NewGuid(),Guid.NewGuid(),"eds",0,Math.Max(1,(total+999)/1000),total,DateTime.UtcNow,Enumerable.Repeat(Row,Math.Min(total,1000)).ToArray());
    [Theory][InlineData(0)][InlineData(1)][InlineData(999)][InlineData(1000)][InlineData(1000000)]public void CompleteFirstBatchAcceptsScale(int count)=>Batch(count).Validate();
    [Fact] public void MissingRowsRejected()=>Assert.Throws<InvalidDataException>(()=>(Batch() with{Rows=[]}).Validate());
    [Fact] public void UnknownSchemaRejected()=>Assert.Throws<InvalidDataException>(()=>(Batch() with{SchemaVersion=2}).Validate());
    [Fact] public void InvalidSequenceRejected()=>Assert.Throws<InvalidDataException>(()=>(Batch() with{Sequence=1}).Validate());
    [Fact] public void ForgedManifestRejected()=>Assert.Throws<InvalidDataException>(()=>(Batch() with{TotalBatches=3}).Validate());
    [Fact] public void MissingSourceKeysRejected()=>Assert.Throws<InvalidDataException>(()=>(Batch() with{Rows=[JsonSerializer.SerializeToElement(new{x=1})]}).Validate());
    [Fact] public void EventIdentityIsStableOnReplay(){var b=Batch();Assert.Equal(b.EventId,Wire.Deserialize<StreamBatch>(Wire.Serialize(b)).EventId);}
    [Fact] public void FinalPartialBatchAcceptsOnlyRemainingRows(){var b=Batch(1001) with{Sequence=1,Rows=[Row]};b.Validate();Assert.Throws<InvalidDataException>(()=>(b with{Rows=[Row,Row]}).Validate());}
    [Theory][InlineData(1000)][InlineData(10000)][InlineData(100000)][InlineData(1000000)]public void FeedsAcceptSupportedSizes(int size)=>new FeedConfig("test",size).Validate();
    [Theory][InlineData(0)][InlineData(20)][InlineData(2000000)]public void InvalidScaleRejected(int size)=>Assert.Throws<ArgumentException>(()=>new FeedConfig("test",size).Validate());
    [Fact] public void FastLoopRejected()=>Assert.Throws<ArgumentException>(()=>new FeedConfig("test",IntervalSeconds:0).Validate());
    [Fact] public void InjectionOperationRejected()=>Assert.Throws<ArgumentException>(()=>new FeedConfig("test",Operation:"join;drop table eds").Validate());
}
