#!/usr/bin/env python3
"""Live Oracle + HTTP APIs + DuckDB checks. Server must already be running."""
import json, urllib.request, urllib.error
from pathlib import Path
base='http://127.0.0.1:8080'
results=[]
def request(path,body=None):
 data=None if body is None else json.dumps(body).encode()
 with urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers={'Content-Type':'application/json'}),timeout=40) as r:return json.load(r)
def check(name,ok):
 assert ok,name
 results.append({'name':name,'passed':True})
e=request('/api/dac/get_eds_data?limit=1000');d=request('/api/dac/get_defect_data?limit=1000')
check('Oracle EDS sample: 312 rows',len(e)==312)
check('Oracle defect sample: 464 rows',len(d)==464)
check('Oracle lot filter',len(request('/api/dac/get_eds_data?lotId=LOT-001'))==4)
check('Oracle wafer filter',len(request('/api/dac/get_eds_data?lotId=LOT-001&waferId=W01'))==1)
check('Oracle empty query',request('/api/dac/get_eds_data?lotId=UNKNOWN')==[])
check('Oracle bind values prevent injection',request('/api/dac/get_eds_data?lotId=LOT%27%20OR%201%3D1--')==[])
check('Oracle limit',len(request('/api/dac/get_defect_data?limit=2'))==2)
check('Lot API',len(request('/api/dac/lots'))==6)
check('Summary API',request('/api/dac/summary')['waferCount']==312)
for join,n in [('inner',463),('left',465),('full',466)]:
 r=request('/api/dac/transform',{'operation':'join','joinType':join,'limit':1000})
 check('DuckDB '+join+' cardinality',r['count']==n)
 check('Real API source counts '+join,r['sourceCounts']=={'eds':312,'defects':464})
r=request('/api/dac/transform',{'operation':'merge','limit':1000})
check('Merge UNION ALL retains 776 rows',r['count']==776)
check('Merge keeps both sources',{x['source_type'] for x in r['data']}=={'eds','defect'})
r=request('/api/dac/transform',{'operation':'filter','minYield':94,'severity':'HIGH','joinType':'inner','lotId':'LOT-002'})
check('Combined yield/severity filters',r['count']==2 and all(x['yield_pct']>=94 and x['severity']=='HIGH' for x in r['data']))
check('Transform result limit',request('/api/dac/transform',{'limit':2})['count']==2)
check('Transform empty source',request('/api/dac/transform',{'lotId':'UNKNOWN'})['count']==0)
for path,body in [('/api/dac/get_eds_data?limit=0',None),('/api/dac/transform',{'operation':'drop'}),('/api/dac/transform',{'joinType':'cross'}),('/api/dac/transform',{'minYield':101})]:
 try:request(path,body);raise AssertionError('Expected 400: '+path)
 except urllib.error.HTTPError as ex:check('Validation 400: '+path+str(body),ex.code==400)
Path('artifacts').mkdir(exist_ok=True)
Path('artifacts/integration.json').write_text(json.dumps(results,indent=2))
print(f'PASS: {len(results)} live integration checks')
