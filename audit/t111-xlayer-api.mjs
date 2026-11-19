/* t111: X Layer in the merchant API (functions/api/v1/[[path]].js).

   Against a fake X Layer node that behaves like OKX's: eth_getLogs over more
   than 100 blocks is refused with an error, every node. Checked:
   — an invoice with network "xlayer" is created (USDT = USDT0, USDC, six
     decimals), its payment link carries net=xlayer; /me lists xlayer; a test
     key is refused; an unknown network's error lists xlayer;
   — the timer (phase "xlayer") finds a USDT0 payment by reading the log in
     chunks of at most 100 blocks, and marks it paid only at 20 confirmations
     (19 is not enough);
   — a payment that sits 300 blocks back is still found (fourth chunk);
   — wrong token, too little, another merchant, or a Paid event from a
     contract that is not ours: NOT paid, no webhook;
   — the webhook says network "xlayer", is signed, and comes once;
   — GET finds the transaction hash through chunked reads too;
   — a chunk no node answers makes the scan an error, not a silent "nothing".

   Run: cd audit && node t111-xlayer-api.mjs   (no browser, no network) */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = await import(pathToFileURL(path.resolve(HERE, '../functions/api/v1/[[path]].js')).href);

let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'FAIL ') + n + (d !== undefined && !c ? '  [' + String(d).slice(0, 300) + ']' : '')); };

/* ---------- storage ---------- */
const map = new Map();
const env = { TILL: { async get(k){ return map.has(k) ? map.get(k) : null; }, async put(k, v){ map.set(k, v); }, async delete(k){ map.delete(k); } },
              V1_NO_THROTTLE: 1, CRON_SECRET: 'cron-secret-t111' };

/* ---------- the fake X Layer ---------- */
const PAY     = '0x29a318431053127e2fbf3c0ae9cbaf84cb6aa1d4';    // TavarovPay v3 on X Layer
const FAKEPAY = '0x' + '66'.repeat(20);                          // someone else's contract
const USDT0   = '0x779ded0c9e1022225f8e0630b35a9b54be713736';
const USDC    = '0xb6ceceab302e2e4948951ee7843fc24e92933061';
const PAID_TOPIC = '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861';
const XL_HOSTS = ['rpc.xlayer.tech', 'xlayer.drpc.org', 'xlayerrpc.okx.com'];
const W   = '0x' + 'ab'.repeat(20);     // the merchant
const W2  = '0x' + 'cd'.repeat(20);     // another merchant
const BUY = '0x' + '11'.repeat(20);
const w64 = v => BigInt(v).toString(16).padStart(64, '0');
const a64 = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

let head = 10_000;
const sales = {};        // h -> { merchant, amount, buyer, refunded, token, b }
const logs = [];         // { address, b, topics, data, tx }
let failRange = null;    // [lo, hi]: no node answers getLogs touching it
const seen = { calls: [], ranges: [], tooWide: 0, otherHosts: [], callTags: [] };
const hooks = [];

function pay(h, { merchant = W, amount, token = USDT0, b, contract = PAY, onChain = true }){
  const tx = '0x' + crypto.randomBytes(32).toString('hex');
  if (onChain) sales[h] = { merchant, amount: BigInt(amount), buyer: BUY, refunded: 0n, token, b };
  const fee = BigInt(amount) / 100n;
  logs.push({ address: contract, b, tx,
    topics: [PAID_TOPIC, '0x' + a64(merchant), '0x' + a64(BUY), '0x' + a64(token)],
    data: '0x' + w64(BigInt(amount) - fee) + w64(fee) + w64(0) + h.replace(/^0x/, '') });
  return tx;
}

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://shop.example/')){
    hooks.push({ headers: init.headers, body: init.body });
    return { status: 200, ok: true };
  }
  const host = u.replace(/^https?:\/\//, '').split('/')[0];
  const req = JSON.parse(init.body);
  seen.calls.push({ host, method: req.method });
  if (!XL_HOSTS.includes(host)){ seen.otherHosts.push(host); throw new Error('not an X Layer node: ' + host); }
  const reply = result => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
  const error = message => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32000, message } }) });
  if (req.method === 'eth_blockNumber') return reply('0x' + head.toString(16));
  if (req.method === 'eth_getLogs'){
    const f = req.params[0];
    const from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
    seen.ranges.push([from, to]);
    if (to - from + 1 > 100){ seen.tooWide++; return error('block range is too large, max 100'); }
    if (to > head) return error('block beyond head');
    if (failRange && from <= failRange[1] && to >= failRange[0]) return error('upstream timeout');
    const topics = f.topics || [];
    return reply(logs.filter(l => l.address === String(f.address).toLowerCase() && l.b >= from && l.b <= to &&
        topics.every((x, i) => !x || l.topics[i] === String(x).toLowerCase()))
      .map((l, i) => ({ address: l.address, topics: l.topics, data: l.data, transactionHash: l.tx,
                        blockNumber: '0x' + l.b.toString(16), logIndex: '0x' + i.toString(16) })));
  }
  if (req.method === 'eth_call'){
    const to = String(req.params[0].to).toLowerCase(), data = String(req.params[0].data);
    const tag = req.params[1];
    seen.callTags.push(tag);
    if (to !== PAY || !data.startsWith('0x38d56afe')) return error('execution reverted');
    const h = '0x' + data.slice(10).toLowerCase();
    const at = parseInt(tag, 16);
    const s = sales[h];
    if (!s || s.b > at) return reply('0x' + '0'.repeat(64 * 7));     // not paid (yet) at that depth
    return reply('0x' + a64(s.merchant) + w64(s.amount) + a64(s.buyer) + w64(s.refunded) + a64(s.token) + w64(0) + w64(0));
  }
  return error('method not supported in the fake node: ' + req.method);
};

