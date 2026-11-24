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

async function merchantId(env, address) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.ADMIN_STATS_SALT),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = await crypto.subtle.sign('HMAC', key, encoder.encode(address.toLowerCase()));
  return Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, '0')).join('');
}

export async function recordInvoiceStat(env, invoice, stage) {
  if (!env.ADMIN_STATS || !env.ADMIN_STATS_SALT || statsStart(env) === null) return;
  if (invoice.mode !== 'live' && invoice.mode !== 'test') return;
  if (invoice.ct < statsStart(env)) return;
  try {
    const merchant = await merchantId(env, invoice.w);
    const kind = stage + '_' + invoice.mode;
    await writeStat(env, kind, kind + ':' + invoice.h, merchant, stage === 'invoice' ? invoice.ct : undefined);
  } catch {
    console.error('Admin invoice counter write failed');
  }
}

/* 25.11.2026: оплаты, которые сервер не выписывал (платёжная ссылка,
   касса, донат), до этого в сводке не было. Таймер и так читает журнал
   Paid контракта оплаты; каждую запись основной сети считаем здесь один
   раз (id — сеть, транзакция и номер записи). Это все оплаты через
   контракт, включая счета API; Solana сюда не попадает: там нет журнала. */
export async function recordChainPaid(env, net, log) {
  if (!env.ADMIN_STATS || !env.ADMIN_STATS_SALT || statsStart(env) === null) return;
  try {
    const id = 'paid_chain:' + net + ':' + String(log.transactionHash).toLowerCase() + ':' + parseInt(log.logIndex, 16);
    /* Окно таймера — 400 блоков, одна и та же запись попадает в него
       много раз (в Ethereum — до 80). Метка в кэше на час избавляет от
       повторных подписей и записей: у части таймера всего 10 мс. */
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const mark = cache ? new Request('https://admin-stats.invalid/' + encodeURIComponent(id)) : null;
    if (mark && await cache.match(mark)) return;
    const merchant = await merchantId(env, '0x' + String(log.topics[1]).slice(-40));
    await writeStat(env, 'paid_chain', id, merchant);
    if (mark) await cache.put(mark, new Response('1', { headers: { 'cache-control': 'max-age=3600' } }));
  } catch {
    console.error('Admin chain payment counter write failed');
  }
}
