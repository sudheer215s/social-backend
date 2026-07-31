# Data Management

Schema conventions, migrations, partitioning, backup/restore, and retention. v1 had none of this (review C8, A3, A4) — it is the difference between a schema that can evolve under load and one that can only be changed during downtime.

---

## 1. Conventions

| Concern | Rule | Why |
|---|---|---|
| Primary keys | UUIDv7, application-generated | Sequential inserts; the ID is a valid cursor (ADR-0003) |
| Timestamps | `timestamptz`, DB-assigned via `now()` | Application clocks drift between replicas |
| Soft delete | `deleted_at timestamptz NULL` | `NULL` is unambiguous; a boolean loses *when* |
| Indexes on soft-deleted tables | **Always** `WHERE deleted_at IS NULL` | Deleted rows carry no index weight (review C6) |
| Counters | `bigint` with `CHECK (>= 0)` | Never clamp — clamping hides double-decrements (review C5) |
| Enums | `text` + `CHECK` | Native enum changes take `ACCESS EXCLUSIVE` |
| Booleans | `NOT NULL DEFAULT` always | Three-valued logic in application code is a bug source |
| Naming | `snake_case`, plural tables, `ix_`/`uq_`/`fk_` prefixes | |
| Foreign keys | **Within a service only**, never across databases | Service boundaries are enforced by grants |

Numeric-typed columns never store an unknown as `-1` or `0`; unknown is `NULL`.

---

## 2. Migrations

Forward-only SQL files, sequentially numbered, applied by a Kubernetes Job that must complete before the rollout proceeds. No down migrations: a rollback is a new forward migration, because a down migration written months earlier has never been tested against the data that now exists.

### Expand/contract

Rolling deploys mean old and new code run concurrently against one schema. That is the normal case, and every migration must be safe under it.

Renaming `posts.content` → `posts.body`:

| Phase | Migration | Code |
|---|---|---|
| 1 — Expand | Add `body`, nullable | Writes both, reads `content` |
| 2 — Backfill | Batched `UPDATE` | unchanged |
| 3 — Migrate | Add `NOT NULL` via `NOT VALID` + `VALIDATE` | Reads `body`, writes both |
| 4 — Contract | Drop `content` | Reads/writes `body` only |

Four deploys for one rename. That is the cost of not taking downtime, and it is why renames are discouraged rather than made easy.

### Lock classes

Every migration is reviewed for its lock, with `lock_timeout = 3s` set so a migration that would block fails fast rather than queueing behind — and ahead of — production traffic.

| Operation | Lock | Safe online? |
|---|---|---|
| `ADD COLUMN` (nullable, no default) | brief `ACCESS EXCLUSIVE` | ✅ |
| `ADD COLUMN … DEFAULT` (PG 11+) | brief | ✅ |
| `CREATE INDEX CONCURRENTLY` | none blocking | ✅ (cannot run in a transaction) |
| `ADD CONSTRAINT … NOT VALID` then `VALIDATE` | brief, then `SHARE UPDATE EXCLUSIVE` | ✅ |
| `ALTER COLUMN … TYPE` | full rewrite | ❌ — expand/contract instead |
| `ADD COLUMN … NOT NULL` without default | full rewrite | ❌ |
| `DROP COLUMN` | brief | ✅ (but only after no code references it) |

A CI check greps migrations for the unsafe forms and fails the build with a pointer to this table.

---

## 3. Partitioning

| Table | Scheme | Rationale |
|---|---|---|
| `posts` | `RANGE (created_at)`, monthly | Retention by `DETACH`; hot partition stays cached |
| `likes` | `HASH (post_id)`, 32 | 730M rows/year — the largest table (review C2) |
| `notifications` | `RANGE (created_at)`, monthly | 90-day retention by `DROP` |
| `processed_events` | `RANGE (processed_at)`, daily | 7-day retention by `DROP` |

Partitioned from day one, not retrofitted. Converting a 730M-row table to partitioned later means a full rewrite under load — the migration nobody schedules.

`HASH (post_id)` on `likes` keeps "who liked this post" — the dominant query — inside one partition. Hashing on `user_id` instead would scatter it across all 32.

A `partition-maintenance` job creates partitions three months ahead and drops expired ones. Running out of future partitions causes inserts to fail; three months of lead time makes that a warning, not an incident.

---

## 4. Connection management

The constraint that bites first (review C7):

```
8 services × 3 replicas × pool 10 = 240 connections
Postgres max_connections               ≈ 100–200
```

