/* Страница доната и экран OBS в других сетях (1 октября 2026).
   Настоящие страницы в браузере, настоящий donate.js с поддельным
   хранилищем; сеть Solana поддельная и для сервера, и для страницы. */
import { toRaw } from './solraw.mjs';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const DON = await import('/home/claude/apk/functions/api/donate.js');
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');
let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 180) + ']' : '')); };

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TREASURY = 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU';
const AUTHOR = 'GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw', BUYER = 'CttRr6et6TryhMzCgZyKk9YyXp4TWXeYBkgZUg22Bxnt';
const BLOGGER = '0x73bbcd23735257660a9f6be57d057dc4a2abf432';
const ataOf = async (o, m) => SOL.b58enc(await SOL.ata(SOL.b58dec(o, 32), SOL.b58dec(m, 32)));
const AUTHOR_USDC = await ataOf(AUTHOR, USDC);

// ---- сервер: хранилище и Solana ----
const map = new Map();
const env = { V1_NO_THROTTLE: '1', TILL: {
  async get(k){ const v = map.get(k); return v ? v.body : null; },
  async put(k, body, o){ map.set(k, { body, metadata: o && o.metadata ? o.metadata : null }); },
  async delete(k){ map.delete(k); },
  async list(){ return { list_complete: true, keys: [] }; } } };
const solTx = {};
const ataSigs = {};       // счёт -> подписи (новые первыми) — это видит страница
globalThis.fetch = async (url, init) => {
  const q = JSON.parse(init.body);
  let result = null;
  if (q.method === 'getSignaturesForAddress') result = (solTx[q.params[0]] || []).map((t, i) => ({ signature: q.params[0] + ':' + i, err: null }));
  else if (q.method === 'getTransaction'){ const [ref, i] = q.params[0].split(':'); result = toRaw(solTx[ref][Number(i)]); }
  else if (q.method === 'eth_call') result = '0x' + '0'.repeat(64 * 7);
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: q.id, result }) };
};
async function pay(h, whole){
  const ref = SOL.refFromInvoice(h), units = BigInt(whole) * 1_000_000n, fee = units / 100n;
  (solTx[ref] = solTx[ref] || []).push({ meta: { err: null, innerInstructions: [] }, transaction: { message: {
    accountKeys: [{ pubkey: BUYER }, { pubkey: ref }],
    instructions: [
      { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint: USDC, destination: AUTHOR_USDC, authority: BUYER, tokenAmount: { amount: String(units - fee) } } } },
      { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint: USDC, destination: await ataOf(TREASURY, USDC), authority: BUYER, tokenAmount: { amount: String(fee) } } } } ] } } });
  (ataSigs[AUTHOR_USDC] = ataSigs[AUTHOR_USDC] || []).unshift('sig' + h.slice(2, 10) + Date.now());
}

const WWW = '/home/claude/apk/www', PORT = 8890;
const posts = []; let recentCalls = 0;
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/donate'){
    let r;
    if (req.method === 'POST'){
      let body = ''; for await (const c of req) body += c;
      posts.push(JSON.parse(body));
      r = await DON.onRequestPost({ env, request: new Request('https://wallet.tavarov.com/api/donate', { method: 'POST', headers: { 'content-type': 'application/json' }, body }) });
    } else {
      if (u.searchParams.get('recent') === '1') recentCalls++;
      r = await DON.onRequestGet({ env, request: new Request('https://wallet.tavarov.com' + u.pathname + u.search) });
    }
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(await r.text());
  }
  if (u.pathname === '/api/status'){ res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"paid":false}'); }
  let rel = u.pathname.startsWith('/d/') ? 'donate.html' : (decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html');
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const B = 'http://localhost:' + PORT;

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const hexOf = s => Buffer.from(s, 'utf8').toString('hex');
const encStr = s => { const h = hexOf(s); return '0x' + '0'.repeat(62) + '20' + (h.length / 2).toString(16).padStart(64, '0') + h.padEnd(64, '0'); };
const nodesAsked = [];
async function fresh(opts = {}){
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 800, height: 700 }, locale: 'ru-RU' }, opts));
  await ctx.route(/publicnode\.com|bsc-dataseed|bnbchain\.org|drpc\.org|mainnet\.base\.org/, route => {
    const q = JSON.parse(route.request().postData());
    nodesAsked.push(route.request().url() + ' ' + q.method);
    let result = null;
    if (q.method === 'getSignaturesForAddress') result = (ataSigs[q.params[0]] || []).slice(0, (q.params[1] || {}).limit || 10).map(s => ({ signature: s, err: null }));
    else if (q.method === 'eth_call'){
      const { data } = q.params[0];
      result = '0x' + '0'.repeat(64);
      if (data.startsWith('0xccf1454a') && data.slice(10) === encStr('streamer').slice(2)) result = '0x' + '0'.repeat(24) + BLOGGER.slice(2);
      if (data.startsWith('0xf5c57382')) result = data.slice(-40) === BLOGGER.slice(2) ? encStr('streamer') : encStr('');
    }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) });
  });
  if (opts.obs) await ctx.addInitScript(() => { window.obsstudio = { pluginVersion: '2.24.0' }; });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  return { ctx, page };
}
const txt = (page, id) => page.evaluate(i => document.getElementById(i).textContent, id);

