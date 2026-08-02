# Kubernetes manifests

Deployments, Services, HPA, PDB, Ingress, NetworkPolicies, and optional ExternalSecrets / KEDA.

## Apply

```bash
# Base (no plaintext Secret — create social-secrets yourself or use ExternalSecrets)
kubectl apply -k deploy/k8s/
pnpm k8s:apply

# Dev (includes local secrets.yaml placeholders)
kubectl apply -k deploy/k8s/overlays/dev
pnpm k8s:apply:dev

# Prod (ExternalSecrets + registry images + cert-manager annotation)
# 1. Install External Secrets Operator + edit ClusterSecretStore provider
# 2. Pin image tags/digests in overlays/prod/kustomization.yaml
# 3. Apply cert-manager issuers, then prod overlay
pnpm k8s:issuers
pnpm k8s:secrets:eso   # ClusterSecretStore + ExternalSecret
pnpm k8s:apply:prod
```

## Secrets strategy

| Environment | How `social-secrets` is created                          |
| ----------- | -------------------------------------------------------- |
| **dev**     | `secrets.yaml` (placeholder DSNs) via overlay            |
| **prod**    | External Secrets Operator → remote store (AWS/GCP/Vault) |
| **manual**  | `kubectl create secret generic social-secrets …`         |

Keys required by apps:

- `DATABASE_URL`
- `REDIS_URL`
- `REALTIME_SERVICE_TOKEN`

Remote key conventions (prod ExternalSecret):

- `social/prod/database-url`
- `social/prod/redis-url`
- `social/prod/realtime-service-token`

## Layout

| Path                       | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `apps.yaml`                | Deployments + Services                     |
| `configmap.yaml`           | Non-secret config                          |
| `secrets.yaml`             | **Dev-only** placeholders                  |
| `external-secrets/`        | ClusterSecretStore + ExternalSecret        |
| `networkpolicies.yaml`     | Default-deny ingress + allow lists         |
| `cert-manager/`            | Let's Encrypt ClusterIssuers               |
| `components/keda-scaling/` | Optional Kafka lag / WS KEDA ScaledObjects |
| `overlays/dev`             | 1 replica, local tags, local secrets       |
| `overlays/prod`            | Registry tags, ESO, cert-manager           |

## Image digests (prod)

Prefer immutable digests over floating tags:

```bash
crane digest ghcr.io/example/social-gateway:1.0.0
# then in overlays/prod/kustomization.yaml:
# images:
#   - name: social-gateway
#     newName: ghcr.io/example/social-gateway
#     digest: sha256:…
```

See `overlays/prod/images-digests.example.yaml`.

## Optional KEDA

```bash
# After KEDA is installed:
kubectl apply -k deploy/k8s/components/keda-scaling
```

Examples scale notification/timeline on **Kafka consumer lag** and realtime on
`sum(websocket_active_connections)` (exported by realtime-gateway at `/metrics`).

## Monitoring

```bash
pnpm k8s:monitoring
```

| Endpoint            | Service          | Metrics                                                                             |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `GET /metrics`      | all HTTP apps    | `http_requests_total`, `http_request_duration_seconds`, `http_request_errors_total` |
| `GET /metrics`      | realtime-gateway | + `websocket_active_connections{transport}`, `realtime_tickets_issued_total`        |
| `GET /health/ready` | all apps         | readiness (ServiceMonitor / blackbox)                                               |

## GitOps

Argo CD Applications: `deploy/argocd/` — `pnpm argocd:apply`

## NetworkPolicies / Ingress / HPA

- `networkpolicies.yaml` — default-deny + allow lists
- `ingress.yaml` — NGINX, TLS, realtime path split
- `hpa.yaml` / `pdb.yaml` — CPU/memory HPA + disruption budgets

## Not included (yet)

- Service mesh mTLS
- Infra operators (Strimzi, CloudNativePG, …)
- Full HTTP RED metrics interceptor on all services
