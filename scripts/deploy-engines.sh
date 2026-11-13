#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
docker compose -f compose.engines.yaml build
docker compose -f compose.engines.yaml up -d --wait --wait-timeout 180
docker compose -f compose.engines.yaml exec -T analytics-engines python - <<'PY'
import json,time,urllib.request
for attempt in range(60):
    try:
        with urllib.request.urlopen('http://localhost:8095/engines',timeout=10) as r:status=json.load(r)
        if all(status[e]['available'] for e in ['spark','datafusion','drill']) and status['spark']['workerCount']>=2:
            print(json.dumps(status));break
    except Exception:
        pass
    time.sleep(2)
else:
    raise SystemExit('Analytics engines did not become ready; inspect compose logs')
PY
