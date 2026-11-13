# Runbook

Fresh clone: run `./scripts/up.sh`. It generates `.env` once with private random credentials. `.env.example` documents the variable names; do not overwrite an existing `.env` because existing DB volumes retain their original passwords.

## Inspect

```bash
export KUBECONFIG="$PWD/.kube/config"
~/.local/bin/kubectl get pods,services -n dac
~/.local/bin/kubectl logs -n dac deployment/waferscope --tail=100
~/.local/bin/kubectl logs -n dac deployment/dac-worker --tail=100
~/.local/bin/kubectl logs -n dac deployment/chart-worker -c chart-worker --tail=100
~/.local/bin/kubectl logs -n dac deployment/chart-worker -c echarts-renderer --tail=100
docker compose ps
```

`http://localhost:8082/health/live` checks the portal process. `/health/ready` checks workspace storage.
`/api/workspace/health` probes DAC, chart readiness, and PostgreSQL. DAC readiness queries Oracle;
chart readiness checks its data source and renderer. Portal headers include X-Request-Id, while executions
return a runId that matches persisted history.

## Failure symptoms

| Symptom | Check/action |
| --- | --- |
| Portal 502 response | inspect worker Pod readiness and logs; verify internal DNS names |
| DB health failure | check Oracle/PostgreSQL Compose containers and Docker network attachment |
| Portal startup failure | check `portal-postgres` Secret and Npgsql connection; do not print Secret contents |
| 409 saving a view | re-fetch the view, merge the user's intent, submit the current version |
| 429 executing requests | concurrency queue is full; wait and retry intentionally, not in an infinite loop |
| Chart 400 | verify column name, X/Y types, category count, sample size and Lot filter |
| Chart 422 on normal transform | source reached its 1,000-row snapshot bound; narrow the Lot |
| Empty chart | inspect the Lot filter and null X/Y count; compare source and plotted rows |
| Image labels are boxes | check fonts in `Chart.Renderer/Dockerfile`, rebuild and reload the renderer image |
| Missing portal assets | build React before packaging; keep `wwwroot` from the same frontend build |

## Redeploy and persistence

Use `scripts/deploy-portal.sh`, `scripts/deploy-chart.sh`, or `scripts/deploy.sh` for the relevant service.
The image tags are local development tags and are loaded into kind. Restarting the portal must preserve saved
views and history because they live in PostgreSQL, not process memory. Pin versioned image tags and retain image
artifacts before introducing production rollback requirements.

The NodePort gateways are local nginx Compose services. Ports 8080/8081 are loopback-only. Portal 8082 uses `WAFERSCOPE_BIND_ADDRESS` from `.env`;
set `0.0.0.0` only when LAN access is needed, then use the server LAN IP.
After changing it, run `docker compose -f compose.portal.yaml up -d`.
A LAN client must use the server IPv4 address rather than its own localhost.
Do not recreate the kind cluster just to change UI files. DB data is outside the cluster in separate named volumes.

## Back up workspace state

```bash
mkdir -p artifacts/backups
chmod 700 artifacts/backups
docker compose exec -T postgres pg_dump -U app -d appdb -Fc > artifacts/backups/workspace.dump
chmod 600 artifacts/backups/workspace.dump
```

A real backup requires an off-host copy and a tested restore procedure. This command creates only a local dump.
Oracle source data needs its own backup strategy; seed scripts recreate synthetic data but are not backups of
user-created data. Never run `docker compose down -v` as a routine restart: it deletes database volumes.

## Tests and evidence

The README lists the unit, integration and browser scripts. Each browser script needs Playwright plus Chromium.
Generated evidence lives under `artifacts/`. Benchmark timings describe the local hardware and the explicitly documented dataset size;
they do not establish an SLO or distributed-load capacity. Integration scripts create real execution history,
including intentional errors, so dashboard error counts include validation runs.
