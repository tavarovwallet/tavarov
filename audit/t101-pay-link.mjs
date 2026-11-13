/* Личная ссылка для оплаты: wallet.tavarov.com/@имя (www/u.html).

   Что проверяется:
   1. В кошельке «Моя ссылка для оплаты» видна только тому, у кого есть имя;
      без имени — подсказка занять его. Копирование кладёт ссылку в буфер.
   2. /@имя находит имя в реестре (поддельный узел mocknode), показывает
      форму и короткий адрес, на который уйдут деньги. Регистр букв не важен.
   3. Незарегистрированное или кривое имя — «не зарегистрировано», формы нет.
      Сеть не ответила — это другая ошибка, а не «нет имени».
   4. Оплата со ссылки — это обычный счёт для /pay, и чужой кошелёк получает
      на подпись те же байты, что и по равному счёту, открытому напрямую:
      разрешение USDT и pay() в контракте Tavarov Pay.
   5. Запасной путь: если хостинг отдал /@имя кошельку, тот ведёт на /u?to=имя.

   Запуск: cd audit && timeout 180 node t101-pay-link.mjs
   Снимки экрана: audit/out/pay-link-*.png (390×844, плотность 2). */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../www/lib/ethers.umd.min.js');

const WWW = new URL('../www', import.meta.url).pathname;
const OUT = new URL('./out', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8871, B = 'http://localhost:' + PORT;
const MOCK = 'http://localhost:8557';
const NAMES_MAIN = '0xd6e8a78634be366bdbd041227d1e94f5b374338e';
const PAY = '0x1Fc681FA250A17e66B57B7150F2EeD4e71D1Ca35';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const PAYEE = '0x73bbcd23735257660a9f6be57d057dc4a2abf432';
const BUYER = '0x1111111111111111111111111111111111111111';
const SOL = '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2';

await start(8557);
const R = reporter();
const errors = [];

/* ---------- сайт, как его отдаёт Cloudflare Pages ----------
   /@имя — функция functions/@[name].js (отдаёт /u); /pay, /u — без .html;
   незнакомый адрес — index.html (у сайта нет 404.html). fnOn = false —
   «функция не сработала», чтобы проверить запасной путь через кошелёк. */
let fnOn = true, solBinding = null;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/status') return json({ paid: false });
  if (u.pathname === '/api/solname') return json(solBinding && u.searchParams.get('evm').toLowerCase() === PAYEE ? { sol: solBinding } : {});
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (fnOn && /^@[^/]+\/?$/.test(rel)) rel = 'u.html';
  if (!path.extname(rel) && fs.existsSync(path.join(WWW, rel + '.html'))) rel += '.html';
  let f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(WWW, 'index.html');
  const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.woff2') ? 'font/woff2' : 'text/html; charset=utf-8';
  res.writeHead(200, { 'content-type': type });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));

/* ---------- поддельные узлы BNB Chain ----------
   Имена отвечает mocknode (state.names), как во всех проверках имён.
   Остальное — как настоящий контракт оплаты и USDT (так же, как в t58). */
const namesAsked = [];
let nodesDown = false, payeeCode = '0x';
async function node(page, route){
  if (nodesDown) return route.fulfill({ status: 503, body: 'down' });
  let q; try{ q = JSON.parse(route.request().postData() || '{}'); } catch(e){ q = {}; }
  const reply = result => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) });
  const w = v => '0x' + BigInt(v).toString(16).padStart(64, '0');
  if (q.method === 'eth_call' && q.params[0].data.startsWith('0xccf1454a')){
    namesAsked.push(q.params[0].to.toLowerCase());
    const r = await fetch(MOCK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await r.text() });
  }
  if (q.method === 'eth_getCode') return reply(payeeCode);
  if (q.method === 'eth_getBalance') return reply('0x16345785d8a0000');
  if (q.method === 'eth_getTransactionReceipt') return reply({ status: '0x1' });
  if (q.method === 'eth_call'){
    const d = q.params[0].data;
    const allowance = await page.evaluate(() => window.__allowance || '0').catch(() => '0');
    if (d.startsWith('0x55f5e7de')) return reply(w(1n));                       // acceptedToken
    if (d.startsWith('0x38d56afe')) return reply('0x' + '0'.repeat(64 * 7));   // saleOf — не оплачен
    if (d.startsWith('0x70a08231')) return reply(w(100n * 10n ** 18n));        // balanceOf
    if (d.startsWith('0xdd62ed3e')) return reply(w(allowance));               // allowance
  }
  return reply('0x');
}

