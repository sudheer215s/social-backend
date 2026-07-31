#!/usr/bin/env bash
# Clean-clone local setup (P0-T16). Target: usable dev env in under 10 minutes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> [1/5] Node version"
if [[ -f .nvmrc ]] && command -v nvm >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  nvm use || true
fi
node -v
corepack enable >/dev/null 2>&1 || true
pnpm -v

echo "==> [2/5] Install dependencies"
pnpm install --frozen-lockfile

echo "==> [3/5] Env file"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example"
else
  echo ".env already present"
fi

echo "==> [4/5] Docker Compose stack"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the local data plane" >&2
  exit 1
fi
docker compose -f docker/docker-compose.yml up -d
bash "${ROOT}/scripts/check-compose.sh"

echo "==> [5/5] Build + unit tests"
pnpm build
pnpm test

echo
echo "Setup complete."
echo "  pnpm dev                 # hello-service on :3000"
echo "  Jaeger UI                http://127.0.0.1:16686"
echo "  Elasticsearch            http://127.0.0.1:9200"
echo "  Kafka (Redpanda host)    127.0.0.1:19092  (in-network: redpanda:9092)"
echo "  OTLP HTTP                http://127.0.0.1:4318"
echo "  Postgres via PgBouncer   127.0.0.1:6432"
