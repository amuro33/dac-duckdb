#!/usr/bin/env python3
"""Exercise appearance validation and standalone export against running workers."""
import json
import urllib.request
from pathlib import Path

checks = []
def post(path, body):
    request = urllib.request.Request('http://127.0.0.1:8082' + path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()

config = dict(source='eds', category='lotId', legend='product', x='inspectedAt', y='yieldPct', xType='date', lotId='LOT-101', pointSize=12, showLabels=True, labelColumn='waferId', labelFontSize=14)
for field, value in [('pointSize',0), ('pointSize',21), ('labelFontSize',21), ('labelColumn','missing')]:
    result = json.loads(post('/api/execute', dict(path='/api/chart/scatter', method='POST', body={**config,field:value}, record=False)))
    assert result['status'] == 400
    checks.append(f'Reject {field}={value}')
result = json.loads(post('/api/execute', dict(path='/api/chart/scatter', method='POST', body=config, record=False)))
assert result['status'] == 200 and result['data']['pointSize'] == 12
checks.append('Explicit size and labels preserved')
html = post('/api/export', dict(config=config, format='html', categoryIndex=0))
assert b'"pointSize":12' in html and b'"label":"W' in html
Path('artifacts/chart-options.html').write_bytes(html)
checks.append('Standalone HTML includes appearance and labels')
Path('artifacts/chart-options-integration.json').write_text(json.dumps(dict(passed=len(checks), checks=checks), indent=2))
print(f'PASS: {len(checks)} appearance API checks')
