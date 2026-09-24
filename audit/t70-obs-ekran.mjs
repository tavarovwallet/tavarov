/* Экран оповещений для OBS: wallet.tavarov.com/alert.

   Настоящая страница в браузере, настоящий сервер донатов (donate.js) с
   поддельными хранилищем и узлом. Сеть для страницы — поддельная: мы сами
   решаем, когда в журнале контракта появляется «оплачено».

   Проверяется: донат показан с ником, суммой и текстом; обычная покупка у
   того же кошелька оповещением не становится; старые донаты при открытии
   не повторяются; порог суммы; ссылки в тексте замазаны; чужая разметка
   не выполняется; в OBS фон прозрачный и подсказки нет. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const DON = await import('/home/claude/apk/functions/api/donate.js');

let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++;
  console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 200) + ']' : '')); };

const STREAMER = '0x73bbcd23735257660a9f6be57d057dc4a2abf432';
const BUYER = '0x3333333333333333333333333333333333333333';
const V3 = '0x1fc681fa250a17e66b57b7150f2eed4e71d1ca35';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const PAID = '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861';
const w = v => BigInt(v).toString(16).padStart(64, '0');
const wa = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const H = n => '0x' + String(n).padStart(4, '0').repeat(16);

/* ---------- сторона сервера: хранилище и узел для donate.js ---------- */
const map = new Map();
const env = { TILL: {
  async get(k){ const v = map.get(k); return v ? v.body : null; },
  async put(k, body, o){ map.set(k, { body, metadata: o && o.metadata ? JSON.parse(JSON.stringify(o.metadata)) : null }); },
  async delete(k){ map.delete(k); },
  async list({ prefix, limit }){ return { keys: [...map.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit || 1000).map(name => ({ name, metadata: map.get(name).metadata })) }; } } };
const sales = {};
globalThis.fetch = async (url, init) => {
  const req = JSON.parse(init.body);
  let result = '0x' + '0'.repeat(64 * 7);
  const p = req.params[0] || {};
  if (req.method === 'eth_call' && p.data.startsWith('0x38d56afe')){
    const s = sales['0x' + p.data.slice(10)];
    if (s && s.hub === p.to.toLowerCase()) result = '0x' + wa(s.merchant) + w(s.amount) + wa(BUYER) + w(0) + wa(USDT) + w(0) + w(0);
  }
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
};
const postMsg = async (h, nick, msg) => {
  const r = await DON.onRequestPost({ env, request: new Request('https://wallet.tavarov.com/api/donate', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: STREAMER, h, nick, msg }) }) });
  return r.status;
};

/* ---------- сторона страницы: www и /api/donate ---------- */
const WWW = '/home/claude/apk/www', PORT = 8870;
let apiCalls = 0;
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/donate'){
    apiCalls++;
    const r = await DON.onRequestGet({ env, request: new Request('https://wallet.tavarov.com' + u.pathname + u.search) });
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(await r.text());
  }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));