/* ---------- merchant, key, webhook ---------- */
const key  = 'tp_live_' + crypto.randomBytes(32).toString('base64url').slice(0, 43);
const tkey = 'tp_test_' + crypto.randomBytes(32).toString('base64url').slice(0, 43);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
map.set('v1:key:' + sha(key), JSON.stringify({ w: W, mode: 'live', ct: 1 }));
map.set('v1:key:' + sha(tkey), JSON.stringify({ w: W, mode: 'test', ct: 1 }));
const SECRET = 'whsec_' + crypto.randomBytes(24).toString('base64url');
map.set('v1:acct:' + W, JSON.stringify({ w: W, ct: 1, keys: {}, webhook: { url: 'https://shop.example/hook', secret: SECRET, ct: 1 } }));

const call = async (method, p, body, auth) => {
  const r = await API.handle(new Request('https://wallet.tavarov.com/api/v1' + p, { method,
    headers: { authorization: auth || 'Bearer ' + key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined }), env, () => {});
  return { status: r.status, body: await r.json() };
};
const cron = () => call('GET', '/cron?phase=xlayer', null, 'Bearer ' + env.CRON_SECRET);
const reset = () => { seen.calls.length = 0; seen.ranges.length = 0; seen.callTags.length = 0; };
const stored = h => JSON.parse(map.get('v1:inv:' + h));
const newInvoice = async (amount, currency, order) => (await call('POST', '/invoices', { amount, currency, network: 'xlayer', order_id: order })).body;

/* ---------- 1. invoices ---------- */
ok('CRON_PHASES has xlayer', API.CRON_PHASES.includes('xlayer'), API.CRON_PHASES.join(','));
let r = await call('GET', '/me');
ok('/me lists xlayer with USDT and USDC', JSON.stringify(r.body.networks && r.body.networks.xlayer) === '["USDT","USDC"]', JSON.stringify(r.body.networks));
r = await call('POST', '/invoices', { amount: '1', network: 'polygon' });
ok('unknown network: bad_network, and the message lists xlayer', r.status === 400 && r.body.error.code === 'bad_network' && /xlayer/.test(r.body.error.message), JSON.stringify(r.body));
r = await call('POST', '/invoices', { amount: '1', network: 'xlayer' }, 'Bearer ' + tkey);
ok('test key on xlayer: network_unavailable (testnet is BNB only)', r.status === 400 && r.body.error.code === 'network_unavailable', JSON.stringify(r.body));
r = await call('POST', '/invoices', { amount: '1.0000001', currency: 'USDT', network: 'xlayer' });
ok('seventh decimal refused (USDT0 has six)', r.status === 400 && r.body.error.code === 'bad_amount', JSON.stringify(r.body));
r = await call('POST', '/invoices', { amount: '1', currency: 'DAI', network: 'xlayer' });
ok('unknown currency on xlayer refused, USDT/USDC offered', r.status === 400 && r.body.error.code === 'bad_currency' && /USDT, USDC/.test(r.body.error.message), JSON.stringify(r.body));
r = await call('POST', '/invoices', { amount: '25.5', currency: 'USDT', network: 'XLayer', order_id: 'X-1' });
ok('invoice on xlayer created (network name is case-insensitive)', r.status === 201 && r.body.network === 'xlayer' && r.body.amount === '25.5' && r.body.currency === 'USDT' && r.body.status === 'pending', JSON.stringify(r.body).slice(0, 200));
const inv1 = r.body;
const p = JSON.parse(Buffer.from((inv1.payment_url.match(/#p=([A-Za-z0-9_-]+)/) || [])[1] || '', 'base64url').toString('utf8') || '{}');
ok('payment link: /pay with net=xlayer, api=1', inv1.payment_url.startsWith('https://wallet.tavarov.com/pay#p=') && p.net === 'xlayer' && p.api === 1 && p.c === 'USDT' && p.a === '25.5', JSON.stringify(p));
r = await call('POST', '/invoices', { amount: '25.5', currency: 'USDT', order_id: 'X-1' });
ok('same order_id on BNB Chain: conflict, not a second invoice', r.status === 409 && r.body.error.code === 'order_exists', JSON.stringify(r.body));
ok('no node was asked while creating invoices', seen.calls.length === 0, JSON.stringify(seen.calls));

/* ---------- 2. confirmations ---------- */
const P1 = 10_003;
const tx1 = pay(inv1.id, { amount: 25_500_000n, b: P1 });
head = P1 + 5; reset();
r = await cron();
ok('cron phase xlayer runs, X Layer nodes only', r.status === 200 && r.body.phase === 'xlayer' && seen.otherHosts.length === 0 && seen.calls.length > 0, JSON.stringify(r.body) + ' ' + seen.otherHosts.join(','));
ok('every getLogs range is at most 100 blocks; no node refused a range', seen.ranges.length >= 4 && seen.ranges.every(([a, b]) => b - a + 1 <= 100) && seen.tooWide === 0, JSON.stringify(seen.ranges));
const safe0 = head - 20;
const cover = seen.ranges.slice().sort((x, y) => x[0] - y[0]);
ok('chunks cover the whole 400-block window up to head-20, no gaps', cover[0][0] === safe0 - 400 && cover[cover.length - 1][1] === safe0 && cover.every((c, i) => i === 0 || c[0] === cover[i - 1][1] + 1), JSON.stringify(cover));
ok('5 confirmations: still pending, no webhook', stored(inv1.id).st === 'pending' && hooks.length === 0, JSON.stringify(stored(inv1.id)));
head = P1 + 19; reset();
await cron();
ok('19 confirmations: still pending', stored(inv1.id).st === 'pending' && hooks.length === 0);
r = await call('GET', '/invoices/' + inv1.id);
ok('GET at 19 confirmations: pending', r.body.status === 'pending', JSON.stringify(r.body).slice(0, 160));
head = P1 + 20; reset();
r = await cron();
ok('20 confirmations: cron marks it paid', stored(inv1.id).st === 'paid', JSON.stringify(stored(inv1.id)));
ok('saleOf read exactly 20 blocks deep', seen.callTags.length > 0 && seen.callTags.every(t => parseInt(t, 16) === head - 20), JSON.stringify(seen.callTags));
ok('cron reports one Paid log scanned on xlayer, one delivered', r.body.scanned.xlayer === 1 && r.body.delivered === 1, JSON.stringify(r.body));
ok('ranges still ≤ 100 blocks', seen.ranges.every(([a, b]) => b - a + 1 <= 100) && seen.tooWide === 0);

/* ---------- 3. the webhook ---------- */
ok('one webhook', hooks.length === 1, hooks.length);
const ev = JSON.parse(hooks[0].body);
ok('webhook: invoice.paid, network xlayer, live', ev.type === 'invoice.paid' && ev.data.network === 'xlayer' && ev.livemode === true && ev.data.id === inv1.id, hooks[0].body.slice(0, 200));
ok('webhook: amount, currency, payer, tx', ev.data.payment && ev.data.payment.amount === '25.5' && ev.data.payment.currency === 'USDT' && ev.data.payment.payer === BUY && ev.data.payment.tx === tx1 && ev.data.payment.block === P1, JSON.stringify(ev.data.payment));
const sig = hooks[0].headers['tavarov-signature'] || '';
const m = sig.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
ok('webhook signature checks out with the secret', !!m && crypto.createHmac('sha256', SECRET).update(m[1] + '.' + hooks[0].body).digest('hex') === m[2], sig);
head += 3; reset();
await cron();
ok('next cron: no second webhook', hooks.length === 1, hooks.length);
r = await call('GET', '/invoices/' + inv1.id);
ok('GET: paid, network xlayer, tx recorded', r.body.status === 'paid' && r.body.network === 'xlayer' && r.body.payment.tx === tx1, JSON.stringify(r.body).slice(0, 200));

/* ---------- 4. found in an older chunk ---------- */
const inv2 = await newInvoice('3', 'USDC', 'X-2');
const P2 = 10_100;
pay(inv2.id, { amount: 3_000_000n, token: USDC, b: P2 });
head = P2 + 20 + 300; reset();
r = await cron();
ok('payment 300 blocks back (4th chunk) found: paid, USDC', stored(inv2.id).st === 'paid' && stored(inv2.id).pay.cur === 'USDC' && stored(inv2.id).pay.amount === '3', JSON.stringify(stored(inv2.id).pay));
ok('second webhook, for invoice 2, network xlayer', hooks.length === 2 && JSON.parse(hooks[1].body).data.id === inv2.id && JSON.parse(hooks[1].body).data.network === 'xlayer');
ok('ranges ≤ 100 blocks', seen.ranges.every(([a, b]) => b - a + 1 <= 100) && seen.tooWide === 0, JSON.stringify(seen.ranges));

/* ---------- 5. what must NOT be paid ---------- */
const bad = {};
bad.token  = await newInvoice('10', 'USDT', 'X-3');
bad.short  = await newInvoice('10', 'USDT', 'X-4');
bad.other  = await newInvoice('10', 'USDT', 'X-5');
bad.fake   = await newInvoice('10', 'USDT', 'X-6');
const PB = head + 5;
pay(bad.token.id, { amount: 10_000_000n, token: USDC, b: PB });                // paid in USDC, billed USDT
pay(bad.short.id, { amount: 9_999_999n, b: PB });                              // one unit short
pay(bad.other.id, { amount: 10_000_000n, merchant: W2, b: PB });               // to another merchant
pay(bad.fake.id,  { amount: 10_000_000n, b: PB, contract: FAKEPAY, onChain: false });   // Paid event from a contract that is not ours
head = PB + 25; reset();
await cron();
const st = k => stored(bad[k].id).st;
ok('wrong token: wrong_currency, not paid', st('token') === 'wrong_currency', st('token'));
ok('one unit short: underpaid, not paid', st('short') === 'underpaid', st('short'));
ok('another merchant: not paid', st('other') === 'pending', st('other'));
ok('Paid event from a foreign contract: not paid', st('fake') === 'pending', st('fake'));
ok('no webhook for any of them', hooks.length === 2, hooks.length);
const gets = [];
for (const k of Object.keys(bad)) gets.push((await call('GET', '/invoices/' + bad[k].id)).body.status);
ok('GET on all four: none says paid', JSON.stringify(gets) === '["wrong_currency","underpaid","pending","pending"]', JSON.stringify(gets));

/* ---------- 6. GET finds the tx by chunks ---------- */
const inv8 = await newInvoice('7.25', 'USDT', 'X-8');
const P8 = head - 20 - 150;    // already deep, never seen by the timer
const tx8 = pay(inv8.id, { amount: 7_250_000n, b: P8 });
reset();
r = await call('GET', '/invoices/' + inv8.id);
ok('GET: paid with the tx found in the second chunk', r.body.status === 'paid' && r.body.payment.tx === tx8 && r.body.payment.block === P8, JSON.stringify(r.body.payment));
ok('tx lookup stopped once found (2 chunks), each ≤ 100 blocks', seen.ranges.length === 2 && seen.ranges.every(([a, b]) => b - a + 1 <= 100), JSON.stringify(seen.ranges));
ok('GET does not send the webhook (the timer does)', hooks.length === 2);
reset();
r = await call('POST', '/invoices/' + inv8.id + '/check');
ok('/check (the payment page): paid, webhook goes out', r.body.status === 'paid' && hooks.length === 3 && JSON.parse(hooks[2].body).data.network === 'xlayer', JSON.stringify(r.body));

/* ---------- 7. a chunk nobody answers ---------- */
const inv9 = await newInvoice('5', 'USDT', 'X-9');
const P9 = head - 20 - 210;
pay(inv9.id, { amount: 5_000_000n, b: P9 });
failRange = [P9, P9];
reset();
r = await cron();
ok('a refused chunk: scan is an error, not "nothing there"', r.body.scanned.xlayer === 'error', JSON.stringify(r.body));
failRange = null;
reset();
r = await cron();
ok('next minute it is found', stored(inv9.id).st === 'paid' && hooks.length === 4, JSON.stringify(r.body));

/* ---------- 8. saleOf refused on X Layer: no guessing from the log ---------- */
const inv10 = await newInvoice('4', 'USDT', 'X-10');
pay(inv10.id, { amount: 4_000_000n, b: head - 30 });
env.TAVAROV_PAY = FAKEPAY;            // the fake node reverts every call to that address
reset();
r = await call('GET', '/invoices/' + inv10.id);
ok('saleOf reverts on X Layer: GET answers stale, not paid', r.body.status === 'pending' && r.body.stale === true, JSON.stringify(r.body).slice(0, 160));
ok('and no log history was scanned to guess', seen.ranges.length === 0, JSON.stringify(seen.ranges));
delete env.TAVAROV_PAY;

/* ---------- 9. the other networks are not touched by the xlayer phase ---------- */
ok('phase xlayer never asked a non-X Layer node', seen.otherHosts.length === 0, seen.otherHosts.join(','));

console.log('\n--- ' + okN + ' of ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
