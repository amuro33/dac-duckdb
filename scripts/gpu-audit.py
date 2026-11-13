#!/usr/bin/env python3
"""Read-only GPU/CUDA readiness report. Does not install drivers or packages."""
import datetime
import glob
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=20)
        return {'exitCode': result.returncode, 'output': result.stdout.strip()}
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        return {'error': type(error).__name__}

pci = command(['lspci','-k'])
lines = pci.get('output','').splitlines()
gpus = []
for i,line in enumerate(lines):
    if any(kind in line for kind in ('VGA compatible controller','3D controller','Display controller')):
        block = [line]
        for detail in lines[i+1:]:
            if not detail.startswith('\t'): break
            block.append(detail)
        gpus.append('\n'.join(block))
runtimes = command(['docker','info','--format','{{json .Runtimes}}'])
try: runtime_names = list(json.loads(runtimes.get('output','{}')))
except json.JSONDecodeError: runtime_names = []
report = dict(checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),gpus=gpus,
    commands={name:shutil.which(name) for name in ['nvidia-smi','nvcc','nvidia-container-cli','nvidia-ctk']},
    nvidiaDeviceNodes=glob.glob('/dev/nvidia*'),driRenderNodes=glob.glob('/dev/dri/render*'),
    dockerRuntimes=runtime_names,packages={name:importlib.util.find_spec(name) is not None for name in ['torch','cupy','cudf','numpy']})
if report['commands']['nvidia-smi']:
    report['nvidiaSmi'] = command(['nvidia-smi','--query-gpu=name,driver_version,memory.total','--format=csv,noheader'])
if report['packages']['torch']:
    import torch
    report['torch'] = dict(version=torch.__version__,cudaBuild=torch.version.cuda,available=torch.cuda.is_available(),archList=torch.cuda.get_arch_list())
    if torch.cuda.is_available(): report['torch']['devices']=[dict(name=torch.cuda.get_device_name(i),capability=torch.cuda.get_device_capability(i)) for i in range(torch.cuda.device_count())]
Path('artifacts').mkdir(exist_ok=True)
Path('artifacts/gpu-host-audit.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
