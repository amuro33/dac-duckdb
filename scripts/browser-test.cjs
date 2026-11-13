const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});let checks=0;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8080');await page.waitForFunction(()=>document.getElementById('health').textContent.includes('연결됨'));
 const buttons=page.locator('aside button');
 for(let i=0;i<await buttons.count();i++){
  await buttons.nth(i).click();await page.locator('#send').click();
  await page.waitForFunction(()=>!document.getElementById('send').disabled);
  const status=await page.locator('#status').textContent();if(!status.startsWith('200'))throw Error(`Preset ${i}: ${status}`);
  if(await page.locator('#table tr').count()<2)throw Error(`No table rows ${i}`);checks++;
 }
 await page.locator('#jsonTab').click();if(!await page.locator('#json').isVisible())throw Error('JSON tab failed');checks++;
 await page.locator('#tableTab').click();
 await buttons.nth(5).click();await page.locator('#body').fill('{bad');await page.locator('#send').click();await page.waitForFunction(()=>!document.getElementById('send').disabled);if((await page.locator('#status').textContent()).startsWith('200'))throw Error('Bad JSON accepted');checks++;
 await buttons.nth(5).click();await page.locator('#send').click();await page.waitForFunction(()=>!document.getElementById('send').disabled);
 await page.screenshot({path:'artifacts/console-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/console-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile page overflow');checks++;
 if(errors.length)throw Error(errors.join('\n'));
 fs.writeFileSync('artifacts/browser.json',JSON.stringify({passed:true,checks,consoleErrors:errors},null,2));console.log(`PASS: ${checks} browser checks`);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