| Layer | Setting |
|---|---|
| Application pool | `max: 5` per replica, capped in the config schema |
| PgBouncer | transaction mode, `default_pool_size = 20`/db, `max_client_conn = 1000` |
| Postgres | `max_connections = 200` |

**Transaction pooling constrains application code**, and violations only fail under load:

| Forbidden | Why |
|---|---|
| `SET` outside a transaction | The next statement may land on a different backend |
| Session advisory locks | Same |
| `LISTEN`/`NOTIFY` | Requires a session |
| Server-side prepared statements | Needs PgBouncer ≥ 1.21 |
| Cursors held across statements | Session state |

Enforced by running **integration tests through PgBouncer** (risk R5). Testing against Postgres directly passes code that production rejects — the environment must be able to fail the test.

Per-connection at checkout: `statement_timeout = 5s`, `lock_timeout = 3s`, `idle_in_transaction_session_timeout = 10s`. The last one prevents the classic outage where an application bug leaves a transaction open holding a lock.

---

## 5. Backup and recovery

| Objective | Target |
|---|---|
| RPO | 5 minutes |
| RTO | 1 hour |
| Backup retention | 30 days daily, 12 months monthly |
| Restore rehearsal | **Monthly, to a scratch environment** |

- Continuous WAL archiving to object storage → 5-minute RPO, PITR to any second.
- Nightly base backup, verified by automated restore.
- Cross-region backup replication.

**A backup that has never been restored is not a backup.** The monthly rehearsal is a scheduled job that restores to a scratch instance, runs a consistency check, and fails loudly — which is the only way the RTO figure means anything.

### Derived stores are not backed up

Redis and Elasticsearch hold only derived state and are **rebuilt, not restored**:

| Store | Recovery | Time |
|---|---|---|
| Redis timelines | Rebuilt lazily on read (timeline-service §5) | Immediate, degraded |
| Redis caches | Repopulated on miss | Immediate |
| Notification streams | Lost; clients fall back to polling | Immediate |
| Elasticsearch | Reindex from Postgres | ~2 h |
| Kafka | Replay from retained topics | n/a |

This is a direct payoff of the "everything derived is rebuildable" principle: it removes three backup systems and three restore runbooks.

---

## 6. Retention

| Data | Retention | Mechanism |
|---|---|---|
| Posts (live) | Indefinite | — |
| Posts (deleted) | 30 days, then hard delete | Partition maintenance |
| Notifications | 90 days | Partition `DROP` |
| Sessions | 7 days past expiry | `session-sweep` |
| `processed_events` | 7 days | Partition `DROP` |
| Outbox (published) | 1 hour | `outbox-vacuum` |
| Kafka `social.post/graph.v1` | 7 days | Broker retention |
| Kafka `social.user.v1` | Compacted + 30 days | Compaction, for erasure tombstones |
| Access logs | 30 days | Log pipeline |
| Audit logs | 1 year | Separate stream |
| Backups | 30 days / 12 months | Lifecycle policy |

Retention is enforced by jobs and broker config, never by manual cleanup.

---

## 7. Data quality

| Check | Cadence | Alert |
|---|---|---|
| Counter drift (follower/following/post/like) | Daily | > 0.1% |
| ES index vs Postgres (sampled 10K) | Nightly | > 0.1% |
| Orphaned rows (likes on absent posts) | Weekly | any |
| Outbox depth / oldest age | Continuous | > 10K / > 60 s |
| DLQ depth | Continuous | > 0 warn, > 100 page |
| Partition headroom | Daily | < 30 days |

Drift is treated as an **SLI with an error budget**, not just an alert (risk R6). An alert that fires daily and is acknowledged daily has become noise; a budget that is being consumed forces a decision.

---

## 8. Local and test data

- `docker compose up` starts Postgres + PgBouncer + Redis (cluster) + Redpanda + Elasticsearch + the OTel stack.
- `pnpm db:migrate && pnpm db:seed` produces a deterministic dataset: 1,000 users, a power-law follow graph, 10,000 posts, one large account above the fan-out threshold, one private account, one blocked pair.

The seed deliberately includes the edge cases the design turns on. A dataset of only ordinary users would let a fan-out threshold bug, a private-account leak, or a block-filter regression reach production untested.

- Test isolation via a template database — `CREATE DATABASE … TEMPLATE` is far faster than re-running migrations per test.
- **Production data is never copied to lower environments.** Load testing uses generated data at production scale.
