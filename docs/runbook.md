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


## Kafka / transform 운영

```bash
docker compose -f compose.kafka.yaml ps
docker compose -f compose.kafka.yaml exec -T kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka-broker:9092 --all-groups --describe
KUBECONFIG="$PWD/.kube/config" ~/.local/bin/kubectl logs -n dac deployment/dac-publisher --tail=100
KUBECONFIG="$PWD/.kube/config" ~/.local/bin/kubectl logs -n dac deployment/data-transform-service --tail=100
KUBECONFIG="$PWD/.kube/config" ~/.local/bin/kubectl logs -n dac deployment/stream-observer --tail=100
```

Data streams 화면에서 feed를 중지하면 신규 발행이 멈추고 진행 중인 스냅샷은 끝까지 전달합니다. consumer 중지는 다른 그룹의 진행을 막지 않으며, 재시작하면 보존된 Kafka offset부터 이어받습니다. 격리 메시지는 PostgreSQL `stream_failures`, 완료 발행 대기는 `stream_outbox`에서 확인합니다. 동기 변환 502는 data-transform-service의 상태도 확인하세요.

결과 PVC는 kind 노드 내부 hostPath입니다. Pod 재시작은 보존되지만 클러스터 삭제 전에 결과 파일을 별도 백업해야 합니다. PostgreSQL 입력·메타데이터와 결과 파일을 함께 복구해야 합니다. Kafka Compose 볼륨 삭제도 이벤트 로그를 지우므로 재시작 절차로 사용하지 마세요. 자세한 범위는 [스트리밍 설계](streaming.md)에 있습니다.

## Analytics engines

See [engine deployment, storage, recovery, and multi-host prerequisites](engines.md). `scripts/up.sh` now includes `scripts/deploy-engines.sh`. The default Compose cluster has one Spark master, two worker containers, one execution gateway/driver, and one Drillbit. These currently share one physical host. None of their ports is published on the host.

`docker compose -f compose.engines.yaml ps` and the Analysis engine selector show availability. Failed transforms do not fall back to another engine. Retry after resolving the dependency; saved results remain readable during a compute-engine outage.
