export function statsStart(env) {
  const start = Date.parse(env.ADMIN_STATS_START || '');
  return Number.isFinite(start) ? Math.floor(start / 1000) : null;
}

export async function writeStat(env, kind, id, merchant = null, time = Math.floor(Date.now() / 1000)) {
  const start = statsStart(env);
  if (!env.ADMIN_STATS || start === null || time < start) return;
  await env.ADMIN_STATS.prepare(
    'INSERT OR IGNORE INTO admin_events (id, kind, merchant, occurred) VALUES (?, ?, ?, ?)'
  ).bind(id, kind, merchant, time).run();
}

export async function recordInvoiceStat(env, invoice, stage) {
  if (!env.ADMIN_STATS || !env.ADMIN_STATS_SALT || statsStart(env) === null) return;
  if (invoice.mode !== 'live' && invoice.mode !== 'test') return;
  if (invoice.ct < statsStart(env)) return;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.ADMIN_STATS_SALT),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const data = await crypto.subtle.sign('HMAC', key, encoder.encode(invoice.w.toLowerCase()));
    const merchant = Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, '0')).join('');
    const kind = stage + '_' + invoice.mode;
    await writeStat(env, kind, kind + ':' + invoice.h, merchant, stage === 'invoice' ? invoice.ct : undefined);
  } catch {
    console.error('Admin invoice counter write failed');
  }
}
