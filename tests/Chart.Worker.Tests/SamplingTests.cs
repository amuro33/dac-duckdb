using Chart.Worker;
using Xunit;
namespace Chart.Worker.Tests;
public class SamplingTests
{
    [Fact] public async Task AllPagesContributePointsAndGlobalOrdering()
    {
        async IAsyncEnumerable<Dataset> Pages()
        {
            yield return ChartTests.Data("""[{"x":3,"y":3},{"x":1,"y":1}]""") with {TotalRows=4,RequestedSampleSize=1000};
            await Task.Yield();
            yield return ChartTests.Data("""[{"x":2,"y":2},{"x":null,"y":4}]""") with {TotalRows=4,RequestedSampleSize=1000};
        }
        var result=await new ChartBuilder().BuildAllAsync(Pages(),new(Category:null,Legend:null,X:"x",Y:"y",XType:"number"),default);
        Assert.Equal(4,result.SourceRows);Assert.Equal(3,result.PlottedRows);Assert.Equal(1,result.SkippedRows);
        Assert.Equal(0,result.SampledOutRows);Assert.Equal("none",result.Sampling);
        Assert.Equal(new double[]{1,2,3},result.Charts[0].Series[0].Points.Select(p=>Convert.ToDouble(p.X)));
    }
    [Fact] public async Task IncompletePagesFailInsteadOfReturningPartialChart()
    {
        async IAsyncEnumerable<Dataset> Pages(){yield return ChartTests.Data("""[{"x":1,"y":2}]""") with {TotalRows=2};await Task.Yield();}
        await Assert.ThrowsAsync<InvalidOperationException>(()=>new ChartBuilder().BuildAllAsync(Pages(),new(Category:null,Legend:null,X:"x",Y:"y",XType:"number"),default));
    }
}
