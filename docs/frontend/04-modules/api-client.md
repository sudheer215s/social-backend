# Module — `api-client`

**Responsibility:** the only code in the application permitted to call `fetch`.
**Depends on:** `lib/telemetry`, generated OpenAPI types
**Consumed by:** `data/` only — never by features directly

---

## 1. Why it is a hard boundary

Six concerns must apply to **every** request, and each fails silently if skipped:

1. Bearer token attachment
2. Single-flight refresh on 401 (a mistake here logs users out — [`03-flows.md`](../03-flows.md) §4)
3. `Idempotency-Key` on required endpoints
4. `problem+json` → typed error normalisation
5. `traceparent` propagation for end-to-end tracing
6. `X-Degraded` and `RateLimit-*` header extraction

A single stray `fetch()` in a feature bypasses all six and nothing fails loudly. `no-restricted-globals: fetch` outside this module is therefore a lint **error**, not a warning (FE-0013).

---

## 2. Structure

```
api-client/
├── client.ts        request pipeline
├── auth.ts          token store, single-flight + cross-tab refresh
├── idempotency.ts   intent-scoped key resolution
├── errors.ts        problem+json → typed errors
├── headers.ts       degradation and rate-limit extraction
├── endpoints/       thin typed wrappers, one file per resource
└── generated/       openapi-typescript output — never hand-edited
```

---

## 3. Request pipeline

```
1  resolve URL and typed body from generated types
2  attach Authorization (unless the endpoint is public)
3  attach Idempotency-Key when the endpoint requires one
4  inject traceparent
5  apply an AbortSignal (caller's, or a default deadline)
6  fetch
7  extract X-Degraded and RateLimit-* → side channel
8  on 401 → refresh (§5) → retry once
9  on 5xx/network and method is idempotent → backoff retry ×2
10 non-2xx → throw a typed error (§6)
11 parse and return
```

### Deadlines, not timeouts

```ts
const DEADLINES = {
  default: 10_000,
  timeline: 15_000, // may take the deep-page path — timeline-service §4a
  search: 8_000,
  auth: 10_000,
  mutation: 20_000, // never abort a write early; see below
};
```

Aborting a mutation client-side does **not** abort it server-side. A `POST /v1/posts` cancelled at 5 s may still have committed, and the client cannot know. The generous mutation deadline plus idempotency keys makes the retry safe rather than duplicating — the two mechanisms only work together.

### Retry policy

| Condition                             | Retry                                            |
| ------------------------------------- | ------------------------------------------------ |
| `GET`, `HEAD`                         | Yes — 2 attempts, exponential + full jitter      |
| `PUT`, `DELETE` (like, follow, block) | Yes — idempotent by design (`api-gateway.md` §3) |
| `POST` **with** an idempotency key    | Yes — safe by construction                       |
| `POST` **without** one                | **No**                                           |
| 4xx (except 429)                      | Never                                            |
| 429                                   | Only after `Retry-After`                         |

Full jitter, not fixed backoff: a backend blip returning 503 to 200 concurrent clients otherwise produces a synchronised retry wave that prevents recovery. This mirrors the backend's own retry-budget reasoning (`platform-libraries.md`).

---

## 4. Token store

```ts
// module-private — deliberately not a store, not a context, not persisted
let accessToken: string | null = null;
let expiresAt = 0;

export const tokens = {
  get: () => (Date.now() < expiresAt ? accessToken : null),
  set: (t: string, ttlSec: number) => {
    accessToken = t;
    expiresAt = Date.now() + ttlSec * 1000 - 5_000;
  },
  clear: () => {
    accessToken = null;
    expiresAt = 0;
  },
  needsProactiveRefresh: () =>
    accessToken !== null && Date.now() > expiresAt - 60_000,
};
```

Not a Zustand store, not React context, not `localStorage`. Stores acquire devtools, get persisted "for convenience", and get serialised into error reports. A module-private variable behind a narrow accessor cannot.

The 5-second safety margin on expiry avoids a request racing the boundary and 401-ing for the sake of clock skew.

---

## 5. Refresh — the critical section

Full rationale in [`03-flows.md`](../03-flows.md) §4. The backend revokes the **entire session family** when a rotated refresh token is presented twice, so an uncoordinated refresh is not a performance problem — it is an unexplained logout for every active user, roughly every ten minutes.

```ts
let inFlight: Promise<boolean> | null = null;

export async function refresh(): Promise<boolean> {
  if (inFlight) return inFlight; // (1) in-tab single-flight
  inFlight = doRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(): Promise<boolean> {
  return withLock('auth-refresh', async () => {
    // (2) cross-tab lock
    if (tokens.get()) return true; // (3) another tab won — re-check!

    const res = await fetch('/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include', // httpOnly cookie — FE-0005
    });

    if (res.status === 401) {
      onSessionLost(await problem(res));
      return false;
    }
    if (!res.ok) throw new NetworkError(); // transient: do NOT log out

    const { access_token, expires_in } = await res.json();
    tokens.set(access_token, expires_in);
    channel.postMessage({ type: 'token-refreshed' }); // (4) tell other tabs
    return true;
  });
}
```

