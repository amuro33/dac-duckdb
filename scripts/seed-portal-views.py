#!/usr/bin/env python3
import json,urllib.request
url='http://127.0.0.1:8082/api/workspace/views'
existing=json.load(urllib.request.urlopen(url))
configs=[('검사 수율 · LOT-101','예제: 검사 시각에 따른 DRAM/NAND 수율을 비교합니다.',{'source':'eds','category':'lotId','legend':'product','x':'inspectedAt','y':'yieldPct','xType':'date','lotId':'LOT-101','sampleSize':None}),('백만 행 · 제품별 분포','예제: 실제 100만 행 전체를 조회하여 제품별로 나눕니다.',{'source':'eds','category':'product','legend':'lotId','x':'inspectedAt','y':'yieldPct','xType':'date','lotId':None,'sampleSize':1000000}),('결함 현황 · 심각도별','예제: Lot별 결함 건수를 심각도 시리즈로 나눕니다.',{'source':'defects','category':'lotId','legend':'severity','x':'inspectedAt','y':'defectCount','xType':'date','lotId':'LOT-101','sampleSize':None})]
for name,note,config in configs:
 current=next((x for x in existing if x['name']==name),None)
 if current:
  if name=='백만 행 · 제품별 분포' and current['description']=='예제: 실제 100만 행에서 최대 2만 포인트를 고정 표본으로 조회합니다.':
   update={**current,'description':note}
   with urllib.request.urlopen(urllib.request.Request(url+'/'+current['id'],data=json.dumps(update).encode(),method='PUT',headers={'Content-Type':'application/json'})) as r:assert r.status==200
   continue
  # Migrate only untouched built-in defaults; preserve user-customized views.
  old={**config,'x':'sampleId' if config['sampleSize'] else 'waferId','xType':'number' if config['sampleSize'] else 'string'}
  if current['description']==note and current['config']==old:
   update={**current,'config':config}
   with urllib.request.urlopen(urllib.request.Request(url+'/'+current['id'],data=json.dumps(update).encode(),method='PUT',headers={'Content-Type':'application/json'})) as r:assert r.status==200
  continue
 body=json.dumps({'name':name,'description':note,'config':config,'pinned':True}).encode()
 with urllib.request.urlopen(urllib.request.Request(url,data=body,headers={'Content-Type':'application/json'})) as r:assert r.status==201
print('Saved example views are ready.')
