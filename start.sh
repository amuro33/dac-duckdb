#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if docker info >/dev/null 2>&1; then
  runner=(docker)
else
  runner=(sudo docker)
fi
"${runner[@]}" compose up -d --wait --wait-timeout 900
"${runner[@]}" compose ps
"${runner[@]}" compose exec -T postgres psql -U app -d appdb -c 'select version();'
"${runner[@]}" compose exec -T oracle sqlplus -s / as sysdba <<'SQL'
whenever sqlerror exit failure
select banner_full from v$version;
exit;
SQL
