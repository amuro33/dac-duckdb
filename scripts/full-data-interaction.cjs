const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(240000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://localhost:8082/#analysis');await page.waitForSelector('.plot[data-render-ready="true"]');
 await page.getByLabel('데이터 규모',{exact:true}).selectOption('100000');await page.waitForFunction(()=>!document.querySelector('.studio .primary').disabled);
 await page.getByRole('button',{name:'분석 실행',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.result-strip')?.textContent.match(/100,000/g)?.length===2);
 await page.waitForSelector('.plot[data-render-ready="true"][data-point-count="10000"]');
 assert.equal(await page.locator('.plot[data-point-count="10000"]').count(),4);
 const plot=page.locator('.plot').first();await plot.scrollIntoViewIfNeeded();const box=await plot.boundingBox();
 for(const dx of [.4,.5,.6,.7]){await page.mouse.click(box.x+box.width*dx,box.y+box.height*.45);if(await page.locator('.point-detail').count())break;}
 await page.waitForSelector('.point-detail');assert.match(await page.locator('.point-detail').textContent(),/2026-.*Y:/);
 assert.deepEqual(errors,[]);
 fs.writeFileSync('artifacts/full-data-interaction.json',JSON.stringify({passed:3,checks:['Four category canvases each contain all 10,000 points','Large-mode click selects a real date/Y point','No browser runtime exceptions']},null,2));console.log('PASS: 3 full-data interaction checks');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
