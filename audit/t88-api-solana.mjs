/* API: счета в Solana (1 октября 2026). Выставление, ссылка, «оплачено»
   через таймер и через GET, вебхук. Сеть Solana подделана: метка счёта
   отвечает операцией, которую мы описали. */
import { toRaw } from './solraw.mjs';
import crypto from 'node:crypto';
const API = await import('/home/claude/apk/functions/api/v1/[[path]].js');
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');
let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined ? '  [' + String(d).slice(0, 160) + ']' : '')); };
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', TREASURY = 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU';
const SM = 'GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw', BUYER = 'CttRr6et6TryhMzCgZyKk9YyXp4TWXeYBkgZUg22Bxnt';
const ataOf = async (o, m) => SOL.b58enc(await SOL.ata(SOL.b58dec(o, 32), SOL.b58dec(m, 32)));
const map = new Map();
const env = { TILL: { async get(k){ return map.has(k) ? map.get(k) : null; }, async put(k, v){ map.set(k, v); }, async delete(k){ map.delete(k); } }, V1_NO_THROTTLE: 1 };
const paidRefs = new Map();       // метка -> операция
const hooks = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://shop.example')){ hooks.push(JSON.parse(init.body)); return { status: 200, ok: true }; }
  const q = JSON.parse(init.body);
  let result = null;
  if (q.method === 'eth_blockNumber') result = '0x100000';
  else if (q.method === 'eth_getLogs') result = [];
  else if (q.method === 'eth_call') result = '0x' + '0'.repeat(64 * 7);
  else if (q.method === 'getSignaturesForAddress') result = paidRefs.has(q.params[0]) ? [{ signature: 'sig-' + q.params[0].slice(0, 6), err: null }] : [];
  else if (q.method === 'getTransaction'){ for (const [ref, tx] of paidRefs) if (q.params[0] === 'sig-' + ref.slice(0, 6)) result = toRaw(tx); }
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: q.id, result }) };
};
const W = '0x' + 'ab'.repeat(20);
const key = 'tp_live_' + crypto.randomBytes(32).toString('base64url').slice(0, 43);
map.set('v1:key:' + crypto.createHash('sha256').update(key).digest('hex'), JSON.stringify({ w: W, mode: 'live', ct: 1 }));
map.set('v1:acct:' + W, JSON.stringify({ w: W, keys: {}, webhook: { url: 'https://shop.example/hook', secret: 'whsec_test' } }));
const call = async (method, path, body) => {
  const r = await API.handle(new Request('https://wallet.tavarov.com/api/v1' + path, { method,
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, () => {});
  return { status: r.status, body: await r.json() };
};

let r = await call('POST', '/invoices', { amount: '25', currency: 'USDC', network: 'solana' });
ok('без адреса Solana — понятный отказ', r.status === 400 && r.body.error.code === 'bad_solana_address', JSON.stringify(r.body));
r = await call('POST', '/invoices', { amount: '25', currency: 'USDC', network: 'solana', solana_address: SM, order_id: 'S1', shop_name: 'Shop' });
ok('счёт в Solana выставлен', r.status === 201 && r.body.network === 'solana' && r.body.solana_address === SM, JSON.stringify(r.body).slice(0, 160));
const inv = r.body;
const p = (inv.payment_url.match(/[#?&]p=([A-Za-z0-9_-]+)/) || [])[1];
const o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
ok('ссылка: продавец — адрес Solana, сеть solana', o.m === SM && o.net === 'solana' && o.h === inv.id, JSON.stringify(o).slice(0, 120));
r = await call('POST', '/invoices', { amount: '1', currency: 'USDT', network: 'solana', solana_address: SM });
ok('USDT в Solana тоже можно', r.status === 201);
r = await call('GET', '/me');
ok('/me перечисляет solana', Array.isArray(r.body.networks.solana) && r.body.networks.solana.includes('USDC'), JSON.stringify(r.body.networks));

// оплата пришла
const ref = SOL.refFromInvoice(inv.id);
paidRefs.set(ref, { meta: { err: null, innerInstructions: [] }, transaction: { message: { accountKeys: [{ pubkey: BUYER }, { pubkey: ref }], instructions: [
  { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint: USDC, destination: await ataOf(SM, USDC), authority: BUYER, tokenAmount: { amount: '24750000' } } } },
  { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint: USDC, destination: await ataOf(TREASURY, USDC), authority: BUYER, tokenAmount: { amount: '250000' } } } } ] } } });
const cron = await API.handle(new Request('https://wallet.tavarov.com/api/v1/cron', { method: 'POST' }), env, () => {});
const cj = await cron.json();
ok('таймер обошёл счета Solana', typeof cj.scanned.solana === 'number' && cj.scanned.solana >= 1, JSON.stringify(cj));
r = await call('GET', '/invoices/' + inv.id);
ok('счёт оплачен', r.body.status === 'paid' && r.body.payment && r.body.payment.payer === BUYER && r.body.payment.tx === 'sig-' + ref.slice(0, 6), JSON.stringify(r.body.payment));
ok('вебхук ушёл магазину', hooks.some(h => h.data && h.data.id === inv.id && h.type === 'invoice.paid'), JSON.stringify(hooks.map(h => h.type)));
const q = JSON.parse(map.get('v1:solq') || '[]');
ok('оплаченный убран из очереди Solana', !q.some(e => e.h === inv.id), q.length);

console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(0);
