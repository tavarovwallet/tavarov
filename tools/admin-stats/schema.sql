CREATE TABLE IF NOT EXISTS admin_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('invoice_live', 'paid_live', 'invoice_test', 'paid_test', 'wallet_created', 'transfer_submitted', 'transfer_test_submitted')),
  merchant TEXT,
  occurred INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_events_kind_merchant ON admin_events(kind, merchant, occurred);
CREATE INDEX IF NOT EXISTS admin_events_occurred ON admin_events(occurred);
