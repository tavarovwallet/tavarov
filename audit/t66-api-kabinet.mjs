/* Кабинет разработчика wallet.tavarov.com/dev — в настоящем браузере, против
   настоящего сервера API (functions/api/v1), с поддельными только сетью и
   хранилищем.

   Путь программиста магазина: вошёл кошельком → взял ключ → вписал вебхук →
   проверка дошла → счёт, выставленный ключом, виден в кабинете. И вход из
   NoN Wallet по подписи в адресе — в том числе с подделанной подписью. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const API = await import('/home/claude/apk/functions/api/v1/[[path]].js');

let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++;
  console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 200) + ']' : '')); };

/* ---------- хранилище и сеть для сервера API ---------- */
const map = new Map();
const env = { TILL: {
  async get(k){ return map.has(k) ? map.get(k) : null; },
  async put(k, v){ map.set(k, v); }, async delete(k){ map.delete(k); } }, V1_NO_THROTTLE: 1 };
const hooks = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://shop.example')){ hooks.push({ headers: init.headers, body: init.body }); return { status: 200, ok: true }; }
  const req = JSON.parse(init.body);
  let result = '0x';
  if (req.method === 'eth_blockNumber') result = '0x100000';
  else if (req.method === 'eth_getLogs') result = [];
  else if (req.method === 'eth_call'){
    const to = req.params[0].to.toLowerCase(), data = req.params[0].data.replace(/^0x/, '');
    if (to === '0x0000000000000000000000000000000000000001'){
      try{
        const a = E.utils.recoverAddress('0x' + data.slice(0, 64), { r: '0x' + data.slice(128, 192), s: '0x' + data.slice(192, 256), v: parseInt(data.slice(64, 128), 16) });
        result = '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();
      } catch(e){ result = '0x' + '0'.repeat(64); }
    } else result = '0x' + '0'.repeat(64 * 7);
  }
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
};

/* ---------- сайт: страницы из www, /api/v1 — настоящий обработчик ---------- */
const WWW = '/home/claude/apk/www', PORT = 8866;
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/v1')){
    let b = ''; for await (const ch of req) b += ch;
    const r = await API.handle(new Request('https://wallet.tavarov.com' + u.pathname + u.search, {
      method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : b }), env);
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(await r.text());
  }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const B = 'http://localhost:' + PORT;

const shop = E.Wallet.createRandom(), stranger = E.Wallet.createRandom();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const sent = [];

async function fresh(opts = {}, withWallet = true){
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1200, height: 900 }, locale: 'ru-RU' }, opts));
  if (withWallet){
    await ctx.exposeFunction('__wallet', async (method, params) => {
      if (method === 'eth_requestAccounts') return [shop.address];
      if (method === 'personal_sign') return shop.signMessage(E.utils.arrayify(params[0]));
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'eth_sendTransaction'){ sent.push(params[0]); return '0x' + 'ab'.repeat(32); }
      throw Object.assign(new Error('unsupported ' + method), { code: 4200 });
    });
    await ctx.addInitScript(() => {
      window.ethereum = { isMetaMask: true, request: ({ method, params }) => window.__wallet(method, params || []) };
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  return { ctx, page };
}
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; }, sel);
const txt = (page, sel) => page.evaluate(s => document.querySelector(s).innerText, sel);

// ======================= язык и вид =======================
let { ctx, page } = await fresh();
await page.goto(B + '/dev');
ok('русский браузер — страница по-русски', (await txt(page, 'h1')).includes('Приём USDT и USDC'));
await page.click('#langs button[data-l="en"]');
ok('EN — всё по-английски', (await txt(page, 'h1')).includes('Accept USDT and USDC') && !(await txt(page, 'h1')).includes('Приём'));
await page.click('#langs button[data-l="ru"]');
ok('вход закрыт, кабинет спрятан', await vis(page, '#cabOut') && !(await vis(page, '#cabIn')));