/* ---------- поддельная сеть для страницы ---------- */
let block = 900000;
const chain = [];            // события Paid
function paidEvent(h, merchant, amountWhole){
  const a = BigInt(amountWhole * 100) * 10n ** 16n;
  sales[h] = { merchant, amount: a, hub: V3 };
  block += 3;
  chain.push({ b: block, topics: [PAID, '0x' + wa(merchant), '0x' + wa(BUYER), '0x' + wa(USDT)],
               data: '0x' + w(a * 99n / 100n) + w(a / 100n) + w(0) + h.slice(2) });
}
const logRanges = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function open(q, opts = {}){
  const ctx = await browser.newContext({ viewport: { width: 800, height: 400 }, locale: 'ru-RU' });
  await ctx.route(/publicnode\.com|bsc-dataseed|bnbchain\.org/, route => {
    const req = JSON.parse(route.request().postData());
    let result = null;
    if (req.method === 'eth_blockNumber') result = '0x' + block.toString(16);
    if (req.method === 'eth_getLogs'){
      const f = req.params[0], lo = parseInt(f.fromBlock, 16), hi = parseInt(f.toBlock, 16);
      logRanges.push([lo, hi, JSON.stringify(f.address)]);
      result = chain.filter(l => l.b >= lo && l.b <= hi && l.topics[1] === f.topics[1].toLowerCase())
        .map(l => ({ address: V3, topics: l.topics, data: l.data, blockNumber: '0x' + l.b.toString(16) }));
    }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) });
  });
  if (opts.obs) await ctx.addInitScript(() => { window.obsstudio = { pluginVersion: '2.24.0' }; });
  await ctx.addInitScript(() => {
    window.__beeps = 0;
    const C = window.AudioContext;
    window.AudioContext = function(){ window.__beeps++; return new C(); };
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:' + PORT + '/alert?' + q);
  return { ctx, page };
}
const shown = page => page.evaluate(() => document.getElementById('alert').classList.contains('show'));
const cardText = page => page.evaluate(() => ({ amount: document.getElementById('aAmount').textContent,
  who: document.getElementById('aWho').textContent, msg: document.getElementById('aMsg').textContent,
  head: document.getElementById('aHead').textContent }));

// ======================= в OBS =======================
/* Донат, оплаченный ДО открытия экрана, — не повторяем. */
await postMsg(H(1), 'Старый', 'было давно');
paidEvent(H(1), STREAMER, 3);
let { ctx, page } = await open('to=' + STREAMER + '&d=3', { obs: true });
await page.waitForTimeout(1500);
ok('в OBS: фон прозрачный', await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(document.documentElement).backgroundColor === 'rgba(0, 0, 0, 0)'));
ok('в OBS: подсказки нет — на стриме ничего лишнего', await page.evaluate(() => document.getElementById('help').classList.contains('hidden')));
ok('в OBS: пока доната нет — карточки не видно', !(await shown(page)));
ok('СТАРЫЙ ДОНАТ (ДО ОТКРЫТИЯ) НЕ ПОВТОРЯЕТСЯ', !(await shown(page)) && logRanges.every(r => r[0] > 900003));

/* Новый донат. */
await postMsg(H(2), 'Ваня', 'Спасибо за стрим!');
paidEvent(H(2), STREAMER, 5);
await page.waitForFunction(() => document.getElementById('alert').classList.contains('show'), null, { timeout: 12000 }).catch(() => {});
let c = await cardText(page);
ok('НОВЫЙ ДОНАТ — КАРТОЧКА НА ЭКРАНЕ', await shown(page));
ok('сумма, ник и текст — с сервера, после проверки оплаты', /^5\s+USDT$/.test(c.amount) && c.who === 'Ваня' && c.msg === 'Спасибо за стрим!', JSON.stringify(c));
ok('заголовок по-русски', c.head === 'Новый донат');
ok('журнал спрашиваем у обоих контрактов оплаты', logRanges.some(r => r[2].includes('0x1Fc681FA') && r[2].includes('0xCa4FE6e5')), logRanges[0] && logRanges[0][2]);
ok('СТАРЫЙ ДОНАТ (ДО ОТКРЫТИЯ) В ЖУРНАЛЕ НЕ ИСКАЛИ', logRanges.length > 0 && logRanges.every(r => r[0] > 900003));
ok('ЗВУК ПРОИГРАН', (await page.evaluate(() => window.__beeps)) >= 1);
await page.waitForTimeout(4200);
ok('через заданные 3 секунды карточка уходит', !(await shown(page)));

/* Обычная покупка у того же кошелька. */
const before = apiCalls;
paidEvent(H(3), STREAMER, 50);
await page.waitForTimeout(6000);
ok('ОБЫЧНАЯ ПОКУПКА (НЕ ДОНАТ) ОПОВЕЩЕНИЕМ НЕ СТАНОВИТСЯ', !(await shown(page)) && apiCalls > before);

