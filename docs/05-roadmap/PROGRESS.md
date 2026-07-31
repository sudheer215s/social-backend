# Progress Memory

**Last updated:** 2026-07-31  
**Repo:** https://github.com/sudheer215s/social-backend  
**Branch:** `main`  
**HEAD:** `7c2521c` — feat(P0-T14/T16): extend Compose stack and clean-clone setup

## Workflow

```
task → test → code & build → test → review → commit → update this file
```

## Current status

| Area | State |
|------|--------|
| **Phase** | 0 — nearly complete |
| **Active next** | P0-T04 (ESLint boundaries + husky); Phase 1 prep |
| **Compose** | Postgres, PgBouncer, Redis, **Redpanda**, **Elasticsearch**, **Jaeger**, **OTel Collector** |
| **Dev path** | `pnpm dev:setup` / `scripts/dev-setup.sh` |

## Completed (Phase 0)

P0-T01–T03, P0-T05–T16 **except P0-T04** (optional polish).

### P0-T14 notes
- Redpanda Kafka API: host `localhost:19092`, docker network `redpanda:9092`
- ES single-node security off for local; green cluster health
- OTel Collector OTLP HTTP `:4318` → Jaeger UI `:16686`
- Host port `4317` is Jaeger OTLP; collector gRPC published as host `4319`

### P0-T16 notes
- `scripts/dev-setup.sh` + `pnpm dev:setup`
- `.env.example` updated for Redpanda host port and OTLP

## Technical decisions
1. PgBouncer: SET LOCAL timeouts only.
2. Docker images: `pnpm deploy` for hello-service.
3. Local Kafka = Redpanda (Kafka API compatible).
4. Local observability = OTel Collector + Jaeger (full Grafana/Loki/Tempo can wait).

## Resume
```bash
pnpm dev:setup
pnpm dev
```

## Session log
### 2026-07-31 (continued)
- P0-T14 extended Compose + check-compose probes green
- P0-T16 clean-clone setup script
