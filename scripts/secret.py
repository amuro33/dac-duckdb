#!/usr/bin/env python3
import json, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
s=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if line and not line.startswith('#'))
secret={'apiVersion':'v1','kind':'Secret','metadata':{'name':'dac-oracle','namespace':'dac'},'type':'Opaque','stringData':{'connection-string':'User Id=app;Password='+s['ORACLE_APP_PASSWORD']+';Data Source=local-databases-oracle-1:1521/XEPDB1;Connection Timeout=10;'}}
subprocess.run(['kubectl','apply','-f','-'],input=json.dumps(secret),text=True,check=True)
