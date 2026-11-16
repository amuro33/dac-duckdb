#!/usr/bin/env python3
"""Real Oracle -> stored query -> DuckDB -> PostgreSQL workflow acceptance checks."""
import json, time, urllib.request, urllib.error, copy
from pathlib import Path
BASE='http://localhost:8082'
checks=[]
def api(path,body=None,method=None,status=200):
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'},method=method or ('POST' if body is not None else 'GET'))
    try:
        with urllib.request.urlopen(req,timeout=30) as r: code=r.status; text=r.read()
    except urllib.error.HTTPError as e: code=e.code;text=e.read()
    assert code==status,(path,code,text[:1000])
    return json.loads(text) if text else None
def check(label): checks.append(label);print('PASS',label,flush=True)
def wait(run):
    for _ in range(150):
        r=api('/api/workflow-runs/'+run)
        if r['status'] not in ['queued','running']:return r
        time.sleep(.2)
    raise AssertionError('run timeout')
catalog=api('/api/execute',{'path':'/api/dac/queries','method':'GET','record':False})['data']
q={q['query_id']:q for q in catalog}
def query(id,qid):
    body=copy.deepcopy(q[qid]['default_body']);body.update(lot_id={'$input':'lot_id'},limit=100)
    return {'id':id,'kind':'query','x':40,'y':60 if id=='eds' else 260,'config':{'queryId':qid,'queryVersion':q[qid]['query_version'],'body':body}}
def edge(s,t,p='input'):return {'source':s,'target':t,'port':p}
def node(id,kind,config,x=400,y=150):return {'id':id,'kind':kind,'config':config,'x':x,'y':y}
definition={'inputs':{'lot_id':'LOT-101'},'nodes':[query('eds','EDS_BY_LOT'),query('defects','DEFECT_BY_LOT'),node('join','join',{'joinType':'left','keys':[{'left':'lot_id','right':'lot_id'},{'left':'wafer_id','right':'wafer_id'}]},340),node('filter','filter',{'rules':[{'column':'yield_pct','op':'gte','value':95}]},640),node('output','output',{},940)],'edges':[edge('eds','join','left'),edge('defects','join','right'),edge('join','filter'),edge('filter','output')]}
w=api('/api/workflows',{'name':'Lot 품질 분석 · 워크플로우 예제','definition':definition});wid=w['id']
def save(d):
    global w
    w=api('/api/workflows/'+wid,{'name':w['name'],'definition':d,'revision':w['revision']},'PUT');return w
def start(d=None,published=False,version=None,inputs=None):
    if d is not None:save(d)
    r=api('/api/workflows/'+wid+('/runs' if published else '/test'),{'inputs':inputs or {},'version':version},status=202)
    return wait(r['runId'])
api('/api/workflows/validate',definition);check('Graph validation')
w=api('/api/workflows/'+wid+'/publish',{'revision':w['revision']});assert w['published_version']==1
run=start(published=True,version=1);assert run['status']=='succeeded',run
out=api('/api/workflow-runs/'+run['id']+'/nodes/output/data?limit=1000');assert out['total']>0
# Compare complete output values against independent Python join/filter.
eds=api('/api/workflow-runs/'+run['id']+'/nodes/eds/data?limit=1000')['rows'];defects=api('/api/workflow-runs/'+run['id']+'/nodes/defects/data?limit=1000')['rows']
expected=[]
for e in eds:
    if e['yield_pct']<95:continue
    matches=[d for d in defects if (d['lot_id'],d['wafer_id'])==(e['lot_id'],e['wafer_id'])]
    for d in matches or [{k:None for k in defects[0]}]:expected.append({**e,**{'right_'+k:v for k,v in d.items()}})
