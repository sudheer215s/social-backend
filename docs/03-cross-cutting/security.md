# Security Design

Covers authentication, authorization, transport, secrets, abuse, and privacy. v1 designed authentication and almost no authorization — `private_account` existed in the schema and was enforced nowhere (review F1). This document closes that gap and the related ones (F2–F11).

---

## 1. Threat model

| Actor | Capability | Primary mitigations |
|---|---|---|
| Anonymous internet | Public endpoints, enumeration, credential stuffing | Rate limits, anti-enumeration, WAF, argon2id |
| Authenticated user | Own credentials; may attempt to read others' data | Authorization at the data owner; ownership in `WHERE` predicates |
| Compromised token | A stolen access or refresh token | 10-min access lifetime; rotating refresh with reuse detection |
| Compromised service pod | Network access inside the cluster | mTLS, per-service DB roles, default-deny NetworkPolicy |
| Malicious insider | Repo and pipeline access | Code review, signed images, audit logs, no prod secrets in CI |
| Abusive user | Legitimate credentials, harmful behaviour | Velocity limits, blocking, reporting, suspension |

**Out of scope for v2:** DDoS volumetrics (CDN/WAF concern), physical security, supply-chain attacks beyond dependency scanning and image signing.

---

## 2. Authentication

Fully specified in [`identity-service.md`](../02-components/identity-service.md) §3. Summary of what v1 lacked:

| Control | v1 | v2 |
|---|---|---|
| Password hashing | bcrypt cost 12 | **argon2id** (m=19456, t=2, p=1) — bcrypt silently truncates at 72 bytes |
| Access token | RS256, no `kid`/`aud`/`jti` | **EdDSA**, full claim set, 10 min |
| Key rotation | Stated, no mechanism | JWKS, two live keys, 90-day rotation |
| Refresh token | 7 days, non-rotating | 30 days, **rotating with reuse detection** |
| Token issuer | API gateway | **identity-service** (gateway only verifies) |
| Revocation | None | Session, family, and all-sessions revocation |
| Login lockout | Not specified | 10 failures → 15-min lock, per-IP **and** per-account limits |

The two controls that matter most: **reuse detection** turns refresh-token theft from undetectable into detected-within-one-cycle, and **moving issuance to identity-service** keeps the signing key out of the most exposed, highest-replica component.

---

## 3. Authorization

### Principles
1. **Enforced by the data owner.** The gateway is defence in depth; a gateway bug must not expose data.
2. **Deny by default.** No matching allow rule ⇒ `404`.
3. **Rules are shared code, not duplicated logic** — `libs/platform-authz`, table-tested.

### Post visibility
```
canViewPost(viewer, post, author) :=
     post.deleted_at IS NULL
  ∧  author.status = 'active'
  ∧  ¬blocked(author → viewer) ∧ ¬blocked(viewer → author)
  ∧  (author.visibility = 'public' ∨ viewer = author ∨ follows(viewer → author))
```
Applied at: direct post read, timeline hydration, search post-filter, notification rendering, thread reads.

### Ownership
Mutations put ownership **in the predicate**, never in a preceding read:
```sql
UPDATE posts SET deleted_at = now()
 WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL;
-- rowcount 0 → 404
```
A read-then-write is a TOCTOU race and leaks existence through the error path. This form does neither.

### Roles
`user` (default), `moderator` (delete any post, suspend accounts), `admin` (moderator + account operations). Role changes are audit-logged with actor, target, and reason. No admin UI in v2 — operations run through an audited CLI against the same gRPC surface.

---

## 4. Transport and network

| Hop | Protection |
|---|---|
| Client → ingress | TLS 1.3, HSTS `max-age=63072000; includeSubDomains; preload` |
| Ingress → gateway | Cluster-internal, mTLS via mesh |
| Service → service | **mTLS**, SPIFFE identities issued by the mesh |
| Service → Postgres | TLS, `verify-full` |
| Service → Redis / Kafka | TLS + SASL/SCRAM |

**mTLS is delivered by a service mesh (Linkerd), not by hand.** v1 specified "certificate rotation: 90 days" with no mechanism (review F8); manual rotation across eight services does not happen, and the first missed rotation is an outage. The mesh rotates identities every 24 h automatically, which is both stronger and less work.

### NetworkPolicy — default deny
```yaml
# Nothing talks to anything unless explicitly allowed.
- deny all ingress and egress in the namespace
- allow gateway → domain services (gRPC port)
- allow domain services → their own datastores
- allow all → OTel collector
- deny domain service → domain service, except the five edges in system design §5.2
```
The last line is the valuable one: it makes the dependency DAG a *runtime* constraint. An accidental new synchronous dependency fails in staging rather than quietly becoming architecture.

### Security headers
Helmet with: CSP `default-src 'none'` (it is a JSON API), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, no `X-Powered-By`. CORS allow-lists exact origins — never `*` with credentials.

---

## 5. Secrets

v1 planned a committed `k8s/base/secrets.yaml` (review F7). Kubernetes Secrets are base64-encoded, not encrypted; committing them is a credential leak that survives in git history forever.

| Secret | Storage | Rotation |
|---|---|---|
| DB credentials | External Secrets Operator ← cloud secret manager | 90 days, automated |
| JWT signing keys | Secret manager; loaded at boot, never on disk | 90 days, overlapping (identity-service §3) |
| Kafka/Redis credentials | ESO | 180 days |
| Third-party API keys | ESO | Per provider |
| TLS certificates | cert-manager | Automatic |

