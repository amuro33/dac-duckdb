// Isolated normal/large Canvas comparison; this does not change application defaults.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1100,height:650}});
 const cdp=await browser.newBrowserCDPSession();
 const system=await cdp.send('SystemInfo.getInfo');
 const results=[];
 try{
  await page.setContent('<!doctype html><html><body><div id="chart" style="width:1000px;height:500px"></div></body></html>');
  await page.addScriptTag({path:path.resolve('src/Portal.Web/node_modules/echarts/dist/echarts.min.js')});
  await page.addScriptTag({path:path.resolve('src/Chart.Worker/wwwroot/echarts-adapter.js')});
  for(const sourceRows of [1000,10000,1000000]){
   const response=await page.request.post('http://localhost:8082/api/execute',{data:{path:'/api/chart/scatter',method:'POST',record:false,body:{source:'eds',category:null,legend:'product',x:'inspectedAt',y:'yieldPct',xType:'date',sampleSize:sourceRows,pointSize:6,showLabels:false}}});
   const body=await response.json();assert.equal(body.status,200);
   for(let trial=0;trial<=5;trial++)for(const large of trial%2?[true,false]:[false,true]){
    const measured=await page.evaluate(async({spec,large})=>{
     const dom=document.getElementById('chart');
     const chart=echarts.init(dom,null,{renderer:'canvas'});
     const options=ScatterAdapter.option(spec,spec.charts[0]);
     for(const s of options.series){s.large=large;s.largeThreshold=0;}
     const start=performance.now();
     const ms=await new Promise(resolve=>{chart.on('finished',()=>resolve(performance.now()-start));chart.setOption(options);});
     const points=chart.getOption().series.reduce((n,s)=>n+s.data.length,0);
     const displayObjects=chart.getZr().storage.getDisplayList(true).length;
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const image=chart.getDataURL({type:'png'});
     chart.dispose();return {renderMs:+ms.toFixed(2),points,displayObjects,image};
    },{spec:body.data,large});
    assert.equal(measured.points,sourceRows);
    if(sourceRows===1000000&&trial===5)fs.writeFileSync('artifacts/render-mode-'+(large?'large':'normal')+'.png',Buffer.from(measured.image.split(',')[1],'base64'));
    delete measured.image;
    if(trial>0)results.push({sourceRows,large,trial,...measured});
   }
  }
  const report={checkedAt:new Date().toISOString(),browser:await browser.version(),echarts:await page.evaluate(()=>echarts.version),gpu:system.gpu.devices,scope:'Isolated 1000x500 Canvas; actual Oracle sample; labels off; 6px points; 5 trials after warmup per mode, alternating mode order. Excludes HTTP, React and instance init. No app defaults changed; not a CUDA/GPU benchmark.',results};
  fs.writeFileSync('artifacts/render-mode-experiment.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
