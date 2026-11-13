#!/usr/bin/env python3
"""Measure the local end-to-end HTTP path; this is not a load test."""
import datetime
import json
import time
import urllib.request
from pathlib import Path

measurements = []
for size in (1000, 10000, 100000, 1000000):
    config = dict(source='eds', category='lotId', legend='product', x='sampleId',
                  y='yieldPct', xType='number', sampleSize=size, lotId=None)
    body = json.dumps(dict(path='/api/chart/scatter', method='POST', body=config)).encode()
    request = urllib.request.Request('http://127.0.0.1:8082/api/execute', data=body,
                                     headers={'Content-Type': 'application/json'})
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=90) as response:
        raw = response.read()
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    result = json.loads(raw)
    spec = result['data']
    assert result['status'] == 200
    assert spec['sourceRows'] == size
    assert spec['plottedRows'] == size
    assert spec['sourceRows'] == spec['plottedRows'] + spec['skippedRows'] + spec['sampledOutRows']
    measurements.append(dict(sourceRows=size, plottedRows=spec['plottedRows'],
                             categories=len(spec['charts']), httpMs=elapsed_ms,
                             upstreamMs=result['durationMs'], responseBytes=len(raw)))
report = dict(checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
              scope='One sequential request per size, local warm services; HTTP transfer included, browser rendering excluded',
              measurements=measurements)
Path('artifacts').mkdir(exist_ok=True)
Path('artifacts/portal-scale.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
