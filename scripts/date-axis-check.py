#!/usr/bin/env python3
"""Check date defaults against real data and the server rendering adapter."""
import json
import urllib.request
from pathlib import Path
base='http://127.0.0.1:8082'
def post(path,body):
    request=urllib.request.Request(base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=90) as r:return r.read()
checks=[]
for source,size in [('eds',None),('defects',None),('joined',None),('eds',1000),('eds',10000),('eds',100000),('eds',1000000),('defects',1000),('joined',1000)]:
    joined=source=='joined'
    config=dict(source=source,category='lot_id' if joined else 'lotId',legend='severity' if source=='defects' else 'product',x='inspected_at' if joined else 'inspectedAt',xType='date',y='yield_pct' if joined else 'defectCount' if source=='defects' else 'yieldPct',lotId=None if size else 'LOT-101',sampleSize=size)
    result=json.loads(post('/api/execute',dict(path='/api/chart/scatter',method='POST',body=config,record=False)))
    assert result['status']==200, result
    spec=result['data']
    assert spec['xType']=='date' and spec['plottedRows']>0
    assert all(p['x']>1700000000000 for c in spec['charts'] for s in c['series'] for p in s['points'])
    checks.append(f'{source}/{size or "base"}: real UTC date coordinates')
    if source=='eds' and size is None:
        svg=post('/api/export',dict(config=config,format='svg',categoryIndex=0)).decode()
        assert '2026-11-' in svg
        Path('artifacts/date-axis.svg').write_text(svg)
        checks.append('SVG displays explicit year-month-day labels')
Path('artifacts/date-axis.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2))
print(f'PASS: {len(checks)} date-axis checks')
