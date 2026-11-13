#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.local/bin:$PATH"
for tool in docker kind kubectl python3; do command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }; done
python3 scripts/init-env.py
./start.sh
./scripts/deploy.sh
./scripts/deploy-streaming.sh
./scripts/deploy-chart.sh
./scripts/deploy-portal.sh
python3 scripts/seed-portal-views.py