/* Две подряд — по очереди. Ссылка в тексте, разметка в нике. */
ok('ник с разметкой сервер принял (не длиннее 32)', (await postMsg(H(4), '<img src=x onerror=__pwned=1>', 'заходи на evil.com/free и https://scam.io/x')) === 200);
await postMsg(H(5), '', '');
paidEvent(H(4), STREAMER, 10);
paidEvent(H(5), STREAMER, 1);
await page.waitForFunction(() => document.getElementById('alert').classList.contains('show'), null, { timeout: 12000 }).catch(() => {});
c = await cardText(page);
ok('ЧУЖАЯ РАЗМЕТКА В НИКЕ — ТЕКСТОМ, НЕ ВЫПОЛНЕНА', c.who.startsWith('<img') && !(await page.evaluate(() => window.__pwned)) && (await page.$$eval('#alert img', x => x.length)) === 0, c.who);
ok('ССЫЛКИ В ТЕКСТЕ ЗАМАЗАНЫ', !/evil\.com|scam\.io|https/.test(c.msg) && (c.msg.match(/\[ссылка\]/g) || []).length === 2, c.msg);
await page.waitForFunction(() => document.getElementById('aAmount').textContent.startsWith('1 '), null, { timeout: 12000 }).catch(() => {});
c = await cardText(page);
ok('ВТОРОЙ ДОНАТ — СЛЕДОМ, ПО ОЧЕРЕДИ', c.amount.startsWith('1 ') && await shown(page), JSON.stringify(c));
ok('без ника — «Аноним», без текста — поле скрыто', c.who === 'Аноним' && await page.evaluate(() => getComputedStyle(document.getElementById('aMsg')).display === 'none'));
await ctx.close();

// ======================= настройки из ссылки =======================
({ ctx, page } = await open('to=' + STREAMER + '&d=3&min=5&msg=0&snd=0&lang=en', { obs: true }));
await page.waitForTimeout(1200);
await postMsg(H(6), 'Мелкий', 'копейка');
paidEvent(H(6), STREAMER, 2);
await page.waitForTimeout(6000);
ok('ПОРОГ 5 $: ДОНАТ 2 $ НЕ ПОКАЗАН', !(await shown(page)));
await postMsg(H(7), 'Kate', 'секретный текст');
paidEvent(H(7), STREAMER, 7);
await page.waitForFunction(() => document.getElementById('alert').classList.contains('show'), null, { timeout: 12000 }).catch(() => {});
c = await cardText(page);
ok('донат 7 $ при пороге 5 $ — показан', await shown(page) && c.who === 'Kate');
ok('msg=0 — текст сообщения не выводится', c.msg === '' && !(await page.evaluate(() => document.body.innerText.includes('секретный'))));
ok('snd=0 — без звука', (await page.evaluate(() => window.__beeps)) === 0);
ok('lang=en — заголовок по-английски', c.head === 'New tip');
await ctx.close();

// ======================= в обычном браузере =======================
({ ctx, page } = await open('to=' + STREAMER));
await page.waitForTimeout(1500);
ok('НЕ В OBS — подсказка, как добавить в OBS', await page.evaluate(() => !document.getElementById('help').classList.contains('hidden')) &&
   (await page.textContent('#help')).includes('Браузер'));
ok('и видно, что связь с сетью есть', (await page.textContent('#stText')).includes('связь с сетью есть'));
await page.click('#helpDemo');
await page.waitForTimeout(700);
ok('кнопка «Показать пример» — пример на экране', await shown(page) && /USDT|USDC/.test((await cardText(page)).amount));
await ctx.close();

({ ctx, page } = await open('demo=1&d=3&to=' + STREAMER, { obs: true }));
await page.waitForTimeout(900);
ok('demo=1 — пример сразу (для настройки в OBS)', await shown(page));
await ctx.close();

({ ctx, page } = await open(''));
await page.waitForTimeout(600);
ok('без адреса — понятно сказано, где взять ссылку', (await page.textContent('#helpText')).includes('NoN Wallet'));
await ctx.close();

ok('ни одной ошибки JavaScript', errors.length === 0, errors.join(' | '));
await browser.close(); srv.close();
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
