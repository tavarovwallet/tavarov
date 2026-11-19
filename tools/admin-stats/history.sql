CREATE TABLE IF NOT EXISTS admin_invoices (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'test')),
  network TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_invoices_date ON admin_invoices(created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS admin_site_traffic (
  days INTEGER PRIMARY KEY CHECK (days IN (7, 30, 90)),
  captured_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
