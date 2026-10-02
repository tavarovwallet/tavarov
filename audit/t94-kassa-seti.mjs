/* Касса с наклейкой во всех сетях (1 октября 2026).

   Одна наклейка: продавец называет сумму, покупатель платит в BNB,
   Ethereum, Base или Solana — где у него доллары. Проверяется:
   — сервер кассы принимает выбор сети только подписанным продавцом, только
     за доллары и только в основной сети; адрес Solana — тоже под подписью;
   — старая касса (без выбора) работает как раньше;
   — «оплачено ли» умеет «любой доллар сети» (c=USD) в EVM и в Solana;
   — страница наклейки показывает сети, подменяет USDT на USDC в Base и
     берёт адрес Solana из подписанной записи;
   — приложение продавца шлёт выбор и адрес Solana под подписью и замечает
     оплату в другой сети. */
import { toRaw } from './solraw.mjs';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const TILL = await import('/home/claude/apk/functions/api/till.js');
const STATUS = await import('/home/claude/apk/functions/api/status.js');
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');
const R = reporter();

const seller = E.Wallet.createRandom();
const M = seller.address;
const SM = 'GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw';
const H = '0x' + 'ab'.repeat(32);

// ---------- поддельные узлы для сервера ----------
const sales = {};                 // net -> { merchant, amount, token }
const solTx = [];
const w = v => BigInt(v).toString(16).padStart(64, '0');
const wa = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const netOf = url => /ethereum|eth\.drpc/.test(url) ? 'eth' : /base/.test(url) ? 'base' : 'bnb';
globalThis.fetch = async (url, init) => {
  const q = JSON.parse(init.body);
  let result = null;
  if (q.method === 'eth_call'){
    const { to, data } = q.params[0];
    if (/0{39}1$/.test(to)){
      const hash = '0x' + data.slice(2, 66), v = parseInt(data.slice(66, 130), 16), r = '0x' + data.slice(130, 194), s = '0x' + data.slice(194, 258);
      result = '0x' + wa(E.utils.recoverAddress(hash, { r, s, v }));
    } else if (data.startsWith('0x38d56afe')){
      const sl = sales[netOf(String(url))];
      result = sl ? '0x' + wa(sl.merchant) + w(sl.amount) + wa('0x' + '77'.repeat(20)) + w(0) + wa(sl.token) + w(0) + w(0) : '0x' + '0'.repeat(448);
    } else result = '0x' + '0'.repeat(448);
  }
  else if (q.method === 'eth_blockNumber') result = '0x100000';
  else if (q.method === 'eth_getLogs') result = [];
  else if (q.method === 'getSignaturesForAddress') result = solTx.map((t, i) => ({ signature: 's' + i, err: null }));
  else if (q.method === 'getTransaction') result = toRaw(solTx[Number(q.params[0].slice(1))]);
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: q.id, result }) };
};
const env = { TILL: (() => { const m = new Map(); return { get: async k => m.has(k) ? m.get(k) : null, put: async (k, v) => { m.set(k, v); }, delete: async k => m.delete(k) }; })(), V1_NO_THROTTLE: '1' };
const text = o => ['Tavarov till', 'action: ' + o.action, 'merchant: ' + o.m.toLowerCase(), 'till: ' + o.k, 'network: ' + o.net,
  'currency: ' + (o.c || ''), 'amount: ' + (o.a || ''), 'item: ' + (o.i || ''), 'order: ' + (o.o || ''), 'invoice: ' + (o.h || ''),
  ...(o.x ? ['networks: all'] : []), ...(o.s ? ['solana: ' + o.s] : []), 'time: ' + o.ts].join('\n');
