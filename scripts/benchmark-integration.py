#!/usr/bin/env python3
import json,time,urllib.request,urllib.error
from pathlib import Path
results=[]
def get(url,body=None):
 req=urllib.request.Request(url,data=json.dumps(body).encode() if body else None,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=240) as r:return json.load(r)
def check(name,ok):
 assert ok,name
 results.append(name)
base={'source':'eds','category':'lotId','legend':'product','x':'sampleId','y':'yieldPct','xType':'number'}
perf=[]
for size in (1000,10000,100000,1000000):
 start=time.monotonic();body={**base,'sampleSize':size}
 r=get('http://localhost:8081/api/chart/scatter',body)
 perf.append({'size':size,'seconds':round(time.monotonic()-start,3),'plotted':r['plottedRows']})
 check(f'{size}: realistic yield',all(0<=p['y']<=100 for c in r['charts'] for series in c['series'] for p in series['points']))
 check(f'{size}: exact source count',r['sourceRows']==size)
 check(f'{size}: all points',r['plottedRows']==size)
 check(f'{size}: accounting',r['sourceRows']==r['plottedRows']+r['skippedRows']+r['sampledOutRows'])
 check(f'{size}: all lot groups',len(r['charts'])==10)
 check(f'{size}: all product series',all(len(c['series'])==3 for c in r['charts']))
 check(f'{size}: no sampling',r['sampledOutRows']==0 and r['sampling']=='none')
 ids={int(p['x']) for c in r['charts'] for series in c['series'] for p in series['points']}
 check(f'{size}: every source ID exactly once',len(ids)==size and min(ids)==1 and max(ids)==size)
 columns=get(f'http://localhost:8081/api/chart/columns?source=eds&sampleSize={size}')
 check(f'{size}: column count independent of metadata preview',columns['rowCount']==size)
for source,body in [('defects',{'category':'lotId','legend':'severity','x':'sampleId','y':'defectCount'}),('joined',{'category':'lot_id','legend':'severity','x':'sample_id','y':'yield_pct'})]:
 r=get('http://localhost:8081/api/chart/scatter',{'source':source,'sampleSize':1000000,'xType':'number',**body})
 check(source+' all points',r['plottedRows']==1000000 and r['sourceRows']==1000000)
r=get('http://localhost:8081/api/chart/scatter',{**base,'sampleSize':1000000,'lotId':'BENCH-001'})
check('Lot filter returns all matching rows',r['sourceRows']==100000 and r['plottedRows']==100000 and len(r['charts'])==1)
r=get('http://localhost:8081/api/chart/scatter',{**base,'sampleSize':1000000,'lotId':'EMPTY'})
check('Empty filter response',r['sourceRows']==0 and r['charts']==[])
for size in (999,1000001):
 try:get('http://localhost:8081/api/chart/scatter',{**base,'sampleSize':size});raise AssertionError('invalid size accepted')
 except urllib.error.HTTPError as e:check('Invalid size '+str(size),e.code==400)
Path('artifacts/benchmark-integration.json').write_text(json.dumps({'checks':results,'timings':perf},indent=2))
print(f'PASS: {len(results)} benchmark checks');print(json.dumps(perf))
