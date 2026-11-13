// Real integrated UI, one independent chart, identical coordinates and point size.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1600,height:1100}});
  page.setDefaultTimeout(120000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.longTasks=[];
    new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
  });
  const measurements=[];
  try {
    await page.goto('http://localhost:8082/#analysis');
    await page.waitForSelector('.plot[data-render-ready="true"]');
    const size=page.getByLabel('포인트 크기',{exact:true}); await size.focus(); await size.press('Home');
    for(let i=0;i<8;i++)await size.press('ArrowRight'); // fixed 6px
    for(const sourceRows of [1000,10000,100000,1000000]){
      await page.getByLabel('데이터 규모',{exact:true}).selectOption(String(sourceRows));
      await page.waitForFunction(()=>!document.querySelector('.studio .primary').disabled);
      await page.getByLabel('Category · 독립 차트',{exact:true}).selectOption('');
      for(const showLabels of [false,true]){
        await page.getByLabel('포인트 라벨 표시',{exact:true}).setChecked(showLabels);
        if(showLabels)await page.getByLabel('라벨 컬럼',{exact:true}).selectOption('waferId');
        for(let trial=1;trial<=3;trial++){
          const previous=await page.locator('.plot').first().getAttribute('data-render-started');
          const started=await page.evaluate(()=>performance.now());
          const response=page.waitForResponse(r=>r.url().endsWith('/api/execute')&&r.request().postDataJSON()?.path==='/api/chart/scatter');
          await page.getByRole('button',{name:'분석 실행',exact:true}).click();
          const api=await response; const body=await api.json(); assert.equal(body.status,200);
          const bytes=Buffer.byteLength(JSON.stringify(body));
          await page.waitForFunction(prev=>{
            const charts=[...document.querySelectorAll('.plot')];
            return charts.length===1&&charts[0].dataset.renderStarted!==prev&&charts[0].dataset.renderReady==='true';
          },previous);
          const measured=await page.evaluate(start=>{
            const plot=document.querySelector('.plot');
            const tasks=window.longTasks.filter(t=>t.start>=start);
            return {renderMs:Number(plot.dataset.renderMs),points:Number(plot.dataset.pointCount),clientMs:+(performance.now()-start).toFixed(1),longTasks:tasks.length,maxLongTaskMs:+Math.max(0,...tasks.map(t=>t.duration)).toFixed(1)};
          },started);
          assert.equal(measured.points,sourceRows);
          const row={sourceRows,showLabels,trial,upstreamMs:body.durationMs,responseBytes:bytes,...measured}; measurements.push(row); console.log(JSON.stringify(row));
          fs.writeFileSync('artifacts/chart-render-performance-progress.json',JSON.stringify(measurements,null,2));
        }
      }
    }
    assert.deepEqual(errors,[]);
    const report={checkedAt:new Date().toISOString(),browser:await browser.version(),viewport:{width:1600,height:1100},pointSize:6,labelColumn:'waferId',labelFontSize:11,category:null,legend:'product',iterations:3,notes:'Local warm Chromium; 1 chart; all selected rows are returned. renderMs: option construction/setOption to first finished (instance init excluded); clientMs: before click to two frames after finished (includes automation). No concurrent load; not an FPS or p95 benchmark.',measurements,errors};
    fs.writeFileSync('artifacts/chart-render-performance.json',JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