const post = async (o, signWith) => {
  const sig = await seller.signMessage(text(signWith || o));
  const r = await TILL.onRequestPost({ env, request: new Request('https://wallet.tavarov.com/api/till', { method: 'POST', body: JSON.stringify(Object.assign({}, o, { sig })) }) });
  return { status: r.status, body: await r.json() };
};
const get = async (k) => (await TILL.onRequestGet({ env, request: new Request('https://wallet.tavarov.com/api/till?m=' + M + '&k=' + k + '&net=bnb') })).json();
let ts = Math.floor(Date.now() / 1000);
const base = { action: 'set', m: M, k: 1, net: 'bnb', c: 'USDT', a: '5', i: 'Кофе', o: '', h: H };

let r = await post(Object.assign({}, base, { ts: ts++, x: 1, s: SM }));
R.ok('СЕРВЕР: касса с выбором сети и адресом Solana — принята', r.status === 200 && r.body.ok, JSON.stringify(r.body));
let g = await get(1);
R.ok('наклейка отдаёт сети BNB, Ethereum, Base, Solana и адрес Solana', JSON.stringify(g.nets) === '["bnb","eth","base","solana"]' && g.sm === SM && g.amount === '5', JSON.stringify(g));
r = await post(Object.assign({}, base, { ts: ts++, x: 1, s: SM }), Object.assign({}, base, { ts: ts - 1 }));
R.ok('подпись без строк о сетях — отказ (выбор сети не подделать)', r.status === 403 || r.status === 409, JSON.stringify(r.body));
r = await post(Object.assign({}, base, { ts: ts++, x: 1, s: 'EvH4yY1mXH2Df6Rz3oMCTWNYBo3mz5zxKJKdgTLLjbLH' }));
r = await post(Object.assign({}, base, { k: 2, ts: ts++, x: 1, s: await SOL.b58enc(await SOL.ata(SOL.b58dec(SM, 32), SOL.b58dec('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 32))) }));
R.ok('адрес Solana не кошелёк (адрес программы) — отказ', r.status === 400, JSON.stringify(r.body));
r = await post(Object.assign({}, base, { k: 3, c: 'TVR', ts: ts++, x: 1 }));
R.ok('выбор сети за TVR — отказ (TVR только в BNB)', r.status === 400, JSON.stringify(r.body));
r = await post(Object.assign({}, base, { k: 4, ts: ts++, s: SM }));
R.ok('адрес Solana без выбора сети — отказ', r.status === 400, JSON.stringify(r.body));
r = await post(Object.assign({}, base, { k: 5, ts: ts++ }));
g = await get(5);
R.ok('старая касса (без выбора) — как раньше, без списка сетей', r.status === 200 && !g.nets && !g.sm && g.cur === 'USDT', JSON.stringify(g));
r = await post(Object.assign({}, base, { k: 6, net: 'bnbTestnet', ts: ts++, x: 1 }));
R.ok('в тестовой сети выбора сетей нет — отказ', r.status === 400);

// ---------- «оплачено ли»: любой доллар сети ----------
const st = async (q) => { const res = await STATUS.onRequestGet({ request: new Request('https://wallet.tavarov.com/api/status?' + new URLSearchParams(q)), env: {} }); return { status: res.status, body: await res.json() }; };
sales.base = { merchant: M, amount: 5_000_000n, token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
let s1 = await st({ h: H, m: M, a: '5', c: 'USD', net: 'base' });
R.ok('STATUS c=USD: в Base оплачено 5 USDC — оплачено', s1.body.paid === true, JSON.stringify(s1.body));
sales.base.amount = 4_990_000n;
s1 = await st({ h: H, m: M, a: '5', c: 'USD', net: 'base' });
R.ok('меньше суммы — не оплачено', s1.body.paid === false && s1.body.underpaid, JSON.stringify(s1.body));
sales.eth = { merchant: M, amount: 5_000_000n, token: '0xdAC17F958D2ee523a2206206994597C13D831ec7' };
s1 = await st({ h: H, m: M, a: '5', c: 'USD', net: 'eth' });
R.ok('в Ethereum USDT — тоже доллар, оплачено', s1.body.paid === true, JSON.stringify(s1.body));
sales.eth.token = '0x' + '12'.repeat(20);
s1 = await st({ h: H, m: M, a: '5', c: 'USD', net: 'eth' });
R.ok('чужая монета — не оплачено', s1.body.paid === false && s1.body.wrongToken, JSON.stringify(s1.body));
sales.bnb = { merchant: M, amount: 5n * 10n ** 18n, token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' };
s1 = await st({ h: H, m: M, a: '5', c: 'USD', net: 'bnb' });
R.ok('в BNB USDC (18 знаков) — оплачено', s1.body.paid === true, JSON.stringify(s1.body));
const ref = SOL.refFromInvoice(H);
const USDT_SOL = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', TRE = 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU';
const ataOf = async (o, m) => SOL.b58enc(await SOL.ata(SOL.b58dec(o, 32), SOL.b58dec(m, 32)));
solTx.push({ meta: { err: null, innerInstructions: [] }, transaction: { message: { accountKeys: [{ pubkey: 'CttRr6et6TryhMzCgZyKk9YyXp4TWXeYBkgZUg22Bxnt' }, { pubkey: ref }], instructions: [
  { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint: USDT_SOL, destination: await ataOf(SM, USDT_SOL), authority: 'CttRr6et6TryhMzCgZyKk9YyXp4TWXeYBkgZUg22Bxnt', tokenAmount: { amount: '4950000' } } } },
  { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint: USDT_SOL, destination: await ataOf(TRE, USDT_SOL), authority: 'CttRr6et6TryhMzCgZyKk9YyXp4TWXeYBkgZUg22Bxnt', tokenAmount: { amount: '50000' } } } } ] } } });
s1 = await st({ h: H, m: SM, a: '5', c: 'USD', net: 'solana' });
R.ok('в Solana USDT по метке счёта — оплачено', s1.body.paid === true, JSON.stringify(s1.body));

// ---------- страница наклейки ----------
const WWW = '/home/claude/apk/www', PORT = 8941;
let tillAnswer = { amount: '5', cur: 'USDT', item: 'Кофе', h: H, setAt: ts, expiresAt: ts + 600, nets: ['bnb', 'eth', 'base', 'solana'], sm: SM, source: 'till' };
const srv = http.createServer((req, res) => {
  const [p] = req.url.split('?');
  if (p === '/api/till'){ res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(Object.assign({ now: Math.floor(Date.now() / 1000) }, tillAnswer))); }
  if (p === '/api/status'){ res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"paid":false}'); }
  let rel = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!fs.existsSync(f)){ const f2 = path.join(WWW, 'lib', rel); if (fs.existsSync(f2)){ res.writeHead(200); return res.end(fs.readFileSync(f2)); } res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(res => srv.listen(PORT, res));
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const pg = await (await br.newContext({ viewport: { width: 414, height: 896 }, locale: 'ru-RU' })).newPage();
const perr = []; pg.on('pageerror', e => perr.push(e.message));
const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
await pg.goto('http://localhost:' + PORT + '/pay?lang=ru#t=' + b64url({ m: M, k: 1, n: 'Кофейня', net: 'bnb' }));
await pg.waitForFunction(() => !document.getElementById('tillGot').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
const nets = await pg.$$eval('#tillNets button', b => b.map(x => x.textContent));
R.ok('СТРАНИЦА: четыре сети на выбор', JSON.stringify(nets) === '["BNB Chain","Ethereum","Base","Solana"]' && /В какой сети/.test(await pg.textContent('#tillNetBox')), JSON.stringify(nets));
await pg.click('#tillNets button:has-text("Base")');
R.ok('Base: USDT заменён на USDC', /5 USDC/.test(await pg.textContent('#tillAmount')), await pg.textContent('#tillAmount'));
await pg.click('#tillPay'); await pg.waitForTimeout(500);
let inv = await pg.evaluate(() => inv && { net: inv.net, c: inv.c, m: inv.m, h: inv.h, a: inv.a });
R.ok('счёт: Base, USDC, адрес продавца, номер счёта кассы', inv && inv.net === 'base' && inv.c === 'USDC' && inv.m === M && inv.h === H && inv.a === '5', JSON.stringify(inv));
await pg.goto('http://localhost:' + PORT + '/pay?lang=ru&x=2#t=' + b64url({ m: M, k: 1, n: 'Кофейня', net: 'bnb' }));
await pg.waitForFunction(() => !document.getElementById('tillGot').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
await pg.click('#tillNets button:has-text("Solana")');
await pg.click('#tillPay'); await pg.waitForTimeout(500);
inv = await pg.evaluate(() => inv && { net: inv.net, c: inv.c, m: inv.m });
R.ok('Solana: адрес — из подписанной записи, USDT остаётся', inv && inv.net === 'solana' && inv.m === SM && inv.c === 'USDT', JSON.stringify(inv));
tillAnswer = { amount: '7', cur: 'USDT', item: '', h: H, setAt: ts, expiresAt: ts + 600, source: 'till' };
await pg.goto('http://localhost:' + PORT + '/pay?lang=ru&x=3#t=' + b64url({ m: M, k: 1, n: 'Кофейня', net: 'bnb' }));
await pg.waitForFunction(() => !document.getElementById('tillGot').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
R.ok('старая касса — выбора нет, BNB как раньше', await pg.evaluate(() => document.getElementById('tillNetBox').classList.contains('hidden')));
await pg.click('#tillPay'); await pg.waitForTimeout(400);
R.ok('и счёт в BNB', await pg.evaluate(() => inv.net) === 'bnb');
R.ok('ошибок на странице нет', perr.length === 0, perr.join(' | '));
await br.close(); srv.close();

// ---------- приложение продавца ----------
await start(8595);
const { browser, page, errors } = await boot({ role: 'seller', rpc: 'http://localhost:8595' });
const pushed = []; let paidNet = null;
await page.route('**/api/till', async route => {
  const b = JSON.parse(route.request().postData()); pushed.push(b);
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});
await page.route('**/api/status?**', route => {
  const q = Object.fromEntries(new URL(route.request().url()).searchParams);
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ paid: q.net === paidNet && q.c === 'USD' }) });
});
const me = await page.evaluate(() => ({ evm: wallet.evm.address, sol: wallet.solana.address }));
await page.evaluate(() => { setTab('pay'); setPayMode('kassa'); });
await page.evaluate(() => { document.getElementById('kassaCurrency').value = 'USDT'; document.getElementById('kassaAmount').value = '5'; });
await page.evaluate(() => createTicket({}));
await page.waitForTimeout(800);
const set = pushed.find(b => b.action === 'set') || {};
R.ok('ПРИЛОЖЕНИЕ: на наклейку ушли выбор сети и адрес Solana', set.x === 1 && set.s === me.sol && set.net === 'bnb' && set.c === 'USDT', JSON.stringify(set).slice(0, 200));
R.ok('подпись покрывает и выбор, и адрес Solana', !!set.sig && E.utils.verifyMessage(text(set), set.sig).toLowerCase() === me.evm.toLowerCase());
R.ok('продавцу сказано: покупатель заплатит в любой сети', /в любой сети/.test(await page.textContent('#ticketTillHint')), await page.textContent('#ticketTillHint'));
paidNet = 'base';
await page.waitForFunction(() => /Base/.test(document.getElementById('kassaStatusPill').textContent), null, { timeout: 20000 }).catch(() => {});
R.ok('ОПЛАТА В BASE ЗАМЕЧЕНА: «Оплачено в сети Base»', /Оплачено в сети Base/.test(await page.textContent('#kassaStatusPill')), await page.textContent('#kassaStatusPill'));
await page.waitForTimeout(400);
R.ok('и наклейка снята', pushed.some(b => b.action === 'clear'));
const own = errors.filter(e => !/Failed to load resource|ERR_|net::|503/.test(e));
R.ok('ошибок в коде приложения нет', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
