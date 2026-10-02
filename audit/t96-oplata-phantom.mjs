/* Оплата счёта Solana кошельком в его же браузере (1 октября 2026).

   На iPhone свой экран не отсканировать. Страница оплаты: вне кошелька —
   кнопки «Оплатить в Phantom / Solflare» (открывают эту же оплату в
   браузере кошелька); внутри Phantom — «Оплатить этим кошельком»:
   операцию собирает наш сервер (та же, что по QR, с 1% в казну), кошелёк
   подписывает и отправляет. Ключа страница не видит. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const SP = await import('/home/claude/apk/functions/api/solpay.js');
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');
let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 200) + ']' : '')); };

globalThis.fetch = async (url, init) => {
  const q = JSON.parse(init.body);
  const result = q.method === 'getLatestBlockhash' ? { value: { blockhash: '9HTCXxaceMEAdwwUBuSyVHbS7iN14iH4UndyZ89J7qGi' } } : null;
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: q.id, result }) };
};
const M = 'GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw', BUYER = 'CttRr6et6TryhMzCgZyKk9YyXp4TWXeYBkgZUg22Bxnt';
const H = '0x' + 'cd'.repeat(32);
const WWW = '/home/claude/apk/www', PORT = 8961;
const solpayCalls = []; let lastTx = null;
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/solpay'){
    let body = ''; for await (const c of req) body += c;
    solpayCalls.push({ q: u.search, body });
    const r = await SP.onRequestPost({ request: new Request('https://wallet.tavarov.com' + u.pathname + u.search, { method: 'POST', body }), env: {} });
    const t = await r.text(); try{ lastTx = JSON.parse(t).transaction; } catch(e){}
    res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(t);
  }
  if (u.pathname === '/api/status'){ res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"paid":false}'); }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  let f = path.join(WWW, rel); if (!fs.existsSync(f)) f = path.join(WWW, 'lib', rel);
  if (!fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const inv = { m: M, a: '12.5', c: 'USDC', h: H, net: 'solana', n: 'Кофейня', i: 'Латте', t: Math.floor(Date.now() / 1000) + 3600 };
const URL0 = 'http://localhost:' + PORT + '/pay?lang=ru#p=' + b64url(inv);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const vis = (pg, id) => pg.evaluate(i => { const e = document.getElementById(i); return !!e && !e.classList.contains('hidden') && !e.closest('.hidden'); }, id);

// ---- вне кошелька ----
let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
let pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL0); await pg.waitForTimeout(700);
ok('iPhone без кошелька: кнопки «Оплатить в Phantom» и «в Solflare»', await vis(pg, 'solPhantom') && await vis(pg, 'solSolflare') && !(await vis(pg, 'solPayHere')));
const ph = await pg.getAttribute('#solPhantom', 'href');
const inner = decodeURIComponent(ph.split('/ul/browse/')[1].split('?ref=')[0]);
const p = JSON.parse(Buffer.from(new URL(inner).searchParams.get('p').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
ok('ссылка Phantom — эта же оплата (продавец, сумма, номер счёта, сеть)', ph.startsWith('https://phantom.app/ul/browse/') && p.m === M && p.a === '12.5' && p.h === H && p.net === 'solana' && p.c === 'USDC', JSON.stringify(p));
{ // общий счёт кассы (ft) — признак едет в ссылку Phantom (аудит 2.10.2026)
  const pg2 = await ctx.newPage();
  await pg2.goto('http://localhost:' + PORT + '/pay?lang=ru#p=' + b64url(Object.assign({}, inv, { ft: 1, s: 'abc', o: 'Заказ 7' }))); await pg2.waitForTimeout(600);
  const ph2 = await pg2.getAttribute('#solPhantom', 'href');
  const in2 = decodeURIComponent(ph2.split('/ul/browse/')[1].split('?ref=')[0]);
  const p2 = JSON.parse(Buffer.from(new URL(in2).searchParams.get('p').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  ok('общий счёт кассы: в ссылке Phantom есть ft и s (чужая оплата не станет «вашей»)', p2.ft === 1 && p2.s === 'abc' && p2.o === 'Заказ 7', JSON.stringify(p2));
  await pg2.goto('http://localhost:' + PORT + '/pay?lang=ru#p=' + b64url({ m: M, a: '3', h: H, net: 'solana' })); await pg2.waitForTimeout(500);
  ok('счёт Solana без валюты — USDC', /USDC/.test(await pg2.textContent('body')) && !/USDT/.test(await pg2.textContent('#amount').catch(() => '')));
}
await ctx.close();

// ---- внутри Phantom ----
ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(buyer => {
  window.__req = [];
  window.phantom = { solana: { isPhantom: true, publicKey: null,
    connect: async () => { window.phantom.solana.publicKey = { toString: () => buyer }; return { publicKey: { toString: () => buyer } }; },
    request: async (a) => { window.__req.push(a); return { signature: '5'.repeat(88), publicKey: buyer }; } } };
}, BUYER);
pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL0); await pg.waitForTimeout(700);
ok('в браузере Phantom — «Оплатить этим кошельком», ссылок нет', await vis(pg, 'solPayHere') && !(await vis(pg, 'solPhantom')));
await pg.click('#solPayHere'); await pg.waitForTimeout(800);
const req = await pg.evaluate(() => window.__req);
ok('операцию собрал наш сервер — на кошелёк покупателя и этот счёт', solpayCalls.length === 1 && JSON.parse(solpayCalls[0].body).account === BUYER && solpayCalls[0].q.includes('m=' + M) && solpayCalls[0].q.includes('r=' + SOL.refFromInvoice(H)), JSON.stringify(solpayCalls[0]));
const msg = Buffer.from(lastTx, 'base64').slice(65);
ok('кошельку отдано ровно это сообщение (base58) на подпись и отправку', req.length === 1 && req[0].method === 'signAndSendTransaction' && Buffer.from(SOL.b58dec(req[0].params.message)).equals(msg), JSON.stringify(req).slice(0, 120));
ok('ошибки не показано', !(await vis(pg, 'solPayErr')), await pg.textContent('#solPayErr'));
ok('плательщик запомнен — «оплачено» будет своим', await pg.evaluate(b => inv.payer === b, BUYER));
await pg.evaluate(() => { window.phantom.solana.request = async () => { throw new Error('User rejected the request.'); }; });
await pg.click('#solPayHere'); await pg.waitForTimeout(700);
ok('отказ в кошельке — сказано словами', await vis(pg, 'solPayErr') && /User rejected/.test(await pg.textContent('#solPayErr')), await pg.textContent('#solPayErr'));
await ctx.close();

// ---- счёт не в Solana ----
ctx = await browser.newContext(); pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message));
await pg.goto('http://localhost:' + PORT + '/pay?lang=ru#p=' + b64url({ m: '0x9B68E34De911333310188C5fAcC0fe8ABc1d5dD1', a: '5', c: 'USDT', h: H, net: 'bnb' }));
await pg.waitForTimeout(500);
ok('счёт в BNB — кнопок Solana нет', !(await vis(pg, 'solWallets')));
ok('ошибок на странице нет', errs.length === 0, errs.join(' | '));
await browser.close(); srv.close();
console.log('--- ' + okN + ' из ' + (okN + badN) + ' ---');
