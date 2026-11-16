#!/usr/bin/env python3
import json,time,urllib.request,urllib.error
from pathlib import Path
base='http://localhost:8082';checks=[]
def call(path,body=None,method=None,status=200):
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
 try:
  with urllib.request.urlopen(req,timeout=30) as r:code=r.status;raw=r.read()
 except urllib.error.HTTPError as e:code=e.code;raw=e.read()
 assert code==status,(path,code,raw[:500]);return json.loads(raw) if raw else None
def check(s):checks.append(s);print('PASS',s,flush=True)
q=next(q for q in call('/api/execute',{'path':'/api/dac/queries','method':'GET','record':False})['data'] if q['query_id']=='EDS_BY_LOT')
body={**q['default_body'],'limit':1000}
definition={'inputs':{},'nodes':[{'id':'q','kind':'query','config':{'queryId':q['query_id'],'queryVersion':q['query_version'],'body':body}},{'id':'out','kind':'output','config':{}}],'edges':[{'source':'q','target':'out','port':'input'}]}
call('/api/workflows',{'name':' ','definition':definition},status=400);check('Blank name rejected')
w=call('/api/workflows',{'name':'Management API test','definition':definition});id=w['id'];old=w['revision'];w=call('/api/workflows/'+id,{'name':'Renamed API test','definition':definition,'revision':old},'PUT');assert w['id']==id and w['name']=='Renamed API test';check('Rename retains immutable workflow ID')
call('/api/workflows/'+id+'?revision='+str(old),method='DELETE',status=409);assert call('/api/workflows/'+id)['name']==w['name'];check('Stale delete cannot remove a changed workflow')
w=call('/api/workflows/'+id+'/publish',{'revision':w['revision']});r=call('/api/workflow/'+id,{'inputs':{},'version':1},status=202)
call('/api/workflows/'+id+'?revision='+str(w['revision']),method='DELETE',status=409);check('Queued or running work prevents deletion')
for _ in range(150):
 run=call('/api/workflow-runs/'+r['runId'])
 if run['status'] not in ['queued','running']:break
 time.sleep(.1)
assert run['status']=='succeeded';check('Singular execution route runs published version')
call('/api/workflows/'+id+'?revision='+str(w['revision']),method='DELETE',status=204)
assert not any(x['id']==id for x in call('/api/workflows'));call('/api/workflows/'+id,status=404);check('Deleted workflow disappears from list and lookup')
for path in ['/api/workflow/'+id,'/api/workflows/'+id+'/runs','/api/workflows/'+id+'/test']:call(path,{'inputs':{}},status=404)
call('/api/workflows/'+id,{'name':'Restore attempt','definition':definition,'revision':w['revision']},'PUT',status=409);call('/api/workflows/'+id+'/publish',{'revision':w['revision']},status=409);check('Deleted workflow cannot execute, update or publish')
assert call('/api/workflow-runs/'+r['runId'])['status']=='succeeded';assert call('/api/workflow-runs/'+r['runId']+'/nodes/out/data')['total']>0;check('Historical run and data survive logical deletion')
Path('artifacts/workflow-library-integration.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2))
