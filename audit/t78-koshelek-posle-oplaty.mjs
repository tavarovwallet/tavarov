/* Счёт из Telegram-бота на странице оплаты и предложение NoN Wallet.

   Ссылка из бота должна открыть обычную страницу оплаты с суммой,
   описанием и названием магазина. Предложение «Тоже принимаете оплату? —
   NoN Wallet» появляется только ПОСЛЕ «Оплачено»: до оплаты ничто не
   должно уводить покупателя от кнопки «Оплатить». */
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

const map = new Map();
const env = { TILL: { async get(k){ return map.get(k) || null; }, async put(k, v){ map.set(k, v); }, async delete(k){ map.delete(k); } } };
const made = await API.createTgInvoice(env, { w: '0x73bbcd23735257660a9f6be57d057dc4a2abf432', a: '12.5', c: 'USDT',
  i: 'кофе и десерт', n: 'Кофейня на Садовой', tl: 'ru', chat: 752224143 });

const WWW = '/home/claude/apk/www', PORT = 8871;
let paid = false; const checks = [];
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/status'){
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(paid ? { paid: true, tx: '0x' + 'e'.repeat(64), payer: '0x' + '3'.repeat(40), source: 'sale' } : { paid: false }));
  }
  if (u.pathname.startsWith('/api/v1/invoices/') && req.method === 'POST'){
    checks.push(u.pathname); res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"paid"}');
  }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

for (const lang of ['ru', 'en', 'tr']){
  paid = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ru' ? 'ru-RU' : 'en-US' });
  await ctx.route(/bsc-dataseed|bnbchain\.org|publicnode\.com/, route => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '0'.repeat(64) }) }));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const url = made.url.replace('https://wallet.tavarov.com', 'http://localhost:' + PORT).replace(/&lang=ru$/, '&lang=' + lang);
  await page.goto(url);
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  if (lang === 'ru'){
    ok('ссылка из бота: сумма, описание и название магазина', /12[.,]5/.test(body) && body.includes('кофе и десерт') && body.includes('Кофейня на Садовой'), body.slice(0, 120).replace(/\n/g, ' | '));
  }
  ok(lang + ': до оплаты предложения NoN Wallet не видно', await page.evaluate(() => document.getElementById('promoCard').classList.contains('hidden')));
  paid = true;
  await page.waitForFunction(() => !document.getElementById('promoCard').classList.contains('hidden'), null, { timeout: 12000 }).catch(() => {});
  const st = await page.evaluate(() => { const c = document.getElementById('promoCard'); const a = document.getElementById('promoBtn');
    return { shown: !c.classList.contains('hidden'), text: c.innerText, href: a.href, target: a.target, rel: a.rel,
             payHidden: document.getElementById('openWallet').classList.contains('hidden') }; });
  ok(lang + ': после «Оплачено» — предложение NoN Wallet со ссылкой на скачивание', st.shown && st.href === 'https://tavarov.com/#download' && st.target === '_blank' && /noopener/.test(st.rel), st.text.replace(/\n/g, ' | '));
  ok(lang + ': текст на языке страницы', lang === 'ru' ? /Тоже принимаете оплату/.test(st.text) : lang === 'en' ? /get paid like this/.test(st.text) : /ödeme almak/.test(st.text));
  ok(lang + ': кнопки оплаты убраны, ошибок нет', st.payHidden && errors.length === 0, errors.join(' | '));
  if (lang === 'ru') ok('страница сама сообщила серверу об оплате (→ «Оплачено» в Telegram)', checks.some(p => p.includes(made.rec.h)));
  await ctx.close();
}

/* донат: предложение для стримеров, ссылка на страницу донатов */
for (const lang of ['ru', 'en']){
  paid = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ru' ? 'ru-RU' : 'en-US' });
  await ctx.route(/bsc-dataseed|bnbchain\.org|publicnode\.com/, route => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '0'.repeat(64) }) }));
  const page = await ctx.newPage();
  const inv = { m: '0x73bbcd23735257660a9f6be57d057dc4a2abf432', a: '5', c: 'USDT', h: '0x' + 'ab'.repeat(32), net: 'bnb', n: '@streamer', i: 'Донат', o: 'donate', t: Math.floor(Date.now() / 1000) + 3600 };
  await page.goto('http://localhost:' + PORT + '/pay?lang=' + lang + '#p=' + Buffer.from(JSON.stringify(inv)).toString('base64url'));
  await page.waitForTimeout(1000);
  paid = true;
  await page.waitForFunction(() => !document.getElementById('promoCard').classList.contains('hidden'), null, { timeout: 12000 }).catch(() => {});
  const st = await page.evaluate(() => ({ text: document.getElementById('promoCard').innerText, href: document.getElementById('promoBtn').href }));
  ok(lang + ': после доната — предложение стримерам и ссылка на страницу донатов',
    (lang === 'ru' ? /стримите/.test(st.text) && st.href === 'https://tavarov.com/crypto-donations' : /stream/.test(st.text) && st.href === 'https://tavarov.com/en/crypto-donations'), st.text.replace(/\n/g, ' | ') + ' ' + st.href);
  if (lang === 'ru'){
    await page.click('#langs button:has-text("EN")').catch(() => {});
    await page.waitForTimeout(300);
    ok('смена языка после оплаты переводит и предложение', /stream/.test(await page.evaluate(() => document.getElementById('promoCard').innerText)));
  }
  await ctx.close();
}
await browser.close(); srv.close();
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
