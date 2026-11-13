using Dac.Worker;
using Xunit;
namespace Dac.Worker.Tests;
public class TransformTests {
 readonly Eds[] eds=[new("L1","W1","DRAM",100,95,95),new("L1","W2","DRAM",100,90,90),new("L2","W1","NAND",100,99,99)];
 readonly Defect[] defects=[new("D1","L1","W1","SCRATCH","HIGH",2),new("D2","L1","W1","PARTICLE","LOW",1),new("D3","L3","W1","SCRATCH","HIGH",5)];
 [Theory][InlineData("inner",2)][InlineData("left",4)][InlineData("full",5)]
 public void JoinsHaveExpectedCardinality(string join,int count) => Assert.Equal(count,new TransformEngine().Execute(eds,defects,new(JoinType:join)).Count);
 [Fact] public void CompositeKeyDoesNotCrossLots(){var rows=new TransformEngine().Execute(eds,defects,new());Assert.Null(rows.Single(x=>Equals(x["lot_id"],"L2"))["defect_id"]);}
 [Fact] public void MergePreservesAllSourceRows()=>Assert.Equal(6,new TransformEngine().Execute(eds,defects,new(Operation:"merge")).Count);
 [Theory][InlineData("join")][InlineData("merge")]
 public void InspectionDateSurvivesTransform(string operation){
  var time=new DateTime(2026,11,13,6,30,0,DateTimeKind.Utc);
  var rows=new TransformEngine().Execute([new("L1","W1","DRAM",100,95,95,time)],[new("D1","L1","W1","SCRATCH","HIGH",2,time)],new(Operation:operation));
  Assert.All(rows,row=>Assert.Equal(time,Assert.IsType<DateTime>(row["inspected_at"])));
 }
 [Fact] public void FilterCombinesConditions(){var rows=new TransformEngine().Execute(eds,defects,new(Operation:"filter",MinYield:94,Severity:"HIGH"));Assert.Single(rows);Assert.Equal("D1",rows[0]["defect_id"]);}
 [Fact] public void LotAndLimitApply(){var rows=new TransformEngine().Execute(eds,defects,new(LotId:"L1",Limit:1));Assert.Single(rows);Assert.Equal("L1",rows[0]["lot_id"]);}
 [Fact] public void EmptySourcesReturnEmpty()=>Assert.Empty(new TransformEngine().Execute([],[],new()));
 [Fact] public void InjectionInValueIsLiteral()=>Assert.Empty(new TransformEngine().Execute(eds,defects,new(LotId:"L1' OR 1=1 --")));
 [Theory][InlineData("drop")][InlineData("join; DROP TABLE eds")]
 public void InvalidOperationRejected(string op)=>Assert.Throws<ArgumentException>(()=>new TransformEngine().Execute(eds,defects,new(Operation:op)));
 [Theory][InlineData(0)][InlineData(1001)]public void InvalidLimitRejected(int n)=>Assert.Throws<ArgumentException>(()=>Validation.Transform(new(Limit:n)));
 [Fact] public void InvalidJoinRejected()=>Assert.Throws<ArgumentException>(()=>Validation.Transform(new(JoinType:"cross")));
 [Fact] public void InvalidYieldRejected()=>Assert.Throws<ArgumentException>(()=>Validation.Transform(new(MinYield:101)));
 [Fact] public void InvalidSeverityRejected()=>Assert.Throws<ArgumentException>(()=>Validation.Transform(new(Severity:"BAD")));
}
