# Tiger Data (TimescaleDB)

The ledger service runs on plain PostgreSQL and on Tiger Data. On Tiger Data it additionally keeps
`cash_events` as a hypertable, maintains a `cash_daily` continuous aggregate, and serves spending
analytics from that rollup instead of scanning rows.

Nothing here is required for the demo. With `DATABASE_URL` unset the service still starts an
embedded PostgreSQL, every feature still works, and analytics fall back to an equivalent query.

---

## Provisioning

### Locally, with Docker

`docker-compose.dev.yml` defines a `db` service on the `timescale/timescaledb:latest-pg16` image,
and `scripts/db.sh` wraps it:

```bash
scripts/db.sh up                            # start, wait for healthy
export DATABASE_URL=$(scripts/db.sh url)    # postgresql://copilot:copilot@localhost:5432/copilot
cd services/ledger-service && ./mvnw spring-boot:run
scripts/db.sh status                        # extension, hypertable, aggregate, policies, /health
```

The data lives in a named volume, so it survives `scripts/db.sh down`, service restarts, and
Docker engine restarts (the service carries `restart: unless-stopped`). `scripts/db.sh reset`
drops the volume; the next boot re-runs every migration and re-seeds the demo business.

### Hosted, in the Tiger Data console

1. Create a service in the Tiger Data console and wait for it to finish provisioning.
2. Copy the connection string:

   ```
   postgresql://tsdbadmin:PASSWORD@HOST.tsdb.cloud.timescale.com:PORT/tsdb?sslmode=require
   ```

   The password is usually shown once. Save it.
3. Confirm the extension is installed:

   ```sql
   SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';
   ```

   If that returns nothing, run `CREATE EXTENSION IF NOT EXISTS timescaledb;`

`DataSourceConfig` parses this URL shape directly, `sslmode` and all — there is no separate JDBC
setting to configure.

```bash
export DATABASE_URL='postgresql://tsdbadmin:PASSWORD@HOST.tsdb.cloud.timescale.com:PORT/tsdb?sslmode=require'
export DEMO_MODE=false
cd services/ledger-service && ./mvnw spring-boot:run
```

---

## How the two migration streams work

Flyway runs from **two** locations:

| Location | Applies to | Contents |
| --- | --- | --- |
| `db/migrations` | every database | The portable baseline. `V1` creates every table and converts `cash_events` to a hypertable *if* the extension happens to be present. |
| `db/timescale` | Tiger Data only | Chunk sizing, compression, and the `cash_daily` continuous aggregate. Versions start at `V1001`. |

`TimescaleFlywayConfig` probes for the extension at startup and appends `classpath:db/timescale` to
`spring.flyway.locations` only when it is found. Schema history therefore differs between
deployments by design: a Tiger Data database records the 1001-series migrations, a plain PostgreSQL
one never sees them. The 1001 range exists so future portable migrations can continue from `V2`
without ever colliding.

**Why a second location rather than an inline guard.** `V1` guards its hypertable conversion with
`DO $$ ... IF EXISTS (SELECT 1 FROM pg_extension ...) ... $$`. That pattern cannot be extended to
continuous aggregates: TimescaleDB refuses to create one inside a transaction block, and a `DO`
block *is* a transaction. Choosing the location up front removes the need for any guard, because
reaching those files already proves the extension exists.
`V1002__cash_daily_continuous_aggregate.sql.conf` additionally sets `executeInTransaction=false`,
since Flyway wraps migrations in a transaction by default.

---

## What is configured

**Hypertable.** `cash_events`, partitioned on `event_time`, one month per chunk. A small business
produces tens to low hundreds of events a month, so the 7-day default would scatter a year across
~52 nearly empty chunks. Monthly chunks keep roughly two dozen over two years while still letting
chunk exclusion skip almost everything for the 30- and 90-day queries the product actually runs.

**Continuous aggregate `cash_daily`.** One row per user, per day, per direction, per category, with
`SUM(amount)` and `COUNT(*)`.

- **Settled rows only** (`status = 'ACTUAL'`). `cash_events` deliberately holds forecast rows too —
  `EXPECTED` and `OVERDUE` obligations. Bucketing those alongside settled money would be a
  correctness bug, not a rounding difference: "spend over the last 30 days" would include bills
  nobody has paid, inflating the burn rate and shortening the runway. The forecast is the only
  consumer entitled to unsettled rows, and it reads the hypertable directly.
- **`materialized_only = false`**, so a query returns materialised history UNION rows that have
  arrived since the last refresh. Without it, today's transactions would be invisible until the
  refresh job next ran.
- Refreshed hourly, materialising the last year and leaving the current day to real-time
  aggregation.

**Compression.** Chunks older than 365 days, segmented by `user_id` and ordered by `event_time
DESC`. The threshold is deliberately conservative: `CashEventRepository.replace()` deletes and
re-inserts rows during Nessie re-syncs, and on TimescaleDB before 2.11 those operations fail against
compressed chunks. A year puts compression far outside both the 90-day analytics window and any
plausible re-sync, so correctness never depends on the server's version.

**No retention policy on `cash_events`**, deliberately. The forecast replays settled history and the
dashboard renders a 30-day strip, so old rows are still read — and financial history is not ours to
silently discard.

---

## Verifying

```sql
SELECT hypertable_name FROM timescaledb_information.hypertables;
SELECT view_name       FROM timescaledb_information.continuous_aggregates;
SELECT job_id, proc_name, hypertable_name FROM timescaledb_information.jobs;
SELECT * FROM cash_daily ORDER BY bucket DESC LIMIT 10;
```

Or ask the service, which is faster and needs no SQL client:

