#!/usr/bin/env python3
"""Deterministic, insert-only chart samples; original demo rows remain intact."""
from pathlib import Path
from datetime import datetime,timedelta
import math,random
rng=random.Random(20261113)
lines=['WHENEVER SQLERROR EXIT FAILURE ROLLBACK']
for lot_index in range(1,4):
 lot=f'LOT-{100+lot_index:03}'
 for w in range(1,101):
  wafer=f'W{w:03}';product='DRAM' if w%2 else 'NAND'
  tested=1000+50*(w%5)
  y=round(max(70,min(99.8,93+3*math.sin(w/8)+lot_index*.6+(1 if product=='DRAM' else -1)+rng.gauss(0,1.2))),2)
  good=round(tested*y/100);y=round(good/tested*100,2)
  date=(datetime(2026,11,1)+timedelta(hours=w*3+lot_index*12)).strftime('%Y-%m-%d %H:%M:%S')
  lines.append(f"MERGE INTO DAC_EDS_DATA t USING (SELECT '{lot}' LOT_ID,'{wafer}' WAFER_ID FROM dual) s ON(t.LOT_ID=s.LOT_ID AND t.WAFER_ID=s.WAFER_ID) WHEN NOT MATCHED THEN INSERT (LOT_ID,WAFER_ID,PRODUCT,TESTED_DIES,GOOD_DIES,YIELD_PCT,INSPECTED_AT) VALUES('{lot}','{wafer}','{product}',{tested},{good},{y},TIMESTAMP '{date}');")
  for j in range(1,3 if w%2==0 else 2):
   key=f'CHART-{lot_index}-{w:03}-{j}';severity=['LOW','MEDIUM','HIGH','CRITICAL'][(w+j+lot_index)%4];kind=['SCRATCH','PARTICLE','BRIDGE'][(w+j)%3];count=max(1,round((100-y)*(j+1)+rng.gauss(0,3)))
   lines.append(f"MERGE INTO DAC_DEFECT_DATA t USING (SELECT '{key}' DEFECT_ID FROM dual) s ON(t.DEFECT_ID=s.DEFECT_ID) WHEN NOT MATCHED THEN INSERT VALUES('{key}','{lot}','{wafer}','{kind}','{severity}',{count});")
lines+=['COMMIT;','SELECT COUNT(*) EDS_ROWS FROM DAC_EDS_DATA;','SELECT COUNT(*) DEFECT_ROWS FROM DAC_DEFECT_DATA;','EXIT;']
Path('db/chart-samples.sql').write_text('\n'.join(lines)+'\n')
