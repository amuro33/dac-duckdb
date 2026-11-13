#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.local/bin:$PATH"
export KUBECONFIG="$PWD/.kube/config"
docker build -f src/Portal.Api/Dockerfile -t waferscope:dev .
kind load docker-image waferscope:dev --name dac
python3 scripts/portal-secret.py
kubectl apply -f k8s/portal.yaml
kubectl rollout restart deployment/waferscope -n dac
kubectl rollout status deployment/waferscope -n dac --timeout=180s
docker compose -f compose.portal.yaml up -d
kubectl get pods -n dac
