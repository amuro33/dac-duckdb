#!/usr/bin/env python3
import json,time,urllib.request
from pathlib import Path
checks=[]
def get(url):
    with urllib.request.urlopen(url,timeout=240) as r:return json.load(r)
def check(name,ok):
    assert ok,name
    checks.append(name)
# The unpaginated data endpoint itself must return every row, not merely metadata claiming it.
started=time.monotonic()
raw=get('http://localhost:8080/api/dac/chart_samples?source=eds&size=1000000')
check('Raw default response contains all million rows',len(raw['data'])==1000000 and raw['returnedRows']==1000000 and not raw['hasMore'])
check('Every raw ID exactly once in order',all(row['sampleId']==i for i,row in enumerate(raw['data'],1)))
check('Raw endpoint does not sample',raw['sampling']=='none')
raw_ms=round((time.monotonic()-started)*1000,1);del raw
ids=[];cursor=0
while True:
    page=get(f'http://localhost:8080/api/dac/chart_samples?source=eds&size=1000&limit=333&afterId={cursor}')
    ids.extend(row['sampleId'] for row in page['data'])
    if not page['hasMore']:break
    cursor=ids[-1]
check('Explicit pages cover the whole range without gaps',ids==list(range(1,1001)))
config=dict(source='eds',category='lotId',legend='product',x='inspectedAt',y='yieldPct',xType='date',sampleSize=1000000)
exports=[]
for fmt in ('png','html'):
    request=urllib.request.Request('http://localhost:8082/api/export',data=json.dumps(dict(config=config,format=fmt,categoryIndex=0)).encode(),headers={'Content-Type':'application/json'})
    started=time.monotonic()
    with urllib.request.urlopen(request,timeout=240) as r:content=r.read()
    exports.append(dict(format=fmt,ms=round((time.monotonic()-started)*1000,1),bytes=len(content)))
    if fmt=='png':check('Million-row source category PNG exports',content[:8]==b'\x89PNG\r\n\x1a\n')
    else:
        html=content.decode();spec=json.loads(html.split('const spec=',1)[1].split(';const instances=',1)[0]);del html
        check('HTML contains every million point',sum(len(s['points']) for c in spec['charts'] for s in c['series'])==1000000)
        check('HTML metadata reports full data',spec['plottedRows']==1000000 and spec['sampledOutRows']==0)
    Path('artifacts/full-data.'+fmt).write_bytes(content)
Path('artifacts/full-data-exports.json').write_text(json.dumps(dict(passed=len(checks),checks=checks,rawMillionMs=raw_ms,exports=exports),indent=2))
print('PASS:',len(checks),'full-data raw/paging/export checks',exports)
