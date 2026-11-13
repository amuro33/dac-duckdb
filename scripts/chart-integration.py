#!/usr/bin/env python3
import json,urllib.request,urllib.error,struct
from pathlib import Path
base='http://127.0.0.1:8081';results=[]
def req(path,body=None):
 data=None if body is None else json.dumps(body).encode()
 with urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers={'Content-Type':'application/json'}),timeout=60) as r:return r.read(),r.headers

def api(path,body=None):return json.loads(req(path,body)[0])
def check(name,ok):
 assert ok,name
 results.append({'name':name,'passed':True})
cols=api('/api/chart/columns?source=eds')
check('Source columns are discovered through real data API',cols['rowCount']==312)
check('Date column is available',any(c['name']=='inspectedAt' and c['type']=='date' for c in cols['columns']))
body={'source':'eds','category':'lotId','legend':'product','x':'waferId','y':'yieldPct','xType':'string'}
s=api('/api/chart/scatter',body)
check('One independent panel per lot',len(s['charts'])==6)
check('All EDS rows plotted',s['plottedRows']==312 and s['skippedRows']==0)
check('Legends group per panel',all(len(c['series']) in (1,2) for c in s['charts']))
s=api('/api/chart/scatter',{**body,'category':'product','legend':'lotId'})
check('Dynamic category reassigns charts',len(s['charts'])==2)
check('Legend reassigns independent series',len(s['charts'][0]['series'])==5)
s=api('/api/chart/scatter',{**body,'category':None,'legend':'lotId'})
check('No category gives one chart with six series',len(s['charts'])==1 and len(s['charts'][0]['series'])==6)
s=api('/api/chart/scatter',{**body,'legend':None})
check('No legend gives one series',all(len(c['series'])==1 for c in s['charts']))
s=api('/api/chart/scatter',{**body,'x':'goodDies','xType':'number'})
check('Numeric X remains numeric',isinstance(s['charts'][0]['series'][0]['points'][0]['x'],(int,float)))
s=api('/api/chart/scatter',{**body,'x':'inspectedAt','xType':'date'})
check('Date X is UTC epoch milliseconds',isinstance(s['charts'][0]['series'][0]['points'][0]['x'],int))
s=api('/api/chart/scatter',{**body,'lotId':'LOT-001'})
check('Lot source filter forwarded',s['sourceRows']==4 and len(s['charts'])==1)
s=api('/api/chart/scatter',{**body,'lotId':'EMPTY'})
check('Empty result is explicit',s['charts']==[] and s['sourceRows']==0)
s=api('/api/chart/scatter',{'source':'defects','category':'lotId','legend':'severity','x':'waferId','y':'defectCount','xType':'string'})
check('Defect API and legend grouping work',s['plottedRows']==464 and len(s['charts'])==7)
s=api('/api/chart/scatter',{'source':'joined','category':'lot_id','legend':'severity','x':'wafer_id','y':'yield_pct','xType':'string'})
check('Joined data API works and null Y is reported',s['sourceRows']==466 and s['plottedRows']==465 and s['skippedRows']==1)
for changes in [{'y':'product'},{'x':'missing'},{'xType':'number'},{'source':'http://example.com'}]:
 try:api('/api/chart/scatter',{**body,**changes});raise AssertionError('expected 400')
 except urllib.error.HTTPError as e:check('Invalid selection returns 400 '+str(changes),e.code==400)
svg,h=req('/api/chart/render?format=svg&categoryIndex=0',body)
check('Real ECharts SSR SVG',b'<svg' in svg and b'LOT-001' in svg and h.get_content_type()=='image/svg+xml')
png,h=req('/api/chart/render?format=png&width=1000&height=500',body)
check('Server PNG signature and dimensions',png[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>II',png[16:24])==(1000,500))
html,h=req('/api/chart/render?format=html',body)
check('Self-contained HTML chart export',b'echarts.init' in html and b'ScatterAdapter.option' in html and b'<script src=' not in html)
root=Path('artifacts');root.mkdir(exist_ok=True)
(root/'chart.svg').write_bytes(svg);(root/'chart.png').write_bytes(png);(root/'charts.html').write_bytes(html)
(root/'chart-integration.json').write_text(json.dumps(results,indent=2))
print(f'PASS: {len(results)} chart integration checks')
