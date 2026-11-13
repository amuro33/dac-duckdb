const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch();
 try{
  const cdp=await browser.newBrowserCDPSession();
  const info=await cdp.send('SystemInfo.getInfo');
  const page=await browser.newPage();
  const webgl=await page.evaluate(()=>{
   const gl=document.createElement('canvas').getContext('webgl2');
   if(!gl)return {webgl2:false};
   const extension=gl.getExtension('WEBGL_debug_renderer_info');
   return {webgl2:true,renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
  });
  const report={checkedAt:new Date().toISOString(),scope:'Playwright headless test browser only; not all browsers on this computer',devices:info.gpu.devices,features:info.gpu.featureStatus,webgl};
  fs.writeFileSync('artifacts/gpu-browser-audit.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
