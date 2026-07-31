#!/usr/bin/env bash
# Smoke-check that core Compose services are healthy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "${ROOT}/docker/docker-compose.yml")

echo "==> compose config"
"${COMPOSE[@]}" config --quiet

echo "==> starting services"
"${COMPOSE[@]}" up -d

echo "==> waiting for healthy"
deadline=$((SECONDS + 90))
while true; do
  unhealthy="$("${COMPOSE[@]}" ps --format json 2>/dev/null | python3 -c '
import sys, json
raw = sys.stdin.read().strip()
if not raw:
    print("none")
    raise SystemExit
# docker compose may emit one JSON object per line
items = []
for line in raw.splitlines():
    line = line.strip()
    if not line:
        continue
    items.append(json.loads(line))
if not items and raw.startswith("["):
    items = json.loads(raw)
names = []
for s in items:
    name = s.get("Name") or s.get("Service") or "?"
    health = (s.get("Health") or s.get("State") or "").lower()
    status = (s.get("State") or "").lower()
    if health and health not in ("healthy",):
        names.append(f"{name}:{health or status}")
    elif not health and status not in ("running",):
        names.append(f"{name}:{status}")
print(",".join(names) if names else "ok")
' || echo "parse-error")"

  if [[ "${unhealthy}" == "ok" ]]; then
    echo "all services healthy"
    "${COMPOSE[@]}" ps
    exit 0
  fi

  if (( SECONDS >= deadline )); then
    echo "timeout waiting for healthy services: ${unhealthy}"
    "${COMPOSE[@]}" ps
    "${COMPOSE[@]}" logs --tail=50
    exit 1
  fi

  echo "waiting... (${unhealthy})"
  sleep 3
done
