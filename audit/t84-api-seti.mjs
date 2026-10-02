/* API: поле network при выставлении счёта (1 октября 2026).
   — без поля счёт в BNB Chain, как было;
   — ethereum/base, пока контракт не выпущен, — понятный отказ, а не счёт,
     который никто не сможет оплатить;
   — после выпуска счёт в нужной сети, сумма с шестью знаками, ссылка на
     оплату несёт сеть; тот же номер заказа в другой сети — конфликт;
   — /me перечисляет сети, где можно выставлять счета;
   — /api/status понимает новые сети и не путает их с BNB. */
import crypto from 'node:crypto';
const API = await import('/home/claude/apk/functions/api/v1/[[path]].js');
const STATUS = await import('/home/claude/apk/functions/api/status.js');
let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined ? '  [' + String(d).slice(0, 160) + ']' : '')); };

const map = new Map();
const mkEnv = extra => Object.assign({ TILL: { async get(k){ return map.has(k) ? map.get(k) : null; }, async put(k, v){ map.set(k, v); }, async delete(k){ map.delete(k); } }, V1_NO_THROTTLE: 1 }, extra || {});
const asked = [];
globalThis.fetch = async (url, init) => {
  const req = JSON.parse(init.body); asked.push({ url: String(url), method: req.method });
  let result = '0x';
  if (req.method === 'eth_blockNumber') result = '0x100000';
  else if (req.method === 'eth_getLogs') result = [];
  else if (req.method === 'eth_call') result = '0x' + '0'.repeat(64 * 7);
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
};
const W = '0x' + 'ab'.repeat(20);
const key = 'tp_live_' + crypto.randomBytes(32).toString('base64url').slice(0, 43);
const kh = crypto.createHash('sha256').update(key).digest('hex');
map.set('v1:key:' + kh, JSON.stringify({ w: W, mode: 'live', ct: 1 }));
const tkey = 'tp_test_' + crypto.randomBytes(32).toString('base64url').slice(0, 43);
map.set('v1:key:' + crypto.createHash('sha256').update(tkey).digest('hex'), JSON.stringify({ w: W, mode: 'test', ct: 1 }));
const call = async (env, method, path, body, k) => {
  const r = await API.handle(new Request('https://wallet.tavarov.com/api/v1' + path, { method,
    headers: { authorization: 'Bearer ' + (k || key), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, () => {});
  return { status: r.status, body: await r.json() };
};

let env = mkEnv();
let r = await call(env, 'POST', '/invoices', { amount: '12.5', currency: 'USDT', order_id: 'A1' });
ok('без network — счёт в BNB Chain', r.status === 201 && r.body.network === 'bnb', JSON.stringify(r.body).slice(0, 120));
r = await call(env, 'POST', '/invoices', { amount: '12.5', currency: 'USDC', network: 'base', order_id: 'E1' }, tkey);
ok('тестовый ключ и Base — отказ network_unavailable (тестовая сеть только у BNB)', r.status === 400 && r.body.error.code === 'network_unavailable', JSON.stringify(r.body));
ok('и сказано почему: тестовый ключ — только BNB testnet', /BNB testnet only/.test(r.body.error.message), r.body.error.message);
r = await call(env, 'POST', '/invoices', { amount: '1', network: 'polygon' });
ok('незнакомая сеть — bad_network', r.status === 400 && r.body.error.code === 'bad_network');
r = await call(env, 'GET', '/me');
ok('/me: bnb, ethereum, base и solana', JSON.stringify(r.body.networks) === JSON.stringify({ bnb: ['USDT', 'USDC'], ethereum: ['USDT', 'USDC'], base: ['USDC'], solana: ['USDC', 'USDT'] }), JSON.stringify(r.body.networks));

// «после выпуска»: адрес контракта подставлен проверочной переменной
env = mkEnv({ TAVAROV_PAY: '0x' + '42'.repeat(20) });
r = await call(env, 'POST', '/invoices', { amount: '12.5', currency: 'USDC', network: 'ethereum', order_id: 'E1' });
ok('после выпуска счёт в Ethereum выставлен', r.status === 201 && r.body.network === 'eth', JSON.stringify(r.body).slice(0, 160));
const url = r.body.payment_url || '';
const p = (url.match(/[#?&]p=([A-Za-z0-9_-]+)/) || [])[1];
const o = p ? JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) : {};
ok('ссылка на оплату несёт net=eth', o.net === 'eth', JSON.stringify(o).slice(0, 120));
ok('сумма 12.5 USDC без потери знаков', r.body.amount === '12.5' && r.body.currency === 'USDC');
r = await call(env, 'POST', '/invoices', { amount: '12.5', currency: 'USDT', network: 'base' });
ok('USDT в Base — отказ (там только USDC)', r.status === 400 && r.body.error.code === 'bad_currency', JSON.stringify(r.body));
r = await call(env, 'POST', '/invoices', { amount: '12.5', currency: 'USDC', network: 'base', order_id: 'E1' });
ok('тот же номер заказа в другой сети — конфликт', r.status === 409 && r.body.error.code === 'order_exists', JSON.stringify(r.body).slice(0, 120));
r = await call(env, 'POST', '/invoices', { amount: '0.0000001', currency: 'USDC', network: 'ethereum' });
ok('седьмой знак у USDC в Ethereum не принимается', r.status === 400 && r.body.error.code === 'bad_amount');

// /api/status: сеть из запроса
asked.length = 0;
const st = async (net, extra) => { const q = new URLSearchParams({ h: '0x' + 'cd'.repeat(32), m: W, a: '1', c: 'USDC', net }); 
  const res = await STATUS.onRequestGet({ request: new Request('https://wallet.tavarov.com/api/status?' + q), env: extra || {} }); return { status: res.status, body: await res.json() }; };
let s1 = await st('baseTestnet');
ok('/api/status: неизвестная сеть (старая Base Sepolia) — 400, а не «не оплачено» в BNB', s1.status === 400 && /unknown network/.test(s1.body.error), JSON.stringify(s1.body));
asked.length = 0;
s1 = await st('eth');
ok('/api/status: Ethereum — узлы Ethereum и настоящий контракт', s1.status === 200 && asked.every(a => /ethereum|eth\./.test(a.url)), JSON.stringify(s1.body).slice(0, 80));
asked.length = 0;
s1 = await st('base', { TAVAROV_PAY: '0x' + '42'.repeat(20) });
ok('/api/status: Base спрашивает узлы Base', s1.status === 200 && asked.length > 0 && asked.every(a => /base/.test(a.url)), asked.map(a => a.url).join(',').slice(0, 120));
asked.length = 0;
s1 = await st('bnb');
ok('/api/status: BNB по-прежнему BNB', asked.every(a => /bsc|binance|bnbchain/.test(a.url)), asked.map(a => a.url).join(',').slice(0, 120));

console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(0);
