#!/usr/bin/env python3
"""Drill outage must fail explicitly; a persisted result stays readable; retry uses the same inputs."""
import json
from pathlib import Path
import subprocess
import time
import urllib.request


def api(path, body=None, expected=200):
    request = urllib.request.Request('http://localhost:8082/api/execute', data=json.dumps({'path':path,'method':'GET' if body is None else 'POST','body':body,'record':False}).encode(), headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=240) as r: result=json.load(r)
    assert result['status']==expected,result
    return result['data']


def compose(*args):
    subprocess.run(['docker','compose','-f','compose.engines.yaml',*args],check=True,capture_output=True)


measurements=[]
for name in ['engines-integration-combined.json','engines-integration.json','engines-contracts.json']:
    path=Path('artifacts')/name
    if path.exists():
        candidates=json.loads(path.read_text())['measurements']
        if any(r['case']=='1000 pairs' for r in candidates):
            measurements=candidates;break
assert measurements,'Run engines-integration.py with its default sizes first'
original=next(r for r in measurements if r['case']=='1000 pairs' and r['engine']=='duckdb')['datasetId']
saved=next(r for r in measurements if r['case']=='1000 pairs' and r['engine']=='drill')['datasetId']
checks=[]
compose('stop','drill')
try:
    page=api(f'/api/streams/datasets/{saved}/rows?limit=1000')
    assert page['returnedRows']==1000
    checks.append('Persisted partitioned Parquet result remains readable while its compute engine is offline')
    assert not api('/api/streams/engines')['remote']['drill']['available']
    id=api(f'/api/streams/datasets/{original}/analyze',{'engine':'drill'},202)['id']
    for _ in range(60):
        result=api('/api/streams/datasets/'+id)
        if result['dataset']['status']=='failed':break
        assert result['dataset']['status']!='ready','Unexpected fallback'
        time.sleep(1)
    else:raise AssertionError('Offline engine did not fail explicitly')
    assert 'engine' in result['result'][0]['error'].lower()
    checks.append('Offline Drill produces a visible failed job without silently running DuckDB')
finally:
    compose('start','drill')
for _ in range(60):
    if api('/api/streams/engines')['remote']['drill']['available']:break
    time.sleep(1)
else:raise AssertionError('Drill did not recover')
api('/api/streams/datasets/'+id+'/retry',{},202)
for _ in range(90):
    result=api('/api/streams/datasets/'+id)
    assert result['dataset']['status']!='failed',result
    if result['dataset']['status']=='ready':break
    time.sleep(1)
else:raise AssertionError('Retry did not finish')
assert result['dataset']['inputDatasetId']==original
assert result['result'][0]['execution']['engine']=='drill'
assert api(f'/api/streams/datasets/{id}/rows?limit=1000')['returnedRows']==1000
checks.append('Retry after engine recovery reuses the original immutable inputs and publishes a complete Drill result')
Path('artifacts/engines-recovery.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2))
print('PASS:',len(checks),'engine recovery checks')
