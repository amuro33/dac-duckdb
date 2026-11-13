#!/usr/bin/env python3
from pathlib import Path
import subprocess, sys
root=Path(__file__).resolve().parents[1]
env=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if line and not line.startswith('#'))
sql='connect app/'+env['ORACLE_APP_PASSWORD']+'@//localhost:1521/XEPDB1\n'+(root/(sys.argv[1] if len(sys.argv)>1 else 'db/seed.sql')).read_text()
r=subprocess.run(['docker','compose','exec','-T','oracle','sqlplus','-s','/nolog'],cwd=root,input=sql,text=True,capture_output=True)
# SQLPlus can echo a failed connect. Do not print the credential-bearing input.
print(r.stdout if 'ORA-' not in r.stdout else 'Oracle seed failed; inspect schema/connection.')
raise SystemExit(r.returncode or (1 if 'ORA-' in r.stdout else 0))