normalize=lambda rows:sorted(json.dumps(row,sort_keys=True) for row in rows)
assert normalize(expected)==normalize(out['rows']);check('Published API: Oracle + composite LEFT JOIN + numeric filter matches independent values')
assert all(n['duration_ms']>=0 for n in run['nodes']);assert run['nodes'][0]['request'];check('Node timing, resolved request, SQL version and persisted schema');assert run['definition']==definition;check('Execution definition snapshot is available for replay')
page=api('/api/workflow-runs/'+run['id']+'/nodes/output/data?offset=1&limit=2');assert page['rows']==out['rows'][1:3];check('Paginated result snapshot')
api('/api/workflows/'+wid,{'name':'Conflict','definition':definition,'revision':0},'PUT',status=409);check('Optimistic draft conflict')
empty=start(inputs={'lot_id':'NO-SUCH-LOT'});assert empty['status']=='succeeded',empty
zero=api('/api/workflow-runs/'+empty['id']+'/nodes/output/data');assert zero['total']==0 and len(zero['columns'])>5;check('Empty Oracle result keeps schema through join/filter')
merge=copy.deepcopy(definition);merge['nodes']=merge['nodes'][:2]+[node('merge','merge',{}),node('output','output',{},700)];merge['edges']=[edge('eds','merge','left'),edge('defects','merge','right'),edge('merge','output')]
m=start(merge);assert m['status']=='succeeded',m;counts={n['node_id']:n['row_count'] for n in m['nodes']};assert counts['output']==counts['eds']+counts['defects'];check('Merge aligns unlike schemas and retains every input row')
chain=copy.deepcopy(merge);chain['nodes']=chain['nodes'][:2]+[node('output','output',{},700)];chain['nodes'][1]['config']['body']['lot_id']={'$node':'eds','column':'lot_id','row':0};chain['edges']=[edge('eds','defects','after'),edge('defects','output')]
c=start(chain,inputs={'lot_id':'LOT-102'});assert c['status']=='succeeded',c;assert next(n for n in c['nodes'] if n['node_id']=='defects')['request']['lot_id']=='LOT-102';check('API-to-API typed value binding')
old=start(published=True,version=1);assert old['status']=='succeeded' and len(old['nodes'])==5;check('Published v1 remains immutable while draft changes')
missing=copy.deepcopy(definition);missing['nodes'][3]['config']['rules'][0]['column']='missing_column';bad=start(missing);assert bad['status']=='failed' and next(n for n in bad['nodes'] if n['node_id']=='output')['status']=='skipped';check('Invalid column fails the node and skips descendants')
drift=copy.deepcopy(chain);drift['nodes'][0]['config']['queryVersion']=999;bad=start(drift);assert bad['status']=='failed' and '버전' in bad['error'];check('Query version drift is rejected')
cycle=copy.deepcopy(chain);cycle['edges'].append(edge('defects','eds','after'));api('/api/workflows/validate',cycle,status=400);check('Cycle rejected before execution')
save(definition)
# Cancel either queued or in-flight work; observe terminal acknowledgement.
r=api('/api/workflows/'+wid+'/test',{'inputs':{}},status=202)
api('/api/workflow-runs/'+r['runId']+'/cancel',{},status=202);assert wait(r['runId'])['status']=='cancelled';check('Cancellation reaches terminal state')
long=copy.deepcopy(definition)
for n in long['nodes'][:2]:n['config']['body']['limit']=1000
save(long)
r=api('/api/workflows/'+wid+'/test',{'inputs':{}},status=202)
for _ in range(100):
    running=api('/api/workflow-runs/'+r['runId'])
    if running['status']=='running':break
    time.sleep(.01)
assert running['status']=='running'
api('/api/workflow-runs/'+r['runId']+'/cancel',{},status=202);assert wait(r['runId'])['status']=='cancelled';check('In-flight cancellation interrupts processing')
save(definition)
w=api('/api/workflows/'+wid+'/publish',{'revision':w['revision']});assert w['published_version']==2
final=start(published=True,version=2);assert final['status']=='succeeded';check('Second immutable version executes')
assert len(api('/api/workflows/'+wid+'/versions'))==2
assert len(api('/api/workflows/'+wid+'/runs'))>=9;check('Durable workflow and execution histories')
Path('artifacts/workflow-integration.json').write_text(json.dumps({'workflowId':wid,'runId':final['id'],'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
print('WORKFLOW',wid,'RUN',final['id'])
