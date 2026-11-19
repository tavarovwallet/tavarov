export async function syncAdminInvoice(env, invoice) {
  if (!env.ADMIN_STATS || !env.ADMIN_STATS_START) return;
  try {
    await env.ADMIN_STATS.prepare(`
      INSERT INTO admin_invoices (id, mode, network, currency, amount, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status
      WHERE excluded.status <> 'pending'
    `).bind(invoice.h, invoice.mode, invoice.net, invoice.c, invoice.a,
      invoice.st || 'pending', invoice.ct, invoice.t).run();
  } catch {
    console.error('Admin invoice history write failed');
  }
}

export async function readInvoiceHistory(db, since, page, now) {
  const pageSize = 20;
  const [totals, entries] = await db.batch([
    db.prepare(`
      SELECT count(*) AS total,
        count(CASE WHEN mode = 'live' THEN 1 END) AS live,
        count(CASE WHEN mode = 'test' THEN 1 END) AS test,
        count(CASE WHEN mode = 'live' AND status = 'paid' THEN 1 END) AS paid_live,
        count(CASE WHEN mode = 'test' AND status = 'paid' THEN 1 END) AS paid_test
      FROM admin_invoices WHERE created_at >= ?
    `).bind(since),
    db.prepare(`
      SELECT substr(id, 1, 10) AS id, mode, network, currency, amount,
        CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END AS status,
        created_at
      FROM admin_invoices WHERE created_at >= ?
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `).bind(now, since, pageSize, (page - 1) * pageSize)
  ]);
  return { ...totals.results[0], entries: entries.results, pageSize };
}
