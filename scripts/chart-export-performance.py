#!/usr/bin/env python3
import datetime
import json
import time
import urllib.request
from pathlib import Path

rows = []
for labels in (False, True):
    config = dict(source='eds', category=None, legend='product', x='inspectedAt', y='yieldPct', xType='date', lotId=None, sampleSize=1000000, pointSize=6, showLabels=labels, labelColumn='waferId', labelFontSize=11)
    request = urllib.request.Request('http://127.0.0.1:8082/api/export', data=json.dumps(dict(config=config,format='png',categoryIndex=0)).encode(), headers={'Content-Type':'application/json'})
    started = time.perf_counter()
    with urllib.request.urlopen(request,timeout=90) as response:
        png = response.read()
    ms = round((time.perf_counter()-started)*1000,1)
    assert png[:8] == b'\x89PNG\r\n\x1a\n'
    Path('artifacts/chart-million-labels-'+('on' if labels else 'off')+'.png').write_bytes(png)
    rows.append(dict(sourceRows=1000000,points=1000000,showLabels=labels,totalMs=ms,pngBytes=len(png)))
report = dict(checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),notes='One sequential PNG export per mode; includes Oracle sample query, SVG layout, rasterization and transfer. 1000x500 image, 1 category, 6px points, 11px waferId labels. Not a latency distribution.',measurements=rows)
Path('artifacts/chart-export-performance.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
