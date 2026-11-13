#!/usr/bin/env python3
"""Real Kafka payload delivery, full DuckDB results, independent consumer recovery and replay."""
import json, os, time, urllib.request, subprocess, pathlib
from datetime import datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE=os.environ.get('PORTAL_URL','http://localhost:8082')
checks=[]; measures=[]
def api(path,body=None,expected=200):
    for attempt in range(15):
        req=urllib.request.Request(BASE+'/api/execute',data=json.dumps({'path':path,'method':'GET' if body is None else 'POST','body':body,'record':False}).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=240) as response: result=json.load(response)
        # Readiness/endpoints and pooled connections can settle just after a Recreate rollout.
        # Retry read-only transport failures; never replay a mutation automatically.
        if body is None and result['status'] in (502,503,504) and attempt<14:
            time.sleep(1);continue
        assert result['status']==expected,(path,result)
        return result['data']
def create(name,size=1000,**options):
    return api('/api/streams/feeds',{'name':'QA stream '+name,'sampleSize':size,'intervalSeconds':10,'maxRuns':1,**options},201)['id']
def wait_ready(feed,both=True):
    deadline=time.monotonic()+360
    while time.monotonic()<deadline:
        rows=[d for d in api('/api/streams/datasets') if d['feedId']==feed]
        if rows:
            d=rows[0]
            assert d['status']!='failed',d
            if d['status']=='ready':
                detail=api('/api/streams/datasets/'+d['id'])
                consumers=detail['consumers']
                if not both or len(consumers)==4 and all(c['receivedRows']==c['expectedRows'] and c['batches']==c['expectedBatches'] for c in consumers):return d,detail
        time.sleep(1)
    raise AssertionError('Dataset timeout: '+feed)
def rows(id):
    after=0;expected=None
    while True:
        page=api(f'/api/streams/datasets/{id}/rows?afterId={after}&limit=10000')
        expected=page['totalRows'] if expected is None else expected
        assert expected==page['totalRows'] and page['sampling']=='none'
        for row in page['data']:
            assert row['row_id']==after+1;after+=1;yield row
        if not page['hasMore']:break
        assert page['data'],'Non-advancing result page'
    assert after==expected,(after,expected)
def kube(*args):
    env={**os.environ,'KUBECONFIG':str(ROOT/'.kube/config')}
    return subprocess.run([str(pathlib.Path.home()/'.local/bin/kubectl'),'-n','dac',*args],env=env,capture_output=True,text=True,check=True).stdout

def kafka(args,input=None):
    return subprocess.run(['docker','compose','-f','compose.kafka.yaml','exec','-T','kafka',*args],cwd=ROOT,input=input,capture_output=True,text=True,check=True).stdout

for size in [1000,10000,100000,1000000]:
    started=time.monotonic();feed=create(str(size),size);d,detail=wait_ready(feed)
    assert d['resultRows']==size
    seen=set()
    for row in rows(d['id']):
        n=int(row['wafer_id'][1:]);assert row['defect_id']=='B'+str(n);assert row['lot_id']=='BENCH-'+str((n-1)%10+1).zfill(3);seen.add(n)
    assert len(seen)==size and min(seen)==1 and max(seen)==size
    assert all(c['receivedRows']==size for c in detail['consumers'])
    measures.append({'size':size,'datasetId':d['id'],'elapsedMs':round((time.monotonic()-started)*1000,1),'transformMs':d['transformMs'],'readyMs':round((datetime.fromisoformat(d['readyAt'])-datetime.fromisoformat(d['createdAt'])).total_seconds()*1000,1),'publishMs':round((datetime.fromisoformat(d['publishedAt'])-datetime.fromisoformat(d['createdAt'])).total_seconds()*1000,1),'resultRows':d['resultRows']})
    checks.append(f'{size}: both groups receive both complete sources; full result IDs/joins verified')
    print(json.dumps(measures[-1]),flush=True)

