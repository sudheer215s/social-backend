# Agent instructions — social-backend

## Mandatory workflow

For **every** unit of work:

```
task → test → code & build → test → review → commit → update progress memory
```

Full rules: [`docs/05-roadmap/WORKFLOW.md`](docs/05-roadmap/WORKFLOW.md)
Living progress: [`docs/05-roadmap/PROGRESS.md`](docs/05-roadmap/PROGRESS.md)
Task board: [`docs/05-roadmap/task-board.md`](docs/05-roadmap/task-board.md)
Roadmap: [`docs/05-roadmap/implementation-roadmap.md`](docs/05-roadmap/implementation-roadmap.md)

1. **Task** — pick a small board ID with a clear verifiable output.
2. **Test** — write tests first (TDD).
3. **Code & build** — implement; `pnpm` typecheck/build.
4. **Test** — all relevant suites green.
5. **Review** — diff vs `docs/` design; fix issues.
6. **Commit** — real timestamps only; include task id in message.
7. **Memory** — update `docs/05-roadmap/PROGRESS.md` (and Grok MEMORY when available).

## Project facts

- **Name:** Distributed Social Media Backend
- **Repo:** https://github.com/sudheer215s/social-backend
- **Design source of truth:** `docs/` (v2). Root `twitter-linkedin-*.md` is historical v1.
- **Stack:** NestJS monorepo (`apps/` + `libs/`), pnpm, Turbo, TypeScript `strict` + `noUncheckedIndexedAccess`.
- **Do not** fabricate git history / backdate commits.
- **Do not** skip Phase 0 to jump into domain services.
- Prefer autonomous local work: project `.grok/config.toml` is `always-approve`.

## Quick commands

```bash
pnpm install
pnpm compose:up
pnpm test
pnpm test:integration
pnpm lint && pnpm typecheck && pnpm build
pnpm dev
```

## On session start

1. Read `docs/05-roadmap/PROGRESS.md`.
2. Continue from **Active next** tasks.
3. Keep the workflow loop; do not ask for permission on routine edits/commands.
