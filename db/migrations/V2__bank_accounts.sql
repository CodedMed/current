-- Bank account balances as last ingested from the bank feed (pushed by the BFF or pulled by the
-- ledger's Nessie client). Available cash is read from here instead of calling the bank on every
-- forecast, so a bank outage or an unknown customer can never turn the dashboard into $0.
--
-- Balances are signed: deposit accounts positive, credit cards negative (the amount owed), so the
-- sum is the business's cash position and matches the current.surf dashboard's total.
CREATE TABLE bank_accounts (
    user_id UUID NOT NULL REFERENCES app_users(id),
    account_id TEXT NOT NULL,
    account_type TEXT NOT NULL,
    nickname TEXT,
    balance NUMERIC(14,2) NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, account_id)
);
