# Kubernetes manifests

Deployments, Services, Secrets, HPA, PDB, Ingress, and NetworkPolicies for Nest apps.
**Infrastructure** (Postgres, Redis, Kafka, ES) is assumed to exist — point config/secrets at real endpoints.

## Apply

```bash
# Base (defaults)
kubectl apply -k deploy/k8s/
# or
pnpm k8s:apply

# Dev overlay (1 replica, local image tags, api.social.local)
kubectl apply -k deploy/k8s/overlays/dev
pnpm k8s:apply:dev

# Prod overlay (registry images, cert-manager, Always pull)
# Edit overlays/prod/kustomization.yaml images: first
kubectl apply -k deploy/k8s/overlays/prod
pnpm k8s:apply:prod

# TLS issuers (once per cluster; requires cert-manager)
kubectl apply -f deploy/k8s/cert-manager/cluster-issuers.yaml
```

## Layout

| Path                    | Purpose                                 |
| ----------------------- | --------------------------------------- |
| `namespace.yaml`        | `social` namespace                      |
| `configmap.yaml`        | Non-secret config                       |
| `secrets.yaml`          | DB/Redis/token placeholders             |
| `apps.yaml`             | Deployments + Services                  |
| `hpa.yaml` / `pdb.yaml` | Autoscaling + disruption budgets        |
| `ingress.yaml`          | NGINX + TLS host                        |
| `networkpolicies.yaml`  | Default-deny ingress + allow lists      |
| `cert-manager/`         | Let's Encrypt ClusterIssuers            |
| `overlays/dev`          | Local/small-cluster patches             |
| `overlays/prod`         | Registry tags + cert-manager annotation |

## NetworkPolicies

| Policy                    | Effect                                       |
| ------------------------- | -------------------------------------------- |
| `default-deny-ingress`    | No ingress unless allowed                    |
| `allow-same-namespace`    | App ↔ app inside `social`                    |
| `allow-dns-egress`        | UDP/TCP 53 → `kube-system`                   |
| `allow-ingress-nginx`     | Ingress controller → gateway + realtime      |
| `allow-data-plane-egress` | Egress to PG/Redis/Kafka/ES/OTLP/HTTPS ports |

Tighten `allow-data-plane-egress` to known CIDRs when using managed cloud services.

## Secrets

`secrets.yaml` is for **local clusters only**. Production:

```bash
kubectl -n social create secret generic social-secrets \
  --from-literal=DATABASE_URL='postgres://…' \
  --from-literal=REDIS_URL='redis://…' \
  --from-literal=REALTIME_SERVICE_TOKEN='…' \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Ingress & TLS

- Default host: `api.social.example.com` (dev overlay: `api.social.local`)
- `/v1/realtime/stream|ws` → realtime-gateway
- `/` → api-gateway
- Prod overlay adds `cert-manager.io/cluster-issuer: letsencrypt-prod`

## Probes

| Probe     | Path            | Behavior                                    |
| --------- | --------------- | ------------------------------------------- |
| liveness  | `/health/live`  | Process up                                  |
| readiness | `/health/ready` | **503** when all dependency probes are down |

## Not included (yet)

- Service mesh / mTLS
- Infra operators (Strimzi, CloudNativePG, …)
- Custom HPA metrics (Kafka lag, active WebSockets)
- ExternalSecrets operator CRDs
