/* Rendering adapter only. The API's ScatterSpec has no ECharts-specific fields. */
(function(root){
 const palette=['#4f46e5','#d97706','#0284c7','#16a34a','#e11d48','#7c3aed','#0d9488','#ea580c','#475569','#db2777'];
 function color(key){let h=0;for(const c of key)h=(h*31+c.charCodeAt(0))|0;return palette[Math.abs(h)%palette.length];}
 function option(spec,panel){
  const categories=[...new Set(panel.series.flatMap(s=>s.points.map(p=>String(p.x))))];
  const names=panel.series.map(s=>s.name);const duplicate=new Set(names.filter((n,i)=>names.indexOf(n)!==i));
  return {useUTC:true,animation:false,backgroundColor:'#ffffff',color:['#147d92','#e29325','#8b5cc7','#d35b70','#3c9a69','#547dcc'],
   title:{text:panel.name,left:20,top:14,textStyle:{fontFamily:'sans-serif',fontSize:17,color:'#17344b'}},
   tooltip:{trigger:'item',confine:true,renderMode:'richText'},
   legend:{type:'scroll',top:48,left:20,right:20},
   grid:{left:75,right:35,top:100,bottom:70,containLabel:true},
   xAxis:{type:spec.xType==='string'?'category':spec.xType==='date'?'time':'value',name:spec.x,nameLocation:'middle',nameGap:35,scale:true,...(spec.xType==='string'?{data:categories}:{}),axisLabel:{hideOverlap:true,...(spec.xType==='date'?{formatter:'{yyyy}-{MM}-{dd}\n{HH}:{mm}'}:{})},splitLine:{show:true,lineStyle:{color:'#edf1f5'}}},
   yAxis:{type:'value',name:spec.y,scale:true,splitLine:{lineStyle:{color:'#edf1f5'}}},
   series:panel.series.map(s=>({id:s.key,name:duplicate.has(s.name)?`${s.name} [${s.key.split(':')[0]}]`:s.name,type:'scatter',symbolSize:spec.pointSize??(spec.plottedRows>5000?3.5:6),data:s.points.map(p=>spec.showLabels?[p.x,p.y,p.label??'']:[p.x,p.y]),label:{show:!!spec.showLabels,position:'top',distance:4,fontSize:spec.labelFontSize??11,color:'#435462',formatter:p=>String(p.value[2]??'')},labelLayout:{hideOverlap:true},large:!spec.showLabels&&spec.plottedRows>20000,largeThreshold:2000,progressive:spec.showLabels?0:10000,emphasis:{focus:'series'},itemStyle:{color:color(s.key),opacity:.7}}))};
 }
 const adapter={option};if(typeof module==='object'&&module.exports)module.exports=adapter;else root.ScatterAdapter=adapter;
})(typeof globalThis==='object'?globalThis:this);
