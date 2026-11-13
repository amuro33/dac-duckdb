#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.local/bin:$PATH"
export KUBECONFIG="$PWD/.kube/config"
docker compose -f compose.kafka.yaml up -d --wait --wait-timeout 300
python3 scripts/portal-secret.py
docker build -f src/Data.Transform/Dockerfile -t data-transform:dev .
docker build -f src/Data.Publisher/Dockerfile -t dac-publisher:dev .
kind load docker-image data-transform:dev dac-publisher:dev --name dac
kubectl apply -f k8s/streaming.yaml
kubectl rollout restart -n dac deployment/data-transform-service deployment/stream-observer deployment/dac-publisher
for deployment in data-transform-service stream-observer dac-publisher; do
  kubectl rollout status -n dac deployment/"$deployment" --timeout=180s
done
