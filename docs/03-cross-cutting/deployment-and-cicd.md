# Deployment and CI/CD

v1 deployed with `kubectl apply -k` from CI using the `:latest` tag, with no canary and no defined rollback (review H5). This replaces that.

---

## 1. Environments

| Environment | Purpose | Data | Scale |
|---|---|---|---|
| **local** | Development | Seeded | Docker Compose, single instances |
| **preview** | Per-PR, ephemeral | Seeded | 1 replica, shared infra, auto-deleted on merge |
| **staging** | Pre-production, load and chaos | Generated at production scale | ~30% of production |
| **production** | — | Real | Per component docs |

Staging runs the **same manifests** as production with different values — including PgBouncer, Redis in cluster mode, and multi-broker Kafka. A staging environment that is architecturally simpler than production validates a system that does not exist (risk R5).

**No production data in lower environments, ever.** Load tests use generated data.

---

## 2. Build

Multi-stage, distroless, non-root:

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod=false

FROM deps AS build
COPY . .
ARG APP
RUN pnpm turbo build --filter=${APP} && pnpm deploy --filter=${APP} --prod /out

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
COPY --from=build /out .
USER nonroot
ENV NODE_ENV=production
CMD ["dist/main.js"]
```

- **Distroless**: no shell, no package manager, non-root. An RCE foothold has nothing to pivot with.
- `--frozen-lockfile`: the lockfile is authoritative; CI never resolves a different tree than a developer did.
- **Images are tagged by digest.** `:latest` is banned — it makes rollouts non-reproducible and rollback meaningless.
- Layers ordered so a source change does not invalidate the dependency layer.

---

## 3. CI

```yaml
on: [pull_request, push: [main]]

jobs:
  static:      # ~2 min
    - pnpm install --frozen-lockfile
    - pnpm turbo lint typecheck        # eslint + tsc --noEmit, strict
    - pnpm turbo format:check
    - buf lint && buf breaking --against 'main'
    - gitleaks detect
    - check-migrations.sh              # unsafe DDL patterns (data-management §2)

  unit:        # ~3 min, no I/O
    - pnpm turbo test:unit -- --coverage

  integration: # ~8 min, Testcontainers
    - pnpm turbo test:integration      # Postgres behind PgBouncer, Redis cluster, Redpanda

  contract:
    - openapi-diff committed-spec generated-spec
    - assert event schema registry compatibility

  build:
    - docker buildx build --push (digest output)
    - trivy image --exit-code 1 --severity HIGH,CRITICAL
    - syft (SBOM) && cosign sign

  e2e:         # main only, ~10 min
    - deploy to preview, run the full user journey
```

**Every job is a merge gate.** A build that lints but does not run `buf breaking` will ship a breaking contract change; a build without integration tests through PgBouncer will ship code that fails only under production pooling.

Turborepo caches by content hash, so a PR touching one service runs one service's tests. Total PR feedback: ~8 minutes with a warm cache.

---

## 4. CD — GitOps

```
merge to main
  → CI builds and pushes image@digest
  → CI opens a PR against the deploy repo updating the digest for staging
  → auto-merged → Argo CD syncs staging
  → smoke tests
  → a promotion PR to production is opened, requiring human approval
  → Argo CD syncs production via Argo Rollouts canary
```

Argo CD reconciles cluster state from git continuously. Benefits over push-based deploys: drift is detected and corrected, the deployed state is auditable from git history, and **CI never holds cluster credentials**.

### Canary

```yaml
strategy:
  canary:
    steps:
      - setWeight: 10
      - pause: { duration: 5m }
      - analysis: { templates: [error-rate, latency-p99] }
      - setWeight: 50
      - pause: { duration: 10m }
      - analysis: { templates: [error-rate, latency-p99] }
      - setWeight: 100
    analysis:
      # abort automatically if the canary is worse than the baseline
      errorRate: < 1%      p99: < 1.2× baseline
