#!/usr/bin/env bash
# Build all application images (or one via FILTER).
# Usage:
#   bash scripts/docker-build-apps.sh
#   bash scripts/docker-build-apps.sh identity-service
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

build_one() {
  local app="$1"
  local pkg="$2"
  local port="$3"
  local tag="$4"
  echo "==> building $tag ($pkg)"
  docker build -f docker/Dockerfile.service \
    --build-arg "APP=${app}" \
    --build-arg "PKG=${pkg}" \
    --build-arg "PORT=${port}" \
    -t "${tag}" \
    .
}

FILTER="${1:-}"

declare -a ROWS=(
  "identity-service @social/identity-service 3001 social-identity:local"
  "post-service @social/post-service 3002 social-post:local"
  "graph-service @social/graph-service 3003 social-graph:local"
  "timeline-service @social/timeline-service 3004 social-timeline:local"
  "notification-service @social/notification-service 3005 social-notification:local"
  "search-service @social/search-service 3006 social-search:local"
  "realtime-gateway @social/realtime-gateway 3007 social-realtime:local"
  "api-gateway @social/api-gateway 3000 social-gateway:local"
)

for row in "${ROWS[@]}"; do
  # shellcheck disable=SC2086
  set -- $row
  app="$1"; pkg="$2"; port="$3"; tag="$4"
  if [[ -n "$FILTER" && "$FILTER" != "$app" && "$FILTER" != "$tag" ]]; then
    continue
  fi
  build_one "$app" "$pkg" "$port" "$tag"
done

echo "done."
