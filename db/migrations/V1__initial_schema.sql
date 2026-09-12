-- Cash Flow Copilot — initial schema.
-- Target: Tiger Data / TimescaleDB (PostgreSQL compatible). Plain PostgreSQL is also supported;
-- the hypertable conversion below is skipped when the timescaledb extension is unavailable.

CREATE TABLE app_users (
    id UUID PRIMARY KEY,
    external_auth_subject TEXT UNIQUE NOT NULL,
    email TEXT,
    display_name TEXT,
    persona_status TEXT NOT NULL DEFAULT 'unverified',
    persona_inquiry_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cash_events (
    id UUID NOT NULL,
    event_time TIMESTAMPTZ NOT NULL,
    user_id UUID NOT NULL REFERENCES app_users(id),
    amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
    category TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('NESSIE','DOCUMENT','MANUAL','SYSTEM')),
    source_record_id TEXT,
    description TEXT,
    recurring BOOLEAN NOT NULL DEFAULT FALSE,
    confidence DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'EXPECTED' CHECK (status IN ('ACTUAL','EXPECTED','OVERDUE','CANCELLED')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, event_time)
);

CREATE INDEX idx_cash_events_user_time
    ON cash_events(user_id, event_time DESC);

CREATE INDEX idx_cash_events_user_category_time
    ON cash_events(user_id, category, event_time DESC);

-- Ingest idempotency lookup. Not UNIQUE on purpose: a Timescale hypertable only accepts unique
-- indexes that contain the partitioning column, so uniqueness is enforced in the repository.
CREATE INDEX idx_cash_events_source_record
    ON cash_events(user_id, source, source_record_id);

CREATE TABLE invoices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_users(id),
    vendor_key TEXT NOT NULL,
    vendor_display_name TEXT,
    invoice_number_hash TEXT,
    amount NUMERIC(14,2) NOT NULL,
    previous_amount NUMERIC(14,2),
    invoice_date DATE,
    due_date DATE,
    paid_date DATE,
    status TEXT NOT NULL,
    recurring BOOLEAN NOT NULL DEFAULT FALSE,
    payment_destination_fingerprint TEXT,
    source TEXT NOT NULL,
    extraction_confidence DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_vendor_history
    ON invoices(user_id, vendor_key, invoice_date DESC);

CREATE TABLE invoice_risks (
    id UUID PRIMARY KEY,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    risk_score DOUBLE PRECISION NOT NULL,
    severity TEXT NOT NULL,
    rules_score DOUBLE PRECISION NOT NULL,
    ml_score DOUBLE PRECISION,
    reasons JSONB NOT NULL,
    model_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_risks_invoice
    ON invoice_risks(invoice_id, created_at DESC);

CREATE TABLE todo_items (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_users(id),
    title TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL CHECK (source IN ('MANUAL','ADVISOR','RISK','FORECAST')),
    status TEXT NOT NULL DEFAULT 'PROPOSED'
        CHECK (status IN ('PROPOSED','APPROVED','DECLINED','IN_PROGRESS','COMPLETED')),
    priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH')),
    due_date DATE,
    recommendation_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_todo_items_user_status
    ON todo_items(user_id, status, created_at DESC);

CREATE TABLE nessie_sync_state (
    user_id UUID PRIMARY KEY REFERENCES app_users(id),
    nessie_customer_id TEXT,
    last_synced_at TIMESTAMPTZ,
    sync_cursor TEXT,
    sync_status TEXT
);

-- Convert cash_events to a Timescale hypertable when the extension is present.
-- Plain PostgreSQL installs keep the regular table and every query still works.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        BEGIN
            PERFORM create_hypertable('cash_events', by_range('event_time'), if_not_exists => TRUE);
        EXCEPTION WHEN undefined_function THEN
            -- TimescaleDB older than 2.13 does not expose by_range().
            PERFORM create_hypertable('cash_events', 'event_time', if_not_exists => TRUE);
        END;
    END IF;
END
$$;
