#!/usr/bin/env python3
import json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
values=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if line and not line.startswith('#'))
secret={'apiVersion':'v1','kind':'Secret','metadata':{'name':'portal-postgres','namespace':'dac'},'type':'Opaque','stringData':{'connection-string':'Host=local-databases-postgres-1;Port=5432;Database=appdb;Username=app;Password='+values['POSTGRES_PASSWORD']+';Timeout=10;Maximum Pool Size=20;'}}
subprocess.run(['kubectl','apply','-f','-'],input=json.dumps(secret),text=True,check=True)
