/* 25.11.2026: код на странице оплаты в BNB Chain, Ethereum и Base —
   обычная https-ссылка на эту же страницу (её открывает камера телефона и
   сканер любого кошелька), а не «tavarov:pay?…», который понимал только
   NoN Wallet. Solana — по-прежнему Solana Pay. И сам NoN Wallet такую
   ссылку из кода читает: сеть, сумма, продавец, номер счёта. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../www'), PORT = 8841;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')){ res.writeHead(200, { 'content-type':'application/json' }); return res.end('{"paid":false}'); }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const rows = [];
const ok = (n, c, d) => { rows.push(!!c); console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined ? '  [' + String(d).slice(0, 150) + ']' : '')); };
const b64 = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
async function qrOf(inv){
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  await ctx.addInitScript(() => {
    window.__qr = [];
    let real;
    Object.defineProperty(window, 'QRCode', { configurable: true,
      get(){ return real; },
      set(v){ real = function(el, o){ window.__qr.push(o && o.text); return new v(el, o); }; Object.assign(real, v); real.CorrectLevel = v.CorrectLevel; } });
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:' + PORT + '/pay#p=' + b64(inv));
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({ qr: window.__qr[window.__qr.length - 1] || '', hint: document.getElementById('qrHint').textContent.trim(),
                                         hintShown: !document.getElementById('qrHint').classList.contains('hidden') }));
  await ctx.close();
  return r;
}
const M = '0x73BBaAbB4c9Ee01e3Bf7C9D0Fd5C0b3f0D1eF432', H = '0x' + 'cd'.repeat(32);
const base = { m: M, a: '12.5', c: 'USDT', h: H, n: 'Кофейня', i: 'Латте', w: 'https://wallet.tavarov.com' };

const got = {};
for (const net of ['bnb', 'eth', 'base']){
  const r = await qrOf({ ...base, net, c: net === 'base' ? 'USDC' : 'USDT' });
  got[net] = r.qr;
  ok(net + ': код — https-ссылка на страницу оплаты с выбором кошелька',
     /^http:\/\/localhost:\d+\/pay\?p=[A-Za-z0-9_-]+&pick=1&lang=/.test(r.qr), r.qr.slice(0, 90));
  ok(net + ': в коде больше нет tavarov:pay', !/tavarov:pay/i.test(r.qr));
  ok(net + ': подсказка — любая камера или кошелёк', r.hintShown && /камеру телефона|phone camera/.test(r.hint), r.hint);
}
const sol = await qrOf({ ...base, net: 'solana', m: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', c: 'USDC' });
ok('solana: код — Solana Pay, как раньше', sol.qr.startsWith('solana:'), sol.qr.slice(0, 60));

const long = await qrOf({ ...base, net: 'bnb', n: 'Очень длинное название магазина '.repeat(6), i: 'Очень длинный товар '.repeat(8) });
ok('длинные название и товар не делают код нечитаемым (≤ 420 знаков)', long.qr.length <= 420, long.qr.length);

/* Сам NoN Wallet: его разборщик ссылок понимает этот код. */
const wctx = await browser.newContext(); const w = await wctx.newPage();
await w.goto('http://localhost:' + PORT + '/index.html'); await w.waitForFunction(() => typeof parsePayLink === 'function');
for (const net of ['bnb', 'eth', 'base']){
  const p = await w.evaluate(t => { const u = new URL(t); return parsePayLink('https://wallet.tavarov.com/pay' + u.search); }, got[net]);
  ok(net + ': NoN Wallet читает код — сеть, продавец, сумма, счёт',
     p && p.net === net && p.to.toLowerCase() === M.toLowerCase() && p.amt === '12.5' && p.inv === H, JSON.stringify(p).slice(0, 140));
}
await browser.close(); srv.close();
console.log('--- ' + rows.filter(Boolean).length + ' из ' + rows.length + ' ---');
process.exit(rows.every(Boolean) ? 0 : 1);
