#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.local/bin:$PATH"
export KUBECONFIG="$PWD/.kube/config"
mkdir -p .kube
if ! kind get clusters | grep -qx dac; then
  kind create cluster --name dac --config k8s/kind.yaml --kubeconfig "$KUBECONFIG" --wait 120s
fi
# Reach existing Oracle privately from the kind node; no public DB port is opened.
if ! docker network inspect local-databases_default --format '{{json .Containers}}' | grep -q dac-control-plane; then
 docker network connect local-databases_default dac-control-plane
fi
python3 scripts/seed.py
python3 scripts/seed.py db/query-catalog.sql
python3 scripts/seed.py db/chart-samples.sql
python3 scripts/seed.py db/benchmark.sql
docker build -t dac-worker:dev .
kind load docker-image dac-worker:dev --name dac
kubectl apply -f k8s/dac-worker.yaml
python3 scripts/secret.py
kubectl rollout restart deployment/dac-worker -n dac
kubectl rollout status deployment/dac-worker -n dac --timeout=180s
kubectl get pods -n dac
