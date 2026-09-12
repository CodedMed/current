-- Tiger Data / TimescaleDB tuning for cash_events.
--
-- This directory is a SECOND Flyway location, added to spring.flyway.locations at runtime only
-- when the timescaledb extension is present (see TimescaleFlywayConfig). Plain PostgreSQL
-- deployments never see these files, which is why nothing here is guarded by an extension check:
-- reaching this migration already proves the extension exists.
--
-- db/migrations stays the portable baseline and must keep running unchanged on plain PostgreSQL.
--
-- Versions here start at 1001 so this stream can never collide with a future portable migration
-- in db/migrations, which continues from V2.

-- Chunk sizing. A freelancer or small agency generates on the order of tens to low hundreds of
-- cash events per month, so the 7-day default would scatter a year of data across ~52 nearly empty
-- chunks. One month per chunk keeps roughly two dozen chunks over two years -- few enough that
-- planning stays cheap, while still letting chunk exclusion skip almost everything for the 30- and
-- 90-day windows the dashboard and analytics endpoint actually query.
SELECT set_chunk_time_interval('cash_events', INTERVAL '1 month');

-- Compression. Segmenting by user_id keeps each user's history contiguous inside a compressed
-- chunk, which is how every query in this service reads it; ordering by event_time DESC matches
-- the descending indexes.
ALTER TABLE cash_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'user_id',
    timescaledb.compress_orderby = 'event_time DESC'
);

-- Compress only chunks older than a year.
--
-- This threshold is deliberately conservative rather than tuned for storage. CashEventRepository
-- rewrites ingested rows via replace() -- a DELETE followed by an INSERT -- and Nessie re-syncs can
-- touch historical transactions. On TimescaleDB versions before 2.11 those operations fail against
-- compressed chunks. A year puts compression far outside the 90-day analytics window and outside
-- any plausible re-sync, so correctness never depends on the server's version.
SELECT add_compression_policy('cash_events', INTERVAL '365 days');

-- No retention policy on cash_events, deliberately.
-- The forecast replays settled history and the dashboard renders a 30-day strip, so old rows are
-- still read. Financial history is also not ours to silently discard. auth_events, which is
-- genuinely disposable, is where a retention policy belongs instead.
