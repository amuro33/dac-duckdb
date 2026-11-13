const http=require('node:http');const fs=require('node:fs');const echarts=require('echarts');const sharp=require('sharp');const adapter=require('./echarts-adapter.js');
const safeJson=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
http.createServer(async(req,res)=>{
 if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end('{"status":"ok"}');}
 if(req.url!=='/render'||req.method!=='POST'){res.writeHead(404);return res.end();}
 let size=0;const chunks=[];try{
  for await(const chunk of req){size+=chunk.length;if(size>256_000_000)throw Error('Payload too large');chunks.push(chunk);}
  const {spec,format,categoryIndex,width,height}=JSON.parse(Buffer.concat(chunks));
  if(!['svg','png','html'].includes(format)||width<320||width>2400||height<240||height>1600)throw Error('Invalid render request');
  if(format==='html'){
   const library=fs.readFileSync(require.resolve('echarts/dist/echarts.min.js'),'utf8');const code=fs.readFileSync('./echarts-adapter.js','utf8');
   const html=`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scatter charts</title><style>body{font-family:sans-serif;background:#eef3f7;margin:20px}.chart{height:500px;margin:20px 0;background:white}h1{font-size:22px}</style><h1>Scatter charts</h1><main id="charts"></main><script>${library.replace(/<\/script/gi,'<\\/script')}<\/script><script>${code}<\/script><script>const spec=${safeJson(spec)};const instances=[];for(const panel of spec.charts){const dom=document.createElement('div');dom.className='chart';document.getElementById('charts').append(dom);const c=echarts.init(dom);c.setOption(ScatterAdapter.option(spec,panel));instances.push(c)}window.addEventListener('resize',()=>instances.forEach(c=>c.resize()));<\/script></html>`;
   res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(html);
  }
  const panel=spec.charts[categoryIndex];if(!panel)throw Error('Unknown category');
  const chart=echarts.init(null,null,{renderer:'svg',ssr:true,width,height});let svg;
  try{chart.setOption(adapter.option(spec,panel));svg=chart.renderToSVGString();}finally{chart.dispose();}
  const image=format==='svg'?Buffer.from(svg):await sharp(Buffer.from(svg)).png().toBuffer();
  res.writeHead(200,{'content-type':format==='svg'?'image/svg+xml':'image/png'});res.end(image);
 }catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}
}).listen(8091,'0.0.0.0');