// вкладки примеров
ok('по умолчанию пример на curl', await vis(page, '.codebox[data-group="create"] pre[data-pane="curl"]') && !(await vis(page, '.codebox[data-group="create"] pre[data-pane="php"]')));
await page.click('.codebox[data-group="create"] button[data-tab="php"]');
ok('выбрал PHP — PHP и в примере счёта, и в примере вебхука', await vis(page, '.codebox[data-group="create"] pre[data-pane="php"]') && await vis(page, '.codebox[data-group="hook"] pre[data-pane="php"]'));
const phpText = await page.evaluate(() => document.querySelector('.codebox[data-group="hook"] pre[data-pane="php"]').textContent);
ok('код в примере не испорчен разметкой (<?php, =>)', phpText.startsWith('<?php') && phpText.includes("hash_equals") && !phpText.includes('&lt;'));

// ======================= вход MetaMask =======================
await page.click('#mmLogin');
await page.waitForSelector('#cabIn:not(.hidden)', { timeout: 8000 }).catch(() => {});
ok('ВХОД ЧЕРЕЗ MetaMask: кабинет открыт', await vis(page, '#cabIn'));
ok('показан кошелёк для приёма денег', (await txt(page, '#meWallet')) === shop.address.toLowerCase());
ok('ключей ещё нет', (await txt(page, '#keysBox')).includes('ещё нет'));

// ключ
await page.click('#keysBox .row:nth-child(1) button');
await page.waitForSelector('#newKeyBox:not(.hidden)', { timeout: 5000 }).catch(() => {});
const liveKey = await txt(page, '#newKey');
ok('БОЕВОЙ КЛЮЧ ВЫДАН И ПОКАЗАН', /^tp_live_[A-Za-z0-9_-]{43}$/.test(liveKey), liveKey.slice(0, 12));
ok('в списке ключей — только хвост', (await txt(page, '#keysBox')).includes('…' + liveKey.slice(-4)) && !(await txt(page, '#keysBox')).includes(liveKey));

// вебхук
await page.fill('#whUrl', 'http://shop.example/hook');
await page.click('#whSave');
await page.waitForTimeout(300);
ok('вебхук на http:// не принят, сказано почему', (await txt(page, '#whMsg')).includes('https://'));
await page.fill('#whUrl', 'https://shop.example/hook');
await page.click('#whSave');
await page.waitForSelector('#whSecretBox:not(.hidden)', { timeout: 5000 }).catch(() => {});
ok('вебхук сохранён, секрет скрыт точками', await vis(page, '#whSecretBox') && (await txt(page, '#whSecret')).startsWith('•'));
await page.click('#whShow');
const secret = await txt(page, '#whSecret');
ok('секрет показывается по кнопке', /^whsec_/.test(secret));
await page.click('#whTest');
await page.waitForFunction(() => /200/.test(document.getElementById('whMsg').innerText), null, { timeout: 5000 }).catch(() => {});
ok('ПРОВЕРОЧНЫЙ ВЕБХУК ДОШЁЛ — кабинет так и говорит', (await txt(page, '#whMsg')).includes('200') && hooks.length === 1 && JSON.parse(hooks[0].body).type === 'ping');

// счёт, выставленный ключом, — в кабинете
const cr = await API.handle(new Request('https://wallet.tavarov.com/api/v1/invoices', { method: 'POST',
  headers: { authorization: 'Bearer ' + liveKey, 'content-type': 'application/json' },
  body: JSON.stringify({ amount: '7.5', order_id: 'ORD-77' }) }), env);
ok('ключом из кабинета выставлен счёт', cr.status === 201);
await page.click('#invReload');
await page.waitForFunction(() => document.getElementById('invRows').children.length > 0, null, { timeout: 5000 }).catch(() => {});
ok('СЧЁТ ВИДЕН В КАБИНЕТЕ', (await txt(page, '#invRows')).includes('ORD-77') && (await txt(page, '#invRows')).includes('7.5 USDT'));
await page.click('#invMode button[data-m="test"]');
await page.waitForTimeout(400);
ok('во вкладке «Тестовые» его нет', !(await txt(page, '#invRows')).includes('ORD-77'));

