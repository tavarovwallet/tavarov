-- 25.11.2026: разрешить в сводке запись 'paid_chain' (все оплаты через контракт).
-- В SQLite ограничение CHECK не меняется на месте, поэтому таблица
-- пересобирается: старые записи копируются как есть.
CREATE TABLE admin_events_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('invoice_live', 'paid_live', 'invoice_test', 'paid_test', 'wallet_created', 'transfer_submitted', 'transfer_test_submitted', 'paid_chain')),
  merchant TEXT,
  occurred INTEGER NOT NULL
);
INSERT INTO admin_events_new (id, kind, merchant, occurred) SELECT id, kind, merchant, occurred FROM admin_events;
DROP TABLE admin_events;
ALTER TABLE admin_events_new RENAME TO admin_events;
CREATE INDEX IF NOT EXISTS admin_events_kind_merchant ON admin_events(kind, merchant, occurred);
CREATE INDEX IF NOT EXISTS admin_events_occurred ON admin_events(occurred);
SELECT kind, COUNT(*) AS n FROM admin_events GROUP BY kind;