// ======================= страница доната: Solana =======================
let { ctx, page } = await fresh();
await page.goto(B + '/d/' + AUTHOR + '?net=solana'); await page.waitForTimeout(800);
ok('Solana: страница открылась по адресу', await page.evaluate(() => !document.getElementById('main').classList.contains('hidden')));
ok('адрес показан как есть', (await txt(page, 'addr')) === AUTHOR);
ok('сеть подписана: Solana', (await txt(page, 'netName')) === 'Solana');
ok('что нужно — USDC или USDT и SOL, кошельки Solana', /USDC или USDT в сети Solana/.test(await txt(page, 'f2')) && /Phantom/.test(await txt(page, 'f2')), await txt(page, 'f2'));
ok('как идут деньги — одной операцией, без «контракта»', /одной операцией/.test(await txt(page, 'f1')));
ok('монеты: USDC первым', await page.evaluate(() => [...document.querySelectorAll('#curSeg button')].map(b => b.textContent).join(',')) === 'USDC,USDT');
ok('узлы BNB не спрашивали (имён в Solana нет)', !nodesAsked.some(x => /bsc|bnbchain/.test(x)), nodesAsked.join(' | '));
await page.click('.chip >> text=5 $');
await page.fill('#nick', 'Ваня'); await page.fill('#msg', 'Привет из Solana');
await Promise.all([page.waitForURL(/\/pay/), page.click('#go')]);
const inv = JSON.parse(Buffer.from(decodeURIComponent(page.url().split('#p=')[1]), 'base64url').toString());
ok('сообщение ушло до оплаты, сеть solana', posts.length === 1 && posts[0].net === 'solana' && posts[0].to === AUTHOR && posts[0].msg === 'Привет из Solana', JSON.stringify(posts[0]));
ok('счёт на оплату: Solana, автор, 5 USDC, донат', inv.net === 'solana' && inv.m === AUTHOR && inv.a === '5' && inv.c === 'USDC' && inv.o === 'donate' && inv.h === posts[0].h, JSON.stringify(inv));
await page.waitForTimeout(800);
ok('страница оплаты приняла счёт Solana', await page.evaluate(() => /solana:/i.test(document.body.innerHTML) || /Solana/.test(document.body.innerText)), (await page.evaluate(() => document.body.innerText)).slice(0, 200));
await ctx.close();

({ ctx, page } = await fresh());
await page.goto(B + '/d/streamer?net=solana'); await page.waitForTimeout(800);
ok('Solana по имени — «не найдено» (имена — для EVM)', await page.evaluate(() => !document.getElementById('err').classList.contains('hidden')));
await page.goto(B + '/d/' + AUTHOR + '?net=solanaTestnet'); await page.waitForTimeout(800);
ok('старая ссылка на devnet — тестовой сети нет: ни предупреждения, ни страницы', await page.evaluate(() => document.getElementById('tnCard').classList.contains('hidden') && !document.getElementById('err').classList.contains('hidden')));
await ctx.close();