for operation in ['join','merge','filter']:
    options={'operation':operation,'joinType':'full'}
    if operation=='filter':options.update(minYield=94,severity='HIGH')
    baseline=api('/api/dac/transform',{**options,'limit':1000})
    d,_=wait_ready(create('base '+operation,None,**options));actual=list(rows(d['id']))
    assert len(actual)==baseline['count'],(operation,len(actual),baseline['count'])
    normalize=lambda values: sorted([{k:(v.rstrip('Z') if k=='inspected_at' and isinstance(v,str) else v) for k,v in row.items() if k!='row_id'} for row in values],key=lambda r:(str(r.get('source_type','')),r['lot_id'],r['wafer_id'],str(r['defect_id'])))
    assert normalize(actual)==normalize(baseline['data']),operation
    checks.append('Base '+operation+': matches legacy contract, including one-to-many and orphan rows')
empty,_=wait_ready(create('empty',1000,lotId='QA-NO-MATCH'));assert empty['resultRows']==0 and list(rows(empty['id']))==[];checks.append('Empty inputs produce a complete empty result')

# The second group can be offline while the transform group makes progress.
kube('scale','deployment/stream-observer','--replicas=0')
try:
    kube('wait','--for=delete','pod','-l','app=stream-observer','--timeout=90s')
    feed=create('observer recovery',10000);d,detail=wait_ready(feed,False)
    assert all(c['consumerGroup']!='waferscope-observer-v1' for c in detail['consumers'])
finally:
    kube('scale','deployment/stream-observer','--replicas=1');kube('rollout','status','deployment/stream-observer','--timeout=180s')
d,detail=wait_ready(feed);checks.append('Offline observer catches up from Kafka while transform continues independently')

# Replay a real source record exactly; duplicates must not increase durable source counts.
raw=kafka(['/opt/kafka/bin/kafka-console-consumer.sh','--bootstrap-server','kafka-broker:9092','--topic','dac.eds.v1','--from-beginning','--max-messages','1','--timeout-ms','10000']).strip()
event=json.loads(raw);assert event['rows'] and 'yieldPct' in event['rows'][0]
before=api('/api/streams/datasets/'+event['datasetId'])['consumers']
kafka(['/opt/kafka/bin/kafka-console-producer.sh','--bootstrap-server','kafka-broker:9092','--topic','dac.eds.v1'],raw+'\n');time.sleep(3)
after=api('/api/streams/datasets/'+event['datasetId'])['consumers'];assert before==after;checks.append('Kafka carries actual records; exact duplicate replay does not duplicate durable rows')

# Invalid schema is durably quarantined by each consumer, without stopping valid work.
kafka(['/opt/kafka/bin/kafka-console-producer.sh','--bootstrap-server','kafka-broker:9092','--topic','dac.eds.v1'],json.dumps({**event,'schemaVersion':999})+'\n')
for _ in range(30):
    q=api('/api/streams/status')['quarantine']
    if len(q)==2 and all(x['records']>=1 for x in q):break
    time.sleep(1)
else:raise AssertionError('Poison message not quarantined')
checks.append('Unknown schema is durably quarantined in both consumer groups')

# Files and status survive Pod replacement; legacy calculation is now a remote service.
first=list(rows(d['id']))[:3]
kube('rollout','restart','deployment/data-transform-service');kube('rollout','status','deployment/data-transform-service','--timeout=180s')
assert list(rows(d['id']))[:3]==first
assert api('/api/dac/transform',{'operation':'join','lotId':'LOT-101','limit':1000})['service']=='data-transform-service'
checks.append('Transform Pod restart preserves results; DAC compatibility proxy calls the separate service')
chart=api('/api/chart/scatter',{'source':'transformed','datasetId':d['id'],'category':'lot_id','legend':'product','x':'inspected_at','y':'yield_pct','xType':'date'})
assert chart['plottedRows']==10000 and chart['sampling']=='none';checks.append('Chart worker reads every transformed result row through paginated API')

(ROOT/'artifacts/streaming-integration.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'scale':measures},indent=2))
print('PASS:',len(checks),'streaming integration checks',flush=True)
