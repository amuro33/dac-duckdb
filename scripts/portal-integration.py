#!/usr/bin/env python3
import json,urllib.request,urllib.error,uuid
from pathlib import Path
base='http://127.0.0.1:8082';checks=[]
def req(path,body=None,method=None,headers=None):
 request=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),method=method or ('POST' if body is not None else 'GET'),headers={'Content-Type':'application/json',**(headers or {})})
 try:
  with urllib.request.urlopen(request,timeout=90) as r:
   raw=r.read();return r.status,json.loads(raw) if raw and 'json' in r.headers.get('Content-Type','') else raw
 except urllib.error.HTTPError as e:
  raw=e.read()
  try:out=json.loads(raw)
  except:out=raw
  return e.code,out

def check(name,condition):
 assert condition,name
 checks.append(name)
config={'source':'eds','category':'lotId','legend':'product','x':'inspectedAt','y':'yieldPct','xType':'date','lotId':'LOT-101','sampleSize':None}
s,h=req('/api/workspace/health');check('All live dependencies ready',s==200 and all(x['healthy'] for x in h['services']))
s,r=req('/api/execute',{'path':'/api/dac/get_eds_data?lotId=LOT-101&limit=1000','method':'GET'});check('Data API integration and exact count',s==200 and r['status']==200 and len(r['data'])==100)
s,c=req('/api/execute',{'path':'/api/chart/scatter','method':'POST','body':config});check('Chart API integration',c['status']==200 and c['data']['plottedRows']==100)
runid=c['runId'];s,hist=req('/api/workspace/runs');check('Completed request persisted in PostgreSQL',any(x['id']==runid and x['rowCount']==100 and x['request']['lotId']=='LOT-101' for x in hist))
s,fail=req('/api/execute',{'path':'/api/chart/scatter','method':'POST','body':{**config,'y':'product'}});check('Upstream 400 remains visible',s==200 and fail['status']==400)
s,hist=req('/api/workspace/runs');check('Failed execution is also persisted',any(x['id']==fail['runId'] and x['status']==400 for x in hist))
s,_=req('/api/execute',{'path':'https://example.com','method':'GET'});check('Arbitrary upstream URL blocked',s==400)
s,_=req('/api/workspace/views',{'name':'no','description':'','config':config},headers={'Origin':'https://foreign.example'});check('Cross-origin mutation blocked',s==403)
name='Integration '+uuid.uuid4().hex[:8];body={'name':name,'description':'<script>not executable</script>','config':config,'pinned':False}
s,v=req('/api/workspace/views',body);check('View created',s==201);vid=v['id']
try:
 s,views=req('/api/workspace/views');view=next(x for x in views if x['id']==vid);check('Configuration round trip',view['config']==config and view['version']==1)
 s,_=req('/api/workspace/views/'+vid,{**body,'name':name+' updated','pinned':True,'version':1},'PUT');check('Versioned update succeeds',s==200)
 s,_=req('/api/workspace/views/'+vid,{**body,'version':1},'PUT');check('Stale update returns conflict',s==409)
 s,_=req('/api/workspace/views/'+vid+'?version=1',method='DELETE');check('Stale delete cannot remove updated view',s==409)
 s,views=req('/api/workspace/views');view=next(x for x in views if x['id']==vid);check('Version and pinned state persisted',view['version']==2 and view['pinned'] and view['name']==name+' updated')
finally:req('/api/workspace/views/'+vid+'?version=2',method='DELETE')
s,views=req('/api/workspace/views');check('Deletion persisted',not any(x['id']==vid for x in views))
s,_=req('/api/workspace/views',{'name':'','description':'','config':config});check('Invalid name rejected',s==400)
s,_=req('/api/workspace/views',{'name':'x','description':'','config':{**config,'sampleSize':123}});check('Invalid sample size rejected',s==400)
s,_=req('/api/workspace/views',{'name':'x','description':'','config':{**config,'sampleSize':'1000'}});check('Wrong sample size JSON type returns 400',s==400)
s,_=req('/api/workspace/views',{'name':'x','description':'','config':{**config,'category':[]}});check('Array category returns 400',s==400)
s,_=req('/api/execute',{'path':None,'method':'GET'});check('Null API path returns 400',s==400)
s,_=req('/api/unknown-route');check('Unknown API route returns 404 instead of SPA HTML',s==404)
s,png=req('/api/export',{'config':config,'format':'png','categoryIndex':0});check('Binary image export through portal',s==200 and png[:8]==b'\x89PNG\r\n\x1a\n')
s,metrics=req('/api/workspace/metrics');check('Metrics reflect actual executions',s==200 and metrics['runs']>=3 and metrics['errors']>=1 and metrics['p95Ms'] is not None)
Path('artifacts/portal-integration.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2));print(f'PASS: {len(checks)} portal integration checks')