/* Кошелёк-двойник по EIP-1193/6963 (как в t58): пишет каждую просьбу. */
const FAKE = ({ buyer }) => {
  window.__calls = [];
  let chain = '0x1';
  const provider = { request: async ({ method, params }) => {
    window.__calls.push({ method, params });
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [buyer];
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain'){ chain = params[0].chainId; return null; }
    if (method === 'eth_sendTransaction'){
      if (params[0].data.startsWith('0x095ea7b3')) window.__allowance = String(BigInt('0x' + params[0].data.slice(74)));
      return '0x' + String(window.__calls.length).padStart(64, 'a');
    }
    return new Promise(() => {});
  } };
  const info = { uuid: 'io.metamask', name: 'MetaMask', rdns: 'io.metamask', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
async function fresh(locale = 'en-US'){
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale });
  await ctx.addInitScript(FAKE, { buyer: BUYER });
  const page = await ctx.newPage();
  await ctx.route(/bsc-dataseed|bnbchain\.org|publicnode\.com|data-seed-prebsc|drpc\.org|1rpc\.io|mainnet\.base\.org/, route => node(page, route));
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  return { ctx, page };
}
const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s);
  return !!e && !e.closest('.hidden') && getComputedStyle(e).display !== 'none'; }, sel);
const settle = page => page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
const decodeInv = url => JSON.parse(Buffer.from(url.split('#p=')[1].split('&')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

// ======================= 1. кошелёк =======================
const W = await boot({ role: 'seller', testnet: true, rpc: MOCK });
const wp = W.page;
await W.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8099' });
await wp.setViewportSize({ width: 390, height: 844 });
const me = await wp.evaluate(() => wallet.evm.address);
await wp.evaluate(() => { tab = 'pay'; setPayMode('receive'); });
await wp.evaluate(() => refreshMyName(true));
await wp.waitForTimeout(500);
R.ok('КОШЕЛЁК БЕЗ ИМЕНИ: блок есть, но ссылки нет', await shown(wp, '#payLinkGroup') && !(await shown(wp, '#payLinkHave')));
R.ok('и подсказка занять имя с кнопкой', await shown(wp, '#payLinkNone') && /wallet\.tavarov\.com\/@/.test(await wp.textContent('#payLinkNoneText')),
  await wp.textContent('#payLinkNoneText'));

state.names['alice'] = me;
await wp.evaluate(() => refreshMyName(true));
await wp.waitForTimeout(500);
const link = (await wp.textContent('#payLinkText')).trim();
R.ok('С ИМЕНЕМ: ССЫЛКА ПОКАЗАНА', await shown(wp, '#payLinkHave') && !(await shown(wp, '#payLinkNone')));
R.ok('вид ссылки: wallet.tavarov.com/@имя (в тестовой сети — с ?net=bnbTestnet)',
  link === 'https://wallet.tavarov.com/@alice?net=bnbTestnet', link);
R.ok('в основной сети — просто /@alice',
  await wp.evaluate(() => { const was = window.testnetOn; window.testnetOn = () => false;
    try{ return myPayLink(); } finally { window.testnetOn = was; } }) === 'https://wallet.tavarov.com/@alice');
R.ok('заголовок блока переведён', (await wp.textContent('#payLinkTitle')) === 'Моя ссылка для оплаты');

await wp.click('#payLinkCopyBtn');
await wp.waitForTimeout(300);
const clip = await wp.evaluate(() => navigator.clipboard.readText()).catch(e => 'ошибка: ' + e.message);
R.ok('КОПИРОВАТЬ КЛАДЁТ ССЫЛКУ В БУФЕР', clip === link, clip);
const shared = await wp.evaluate(async () => {
  let got = null; const was = navigator.share;
  navigator.share = o => { got = o; return Promise.resolve(); };
  try{ sharePayLink(); } finally { navigator.share = was; }
  return got;
});
R.ok('поделиться — системным окном, ссылка та же', shared && shared.url === link, JSON.stringify(shared));
await wp.evaluate(() => togglePayLinkQr());
await wp.waitForTimeout(300);
R.ok('QR ссылки нарисован', await wp.evaluate(() => !!document.querySelector('#payLinkQr canvas, #payLinkQr img')));
await wp.evaluate(() => document.getElementById('payLinkTitle').scrollIntoView({ block: 'start' }));
await wp.evaluate(() => window.scrollBy(0, -12));
await wp.waitForTimeout(1700);            // «Скопировано» на кнопке успело смениться обратно
await wp.screenshot({ path: OUT + '/pay-link-wallet.png' });

await wp.evaluate(() => setLang('en'));
R.ok('по-английски тоже', (await wp.textContent('#payLinkTitle')) === 'My pay link');
await wp.evaluate(() => setLang('tg'));
R.ok('тоҷикӣ — русский текст, как в других новых блоках', (await wp.textContent('#payLinkTitle')) === 'Моя ссылка для оплаты');
await wp.evaluate(() => setLang('ru'));

delete state.names['alice'];
await wp.evaluate(() => refreshMyName(true));
await wp.waitForTimeout(400);
R.ok('ИМЯ ОСВОБОДИЛИ — ССЫЛКА ПРОПАЛА', !(await shown(wp, '#payLinkHave')) && await shown(wp, '#payLinkNone'));
R.ok('где реестра имён нет — блока нет совсем',
  await wp.evaluate(() => { const was = window.namesAddress; window.namesAddress = () => null;
    try{ renderPayLink(); return document.getElementById('payLinkGroup').classList.contains('hidden'); }
    finally { window.namesAddress = was; renderPayLink(); } }));
const walletErrors = W.errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|ERR_NAME_NOT_RESOLVED/i.test(e));
await W.browser.close();

// ======================= 2. страница /@имя =======================
state.names['alice'] = PAYEE;
let { ctx, page } = await fresh();
await page.goto(B + '/@Alice'); await settle(page);
R.ok('/@Alice: ИМЯ НАЙДЕНО, ФОРМА ПОКАЗАНА', await shown(page, '#main') && await shown(page, '#amount') && !(await shown(page, '#err')));
R.ok('регистр приведён: «Pay @alice in USDT»', (await page.textContent('#title')) === 'Pay @alice in USDT', await page.textContent('#title'));
R.ok('ПОКАЗАН КОРОТКИЙ АДРЕС, КУДА УЙДУТ ДЕНЬГИ', (await page.textContent('#addr')) === PAYEE.slice(0, 6) + '…' + PAYEE.slice(-4), await page.textContent('#addr'));
R.ok('и полный — в подсказке', (await page.getAttribute('#addr', 'title')) === PAYEE);
R.ok('имя спросили у реестра имён основной сети (только чтение)', namesAsked.includes(NAMES_MAIN), namesAsked.join(','));
R.ok('у обычного кошелька — выбор сети BNB / Ethereum / Base',
  (await page.$$eval('#netSeg button', b => b.map(x => x.textContent))).join(',') === 'BNB Chain,Ethereum,Base');
R.ok('без суммы кнопка неактивна', await page.isDisabled('#go'));
R.ok('тихая кнопка «Get your own link — free» ведёт в кошелёк', (await page.textContent('a.own')) === 'Get your own link — free' &&
  (await page.getAttribute('a.own', 'href')) === '/');
await page.fill('#amount', '42,5');
R.ok('запятая → точка', (await page.inputValue('#amount')) === '42.5');
R.ok('комиссия названа честно: получит 99%', /42\.075 USDT/.test(await page.textContent('#split')), await page.textContent('#split'));
await page.fill('#amount', '0');
R.ok('ноль нельзя', await page.isDisabled('#go'));
await page.fill('#amount', '42');
await page.fill('#note', 'Dinner‮ 🍜');
R.ok('невидимые символы из комментария убраны', (await page.inputValue('#note')) === 'Dinner 🍜');
await page.screenshot({ path: OUT + '/pay-link-page.png' });

/* ---------- оплата со ссылки ---------- */
await Promise.all([page.waitForURL(/\/pay\?lang=en#p=/, { timeout: 10000 }).catch(() => {}), page.click('#go')]);
const url1 = page.url();
R.ok('ДАЛЬШЕ — ОБЫЧНАЯ СТРАНИЦА ОПЛАТЫ /pay', /\/pay\?lang=en#p=/.test(url1), url1.slice(0, 60));
const inv = decodeInv(url1);
R.ok('в счёте получатель — адрес имени', inv.m === PAYEE, inv.m);
R.ok('сумма, монета, сеть', inv.a === '42' && inv.c === 'USDT' && inv.net === 'bnb', JSON.stringify(inv));
R.ok('имя и комментарий', inv.n === '@alice' && inv.i === 'Dinner 🍜');
R.ok('номер счёта — 32 случайных байта', /^0x[0-9a-f]{64}$/.test(inv.h));
await page.waitForTimeout(600);
R.ok('страница оплаты показала @alice и 42 USDT', (await page.textContent('#shop')) === '@alice' && /42 USDT/.test(await page.textContent('#amount')));

async function payWithFake(page){
  await page.evaluate(() => { window.__calls.length = 0; });
  await page.click('#openOther'); await page.waitForTimeout(300);
  await page.click('#wFound .wrow:nth-child(1)');
  await page.waitForFunction(() => window.__calls.filter(c => c.method === 'eth_sendTransaction').length >= 2, null, { timeout: 20000 }).catch(() => {});
  return page.evaluate(() => window.__calls.filter(c => c.method === 'eth_sendTransaction').map(c => c.params[0]));
}
const viaLink = await payWithFake(page);
await ctx.close();

/* Тот же счёт, открытый напрямую — как его открыл бы покупатель с QR кассы. */
({ ctx, page } = await fresh());
const direct = { m: PAYEE, a: '42', c: 'USDT', h: inv.h, net: 'bnb', n: '@alice', o: 'A-1' };
await page.goto(B + '/pay#p=' + Buffer.from(JSON.stringify(direct)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
await page.waitForTimeout(600);
const viaPay = await payWithFake(page);
await ctx.close();

const units = E.utils.parseUnits('42', 18);
const wantApprove = new E.utils.Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [PAY, units]).toLowerCase();
const wantPay = new E.utils.Interface(['function pay(address merchant, address token, uint256 amount, bytes32 invoice)'])
  .encodeFunctionData('pay', [PAYEE, USDT, units, inv.h]).toLowerCase();
R.ok('СО ССЫЛКИ: ДВЕ ОПЕРАЦИИ — РАЗРЕШЕНИЕ И ОПЛАТА', viaLink.length === 2, viaLink.length);
R.ok('разрешение USDT контракту Tavarov Pay на ровно 42', viaLink[0] && viaLink[0].to.toLowerCase() === USDT.toLowerCase() && viaLink[0].data.toLowerCase() === wantApprove);
R.ok('ОПЛАТА — В КОНТРАКТ TAVAROV PAY 0x1Fc6…1Ca35', viaLink[1] && viaLink[1].to.toLowerCase() === PAY.toLowerCase(), viaLink[1] && viaLink[1].to);
R.ok('pay(получатель, USDT, 42, номер счёта) — байт в байт', viaLink[1] && viaLink[1].data.toLowerCase() === wantPay, viaLink[1] && viaLink[1].data.slice(0, 80));
R.ok('ТЕ ЖЕ БАЙТЫ, ЧТО ПО РАВНОМУ СЧЁТУ НАПРЯМУЮ В /pay',
  viaPay.length === 2 && viaPay.every((s, i) => viaLink[i] && s.to.toLowerCase() === viaLink[i].to.toLowerCase() && s.data.toLowerCase() === viaLink[i].data.toLowerCase()),
  viaPay.map(s => s.to + ':' + s.data.slice(0, 10)).join(' '));

// ======================= 3. нет такого имени =======================
({ ctx, page } = await fresh());
for (const bad of ['/@nobody', '/@ab', '/@x-y', '/u?to=']){
  await page.goto(B + bad); await settle(page);
  R.ok('«' + bad + '» — «This name isn’t registered», формы нет',
    await shown(page, '#err') && (await page.textContent('#errH')) === 'This name isn’t registered' && !(await shown(page, '#main')) && !(await shown(page, '#amount')),
    await page.textContent('#errH'));
}
await page.goto(B + '/@nobody'); await settle(page);
await page.screenshot({ path: OUT + '/pay-link-unknown.png' });
nodesDown = true;
await page.goto(B + '/@alice'); await settle(page);
R.ok('СЕТЬ НЕ ОТВЕТИЛА — НЕ «НЕТ ИМЕНИ», А «ОБНОВИТЕ ПОЗЖЕ»',
  await shown(page, '#err') && /Could not check/.test(await page.textContent('#errH')) && !(await shown(page, '#main')), await page.textContent('#errH'));
nodesDown = false;
await ctx.close();

// ======================= 4. сети: контракт, Solana, по-русски =======================
({ ctx, page } = await fresh('ru-RU'));
payeeCode = '0x6080604052';                 // за именем — контракт
await page.goto(B + '/@alice'); await settle(page);
R.ok('ЗА ИМЕНЕМ КОНТРАКТ — ТОЛЬКО BNB CHAIN (как в кошельке)', !(await shown(page, '#netPick')));
R.ok('по-русски: «Оплатить @alice в USDT»', (await page.textContent('#title')) === 'Оплатить @alice в USDT', await page.textContent('#title'));
payeeCode = '0x'; solBinding = SOL;
await page.goto(B + '/@alice'); await settle(page); await page.waitForTimeout(300);
const nets = await page.$$eval('#netSeg button', b => b.map(x => x.textContent));
R.ok('связка с Solana есть — Solana в списке', nets.includes('Solana'), nets.join(','));
await page.click('#netSeg button:has-text("Base")');
R.ok('в Base USDT нет — монета сама стала USDC', (await page.textContent('#title')) === 'Оплатить @alice в USDC', await page.textContent('#title'));
await page.click('#curSeg button:has-text("USDC")');
await page.click('#netSeg button:has-text("Solana")');
R.ok('в Solana показан адрес Solana', (await page.getAttribute('#addr', 'title')) === SOL);
await page.fill('#amount', '5');
await Promise.all([page.waitForURL(/\/pay\?lang=ru#p=/, { timeout: 10000 }).catch(() => {}), page.click('#go')]);
const invSol = decodeInv(page.url());
R.ok('счёт Solana: получатель — адрес Solana, монета выбранная (USDC)', invSol.net === 'solana' && invSol.m === SOL && invSol.c === 'USDC', JSON.stringify(invSol));
solBinding = null;
await ctx.close();

// ======================= 5. запасной путь через кошелёк =======================
({ ctx, page } = await fresh());
fnOn = false;
await page.goto(B + '/@alice');
await page.waitForURL(/\/u\?to=alice/, { timeout: 15000 }).catch(() => {});
await settle(page);
R.ok('/@ИМЯ ПОПАЛО В КОШЕЛЁК — ОН ПЕРЕВЁЛ НА /u?to=alice', /\/u\?to=alice$/.test(page.url()) && await shown(page, '#main'), page.url());
fnOn = true;
await ctx.close();

await browser.close();
srv.close();
const pageErrors = errors.filter(e => !/ERR_TUNNEL|Failed to load resource|net::ERR/i.test(e));
const pass = R.done(walletErrors.concat(pageErrors));
process.exit(pass ? 0 : 1);
