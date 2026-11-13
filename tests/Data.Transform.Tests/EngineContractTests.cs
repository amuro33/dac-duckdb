using System.Text.Json;
using Streaming.Core;
using Xunit;

namespace Data.Transform.Tests;

public class EngineContractTests
{
    [Theory]
    [InlineData("duckdb")][InlineData("spark")][InlineData("datafusion")][InlineData("drill")]
    public void EngineChoiceSurvivesSerialization(string engine)
    {
        var config = new FeedConfig("comparison", Engine: engine);
        config.Validate();
        Assert.Equal(engine, Wire.Deserialize<FeedConfig>(Wire.Serialize(config)).Engine);
    }

    [Fact]
    public void ExistingFeedDefaultsToDuckDb() => Assert.Equal("duckdb", Wire.Deserialize<FeedConfig>("{\"name\":\"old\"}").Engine);

    [Theory]
    [InlineData("Spark")][InlineData("")][InlineData("spark; drop table eds")]
    public void UnknownEngineCannotFallBackSilently(string engine) => Assert.Throws<ArgumentException>(() => new FeedConfig("bad", Engine: engine).Validate());

    static ResultManifest Manifest() => new(1,"spark",3,10,[new("a.parquet",2,0,100,new string('a',64)),new("b.parquet",1,2,100,new string('b',64))],JsonSerializer.SerializeToElement(new{}));

    [Fact] public void PartitionedManifestKeepsEveryRow() => RemoteEngines.ValidateManifest(Manifest(),"spark");
    [Fact] public void DifferentActualEngineRejected() => Assert.Throws<InvalidDataException>(() => RemoteEngines.ValidateManifest(Manifest(),"drill"));
    [Fact] public void MissingRowsRejected() => Assert.Throws<InvalidDataException>(() => RemoteEngines.ValidateManifest(Manifest() with { RowCount=4 },"spark"));
    [Fact] public void OverlappingPartOffsetsRejected()
    {
        var m=Manifest();m.Files[1]=m.Files[1] with { Offset=1 };
        Assert.Throws<InvalidDataException>(()=>RemoteEngines.ValidateManifest(m,"spark"));
    }
    [Fact] public void CorruptChecksumRejected()
    {
        var m=Manifest();m.Files[0]=m.Files[0] with { Sha256="invalid" };
        Assert.Throws<InvalidDataException>(()=>RemoteEngines.ValidateManifest(m,"spark"));
    }
}
