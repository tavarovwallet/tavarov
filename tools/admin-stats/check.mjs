import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { recordInvoiceStat } from '../../functions/api/_admin-events.js';
import { syncAdminInvoice } from '../../functions/api/_admin-history.js';
import { onRequestPost } from '../../functions/api/admin/events.js';
import { onRequestGet } from '../../functions/api/admin/stats.js';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('./history.sql', import.meta.url), 'utf8'));
const d1 = { batch: operations => Promise.all(operations.map(op => op.all())), prepare: sql => ({ bind: (...args) => ({
  run: async () => db.prepare(sql).run(...args),
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  first: async () => db.prepare(sql).get(...args)
}) }) };
const now = Math.floor(Date.now() / 1000);
const env = {
  ADMIN_STATS: d1, ADMIN_STATS_START: new Date((now - 20 * 86400) * 1000).toISOString(),
  ADMIN_STATS_SALT: 'local-test-only', ADMIN_ACCESS_TEAM: 'example', ADMIN_ACCESS_AUD: 'example-app',
  ADMIN_OWNER_EMAIL: 'owner@example.com'
};
const origin = 'https://wallet.tavarov.com';
const first = { w: 'synthetic-merchant', h: 'one', mode: 'live', ct: now - 10 * 86400 };
const second = { ...first, h: 'two', ct: now - 10 };
const sandbox = { ...first, h: 'three', mode: 'test' };
await recordInvoiceStat({}, first, 'invoice');
await recordInvoiceStat(env, { ...first, ct: now - 21 * 86400 }, 'invoice');
assert.equal(db.prepare('SELECT COUNT(*) AS total FROM admin_events').get().total, 0);
for (const invoice of [first, second, sandbox]) {
  await recordInvoiceStat(env, invoice, 'invoice');
  await recordInvoiceStat(env, invoice, 'paid');
  await recordInvoiceStat(env, invoice, 'paid');
}
const historicalInvoice = {
  ...first, h: 'historical', ct: now - 25 * 86400, net: 'bnb', c: 'USDT',
  a: '3.20', t: now - 24 * 86400, st: 'pending'
};
await syncAdminInvoice(env, historicalInvoice);
await syncAdminInvoice(env, { ...historicalInvoice, st: 'paid' });
const event = { kind: 'wallet_created', id: crypto.randomUUID() };
const post = (body, from = origin) => onRequestPost({
  env, request: new Request(origin + '/api/admin/events', {
    method: 'POST', body: JSON.stringify(body), headers: { Origin: from }
  })
});
assert.equal((await post(event, 'https://example.org')).status, 403);
assert.equal((await post({ ...event, kind: 'invoice_live' })).status, 400);
assert.equal((await post({ ...event, extra: 'x'.repeat(300) })).status, 400);
assert.equal((await post(event)).status, 204);
assert.equal((await post(event)).status, 204);
assert.equal((await post({ kind: 'transfer_submitted', id: crypto.randomUUID() })).status, 204);

assert.equal((await post({ kind: 'transfer_test_submitted', id: crypto.randomUUID() })).status, 204);

const rsa = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048,
  publicExponent: Uint8Array.of(1, 0, 1) };
const keys = await crypto.subtle.generateKey(rsa, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
jwk.kid = 'test-key';
globalThis.fetch = async () => Response.json({ keys: [jwk] });
const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
async function token(changes = {}) {
  const payload = { iss: 'https://example.cloudflareaccess.com', aud: ['example-app'],
    exp: now + 3600, email: env.ADMIN_OWNER_EMAIL, ...changes };
  const unsigned = encode({ kid: jwk.kid, alg: 'RS256' }) + '.' + encode(payload);
  const signature = await crypto.subtle.sign(rsa, keys.privateKey, new TextEncoder().encode(unsigned));
  return unsigned + '.' + Buffer.from(signature).toString('base64url');
}
const get = (jwt, days = 30) => onRequestGet({ env, request: new Request(
  origin + '/api/admin/stats?days=' + days, { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} }
) });
const good = await token();
assert.equal((await get()).status, 403);
assert.equal((await get(await token({ email: 'other@example.com' }))).status, 403);
assert.equal((await get(await token({ aud: ['another-app'] }))).status, 403);
assert.equal((await get(await token({ exp: now - 10 }))).status, 403);
assert.equal((await get(good.slice(0, good.lastIndexOf('.') + 1) + 'AAAA')).status, 403);
assert.equal((await get(good, 14)).status, 400);
const full = await (await get(good)).json();
assert.deepEqual(full.funnel, { first_invoice: 1, first_payment: 1, repeat_payment: 1 });
assert.deepEqual(full.counts, {
  invoice_live: 2, invoice_test: 1, paid_live: 2, paid_test: 1, transfer_submitted: 1, transfer_test_submitted: 1, wallet_created: 1
});
assert.equal(full.merchants.length, 1);
assert.equal(full.merchants[0].payments, 2);
assert.notEqual(full.merchants[0].id, first.w);
assert.equal(full.traffic, null);
assert.equal(full.history.total, 1);
assert.equal(full.history.paid_live, 1);
assert.equal(full.history.entries[0].amount, '3.20');
const week = await (await get(good, 7)).json();
assert.equal(week.funnel.first_invoice, 0);
assert.equal(week.funnel.repeat_payment, 1);
console.log('Passed: D1 events, owner authorization, retry deduplication, date filter, live/test split and counters');
