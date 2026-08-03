# Frontend Security

The browser is a hostile runtime: the user controls it, extensions inject into it, and any script that executes has the full authority of the session. Frontend security is therefore about **limiting what a successful XSS can steal**, not about preventing every XSS.

---

## 1. Threat model

| Threat                            | Vector                                          | Mitigation                                                              |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| **Token theft via XSS**           | Injected script reads storage                   | Access token in memory only; refresh token `httpOnly` (§2)              |
| XSS                               | User content, dependencies, third-party scripts | CSP, no `dangerouslySetInnerHTML`, dependency scanning                  |
| CSRF                              | Cross-site request to a cookie-authed endpoint  | Bearer tokens for the API; `SameSite=Strict` on the one cookie endpoint |
| Clickjacking                      | Framing the app                                 | `frame-ancestors 'none'`                                                |
| Session leakage on shared devices | Persisted cache outliving logout                | Cache busted by user ID; cleared on logout                              |
| Enumeration via UI                | Distinct "private"/"blocked" states             | Uniform 404 rendering                                                   |
| Supply chain                      | Compromised npm package                         | Lockfile, SRI, scanning, minimal dependencies                           |
| Data leakage to third parties     | Analytics/error reporters capturing PII         | Scrubbing before egress (§6)                                            |

The first row dominates. Everything else is standard hygiene; that one is architectural.

---

## 2. Token handling

Specified in FE-0005; restated here because it is the core control.

| Token             | Storage                                                                       | Reachable by JS?               |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| Access (10 min)   | Module-private variable in `api-client`                                       | Yes — deliberately short-lived |
| Refresh (30 days) | `httpOnly; Secure; SameSite=Strict` cookie, path-scoped to `/v1/auth/refresh` | **No**                         |

**Why this specific split.** The backend detects refresh-token reuse and revokes the whole session family (`identity-service.md` §3). That control only has value if the attacker and the user cannot both hold a working token. A refresh token in `localStorage` is readable by any injected script, which means:

1. The attacker steals a 30-day credential.
2. Reuse detection fires, revoking the family.
3. The **user** is logged out; the attacker simply re-steals on the next login.

A rotating refresh token in JS-readable storage is barely better than a non-rotating one. Putting it in an `httpOnly` cookie is what makes rotation meaningful.

An XSS can still call the API using the in-memory access token for up to 10 minutes — that is the residual risk, and it is bounded, which is the point.

> **Backend dependency.** As currently specified, `POST /v1/auth/refresh` takes the token in the request body. The cookie mode is an additive change requested in [`06-review.md`](../06-review.md) F1. **Until it ships, this control does not exist**, and no frontend workaround provides it.

### Not permitted, anywhere

`localStorage`/`sessionStorage` for tokens · tokens in URLs, query strings, or `postMessage` · tokens in a Zustand store, React context, or any devtools-visible location · tokens in log lines, breadcrumbs, or error reports.

---

## 3. Content Security Policy

```
default-src 'self';
script-src 'self' 'nonce-{random}' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' https://cdn.example.com data: blob:;
connect-src 'self' https://api.example.com wss://api.example.com https://otel.example.com;
font-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests;
```

`'strict-dynamic'` with a per-request nonce rather than a host allow-list: host allow-lists are routinely bypassed via JSONP endpoints or open redirects on allowed CDNs, and they rot as vendors change domains.

`style-src 'unsafe-inline'` is a concession to Tailwind's runtime style injection and Radix's positioning. It is a real weakening — CSS injection can exfiltrate via attribute selectors and background URLs — but the CSP is not the only control, and `img-src`/`connect-src` bound where anything can go.

CSP is deployed in report-only first, with violations collected for two weeks before enforcement.

---

## 4. XSS defence

**No `dangerouslySetInnerHTML`.** Enforced by an ESLint error with no permitted exceptions. Post content is plain text and rendered as text (`security.md` §6, backend).

**Rich text is constructed, never parsed.** Mentions, hashtags, and links inside post text are found by regex, and the segments are rendered as React elements. There is no HTML string anywhere in the pipeline:

```tsx
// segments: [{type:'text'}, {type:'mention', username}, {type:'link', href}]
{
  segments.map((s) =>
    s.type === 'mention' ? (
      <Link key={s.key} href={`/@${s.username}`}>
        @{s.username}
      </Link>
    ) : s.type === 'link' ? (
      <ExternalLink key={s.key} href={s.href}>
        {s.display}
      </ExternalLink>
    ) : (
      <span key={s.key}>{s.text}</span>
    ),
  );
}
```