// ======================= страница доната: Ethereum и Base =======================
({ ctx, page } = await fresh());
nodesAsked.length = 0;
await page.goto(B + '/d/streamer?net=eth'); await page.waitForTimeout(900);
ok('Ethereum: имя найдено в контракте имён BNB', (await txt(page, 'who')) === '@streamer' && (await txt(page, 'addr')).toLowerCase() === BLOGGER, await txt(page, 'who'));
ok('сеть подписана: Ethereum, комиссия в ETH', (await txt(page, 'netName')) === 'Ethereum' && /Ethereum и немного ETH/.test(await txt(page, 'f2')), await txt(page, 'f2'));
await page.goto(B + '/d/streamer?net=base&lang=en'); await page.waitForTimeout(900);
ok('Base: только USDC', await page.evaluate(() => [...document.querySelectorAll('#curSeg button')].map(b => b.textContent).join(',')) === 'USDC');
ok('Base по-английски', /You need USDC on Base and a little ETH/.test(await txt(page, 'f2')), await txt(page, 'f2'));
await page.goto(B + '/d/streamer'); await page.waitForTimeout(900);
ok('BNB по-прежнему', (await txt(page, 'netName')) === 'BNB Chain' && /USDT или USDC в сети BNB Chain и немного BNB/.test(await txt(page, 'f2')));
await ctx.close();

// ======================= экран OBS: Solana =======================
({ ctx, page } = await fresh({ obs: true, viewport: { width: 800, height: 400 } }));
// старый донат до открытия экрана — не показываем
await DON.onRequestPost({ env, request: new Request('https://x/api/donate', { method: 'POST', body: JSON.stringify({ net: 'solana', to: AUTHOR, h: '0x' + '0a'.repeat(32), nick: 'Old', msg: 'старый' }) }) });
await pay('0x' + '0a'.repeat(32), 3);
await DON.onRequestGet({ env, request: new Request('https://x/api/donate?net=solana&to=' + AUTHOR + '&h=0x' + '0a'.repeat(32)) });
await page.goto(B + '/alert?net=solana&to=' + AUTHOR); await page.waitForTimeout(5000);
ok('старый донат при открытии не показан', !(await page.evaluate(() => document.getElementById('alert').classList.contains('show'))));
ok('экран спрашивает счета USDC/USDT автора, а не журнал контракта', !nodesAsked.some(x => /eth_getLogs/.test(x)) && nodesAsked.some(x => /getSignaturesForAddress/.test(x)));
const rc0 = recentCalls;
await page.waitForTimeout(4500);
ok('без поступлений сервер не дёргаем', recentCalls === rc0, recentCalls - rc0);
// новый донат: сообщение, оплата (до подтверждения сервером)
const H2 = '0x' + '0b'.repeat(32);
await DON.onRequestPost({ env, request: new Request('https://x/api/donate', { method: 'POST', body: JSON.stringify({ net: 'solana', to: AUTHOR, h: H2, nick: 'Kate', msg: 'gm <b>x</b>' }) }) });
await pay(H2, 7);
await page.waitForFunction(() => document.getElementById('alert').classList.contains('show'), null, { timeout: 15000 }).catch(() => {});
ok('новый донат на экране', await page.evaluate(() => document.getElementById('alert').classList.contains('show')));
ok('сумма, ник и текст — текстом', (await txt(page, 'aAmount')).replace(/\s/g, '') === '7USDC' && (await txt(page, 'aWho')) === 'Kate' && (await txt(page, 'aMsg')) === 'gm <b>x</b>',
   [await txt(page, 'aAmount'), await txt(page, 'aWho'), await txt(page, 'aMsg')].join(' / '));
await ctx.close();

// ======================= экран OBS: адрес =======================
({ ctx, page } = await fresh());
await page.goto(B + '/alert?net=solana&to=' + AUTHOR.toLowerCase().replace(/l/g, 'k')); await page.waitForTimeout(600);
ok('Solana: адрес не base58 — подсказка вместо экрана', await page.evaluate(() => !document.getElementById('help').classList.contains('hidden')));
nodesAsked.length = 0;
await page.goto(B + '/alert?net=eth&to=' + BLOGGER); await page.waitForTimeout(1500);
ok('Ethereum: экран читает журнал контракта v3 в Ethereum', nodesAsked.some(x => /ethereum-rpc\.publicnode\.com\/? eth_/.test(x)), nodesAsked.slice(0, 3).join(' | '));
await ctx.close();

ok('ошибок на страницах нет', errors.length === 0, errors.join(' | '));
await browser.close(); srv.close();
console.log('--- ' + okN + ' из ' + (okN + badN) + ' ---');
