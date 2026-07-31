# Kubernetes manifests (minimal)

Skeleton Deployments/Services for Nest apps. **Infrastructure** (Postgres, Redis, Kafka, ES) is assumed to exist in-cluster or as managed services — point `social-config` at real endpoints.

## Apply

```bash
# Build/push images to your registry, then retag in apps.yaml (or use kustomize).
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/apps.yaml
```

## Config

Edit `configmap.yaml` before production:

- `DATABASE_URL`, `REDIS_URL`, `KAFKA_BROKERS`, `ELASTICSEARCH_URL`
- `REALTIME_SERVICE_TOKEN` (use a Secret in real deploys)
- JWT issuer / JWKS URL if the public hostname differs

## Probes

| Probe | Path | Behavior |
|---|---|---|
| liveness | `/health/live` | Process up |
| readiness | `/health/ready` | **503** when all dependency probes are down |

Kafka is a **soft** probe on producers (degraded when down, still ready for HTTP).

## Not included (yet)

- Ingress / TLS
- HPA / PDB
- Secrets Manager integration
- NetworkPolicies
- Infra operators (Strimzi, CloudNativePG, etc.)
