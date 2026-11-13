using Dac.Worker;
using Xunit;
namespace Dac.Worker.Tests;
public class BenchmarkTests {
 [Theory][InlineData(1000)][InlineData(10000)][InlineData(100000)][InlineData(1000000)]
 public void SupportedSizes(int size)=>BenchmarkRepository.Validate("eds",size,size,null);
 [Theory][InlineData(0)][InlineData(999)][InlineData(1000001)]
 public void InvalidSizes(int size)=>Assert.Throws<ArgumentException>(()=>BenchmarkRepository.Validate("eds",size,size,null));
 [Theory][InlineData(0)][InlineData(1000001)]
 public void InvalidPageLimitsRejected(int limit)=>Assert.Throws<ArgumentException>(()=>BenchmarkRepository.Validate("eds",1000,limit,null));
}
