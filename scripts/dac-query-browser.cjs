const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1600,height:1100}});const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://localhost:8082/#console',{waitUntil:'domcontentloaded'});
  const editor=page.getByLabel('JSON 요청 본문');await page.waitForFunction(()=>document.querySelector('textarea')?.value.includes('EDS_BY_LOT'));
  const original=JSON.parse(await editor.inputValue());assert.equal(original.database_name,'oracle');checks.push('Catalog provides a default request body');
  await page.getByLabel('저장 쿼리 검색').fill('DEFECT');assert.equal(await page.locator('.request-list button').count(),1);await page.locator('.request-list button').click();assert.equal(JSON.parse(await editor.inputValue()).query_id,'DEFECT_BY_LOT');await page.getByLabel('저장 쿼리 검색').fill('');checks.push('Catalog search and selection load the corresponding body');
  await page.getByRole('button',{name:/EDS 검사 조회/}).click();
  const edited={...original,lot_id:'LOT-102',min_yield:94.5,limit:7};await editor.fill(JSON.stringify(edited,null,2));
  const response=page.waitForResponse(r=>r.url().endsWith('/api/execute')&&r.request().postDataJSON()?.path==='/api/dac/select/EDS_BY_LOT');
  await page.getByRole('button',{name:'Send',exact:true}).click();const result=await(await response).json();assert.equal(result.status,200);assert.equal(result.data.count,7);await page.waitForFunction(()=>!document.querySelector('.request-bar .primary').disabled);checks.push('Edited parameters execute Oracle SQL');
  const record=await(await page.request.get('http://localhost:8082/api/workspace/runs/'+result.runId)).json();assert.deepEqual(record.request,edited);assert.equal(record.queryVersion,1);checks.push('History retains request and SQL version');
  await page.getByRole('button',{name:'기본 바디 복원'}).click();assert.deepEqual(JSON.parse(await editor.inputValue()),original);
  await page.locator('.history-request').first().click();assert.deepEqual(JSON.parse(await editor.inputValue()),edited);checks.push('History restores edited body instead of catalog defaults');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.history-request');await page.locator('.history-request').first().click();assert.deepEqual(JSON.parse(await editor.inputValue()),edited);checks.push('History survives reload');
  await editor.fill(JSON.stringify({...edited,query_id:'OTHER'}));await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.response-heading .status-code')?.textContent==='400');await page.waitForFunction(()=>!document.querySelector('.request-bar .primary').disabled);assert.equal(await page.locator('.history-request .status-code').first().textContent(),'400');checks.push('Failed requests are visible and persisted');
  await page.getByRole('button',{name:'기본 바디 복원'}).click();await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.response-heading .status-code')?.textContent==='200');await page.getByRole('button',{name:'Table',exact:true}).click();await page.waitForSelector('.console-work tbody tr');checks.push('Result table renders query output');
  await page.screenshot({path:'artifacts/dac-query-console.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('Mobile console has no horizontal overflow');
  assert.deepEqual(errors,[]);checks.push('No browser exceptions');
  fs.writeFileSync('artifacts/dac-query-browser.json',JSON.stringify({passed:checks.length,checks},null,2));console.log(`PASS: ${checks.length} stored query browser checks`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
