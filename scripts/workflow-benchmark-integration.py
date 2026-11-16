#!/usr/bin/env python3
import json,time,urllib.request,urllib.error
from pathlib import Path
BASE='http://localhost:8082';checks=[]
def api(path,body=None,status=200,method=None):
 req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
 try:
  with urllib.request.urlopen(req,timeout=120) as r:code=r.status;raw=r.read()
 except urllib.error.HTTPError as e:code=e.code;raw=e.read()
 assert code==status,(path,code,raw[:1600]);return json.loads(raw) if raw else None
def wait(path):
 for _ in range(600):
  r=api(path)
  if r['status'] not in ['queued','running']:return r
  time.sleep(.5)
 raise AssertionError('timeout')
def check(s):checks.append(s);print('PASS',s,flush=True)
def node(id,kind,config={}):return {'id':id,'kind':kind,'config':config}
def edge(source,target,port='input'):return {'source':source,'target':target,'port':port}
eds={'database_name':'oracle','query_id':'EDS_BY_LOT','lot_id':{'$input':'lot_id'},'min_yield':90,'limit':9}
defect={'database_name':'oracle','query_id':'DEFECT_BY_LOT','lot_id':{'$input':'lot_id'},'severity':None,'limit':9}
d={'inputs':{'lot_id':'LOT-101'},'nodes':[node('eds','query',{'queryId':'EDS_BY_LOT','queryVersion':1,'body':eds}),node('defects','query',{'queryId':'DEFECT_BY_LOT','queryVersion':1,'body':defect}),node('joined','join',{'joinType':'left','keys':[{'left':'lot_id','right':'lot_id'},{'left':'wafer_id','right':'wafer_id'}]}),node('filtered','filter',{'rules':[{'column':'product','op':'contains','value':'RAM'},{'column':'yield_pct','op':'gte','value':90}]}),node('merged','merge'),node('output','output')],'edges':[edge('eds','joined','left'),edge('defects','joined','right'),edge('joined','filtered'),edge('filtered','merged','left'),edge('filtered','merged','right'),edge('merged','output')]}
w=api('/api/workflows',{'name':'Workflow Benchmark 통합 검증','definition':d})
try:
 api('/api/workflow-benchmarks',{},status=400);check('Benchmark requires published workflow or successful versioned run')
 w=api('/api/workflows/'+w['id']+'/publish',{'revision':w['revision']})
 job=api('/api/workflow-benchmarks',{'workflowId':w['id'],'version':1,'inputs':{}},status=202)
 result=wait('/api/source-comparisons/'+job['id']);assert result['status']=='succeeded',result
 assert result['results']['equivalent'],result
 assert 'workflow_payload' not in result
 for engine in ['duckdb','spark','datafusion']:
  r=result['results'][engine];assert r['matchesBaseline'],r
  assert [n['nodeId'] for n in r['nodes']]==['eds','defects','joined','filtered','merged','output']
  assert r['rowCount']>0;assert r['nodes'][4]['rowCount']==2*r['nodes'][3]['rowCount']
  assert r['totalMs']>=r['engineMs']>0
 assert len({tuple(result['results'][e]['inputHashes']) for e in ['duckdb','spark','datafusion']})==1
 check('Server prepares workflow and each real engine replays Join, AND/contains Filter and Merge through Output')
 check('Full Output matches all engines and the original workflow baseline; node timings and common input hashes retained')
 original=api('/api/workflow-runs/'+result['config']['runId']);assert original['status']=='succeeded'
 assert result['config']['version']==1 and result['config']['definition']==original['definition']
 check('Published definition, inputs and baseline run ID are frozen in benchmark history')
 repeated=api('/api/workflow-benchmarks',{'runId':result['config']['runId']},status=202);repeat=wait('/api/source-comparisons/'+repeated['id']);assert repeat['status']=='succeeded',repeat
 assert repeat['config']['runId']==result['config']['runId'];assert repeat['results']['duckdb']['resultHash']==result['results']['duckdb']['resultHash']
 check('Existing successful run can be benchmarked again without re-querying its APIs')
 Path('artifacts/workflow-benchmark-integration.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'benchmarkId':job['id'],'runId':result['config']['runId'],'workflowId':w['id'],'results':result['results']},ensure_ascii=False,indent=2))
finally:
 api('/api/workflows/'+w['id']+'?revision='+str(w['revision']),method='DELETE',status=204)
