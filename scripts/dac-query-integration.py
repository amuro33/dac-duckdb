#!/usr/bin/env python3
import json,urllib.request
from pathlib import Path
BASE='http://127.0.0.1:8082'
def call(path,body=None):
    r=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(r,timeout=60) as response:return json.load(response)
def execute(path,body=None,record=True):return call('/api/execute',dict(path=path,method='GET' if body is None else 'POST',body=body,record=record))
checks=[]
def check(name,ok):
    assert ok,name
    checks.append(name)
catalog=execute('/api/dac/queries',record=False)
check('Stored query catalog loads',catalog['status']==200 and len(catalog['data'])>=3)
for q in catalog['data']:
    result=execute(q['route'],q['default_body'])
    check(q['query_id']+' executes actual Oracle SQL',result['status']==200 and result['data']['count']>0)
q=next(q for q in catalog['data'] if q['query_id']=='EDS_BY_LOT')
body={**q['default_body'],'lot_id':'LOT-102','min_yield':94.5,'limit':7}
r=execute(q['route'],body,False)
check('Edited binds filter and limit actual rows',r['status']==200 and 0<len(r['data']['data'])<=7 and all(x['lot_id']=='LOT-102' and x['yield_pct']>=94.5 for x in r['data']['data']))
history=call('/api/workspace/runs/'+r['runId'])
check('Exact submitted body is durable and addressable by Run ID',history['request']==body and history['path']==q['route'] and history['status']==200)
check('SQL version persisted',history['queryVersion']==q['query_version'])
replay=execute(history['path'],history['request'])
check('Replay creates a new execution with same results',replay['runId']!=r['runId'] and replay['data']==r['data'])
for key,value in [('query_id','OTHER'),('database_name','other'),('limit','7'),('limit',1001),('unknown',1)]:
    bad=execute(q['route'],{**body,key:value})
    check(f'Invalid {key}={value} rejected',bad['status']==400)
    h=call('/api/workspace/runs/'+bad['runId'])
    check(f'Failure history preserves {key}={value}',h['status']==400 and h['request'][key]==value)
r=execute(q['route'],{**body,'lot_id':"' OR 1=1 --"})
check('SQL injection text remains a bound value',r['status']==200 and r['data']['count']==0)
r=execute('/api/dac/select/NOT_REGISTERED',body)
check('Unknown query reports 404',r['status']==404)
Path('artifacts/dac-query-integration.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2))
print(f'PASS: {len(checks)} stored query integration checks')
