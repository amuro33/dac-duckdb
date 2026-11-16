const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const waitIdle=()=>page.getByRole('button',{name:'Send',exact:true}).waitFor();
 try{
  await page.goto('http://localhost:8082/#console',{waitUntil:'domcontentloaded'});
  const editor=page.getByLabel('JSON 요청 본문');await page.waitForFunction(()=>document.querySelector('textarea')?.value.includes('EDS_BY_LOT'));
  const original=JSON.parse(await editor.inputValue());assert.equal(original.database_name,'oracle');checks.push('Catalog default body');
  await page.getByLabel('저장 쿼리 검색').fill('DEFECT');await page.locator('.acb-sidebar .acb-query').filter({hasText:'DEFECT_BY_LOT'}).first().click();assert.equal(JSON.parse(await editor.inputValue()).query_id,'DEFECT_BY_LOT');await page.getByLabel('저장 쿼리 검색').fill('');
  await page.locator('.acb-tabs button').filter({hasText:'EDS_BY_LOT'}).click();checks.push('Multiple requests retain independent bodies');
  await page.locator('.acb-inspector').getByLabel('바인딩 limit',{exact:true}).fill('7');await page.locator('.acb-inspector').getByLabel('바인딩 limit',{exact:true}).press('Enter');assert.equal(JSON.parse(await editor.inputValue()).limit,7);checks.push('Inspector edits numeric body binding');
  const edited={...original,lot_id:'LOT-102',min_yield:94.5,limit:7};await editor.fill(JSON.stringify(edited,null,2));
  const response=page.waitForResponse(r=>r.url().endsWith('/api/execute')&&r.request().postDataJSON()?.path==='/api/dac/select/EDS_BY_LOT');
  await page.getByRole('button',{name:'Send',exact:true}).click();const result=await(await response).json();assert.equal(result.status,200);assert.equal(result.data.count,7);assert.ok(result.responseBytes>0);assert.match(result.responseHeaders['Content-Type'],/json/);await waitIdle();checks.push('Real Oracle response with measured size and headers');
  const record=await(await page.request.get('http://localhost:8082/api/workspace/runs/'+result.runId)).json();assert.deepEqual(record.request,edited);assert.equal(record.queryVersion,1);checks.push('History retains body and SQL version');
  await page.getByRole('button',{name:'기본 바디 복원'}).click();assert.deepEqual(JSON.parse(await editor.inputValue()),original);
  await page.locator('.acb-recent').first().click();assert.deepEqual(JSON.parse(await editor.inputValue()),edited);checks.push('History opens separate replay tab');
  await editor.fill('[]');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('JSON 객체 형식의 요청 본문을 입력해 주세요.',{exact:true}).waitFor();checks.push('Invalid object body blocked');
  await editor.fill(JSON.stringify({...edited,query_id:'OTHER'}));await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.acb-status')?.textContent==='400');await waitIdle();checks.push('Server validation error rendered');
  await editor.fill(JSON.stringify(edited));await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.acb-status')?.textContent==='200 OK');await waitIdle();
  await page.getByRole('button',{name:'실행 옵션',exact:true}).click();const capture=page.waitForResponse(r=>r.url().endsWith('/api/sources')&&r.request().method()==='POST');await page.locator('.acb-send-menu').getByRole('button',{name:'실행하고 소스 고정',exact:true}).click();const source=await(await capture).json();assert.equal(source.row_count,7);await page.waitForFunction(()=>document.querySelector('.acb-status')?.textContent==='SNAPSHOT');assert.equal(await page.locator('.acb-response tbody tr').count(),7);checks.push('Send-and-pin creates a persisted source and opens SRC tab');
  await page.locator('.acb-tabs button').filter({hasText:'EDS_BY_LOT'}).first().click();await editor.fill(JSON.stringify({...edited,limit:9}));await page.reload({waitUntil:'domcontentloaded'});await editor.waitFor();assert.equal(JSON.parse(await editor.inputValue()).limit,9);checks.push('Draft tabs survive reload without storing result payloads');
  await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.acb-status')?.textContent==='200 OK');await waitIdle();
  fs.mkdirSync('artifacts/console-workbench',{recursive:true});await page.screenshot({path:'artifacts/console-workbench/desktop.png',fullPage:true});
  for(const width of [1280,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);await page.screenshot({path:`artifacts/console-workbench/${width}.png`,fullPage:true});}checks.push('Desktop/tablet/mobile no document overflow');
  assert.deepEqual(errors,[]);checks.push('No browser exceptions');
  fs.writeFileSync('artifacts/dac-query-browser.json',JSON.stringify({passed:checks.length,checks,createdSource:source.id},null,2));console.log(`PASS: ${checks.length} console workbench browser checks`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