Line (3) is the one that is easy to omit and fatal to omit. The lock _serialises_ refreshes; it does not prevent the second one. Without the re-check, tab B acquires the lock after tab A finishes and refreshes anyway — presenting the token tab A just rotated. Serialised reuse is still reuse.

`withLock` uses `navigator.locks` where available and falls back to `BroadcastChannel` plus a jittered delay elsewhere; the re-check makes the fallback's residual race harmless.

### Session-loss classification

```ts
function onSessionLost(p: Problem) {
  tokens.clear();
  queryClient.clear();
  clearPersistedCache();
  // drafts are deliberately preserved
  session.set('anonymous', {
    reason: p.type.endsWith('token-reuse-detected') ? 'security' : 'expired',
  });
}
```

Reuse detection gets a distinct message ("You were signed out for your protection…"). It is rare and, when it happens, actionable — it may mean a real compromise.

**A network error must never clear the session.** Doing so signs users out every time they enter a tunnel. Only an explicit 401 does.

---

## 6. Errors

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem, // RFC 9457 body
    readonly traceId?: string,
  ) {
    super(problem.title);
  }

  get fieldErrors(): Record<string, string> {
    /* problem.errors[] → field map */
  }
  get isRetryable() {
    return this.status >= 500 || this.status === 429;
  }
}

export class NetworkError extends Error {} // no response at all
export class TimeoutError extends Error {} // deadline exceeded
```

Distinguishing `NetworkError` from `ApiError` matters throughout: network failures are transient and must not clear sessions, invalidate caches, or discard drafts.

If a response is not valid `problem+json` (a proxy 502, an HTML error page), a synthetic `Problem` is constructed so consumers never branch on shape.

---

## 7. Idempotency keys

```ts
export function withIdempotency<T>(key: string, req: RequestInit): RequestInit;
```

The client **never generates** a key. It is passed in by the caller, because the key belongs to the user's intent and must outlive the process (FE-0009). The composer creates it when a draft is created and persists it alongside the draft text.

A retry wrapper that generated keys per attempt would defeat the mechanism entirely — each retry would look like a fresh intent, and the flaky-network case that idempotency exists to solve would produce duplicate posts.

Endpoints requiring a key are read from the OpenAPI spec, so a request missing one throws in development rather than reaching the network.

---

## 8. Header side channel

Response headers are normally discarded by fetch wrappers. Two carry contract-level meaning:

```ts
// X-Degraded: timeline-pull,post-hydration
degradation.report(['timeline-pull', 'post-hydration']); // → UI banner

// RateLimit-Remaining: 4 / RateLimit-Reset: 1753900800
rateLimit.observe(scope, { remaining, reset }); // → proactive throttling
```

Below 10% remaining, background polling backs off and pre-emptive UI warnings appear — rather than discovering the limit with a 429 mid-interaction.

---

## 9. Endpoint wrappers

Thin, typed, one per resource. No logic beyond shaping.

```ts
export const posts = {
  create: (body: CreatePostBody, idempotencyKey: string) =>
    request('POST', '/v1/posts', {
      body,
      idempotencyKey,
      deadline: DEADLINES.mutation,
    }),
  get: (id: string) => request('GET', `/v1/posts/${id}`),
  delete: (id: string) => request('DELETE', `/v1/posts/${id}`),
  like: (id: string) => request('PUT', `/v1/posts/${id}/like`),
  unlike: (id: string) => request('DELETE', `/v1/posts/${id}/like`),
};
```

Request and response types come from `generated/`, so a backend rename fails the build (FE-0002).

---

## 10. Testing

| Test                                      | Asserts                                         |
| ----------------------------------------- | ----------------------------------------------- |
| **20 parallel 401s**                      | Exactly one `POST /refresh`                     |
| **Two contexts, shared cookies**          | Exactly one refresh; both stay signed in        |
| Lock acquired after another tab refreshed | Second tab **skips** the call (line 3)          |
| Refresh 401                               | Session cleared, drafts preserved               |
| Refresh network error                     | Session **retained**, retried                   |
| Reuse-detection problem type              | Security-specific message                       |
| `POST` without an idempotency key         | Never retried                                   |
| `PUT`/`DELETE` on 503                     | Retried with jitter                             |
| Malformed error body                      | Synthetic `Problem`, no crash                   |
| `X-Degraded` present                      | Reported to the degradation channel             |
| Token expiry mid-flight                   | Refreshed and the original request retried once |

The first three are the ones that matter. They are cheap to write, and the defect they prevent is intermittent, load-dependent, and looks like a backend bug — the worst combination for diagnosis.
