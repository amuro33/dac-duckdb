#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.local/bin:$PATH"
export KUBECONFIG="$PWD/.kube/config"
docker build -f src/Chart.Worker/Dockerfile -t chart-worker:dev .
docker build -f src/Chart.Renderer/Dockerfile -t chart-renderer:dev .
kind load docker-image chart-worker:dev chart-renderer:dev --name dac
kubectl apply -f k8s/chart-worker.yaml
kubectl rollout restart deployment/chart-worker -n dac
kubectl rollout status deployment/chart-worker -n dac --timeout=180s
docker compose -f compose.chart.yaml up -d
kubectl get pods -n dac
