# API Conventions

Binding on every public endpoint. v1 defined routes but no conventions (review G2), which is how error shapes, pagination styles, and cursor formats diverge across a team.

---

## 1. Versioning

`/v1/...` in the path. A new major version is a new prefix served alongside the old.

| Change | Breaking? |
|---|---|
| Add an optional request field | No |
| Add a response field | No — **clients must ignore unknown fields** |
| Add an enum value | **Yes** for enums clients switch on; treat as breaking unless the field is documented as open |
| Remove or rename a field | Yes |
| Tighten validation | Yes |
| Change a default | Yes |

Deprecation: `Deprecation: true` and `Sunset: <HTTP-date>` headers, minimum 90 days, with usage metrics per deprecated field so sunset is a measurement rather than a guess.

---

## 2. Errors — RFC 9457

`Content-Type: application/problem+json` on every non-2xx.

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "content must be between 1 and 280 characters",
  "instance": "/v1/posts",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [{ "field": "content", "code": "max_length", "message": "..." }]
}
```

`traceId` is present on every error, including 500s. It is what turns a user-reported failure into a single trace lookup.

| Status | Use |
|---|---|
| 400 | Malformed syntax |
| 401 | Missing/invalid/expired credentials |
| 403 | Authenticated but not permitted — **only when existence is not a secret** |
| 404 | Not found, or exists but the caller may not know it does |
| 409 | Conflict (duplicate username, idempotency key in flight) |
| 422 | Well-formed but semantically invalid |
| 429 | Rate limited — always with `Retry-After` |
| 503 | Dependency unavailable — always with `Retry-After` |

**404 over 403 for resource visibility.** A `403` on a private post confirms the post exists. Anywhere existence is itself information — private accounts, blocked users, other people's drafts — the answer is `404`.

Internal exception messages never reach clients. `500` carries a generic `detail` plus the trace ID; the real message goes to logs.

---

## 3. Pagination

**Cursor-based everywhere.** No `page`/`offset` on any collection endpoint: offsets skip and duplicate items when the underlying set changes mid-scroll, and they degrade quadratically at depth (review G3).

```
GET /v1/timelines/home?limit=20&cursor=MDE5MGYyYzEt...
```
```json
{
  "data": [ ... ],
  "page": { "next_cursor": "MDE5MGYyYzIt...", "has_more": true }
}
```

| Rule | Value |
|---|---|
| `limit` default / max | 20 / 100 |
| Cursor | **Opaque**, base64url. Clients must not parse or construct one |
| `has_more` | Always present |
| End of results | `next_cursor: null`, `has_more: false` |
| Invalid cursor | 400 |

Opacity is enforced now, while cursors are simply post IDs, so that adding ranking later (ADR-0016) is not a breaking change.

---

## 4. Idempotency

Required on `POST /v1/posts`, `/replies`, `/repost`. Honoured wherever supplied.

```
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

| Situation | Response |
|---|---|
| First use | Executed; response cached 24 h |
| Replay, same body | Cached response + `Idempotent-Replay: true` |
| Replay, different body | 422 |
| Concurrent replay | 409 + `Retry-After: 1` |
| Missing on a required endpoint | 400 |

State-assertion endpoints use `PUT`/`DELETE` and need no key — `PUT /v1/posts/{id}/like` is idempotent by HTTP semantics, which is why it is a `PUT` rather than a `POST`.

---

## 5. Headers

### Request
| Header | Notes |
|---|---|
| `Authorization: Bearer <jwt>` | |
| `Idempotency-Key` | §4 |
| `traceparent` | W3C; generated if absent |
| `Accept-Language` | Notification rendering |
| `X-Client-Version` | Client-side deprecation telemetry |

### Response
| Header | Notes |
|---|---|
| `X-Request-Id` | Always |
| `RateLimit-Limit` / `-Remaining` / `-Reset` | Always |
| `Retry-After` | On 429 and 503 |
| `X-Degraded` | Comma-separated list of degraded subsystems |
| `Deprecation` / `Sunset` | On deprecated endpoints |

`X-Degraded` is part of the contract, not a debug artefact: it lets a client distinguish "no results" from "we could not check" and surface that honestly.

---

## 6. Data formats

| Type | Format |
|---|---|
| IDs | UUID string, lowercase |
| Timestamps | RFC 3339 UTC with `Z` — `2026-07-31T10:30:00Z` |
| Durations | Integer seconds, suffixed (`expires_in_seconds`) |
| Counts | Integers. `null` means unknown, never `-1` |
| Enums | `lower_snake_case` strings, never numbers |
| Empty collections | `[]`, never `null` |
| Absent optional | Field omitted, or `null` — consistent per field, documented |
| Money | Not applicable in v2 |

Field naming is `snake_case` in JSON (matching the protos) and `camelCase` in TypeScript, converted at the serialisation boundary — one conversion point, not a per-handler decision.

---

## 7. Validation

- DTOs validated with `whitelist: true` and `forbidNonWhitelisted: true`: unknown fields are rejected, not silently dropped. Silent dropping is how a client ships a typo'd field name and discovers months later that the setting never applied.
- Strings NFKC-normalised before length checks; **lengths counted in graphemes**, not UTF-16 units (post-service §3).
- Bodies capped at 100 KB; arrays capped explicitly per field.
- Every error names the offending field with a machine-readable `code`.

---

## 8. Authentication

`Authorization: Bearer <access-token>`, verified against cached JWKS. Never in a query string, never in a cookie for the API surface. WebSocket uses the ticket exchange (realtime-gateway §2) precisely because browsers cannot set the header — the exception proves the rule rather than weakening it.

---

## 9. Rate limit responses

```
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 30
RateLimit-Remaining: 0
RateLimit-Reset: 1753900800
Retry-After: 42
```
```json
{ "type": ".../rate-limited", "title": "Rate limit exceeded", "status": 429,
  "detail": "Too many posts. Try again in 42 seconds.", "traceId": "..." }
```

Rate-limit headers appear on **successful** responses too, so well-behaved clients can pace themselves instead of discovering the limit by hitting it.

---

## 10. OpenAPI

Generated from decorators, committed to the repo, and **diffed in CI** — an undeclared breaking change fails the build. `GET /v1/openapi.json` serves it; Swagger UI is available in non-production only.

Every endpoint documents: purpose, auth requirement, rate-limit category, request/response schemas, every error status it can return, and an example. "Every error status it can return" is the field most often omitted and most often needed.
