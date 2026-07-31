# Argo CD GitOps

## Install Argo CD (once)

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

## Register apps

```bash
# Edit repoURL in the Application manifests if forked
kubectl apply -f deploy/argocd/application-dev.yaml
kubectl apply -f deploy/argocd/application-prod.yaml
```

Or:

```bash
pnpm argocd:apply
```

## Paths

| Application | Path | Sync |
|---|---|---|
| `social-backend-dev` | `deploy/k8s/overlays/dev` | auto prune + self-heal |
| `social-backend-prod` | `deploy/k8s/overlays/prod` | manual (no auto sync) |

`Deployment.spec.replicas` is ignored so HPA/KEDA can own scale.

## Flow

```
git push main
  → Argo detects (poll/webhook)
  → sync overlay
  → ExternalSecret (prod) materializes social-secrets
  → Deployments roll
```
