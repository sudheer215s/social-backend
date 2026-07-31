# Kubernetes manifests

Deployments, Services, Secrets, HPA, PDB, and Ingress for Nest apps.
**Infrastructure** (Postgres, Redis, Kafka, ES) is assumed to exist — point config/secrets at real endpoints.

## Apply

```bash
# Build/push images to your registry; retag in apps.yaml (or use kustomize images:)
kubectl apply -k deploy/k8s/
# equivalent:
# pnpm k8s:apply
```

## Layout

| File                 | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `namespace.yaml`     | `social` namespace                                    |
| `configmap.yaml`     | Non-secret config (service URLs, Kafka brokers, …)    |
| `secrets.yaml`       | `DATABASE_URL`, `REDIS_URL`, `REALTIME_SERVICE_TOKEN` |
| `apps.yaml`          | Deployments + Services (8 apps)                       |
| `hpa.yaml`           | HPA for gateway, realtime, identity                   |
| `pdb.yaml`           | PodDisruptionBudgets (minAvailable: 1)                |
| `ingress.yaml`       | NGINX Ingress + TLS (api host)                        |
| `kustomization.yaml` | Single `kubectl apply -k` entrypoint                  |

## Secrets

`secrets.yaml` ships **placeholder** values for local clusters only.

Production:

```bash
kubectl -n social create secret generic social-secrets \
  --from-literal=DATABASE_URL='postgres://…' \
  --from-literal=REDIS_URL='redis://…' \
  --from-literal=REALTIME_SERVICE_TOKEN='…' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Prefer ExternalSecrets / SealedSecrets / cloud secret manager so credentials never live in git.

## Ingress & TLS

- Default host: `api.social.example.com` (edit `ingress.yaml`)
- Class: `nginx`
- TLS secret: `social-tls`
- `/v1/realtime/stream` and `/v1/realtime/ws` → **realtime-gateway** (long timeouts + Upgrade headers)
- All other paths → **api-gateway** (including `POST /v1/realtime/ticket`)

```bash
kubectl -n social create secret tls social-tls --cert=fullchain.pem --key=privkey.pem
```

## Probes

| Probe     | Path            | Behavior                                    |
| --------- | --------------- | ------------------------------------------- |
| liveness  | `/health/live`  | Process up                                  |
| readiness | `/health/ready` | **503** when all dependency probes are down |

Kafka is a **soft** probe on producers (status `degraded`, still ready for HTTP).

## HPA

Requires [metrics-server](https://github.com/kubernetes-sigs/metrics-server).
Realtime scales primarily on **memory** (connection cost); gateway on CPU/memory.

## Not included (yet)

- NetworkPolicies
- Service mesh / mTLS
- Infra operators (Strimzi, CloudNativePG, …)
- Custom metrics (Kafka lag, websocket_active_connections)
- cert-manager ClusterIssuer (annotation stub only)