Rules: no secret in an image, a ConfigMap, an env var in a manifest, or a log. CI has no production secrets — deployment is pull-based via Argo CD (ADR-0013), so the pipeline never holds cluster credentials. `gitleaks` runs pre-commit and in CI.

---

## 6. Input handling

| Input | Control |
|---|---|
| All bodies | Schema-validated, unknown fields rejected, 100 KB cap |
| Text | NFKC normalisation, grapheme-accurate length, control characters stripped |
| Usernames | `^[a-zA-Z0-9_]{3,30}$`, reserved-word list (`admin`, `me`, `api`, `support`…) |
| SQL | Parameterised exclusively; string interpolation into SQL fails ESLint |
| `media_refs` | **Opaque IDs, never URLs** — the backend never dereferences user-supplied URLs |
| Search queries | Length-capped, ES query DSL constructed programmatically, never from user strings |
| Redis keys | Never contain raw user input without hashing |

The reserved-username list is small but load-bearing: `/v1/users/by-username/me` resolving to a real account is a confusing security surface, and `admin` is an impersonation vector.

**No HTML sanitisation of post content, deliberately.** Content is stored as plain text and returned as plain text in JSON; escaping is the client's rendering responsibility. Server-side sanitisation of text that is never rendered as HTML by the server creates false confidence and mangles legitimate input (`<3`, code snippets).

---

## 7. Abuse and rate limiting

Limits are in [`api-gateway.md`](../02-components/api-gateway.md) §4. Beyond simple limits:

| Vector | Control |
|---|---|
| Credential stuffing | Per-IP **and** per-account login limits; account lockout; breach-password check on registration |
| Account enumeration | Identical responses and timings for unknown vs wrong password; `202` always on password reset |
| Spam posting | Verified email required to post; velocity limits; duplicate-content detection within a window |
| Follow churn | 100 follows/day; ratio heuristics flag for review |
| Scraping | Anonymous limits per IP; deep pagination capped at 1,000 |
| Mention spam | 10 mentions/post; notification suppression for muted/blocked actors |
| Report abuse | Rate-limited; repeat false reporters deprioritised |

Requiring email verification before posting is the highest-leverage anti-spam control here — it costs a legitimate user one click and costs a bulk-registration operation an email infrastructure.

---

## 8. Privacy

| Data | Classification | Handling |
|---|---|---|
| Email | PII | Never in events, logs, search index, or JWT claims |
| Password hash | Secret | Separate table; never in a profile query |
| IP address | PII | **Hashed** before storage; raw only in short-retention access logs |
| Session metadata | PII | Deleted 7 days after expiry |
| Post content | User content | Public or followers-only per author |
| Behaviour (likes, follows) | Sensitive | Not exposed beyond what the product surfaces |

**Keeping PII out of Kafka is a deliberate architectural choice** (system design §8.6): events carry identifiers, consumers fetch profile fields. Without it, erasure would require crypto-shredding with per-user keys — complexity in every consumer, forever. The one exception, `social.user.v1`, is log-compacted so tombstones express erasure.

Log redaction is enforced in the serialiser (`platform-telemetry`), not at call sites, because one careless `logger.info({ user })` defeats a hundred careful ones.

Right to erasure is the staged flow in system design §8.6. Data export (`GET /v1/users/me/export`) is a job producing a signed, time-limited download.

---

## 9. Supply chain

| Control | Tool |
|---|---|
| Dependency CVEs | `pnpm audit` + Dependabot; build fails on high/critical |
| Container CVEs | Trivy on every image; fail on high/critical |
| SBOM | Syft, attached to each release |
| Image signing | cosign; the cluster admits only signed images |
| Base image | `gcr.io/distroless/nodejs22` — non-root, no shell |
| Lockfile | Committed; `--frozen-lockfile` in CI |
| Provenance | SLSA build attestations |

Distroless with no shell means a remote-code-execution foothold has no `sh`, `curl`, or package manager to pivot with — a meaningful reduction in blast radius for a small change.

---

## 10. Audit logging

Separate stream, 1-year retention, append-only:

- Authentication: login success/failure, logout, password change, **token reuse detection**
- Authorization: every denial (with reason — logged, never returned)
- Admin: role changes, suspensions, moderator deletions, with reason
- Data: erasure requests and completions, export requests
- Config: secret rotation, deployment of a new signing key

Entries carry actor, target, action, result, IP hash, trace ID, timestamp. Sensitive values are never included — the audit log records *that* a password changed, never the password.

---

## 11. Incident response

| Scenario | Immediate action |
|---|---|
| Signing key compromised | Rotate `kid`, revoke all sessions, force re-auth. ~10 min to full effect |
| Refresh token reuse detected | Automatic: family revoked, alert raised |
| Credential stuffing wave | Tighten per-IP limits (config, no deploy), enable CAPTCHA on login |
| Data exposure | Assess scope from audit logs and traces; revoke; notify per policy |
| Malicious insider commit | Revert, rotate all secrets, audit the deployment history |

Each has a runbook in `docs/runbooks/`. The security controls above are only as good as the rehearsal — key rotation and session revocation are drilled quarterly, because a control first exercised during an incident is a control that does not work.

---

## 12. Verification

- **Automated:** dependency and container scanning per build; `gitleaks`; ESLint rules banning SQL interpolation and unparameterised queries.
- **Tests:** authorization matrix (every viewer/author/relationship combination); login timing equivalence for unknown-email vs wrong-password; reset-token single-use; log-redaction assertions; NetworkPolicy enforcement in a staging soak.
- **Manual:** threat-model review each time a component is added; penetration test before public launch; quarterly access review.
