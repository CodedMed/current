-- The cash_daily continuous aggregate: one row per user, per day, per direction, per category.
--
-- Runs outside a transaction (see the companion .conf file). TimescaleDB refuses to create a
-- continuous aggregate inside a transaction block, and a DO $$ ... $$ guard is itself a
-- transaction -- which is exactly why these migrations live in a conditional Flyway location
-- instead of being guarded inline the way V1 guards the hypertable conversion.

-- SETTLED ROWS ONLY. cash_events deliberately holds three kinds of row: ACTUAL money that has
-- moved, and EXPECTED / OVERDUE obligations that are forecast inputs. Bucketing them together
-- would be a correctness bug, not a rounding difference -- "spend over the last 30 days" would
-- silently include bills that have not been paid, inflating burn rate and shortening runway. The
-- forecast is the only thing entitled to read unsettled rows, and it reads the hypertable directly.
--
-- materialized_only = false turns on real-time aggregation, so a query sees materialized history
-- UNION the rows that have arrived since the last refresh. Without it, today's transactions would
-- be invisible until the next refresh job ran, and the burn rate would lag by up to an hour.
CREATE MATERIALIZED VIEW cash_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket(INTERVAL '1 day', event_time) AS bucket,
    user_id,
    direction,
    category,
    SUM(amount) AS total_amount,
    COUNT(*)    AS event_count
FROM cash_events
WHERE status = 'ACTUAL'
GROUP BY bucket, user_id, direction, category
WITH NO DATA;

-- Backfill immediately. Created WITH NO DATA the view would stay empty until the refresh policy
-- first fired, and an empty aggregate is worse than a missing one: the analytics service would
-- find cash_daily present, read from it, and report zero spend against real history.
CALL refresh_continuous_aggregate('cash_daily', NULL, NULL);

-- Keep the last year materialised. end_offset of one full bucket leaves the current, still-moving
-- day to real-time aggregation rather than rematerialising it every hour.
SELECT add_continuous_aggregate_policy('cash_daily',
    start_offset      => INTERVAL '1 year',
    end_offset        => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 hour');