**URL scheme validation.** Any user-influenced `href` is validated against `https:`/`http:` only — `javascript:`, `data:`, and `vbscript:` are rejected. React blocks `javascript:` in `href` in recent versions, but the check does not depend on that.

**External links** carry `rel="noopener noreferrer"` and `target="_blank"`, with an interstitial for non-allow-listed hosts.

**`media_refs` are opaque IDs, not URLs** (backend `post-service.md` §2), resolved to CDN URLs by us. The client never fetches a user-supplied URL — closing the SSRF-by-proxy and tracking-pixel vectors at the source.

---

## 5. Route-level authorization

The client's authorization is **UX, not security**. The backend enforces (`security.md` §3, backend); the client only avoids showing controls that would fail.

Consequences:

- Never gate on a client-side role check for anything that matters — the user can edit their own JS.
- Never fetch data the user cannot see and hide it with CSS.
- Never encode a permission decision in a bundled config.

**404 rendering is a security control.** Private posts, blocked users, and deleted content all return `404` by design so existence is not confirmed (`api-conventions.md` §2). The UI renders one identical not-found screen for all of them. A "this account is private" state reintroduces the leak through the front door — and, notably, would also leak it to any analytics tool recording the screen name.

---

## 6. Data leaving the browser

Every egress path is a potential PII leak, and the default behaviour of most tooling is to capture everything.

| Destination           | Scrubbing                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------- |
| OTel collector        | No request bodies; URL paths **templated** (`/v1/posts/{id}`), never raw; user ID hashed |
| Error reporting       | `beforeSend` strips tokens, emails, post content, and all headers                        |
| Web Vitals            | Metrics only; route templates only                                                       |
| Third-party analytics | **None used in v1**                                                                      |

Breadcrumbs are the classic leak: a naive fetch breadcrumb captures the full URL including a search query the user typed, and the request body of a post they were writing. Both are scrubbed at source.

Templated paths matter twice — for privacy, and because raw IDs in span names explode cardinality in exactly the way the backend's observability doc warns against.

---

## 7. Supply chain

| Control             | Mechanism                                                        |
| ------------------- | ---------------------------------------------------------------- |
| Lockfile            | Committed; `--frozen-lockfile` in CI                             |
| Vulnerabilities     | `pnpm audit` + Dependabot; high/critical fails the build         |
| New dependencies    | Justified in review — bundle cost, maintenance, transitive count |
| Third-party scripts | **None.** Fonts self-hosted, analytics self-hosted               |
| SRI                 | On any external resource, if one is ever added                   |

Self-hosting fonts is worth the small operational cost: a third-party font host sees every page view, every IP, and every referrer, and it is an executable-adjacent dependency inside the CSP.

---

## 8. Client storage inventory

Everything persisted, and why it is safe to persist:

| Key            | Store          | Contents                    | Cleared                             |
| -------------- | -------------- | --------------------------- | ----------------------------------- |
| `social-cache` | IndexedDB      | Timeline, profiles          | Logout, user change, version change |
| `draft:*`      | localStorage   | Post text + idempotency key | On publish or explicit discard      |
| `theme`        | localStorage   | `light`/`dark`/`system`     | Never                               |
| `rt-cursor`    | sessionStorage | Last notification ID        | Tab close                           |
| `scroll:*`     | sessionStorage | Feed offsets and heights    | Tab close                           |

No tokens. No emails. No settings that reveal account state.

**Drafts survive logout deliberately** — a user whose session expires mid-compose must not lose their writing. They contain only the user's own text, and they are scoped per user ID so a second user on the device cannot see them.

**The `buster` on the persisted cache includes the user ID.** Without it, a shared device shows the previous user's timeline for the first few hundred milliseconds after login — a privacy incident that never reproduces in development, because developers do not switch accounts on the same browser.

---

## 9. Verification

| Check                        | When                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| CSP violations               | Report-only in staging, dashboard-reviewed weekly                                            |
| `no dangerouslySetInnerHTML` | ESLint, every commit                                                                         |
| Token never in storage       | Unit test asserting `localStorage`/`sessionStorage` contain no token-like values after login |
| Cache cleared on logout      | E2E: log in, log out, log in as user B, assert no user A data                                |
| Scrubbing                    | Unit test on `beforeSend` with a payload containing an email, a token, and post content      |
| URL scheme validation        | Unit test with `javascript:`, `data:`, and `vbscript:` inputs                                |
| Dependency audit             | Every build                                                                                  |
| Penetration test             | Before public launch, jointly with the backend                                               |

The logout/user-switch E2E is the highest-value test here. It covers a real privacy failure, it is cheap to write, and it is the one nobody writes by default.
