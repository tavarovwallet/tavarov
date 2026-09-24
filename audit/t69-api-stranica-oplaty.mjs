/* Счёт, выставленный через API, на странице оплаты.

   payment_url из ответа API должен открыть обычную страницу оплаты с
   правильной суммой, валютой, заказом и магазином — без обращения к
   хранилищу (ссылка самодостаточна). После «Оплачено» страница сама
   просит сервер сообщить магазину (/check), а покупателя возвращает на
   success_url магазина с номером заказа. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const API = await import('/home/claude/apk/functions/api/v1/[[path]].js');

let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++;
  console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 200) + ']' : '')); };

/* ключ и счёт — настоящим сервером API */
const map = new Map();
const env = { TILL: { async get(k){ return map.get(k) || null; }, async put(k, v){ map.set(k, v); }, async delete(k){ map.delete(k); } } };
const W = '0x73bbcd23735257660a9f6be57d057dc4a2abf432';
map.set('v1:key:' + (await (async () => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tp_live_' + 'Q'.repeat(43)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
})()), JSON.stringify({ w: W, mode: 'live' }));
const r = await API.handle(new Request('https://wallet.tavarov.com/api/v1/invoices', { method: 'POST',
  headers: { authorization: 'Bearer tp_live_' + 'Q'.repeat(43), 'content-type': 'application/json' },
  body: JSON.stringify({ amount: '12.50', currency: 'USDT', order_id: 'A-1001', description: 'Кроссовки',
                         shop_name: 'Мой магазин', success_url: 'https://shop.example/thanks', lang: 'ru' }) }), env);
const inv = await r.json();
ok('счёт выставлен через API', r.status === 201);

/* страница оплаты — из www */
const WWW = '/home/claude/apk/www', PORT = 8869;
let paid = false; const checks = []; const statusAsks = [];
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/status'){
    statusAsks.push(u.search);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(paid ? { paid: true, tx: '0x' + 'e'.repeat(64), payer: '0x' + '3'.repeat(40), source: 'sale' } : { paid: false }));
  }
  if (u.pathname.startsWith('/api/v1/invoices/') && req.method === 'POST'){
    checks.push(u.pathname);
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"paid"}');
  }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(res => srv.listen(PORT, res));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
await ctx.route(/bsc-dataseed|bnbchain\.org|publicnode\.com/, route => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '0'.repeat(64) }) }));
let landed = null;
await ctx.route('https://shop.example/**', route => { landed = route.request().url(); route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>thanks</h1>' }); });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));

const local = inv.payment_url.replace('https://wallet.tavarov.com', 'http://localhost:' + PORT);
await page.goto(local);
await page.waitForTimeout(1500);
const body = await page.evaluate(() => document.body.innerText);
ok('СТРАНИЦА ОПЛАТЫ ОТКРЫЛАСЬ ПО ССЫЛКЕ ИЗ API — сумма и валюта', /12\.5/.test(body) && /USDT/.test(body), body.slice(0, 160).replace(/\n/g, ' | '));
ok('магазин, товар и заказ на месте', body.includes('Мой магазин') && body.includes('Кроссовки') && body.includes('A-1001'));
ok('язык из lang=ru', /Оплат|оплат/.test(body));
ok('страница спрашивает статус именно этого счёта, суммы и валюты',
  statusAsks.some(q => q.includes('h=' + inv.id) && q.includes('a=12.5') && q.includes('c=USDT') && q.toLowerCase().includes('m=' + W)), statusAsks[0]);
ok('пока не оплачено — магазин не беспокоим', checks.length === 0);

paid = true;
await page.waitForFunction(() => /Оплачено|Paid/i.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(500);
ok('ОПЛАЧЕНО — СТРАНИЦА СРАЗУ ПРОСИТ СЕРВЕР СООБЩИТЬ МАГАЗИНУ', checks.length === 1 && checks[0] === '/api/v1/invoices/' + inv.id + '/check', checks.join());
await page.waitForTimeout(3500);
ok('ПОКУПАТЕЛЬ ВЕРНУЛСЯ НА САЙТ МАГАЗИНА С НОМЕРОМ ЗАКАЗА', !!landed && landed.startsWith('https://shop.example/thanks') && landed.includes('tavarov_order=A-1001'), landed);

/* обычный счёт (не из API) /check не зовёт */
const plain = inv.payment_url.split('#p=')[1].split('&')[0];
const o = JSON.parse(Buffer.from(plain.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
delete o.api; delete o.r;
const b64 = Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const p2 = await ctx.newPage();
p2.on('pageerror', e => errors.push(e.message));
const before = checks.length;
await p2.goto('http://localhost:' + PORT + '/pay#p=' + b64);
await p2.waitForTimeout(2500);
ok('обычный счёт (не из API) сервер API не дёргает', checks.length === before);

/* Контракт тестовой сети отказывает на saleOf — это ответ, а не упавшая сеть. */
await ctx.unroute(/bsc-dataseed|bnbchain\.org|publicnode\.com/);
await ctx.route(/bsc-dataseed|bnbchain\.org|publicnode\.com/, route => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } }) }));
const rv = await p2.evaluate(async () => {
  const a = await readRpc('bnbTestnet', 'eth_call', [{ to: '0x3A3Ba9776ea9c48AE6C69Ae6153d9bBc892ed6e6', data: '0x38d56afe' }, 'latest'], { revertOk: true });
  let b = 'no-throw'; try{ await readRpc('bnbTestnet', 'eth_call', [{ to: '0x3A3Ba9776ea9c48AE6C69Ae6153d9bBc892ed6e6', data: '0x38d56afe' }, 'latest']); } catch(e){ b = 'threw'; }
  return [a, b];
});
ok('ТЕСТОВАЯ СЕТЬ: отказ старого контракта на saleOf не валит оплату (null), а без разрешения — ошибка как раньше', rv[0] === null && rv[1] === 'threw', JSON.stringify(rv));

ok('ни одной ошибки JavaScript', errors.length === 0, errors.join(' | '));
await browser.close(); srv.close();
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
