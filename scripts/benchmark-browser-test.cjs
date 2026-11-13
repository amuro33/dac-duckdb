const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('fs');
(async()=>{const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(240000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const results=[];
await page.goto('http://localhost:8081');await page.waitForFunction(()=>!document.getElementById('draw').disabled);
for(const size of [1000,10000,100000,1000000]){
 const start=Date.now();await page.selectOption('#sampleSize',String(size));await page.waitForFunction(()=>!document.getElementById('draw').disabled,null,{timeout:240000});
 if(await page.locator('#error').isVisible())throw Error(await page.locator('#error').textContent());
 const n=async id=>Number((await page.locator('#'+id).textContent()).replaceAll(',',''));
 if(await n('rows')!==size||await n('points')!==size)throw Error('Wrong UI counts: '+size);
 if(await page.locator('.chart-dom').count()!==10)throw Error('Wrong independent chart count');
 results.push({size,elapsedMs:Date.now()-start});
}
await page.screenshot({path:'artifacts/benchmark-million.png',fullPage:false});
const dl=page.waitForEvent('download');await page.locator('.downloads button').nth(1).click();const file=await dl;await file.saveAs('artifacts/benchmark-million.png.export.png');
if(!fs.readFileSync('artifacts/benchmark-million.png.export.png').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('PNG failed');
await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
if(errors.length)throw Error(errors.join('\n'));fs.writeFileSync('artifacts/benchmark-browser.json',JSON.stringify({results,errors,pngDownload:true,mobile:true},null,2));console.log('PASS: all four sizes, PNG export, mobile, no JS errors');await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