// тестовые доллары
await page.click('#mintTest');
await page.waitForFunction(() => /100/.test(document.getElementById('mintMsg').innerText), null, { timeout: 5000 }).catch(() => {});
ok('КНОПКА ТЕСТОВЫХ ДОЛЛАРОВ: mint(100) в тестовый USDT',
  sent.length === 1 && sent[0].to.toLowerCase() === '0xb4ac75e8cf7c768ffd9fafeaf1bf77b48209524e' &&
  sent[0].data === '0xa0712d68' + (100).toString(16).padStart(64, '0'), JSON.stringify(sent[0]));

// сессия переживает перезагрузку вкладки
await page.reload();
await page.waitForSelector('#cabIn:not(.hidden)', { timeout: 5000 }).catch(() => {});
ok('после перезагрузки вкладки — всё ещё внутри', await vis(page, '#cabIn'));
await page.click('#logout');
ok('выход — снова экран входа', await vis(page, '#cabOut') && !(await vis(page, '#cabIn')));
await ctx.close();

// ======================= вход из NoN Wallet по ссылке =======================
({ ctx, page } = await fresh({}, false));
let ts = Math.floor(Date.now() / 1000);
let sig = await shop.signMessage(API.loginText(shop.address, ts));
await page.goto(B + '/dev#login=' + shop.address + '.' + ts + '.' + sig);
await page.waitForSelector('#cabIn:not(.hidden)', { timeout: 8000 }).catch(() => {});
ok('ВХОД ИЗ NoN Wallet ПО ПОДПИСИ В АДРЕСЕ', await vis(page, '#cabIn'));
ok('подпись сразу убрана из адресной строки', !(await page.evaluate(() => location.href)).includes('login='));
ok('ключ, взятый раньше, на месте', (await txt(page, '#keysBox')).includes('…' + liveKey.slice(-4)));
await ctx.close();

({ ctx, page } = await fresh({}, false));
sig = await stranger.signMessage(API.loginText(shop.address, ts));
await page.goto(B + '/dev#login=' + shop.address + '.' + ts + '.' + sig);
await page.waitForSelector('#loginErr:not(.hidden)', { timeout: 8000 }).catch(() => {});
ok('ЧУЖАЯ ПОДПИСЬ В АДРЕСЕ — НЕ ВПУСКАЕМ', !(await vis(page, '#cabIn')) && await vis(page, '#loginErr'), await txt(page, '#loginErr'));
await ctx.close();

// без кошелька в браузере
({ ctx, page } = await fresh({}, false));
await page.goto(B + '/dev');
await page.click('#mmLogin');
ok('нет MetaMask — понятная подсказка', (await txt(page, '#loginErr')).includes('NoN Wallet'));
await page.click('#nonLogin');
ok('«через NoN Wallet» — объяснено, где кнопка в приложении', (await txt(page, '#nonHow')).includes('Открыть кабинет'));
await ctx.close();

// ======================= телефон, светлая и тёмная =======================
for (const scheme of ['light', 'dark']){
  ({ ctx, page } = await fresh({ viewport: { width: 375, height: 812 }, colorScheme: scheme, locale: 'en-US' }));
  await page.goto(B + '/dev');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('телефон 375px (' + scheme + '): страница не шире экрана', wide <= 0, 'лишних пикселей: ' + wide);
  ok('английский браузер — страница по-английски (' + scheme + ')', (await txt(page, 'h1')).includes('Accept'));
  await page.screenshot({ path: '/tmp/claude-0/dev_' + scheme + '.png', fullPage: false });
  await ctx.close();
}
({ ctx, page } = await fresh({ viewport: { width: 1280, height: 900 } }));
await page.goto(B + '/dev');
await page.click('#mmLogin');
await page.waitForSelector('#cabIn:not(.hidden)', { timeout: 8000 }).catch(() => {});
await page.screenshot({ path: '/tmp/claude-0/dev_desktop_in.png', fullPage: false });
await ctx.close();

ok('на страницах ни одной ошибки JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
srv.close();
globalThis.fetch = realFetch;
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