```bash
curl -s localhost:8080/health
```

```json
{
  "status": "ok",
  "database": {
    "engine": "tigerdata",
    "reachable": true,
    "timescaleVersion": "2.30.0",
    "cashEventsHypertable": true,
    "cashDailyAggregate": true,
    "backgroundJobs": 2,
    "analyticsSource": "CONTINUOUS_AGGREGATE"
  }
}
```

`backgroundJobs` counts the policies the migrations installed — the hourly refresh on `cash_daily`
and the compression job on `cash_events`. Timescale's own housekeeping jobs (telemetry, job-stat
retention) are not attached to any table and are excluded, so the number matches what
`db/timescale` actually created.

On plain PostgreSQL the same endpoint reports `"engine": "postgresql"`, every flag false, and
`"analyticsSource": "ROW_SCAN"`. Before this existed there was no way to tell the two apart from
outside, because the hypertable conversion silently no-ops.

If the database does not answer at all, `status` is `"degraded"` and `engine` is `"unreachable"`.
The Timescale probes deliberately swallow SQL errors and answer "no", so without the separate
reachability check a database that is *down* looked identical to plain PostgreSQL — the service
kept reporting `ok` after a Docker engine restart had stopped the container underneath it.

---

## The analytics endpoint

```
GET /v1/analytics/spend?days=90
```

Returns a daily inflow/outflow series, per-category outflow totals, the trailing 30-day burn rate,
runway in days, and the top category movers (last 30 days against the 30 before). `days` is clamped
server-side to 365.

`runwayDays` is **null**, never a number, when nothing is being burned — "no runway figure" and
"zero days of runway" mean opposite things. `changePct` on a category trend is likewise null when
there was no prior spend, because there is no percentage increase from zero.

`SpendAnalyticsRepository` chooses the read path and `source` in the response reports which one
served the request. Both paths return the same `DailyBucket` shape and every derived figure is
computed from those buckets in `SpendAnalyticsService`, so the paths can only disagree if the
bucketing itself disagrees — which is what `SpendAnalyticsTest` pins down.

---

## Failure modes

| Situation | Behaviour |
| --- | --- |
| `DATABASE_URL` unset, `DEMO_MODE=true` | Embedded PostgreSQL, no Timescale, row-scan analytics. The demo path. |
| `DATABASE_URL` unset, `DEMO_MODE=false` | Refuses to start — `DataSourceConfig` demands a real database. |
| `DATABASE_URL` set without `timescaledb`, `DEMO_MODE=true` | Starts, logs a warning, uses row-scan analytics. |
| `DATABASE_URL` set without `timescaledb`, `DEMO_MODE=false` | **Refuses to start.** Production must not silently run degraded. |
| Database goes away after startup | `/health` reports `"status": "degraded"`, `"engine": "unreachable"`. The connection pool reconnects on its own once the database is back; nothing needs restarting. |

---

## Verified against a real TimescaleDB

Run on 2026-09-12 against `timescale/timescaledb:latest-pg16` — TimescaleDB 2.30.0 on
PostgreSQL 16.15 — through `scripts/db.sh`:

- A fresh database applies all three migrations in one boot: `1`, `1001`, `1002`, including the
  continuous aggregate outside a transaction.
- `cash_events` is a hypertable with 30-day chunks, compression enabled, segmented by `user_id`
  and ordered by `event_time DESC`; the compression policy (365 days) and the hourly `cash_daily`
  refresh policy are both registered.
- `cash_daily` is real-time: an `ACTUAL` row inserted for today appears in the aggregate
  immediately, with no refresh, and disappears when the row is deleted.
- Over the 90-day analytics window the aggregate path and the row-scan path return identical
  totals and counts per direction.
- `GET /v1/analytics/spend` reports `"source": "CONTINUOUS_AGGREGATE"`; `GET /v1/dashboard`
  returns the documented demo figures.
- A second boot against the same database: Flyway reports the schema up to date, the demo seed
  does not duplicate (row counts unchanged), `/health` unchanged.
- The container image built by `docker-compose.dev.yml` packages both migration streams,
  `.conf` file included.

## What the test suite does and does not cover

`SpendAnalyticsTest` runs against the embedded PostgreSQL, which cannot install `timescaledb`. It
verifies the analytics maths, the settled-rows-only rule, the burn-rate and runway edge cases, and —
using a plain view carrying the same definition as the continuous aggregate — that both SQL read
paths bucket identically.

It does **not** verify TimescaleDB itself: chunk sizing, the real continuous aggregate, refresh,
and compression policies are only exercised against a live Tiger Data service. Check those with the
queries above after pointing `DATABASE_URL` at one.

## The `keel` schema (Express)

Express shares the database and keeps its own tables in the `keel` schema, created idempotently
at boot by `server/store/postgres.ts` (an advisory lock serialises concurrent boots). Flyway never
sees these tables and `scripts/db.sh reset` drops them with the volume like everything else.

| Table | Purpose |
|---|---|
| `keel.users` | One row per sign-in identity `(provider, provider_subject)`: profile columns plus `identity`, `onboarding`, and `workspace` as jsonb (the Nessie customer, account ids, merchants). Indexed on `identity->>'inquiryId'` for Persona webhooks. |
| `keel.sessions` | `express-session` store (`connect-pg-simple` layout), pruned every 15 minutes. |
| `keel.workspace_overlays` | Per-user dashboard state Nessie cannot hold: transaction edits, bill-review decisions, loan applications and saved offers. Whole-row write-through on every change. |

Without `DATABASE_URL` Express falls back to in-memory maps and the default MemoryStore, mirroring
the ledger's embedded-database fallback; both reset on restart.