```

Automated analysis is what makes canary meaningful. A canary nobody watches is a slower deploy, not a safer one.

### Rollback

| Trigger | Action | Time |
|---|---|---|
| Canary analysis fails | Automatic abort, traffic returns to stable | < 1 min |
| Manual | `argo rollouts undo` or revert the digest commit | < 2 min |
| Bad migration | Blocked before rollout — the migration Job must succeed first | n/a |

Digest pinning is what makes rollback deterministic: reverting the commit reverts to a byte-identical image.

---

## 5. Migrations in the pipeline

```
1  migration Job runs to completion  → rollout blocked on failure
2  new pods roll out
3  old and new pods run concurrently ← the reason expand/contract is mandatory
```

Because step 3 is unavoidable, every migration must be compatible with both the previous and the next version of the code (data-management §2). This is the single most common source of deploy-time incidents, and the CI check for unsafe DDL exists specifically to catch it at review time.

---

## 6. Scaling configuration

```yaml
# Request-serving
hpa:
  minReplicas: 3, maxReplicas: 12
  metrics:
    - cpu: 70%
    - custom: http_requests_per_second > 600 per pod

# Kafka consumers — lag, not CPU
keda:
  triggers:
    - type: kafka
      lagThreshold: "1000"
      topic: social.post.v1
      consumerGroup: timeline-fanout
  minReplicaCount: 1
  maxReplicaCount: 24        # == partition count; more replicas do nothing

# WebSocket
hpa:
  metrics:
    - custom: websocket_active_connections > 12000 per pod
```

Three different scaling signals for three different workloads (ADR-0013). CPU-scaling a consumer blocked on a downstream call never triggers; CPU-scaling a WebSocket server runs out of memory first.

The `maxReplicaCount: 24` cap is not arbitrary — a consumer group cannot exceed its topic's partition count, and configuring more replicas just creates idle pods that still consume cluster resources.

---

## 7. Configuration and secrets

| Type | Source |
|---|---|
| Non-secret config | ConfigMap from Helm values |
| Secrets | External Secrets Operator ← cloud secret manager |
| Feature flags | ConfigMap, hot-reloaded |
| Rate limits | ConfigMap, hot-reloaded |

Rate limits and feature flags being hot-reloadable matters during an incident: tightening a limit under a credential-stuffing wave should not require a deploy.

Config changes go through the same git review and Argo sync as code. A ConfigMap change is a deploy.

---

## 8. Release process

| Type | Approval | Cadence |
|---|---|---|
| Patch (fix) | Automated after CI | Continuous |
| Minor (feature) | One reviewer + canary | Daily |
| Migration | Reviewer + DBA review | Scheduled, low traffic |
| Breaking API | Architecture review + deprecation period | Rare |
| Hotfix | On-call approval, expedited canary | As needed |

Freeze windows during major incidents and on Fridays after 15:00 for anything but hotfixes.

---

## 9. Local development

```bash
pnpm install
docker compose up -d          # postgres + pgbouncer + redis cluster + redpanda + es + otel
pnpm db:migrate && pnpm db:seed
pnpm dev                      # all services with watch mode
pnpm dev --filter=post-service
```

Compose mirrors production topology — PgBouncer in front of Postgres, Redis in cluster mode, a real broker — because the failure modes that matter (cross-slot errors, transaction-pooling violations, consumer rebalances) do not reproduce on simplified infrastructure.

`pnpm seed` produces the deterministic dataset in data-management §8, including a large account, a private account, and a blocked pair.

---

## 10. Cluster layout

```
namespaces:
  social-prod        application workloads
  social-data        Kafka, Redis, Elasticsearch (StatefulSets)
  observability      OTel collector, Prometheus, Grafana, Tempo, Loki
  argocd · linkerd · cert-manager · external-secrets
```

Postgres is a **managed cloud service**, not a StatefulSet. Running Postgres on Kubernetes is a specialist undertaking, and the failover, backup, and PITR guarantees in `data-management.md` §5 are exactly what a managed service provides and a self-managed one has to earn.

Node pools: general (services), memory-optimised (Redis, Elasticsearch), spot (preview environments only).

---

## 11. Cost controls

- Preview environments auto-delete on merge, and after 3 days regardless.
- Spot instances for preview and CI runners.
- Requests sized from observed p95 usage, reviewed monthly — over-requesting is the most common source of cluster cost.
- Log sampling for high-volume `info` lines.
- Tail-based trace sampling (all errors, 1% otherwise).
- Monthly cost review against the capacity model, with per-namespace attribution.
