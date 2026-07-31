# Implementation Workflow (mandatory)

This is the **only** way work is done on this repository. Every unit of work
follows this loop. No skipping steps. No “implement first, tests later.”

```
1. TASK     → pick a small verifiable task (from task-board / roadmap)
2. TEST     → write failing or specification tests first (TDD)
3. CODE     → implement the minimum to satisfy the tests
4. BUILD    → pnpm typecheck / build for touched packages
5. TEST     → re-run unit (and integration/e2e when relevant) — all green
6. REVIEW   → re-read the diff against design docs; fix issues
7. COMMIT   → real timestamp, clear message (P0-Txx id), push when appropriate
```

Then **update progress memory** (see below) before starting the next task.

---

## Step details

### 1. Task
- Source: [`task-board.md`](./task-board.md) + [`implementation-roadmap.md`](./implementation-roadmap.md)
- Task must have a **verifiable output** (what “done” looks like)
- Prefer one board ID (`P0-T14`, `P1-T02`, …) per commit when practical
- Mark board status `doing` → `done` when finished

### 2. Test (first)
- Unit tests for pure logic
- Integration tests when the task touches Postgres/Redis/Kafka (Compose up)
- e2e for HTTP surfaces on apps
- Soft-skip integration if infra is down **only** when CI cannot provide it; local work should run Compose

### 3–4. Code and build
- Implement against `docs/` design (v2 is source of truth under `docs/01–03`)
- `pnpm --filter <pkg> build` / root `pnpm typecheck` + `pnpm lint`
- Keep changes scoped to the task

### 5. Test (again)
- Full relevant suite green before review
- Root gate before commit: `pnpm test && pnpm lint && pnpm typecheck` (plus integration when DB involved)

### 6. Review
- Diff matches design (no silent API/schema drift)
- No secrets committed; no backdated git history
- Task-board / PROGRESS updated

### 7. Commit
- Real author/committer dates only (**never** fabricate 2025 / Jan–July history)
- Message format examples:
  - `feat(P0-T09): add platform-db with PgBouncer-safe pool`
  - `docs: update progress memory after P0-T13`
- Push to `origin/main` when the user is building continuously on main (current mode)

---

## Autonomy and permissions

- Prefer **always-approve** for local edits and commands (project `.grok/config.toml`)
- Do **not** ask for permission on routine edit/test/build/commit in this repo
- Still avoid destructive irreversible actions unless the user explicitly asks
  (`rm -rf /`, force-push, dropping prod data, etc.)

---

## Progress memory (always update)

After each completed task (or end of a working session), update **both**:

| File | Purpose |
|------|---------|
| [`PROGRESS.md`](./PROGRESS.md) | In-repo living log (committed) |
| Grok workspace `MEMORY.md` | Cross-session agent memory |

Minimum fields to refresh in `PROGRESS.md`:
- Current phase / active task IDs
- Last completed task + commit SHA
- What’s next
- Blockers
- Important technical decisions discovered while building

---

## Sequencing (do not skip Phase 0)

```
Phase 0 (platform) → 1 (identity) → 2 (posts/graph) → 3 (events)
  → 4 (timeline) → 5 (notifications) + 6 (search) → 7 → 8
```

Do **not** start Phase 1 domain services until Phase 0 exit criteria are mostly met
(hello-service, CI, Compose, core platform libs).
