import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchSiteTraffic } from '../../functions/api/_admin-traffic.js';

const account = 'dee58450dba50489948c254917eaa3c2';
const database = '97391b4e-d246-49fb-902d-ed51d57b3220';
const source = readFileSync(join(homedir(), '.wrangler/config/default.toml'), 'utf8');
const token = source.match(/^oauth_token = "([^"]+)"/m)?.[1];
if (!token) throw new Error('Wrangler login required');

async function cloudflare(path, body) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Cloudflare request failed with HTTP ' + response.status);
  const data = await response.json();
  if (data.success === false) throw new Error('Cloudflare operation failed');
  return data;
}

async function write(sql, params) {
  const data = await cloudflare('/d1/database/' + database + '/query', { sql, params });
  if (!data?.result?.every(row => row.success)) throw new Error('D1 could not apply the history batch');
}

if (process.argv.includes('--traffic-only') || process.argv.includes('--all')) {
  const capturedAt = Math.floor(Date.now() / 1000);
  const days = [7, 30, 90];
  const env = { ADMIN_CF_ACCOUNT: account, ADMIN_CF_ANALYTICS_TOKEN: token };
  const snapshots = [];
  for (const day of days) snapshots.push(await fetchSiteTraffic(env, day));
  if (snapshots.some(snapshot => !snapshot)) throw new Error('Web Analytics permissions or data unavailable');
  await write(`INSERT INTO admin_site_traffic (days, captured_at, data)
    VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)
    ON CONFLICT(days) DO UPDATE SET captured_at = excluded.captured_at, data = excluded.data`,
  days.flatMap((day, index) => [day, capturedAt, JSON.stringify(snapshots[index])]));
  console.log('Web Analytics saved', days.map((day, index) => day + ' days: ' + snapshots[index].visits).join(', '));
}

if (!process.argv.includes('--traffic-only')) {
  const project = await cloudflare('/pages/projects/tavarov-wallet');
  const id = project?.result?.deployment_configs?.production?.kv_namespaces?.TILL?.namespace_id;
  if (!id) throw new Error('Wallet invoice namespace not found');
  const namespace = '/storage/kv/namespaces/' + id;
  let cursor = '';
  let imported = 0;
  let skipped = 0;
  do {
    const query = new URLSearchParams({ prefix: 'v1:inv:', limit: '1000', cursor });
    const { result, result_info: info } = await cloudflare(namespace + '/keys?' + query);
    for (let offset = 0; offset < result.length; offset += 10) {
      const keys = result.slice(offset, offset + 10);
      const records = await Promise.all(keys.map(key => cloudflare(namespace + '/values/' + encodeURIComponent(key.name))));
      const invoices = records.filter(invoice => invoice && ['live', 'test'].includes(invoice.mode)
        && [invoice.h, invoice.net, invoice.c, invoice.a].every(value => typeof value === 'string')
        && Number.isSafeInteger(invoice.ct) && Number.isSafeInteger(invoice.t));
      skipped += records.length - invoices.length;
      if (!invoices.length) continue;
      await write(`INSERT INTO admin_invoices (id, mode, network, currency, amount, status, created_at, expires_at)
        VALUES ${invoices.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')} ON CONFLICT(id) DO NOTHING`,
      invoices.flatMap(invoice => [invoice.h, invoice.mode, invoice.net, invoice.c, invoice.a,
        invoice.st || 'pending', invoice.ct, invoice.t]));
      imported += invoices.length;
    }
    cursor = info.cursor || '';
  } while (cursor);
  console.log('Retained invoices read:', imported, 'skipped:', skipped);
}
