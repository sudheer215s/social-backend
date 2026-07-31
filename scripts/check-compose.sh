#!/usr/bin/env bash
# Smoke-check that Compose services are healthy (P0-T13/T14).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "${ROOT}/docker/docker-compose.yml")

echo "==> compose config"
"${COMPOSE[@]}" config --quiet

echo "==> starting services"
"${COMPOSE[@]}" up -d

echo "==> waiting for healthy (up to 180s)"
deadline=$((SECONDS + 180))
required="social-postgres social-pgbouncer social-redis social-redpanda social-elasticsearch social-jaeger"

is_healthy() {
  local name="$1"
  local line
  line="$("${COMPOSE[@]}" ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep "^${name} " || true)"
  [[ "$line" == *healthy* ]]
}

is_running() {
  local name="$1"
  local line
  line="$("${COMPOSE[@]}" ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep "^${name} " || true)"
  [[ -n "$line" && "$line" != *Exit* && "$line" != *missing* ]]
}

while true; do
  pending=""
  for name in $required; do
    if ! is_healthy "$name"; then
      st="$("${COMPOSE[@]}" ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep "^${name} " || echo "${name} missing")"
      pending="${pending}${st}; "
    fi
  done
  if ! is_running social-otel-collector; then
    pending="${pending}social-otel-collector not running; "
  fi

  if [[ -z "$pending" ]]; then
    echo "all required services healthy (otel running)"
    "${COMPOSE[@]}" ps
    echo "==> probe endpoints"
    curl -fsS "http://127.0.0.1:9200/_cluster/health?pretty" | head -20
    echo
    docker exec social-redpanda rpk cluster health || true
    curl -fsS -o /dev/null -w "jaeger_ui_http=%{http_code}\n" http://127.0.0.1:16686/
    # OTLP HTTP has no root handler; connection accepted is enough
    if curl -sS -o /dev/null -w "otel_http=%{http_code}\n" --max-time 2 -X POST http://127.0.0.1:4318/v1/traces || true; then
      :
    fi
    exit 0
  fi

  if (( SECONDS >= deadline )); then
    echo "timeout waiting for healthy services: ${pending}"
    "${COMPOSE[@]}" ps
    "${COMPOSE[@]}" logs --tail=40
    exit 1
  fi

  echo "waiting... ${pending}"
  sleep 5
done
