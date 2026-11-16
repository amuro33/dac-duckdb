#!/usr/bin/env python3
import json,time,urllib.request,urllib.error
from pathlib import Path
BASE='http://localhost:8082';checks=[]
def api(path,body=None,status=200,method=None):
 req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
 try:
  with urllib.request.urlopen(req,timeout=120) as r:code=r.status;raw=r.read()
 except urllib.error.HTTPError as e:code=e.code;raw=e.read()
 assert code==status,(path,code,raw[:1500]);return json.loads(raw) if raw else None
def check(s):checks.append(s);print('PASS',s,flush=True)
def wait(path):
 for _ in range(600):
  r=api(path)
  if r['status'] not in ['queued','running']:return r
  time.sleep(.3)
 raise AssertionError('timeout')
eds={'database_name':'oracle','query_id':'EDS_BY_LOT','lot_id':'LOT-101','min_yield':90,'limit':9}
a=api('/api/sources',{'kind':'api','queryId':'EDS_BY_LOT','body':eds});assert a['row_count']==9 and a['origin']['queryVersion']==1;check('API body creates immutable typed source with provenance')
rows=api('/api/sources/'+a['id']+'/rows?limit=10000');assert len(rows['data'])==9;assert any(c['type']=='date' for c in rows['columns']);check('Shared source preserves dates and data schema')
b=api('/api/sources',{'kind':'api','queryId':'DEFECT_BY_LOT','body':{'database_name':'oracle','query_id':'DEFECT_BY_LOT','lot_id':'LOT-101','severity':None,'limit':9}})
api('/api/sources',{'kind':'api','queryId':'EDS_BY_LOT','body':{**eds,'limit':0}},status=400);check('Invalid API bindings cannot become a source')
d={'inputs':{'lot_id':'LOT-101'},'nodes':[{'id':'q','kind':'query','config':{'queryId':'EDS_BY_LOT','queryVersion':1,'body':{**eds,'lot_id':{'$input':'lot_id'}}}},{'id':'out','kind':'output','config':{}}],'edges':[{'source':'q','target':'out','port':'input'}]}
w=api('/api/workflows',{'name':'공통 소스 통합 검증','definition':d});w=api('/api/workflows/'+w['id']+'/publish',{'revision':w['revision']});r=api('/api/workflow/'+w['id'],{'inputs':{}},status=202);run=wait('/api/workflow-runs/'+r['runId']);assert run['status']=='succeeded'
c=api('/api/sources',{'kind':'workflow','runId':r['runId']});assert c['origin']['version']==1 and c['row_count']==9;assert api('/api/sources/'+c['id']+'/rows')['data']==rows['data'];check('Workflow Output becomes the same reusable dataset contract')
api('/api/workflows/'+w['id']+'?revision='+str(w['revision']),method='DELETE',status=204);assert api('/api/sources/'+c['id'])['row_count']==9;check('Source remains usable after its workflow is deleted')
config={'source':'snapshot','datasetId':c['id'],'category':'lot_id','legend':'product','x':'inspected_at','y':'yield_pct','xType':'date','sampleSize':None,'lotId':None,'showLabels':True,'labelColumn':'wafer_id'}
chart=api('/api/execute',{'path':'/api/chart/scatter','method':'POST','body':config});assert chart['status']==200,chart;assert chart['data']['sourceRows']==9 and chart['data']['plottedRows']==9;assert len(chart['data']['charts'][0]['series'])==2;check('Workflow dataset renders category/legend scatter with date X and labels')
v=api('/api/workspace/views',{'name':'워크플로우 소스 분석 검증','description':'snapshot-backed saved view','config':config,'pinned':False},status=201);assert any(x['config'].get('datasetId')==c['id'] for x in api('/api/workspace/views'));check('Saved view retains the exact source ID');api('/api/workspace/views/'+v['id']+'?version=1',method='DELETE',status=204)
# Validate export through the same chart worker.
req=urllib.request.Request(BASE+'/api/export',data=json.dumps({'config':config,'format':'png','categoryIndex':0}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=120) as response:assert response.read(8)==b'\x89PNG\r\n\x1a\n'
check('PNG export reads the same captured workflow source')
comparisons=[]
for operation,extra in [('aggregate',{'group':'product','metric':'yield_pct'}),('filter',{'filter':{'column':'yield_pct','op':'gte','value':95}}),('join',{'right':b['id'],'joinType':'left','keys':[{'left':'lot_id','right':'lot_id'},{'left':'wafer_id','right':'wafer_id'}]}),('merge',{'right':b['id']})]:
 r=api('/api/source-comparisons',{'left':a['id'],'operation':operation,**extra},status=202);result=wait('/api/source-comparisons/'+r['id']);assert result['status']=='succeeded',result
 assert result['results']['equivalent'],result
 for engine in ['duckdb','spark','datafusion']:
  e=result['results'][engine];assert e['inputHashes'][0]==a['checksum'];assert e['totalMs']>=e['engineMs']>=0
 if operation=='aggregate':assert result['results']['duckdb']['rowCount']==2
 if operation=='filter':assert result['results']['duckdb']['rowCount']==sum(x['yield_pct']>=95 for x in rows['data'])
 if operation=='merge':assert result['results']['duckdb']['rowCount']==18
 comparisons.append(r['id']);check(operation+': real DuckDB/Spark/DataFusion share input hashes and agree on all result values')
empty=api('/api/sources',{'kind':'api','queryId':'EDS_BY_LOT','body':{**eds,'lot_id':'NONE'}});assert empty['row_count']==0 and len(empty['columns'])>0;check('Empty API source retains its schema')
assert api('/api/sources/'+a['id'])['checksum']==a['checksum'];check('Source hash is stable across repeated reads')
Path('artifacts/sources-integration.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'apiSource':a['id'],'workflowSource':c['id'],'defectSource':b['id'],'comparisons':comparisons},ensure_ascii=False,indent=2))
