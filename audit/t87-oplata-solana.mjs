/* Страница оплаты: счёт в Solana (1 октября 2026). И копии ядра Solana. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const WWW = '/home/claude/apk/www', PORT = 8835;
let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined ? '  [' + String(d).slice(0, 150) + ']' : '')); };
const statusAsked = [];
let paid = false;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/status'){ statusAsked.push(u.search); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(paid ? { paid: true, source: 'solana' } : { paid: false })); }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const b64 = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const M = 'GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw', H = '0x' + 'cd'.repeat(32);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const open = async (inv, locale) => {
  const ctx = await browser.newContext({ locale: locale || 'ru-RU' });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:' + PORT + '/pay#p=' + b64(inv)); await page.waitForTimeout(600);
  return { ctx, page };
};
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; }, sel);

let { ctx, page } = await open({ m: M, a: '25', c: 'USDC', h: H, net: 'solana', n: 'Shop', i: 'Coffee', t: Math.floor(Date.now() / 1000) + 900 });
ok('счёт в Solana показан', await vis(page, '#main'));
ok('сеть Solana', (await page.textContent('#net')) === 'Solana');
const qrText = await page.evaluate(() => { const c = document.querySelector('#qr img, #qr canvas'); return document.getElementById('qr').title || ''; });
const built = await page.evaluate(() => { const q = new URLSearchParams({ m: inv.m, a: String(inv.a), c: inv.c, r: SOL.refFromInvoice(inv.h) }); return SOL.refFromInvoice(inv.h); });
ok('метка счёта считается', built === 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU' ? false : built.length >= 32, built);
ok('подсказка — про Phantom и Solflare', /Phantom/.test(await page.textContent('#qrHint')), await page.textContent('#qrHint'));
await page.evaluate(() => applyLang('en'));
ok('и после смены языка тоже', /Phantom/.test(await page.textContent('#qrHint')), await page.textContent('#qrHint'));
ok('кнопки MetaMask нет', !(await vis(page, '#openOther')));
const href = await page.getAttribute('#openWallet', 'href');
ok('«Открыть в NoN Wallet» несёт net=solana и продавца', decodeURIComponent(href || '').includes('net=solana') && decodeURIComponent(href || '').includes(M), decodeURIComponent(href).slice(0, 120));
await page.waitForTimeout(5500);
ok('страница спрашивает «оплачено ли» с net=solana', statusAsked.some(q => /net=solana/.test(q) && /c=USDC/.test(q)), statusAsked[0]);
paid = true; await page.waitForTimeout(5500);
ok('и показывает «оплачено»', /Оплачено|Paid/i.test(await page.textContent('#stateText')), await page.textContent('#stateText'));
await ctx.close();
({ ctx, page } = await open({ m: '0x' + 'ab'.repeat(20), a: '1', c: 'USDC', h: H, net: 'solana' }));
ok('адрес не Solana в счёте Solana — не показываем', !(await vis(page, '#main')));
await ctx.close();
({ ctx, page } = await open({ m: M, a: '1', c: 'TVR', h: H, net: 'solana' }));
ok('незнакомая монета в Solana — не показываем', !(await vis(page, '#main')));
await ctx.close();

// ---- копии ядра Solana одинаковые ----
const core = fs.readFileSync('/home/claude/sol/solcore.js', 'utf8');
ok('ядро в кошельке совпадает', fs.readFileSync(WWW + '/index.html', 'utf8').includes(core));
ok('ядро на странице оплаты совпадает', fs.readFileSync(WWW + '/pay.html', 'utf8').includes(core));
ok('ядро на сервере совпадает', fs.readFileSync('/home/claude/apk/functions/api/_sol.js', 'utf8').startsWith(core));

await browser.close(); srv.close();
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
if (errors.length) console.log('ОШИБКИ:', [...new Set(errors)].join(' | '));
process.exit(0);
