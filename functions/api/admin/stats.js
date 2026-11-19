import { statsStart } from '../_admin-events.js';
import { readSiteTraffic } from '../_admin-traffic.js';
import { readInvoiceHistory } from '../_admin-history.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store'
  } });
}

function bytes(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

function claim(value) {
  return JSON.parse(new TextDecoder().decode(bytes(value)));
}

export async function isOwner(request, env) {
  const team = env.ADMIN_ACCESS_TEAM;
  if (!/^[a-z0-9-]+$/.test(team || '') || !env.ADMIN_ACCESS_AUD || !env.ADMIN_OWNER_EMAIL) return false;
  const issuer = 'https://' + team + '.cloudflareaccess.com';
  const parts = (request.headers.get('Cf-Access-Jwt-Assertion') || '').split('.');
  if (parts.length !== 3) return false;
  try {
    const header = claim(parts[0]);
    const payload = claim(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || payload.iss !== issuer || !Array.isArray(payload.aud) ||
        !payload.aud.includes(env.ADMIN_ACCESS_AUD) || !Number.isFinite(payload.exp) || payload.exp <= now ||
        (payload.nbf != null && (!Number.isFinite(payload.nbf) || payload.nbf > now)) ||
        payload.email?.toLowerCase() !== env.ADMIN_OWNER_EMAIL.trim().toLowerCase()) return false;
    const response = await fetch(issuer + '/cdn-cgi/access/certs');
    if (!response.ok) return false;
    const { keys } = await response.json();
    const jwk = keys?.find(key => key.kid === header.kid);
    if (!jwk) return false;
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
    return await crypto.subtle.verify(algorithm, key, bytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1]));
  } catch { return false; }
}

const funnelQuery = `
  WITH invoices AS (
    SELECT merchant, MIN(occurred) AS first_invoice FROM admin_events
    WHERE kind = 'invoice_live' AND occurred >= ? GROUP BY merchant
  ), payments AS (
    SELECT merchant, occurred, ROW_NUMBER() OVER (PARTITION BY merchant ORDER BY occurred, id) AS number
    FROM admin_events WHERE kind = 'paid_live' AND occurred >= ?
  )
  SELECT
    (SELECT count(*) FROM invoices WHERE first_invoice >= ?) AS first_invoice,
    (SELECT count(*) FROM payments WHERE number = 1 AND occurred >= ?) AS first_payment,
    (SELECT count(*) FROM payments WHERE number = 2 AND occurred >= ?) AS repeat_payment
`;

const merchantsQuery = `
  SELECT substr(merchant, 1, 12) AS id, COUNT(*) AS payments, MAX(occurred) AS latest
  FROM admin_events WHERE kind = 'paid_live' AND occurred >= ?
  GROUP BY merchant ORDER BY latest DESC, id LIMIT 30
`;

export async function onRequestGet({ request, env }) {
  if (!await isOwner(request, env)) return json({ error: 'Access denied' }, 403);
  const start = statsStart(env);
  if (!env.ADMIN_STATS || start === null) return json({ error: 'Data collection is not configured' }, 503);
  const params = new URL(request.url).searchParams;
  const days = Number(params.get('days') || 30);
  const page = Number(params.get('page') || 1);
  if (![7, 30, 90].includes(days)) return json({ error: 'Invalid date range' }, 400);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return json({ error: 'Invalid page' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 86400;
  const liveSince = Math.max(start, since);
  const [counts, funnel, merchants, traffic, history] = await Promise.all([
    env.ADMIN_STATS.prepare('SELECT kind, COUNT(*) AS count FROM admin_events WHERE occurred >= ? GROUP BY kind')
      .bind(liveSince).all(),
    env.ADMIN_STATS.prepare(funnelQuery).bind(start, start, liveSince, liveSince, liveSince).first(),
    env.ADMIN_STATS.prepare(merchantsQuery).bind(liveSince).all(),
    readSiteTraffic(env, days),
    readInvoiceHistory(env.ADMIN_STATS, since, page, now)
  ]);
  return json({ start, counts: Object.fromEntries(counts.results.map(row => [row.kind, row.count])), funnel, merchants: merchants.results, traffic, history });
}
