/* Оплата чужим кошельком — через контракт, с выбором кошелька.

   Раньше кнопка «другим кошельком» была ссылкой ethereum:… — обычный
   перевод. Два изъяна: телефон сам выбирал кошелёк (у кого их три — того
   уводило в MetaMask), и перевод шёл мимо контракта, то есть без комиссии
   и без записи о продаже.

   Здесь проверяется новое поведение, и проверяется по-настоящему: в
   страницу подсовывается кошелёк-двойник по стандарту EIP-1193/6963, он
   записывает каждую просьбу страницы, и мы сверяем байты операций с тем,
   что собрала бы библиотека ethers. Ошибка в одном байте здесь — это
   деньги, ушедшие не туда. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');

const WWW = '/home/claude/apk/www', PORT = 8831;
const MERCHANT = '0x73BBaAbB4c9Ee01e3Bf7C9D0Fd5C0b3f0D1eF432';
const BUYER    = '0x1111111111111111111111111111111111111111';
const USDT     = '0x55d398326f99059fF775485246999027B3197955';
const PAY      = '0x1Fc681FA250A17e66B57B7150F2EeD4e71D1Ca35';   // v3 с 23 сентября
const INVOICE  = '0x' + 'cd'.repeat(32);

let оплачено = false;
let статус = null;           // если задан — отдаётся как есть
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/status'){
    res.writeHead(200, { 'content-type':'application/json' });
    if (статус) return res.end(JSON.stringify(статус));
    return res.end(JSON.stringify(оплачено ? { paid:true, source:'sale', payer: BUYER } : { paid:false }));
  }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));

const rows = [];
const ok = (name, cond, detail) => { rows.push(!!cond);
  console.log((cond ? 'OK   ' : 'ПРОВАЛ ') + name + (detail !== undefined && detail !== '' ? '  [' + String(detail).slice(0, 160) + ']' : '')); };

const b64 = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const invoice = { m: MERCHANT, a: '42', c: 'USDT', h: INVOICE, net: 'bnb', n: 'Кофейня', o: 'A-17' };
const PAGE = 'http://localhost:' + PORT + '/pay#p=' + b64(invoice);

/* Кошелёк-двойник. Ведёт себя как настоящий: спрашивает сеть, переключает
   её, отвечает на eth_call про контракт и токен, принимает операции и
   выдаёт квитанции. Всё, о чём его просили, пишет в window.__calls. */
const FAKE = ({ buyer, behaviour }) => {
  window.__calls = [];
  const mk = (name, rdns, icon, opts) => {
    let chain = '0x1', switched = false;
    const units = 42n * 10n ** 18n;
    const provider = { request: async ({ method, params }) => {
      window.__calls.push({ wallet: name, method, params });
      const b = window.__behaviour || {};
      if (method === 'eth_requestAccounts'){
        if (b.hang) return new Promise(() => {});
        if (b.reject) { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
        return [b.account || buyer];
      }
      /* Так молчит MetaMask во встроенном браузере iPhone: после
         переключения сети на служебные вопросы он не отвечает вовсе. */
      if (method === 'eth_chainId'){ if (b.silentAfterSwitch && switched) return new Promise(() => {}); return chain; }
      if (method === 'wallet_switchEthereumChain'){
        if (b.noChain){ const e = new Error('Unrecognized chain ID'); e.code = 4902; throw e; }
        chain = params[0].chainId; switched = true; return null;
      }
      if (method === 'wallet_addEthereumChain'){ chain = params[0].chainId; return null; }
      /* Чтения страница у кошелька больше не спрашивает. Если спросит —
         зависаем, как MetaMask на iPhone: тест тогда повиснет на шаге 3. */
      if (method === 'eth_getBalance' || method === 'eth_call' || method === 'eth_getTransactionReceipt'){
        window.__walletReads = (window.__walletReads || 0) + 1;
        return new Promise(() => {});
      }
      if (method === 'eth_sendTransaction'){
        const tx = params[0];
        if (b.signHang) return new Promise(() => {});
        if (tx.data.startsWith('0x095ea7b3')) window.__allowance = String(units);
        return '0x' + (window.__calls.length).toString(16).padStart(64, 'a');
      }
      throw new Error('unexpected ' + method);
    } };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider',
      { detail: Object.freeze({ info: { uuid: rdns, name, icon, rdns }, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  };
  mk('MetaMask', 'io.metamask', 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
  mk('Trust Wallet', 'com.trustwallet.app', 'javascript:alert(1)');          // значок-ловушка
};

/* Публичные узлы BNB Chain. Страница читает цепь через них, а не через
   кошелёк; из песочницы их не видно, поэтому отвечаем за них здесь —
   по тем же правилам, что настоящий контракт и токен. */
const узлы = [];
async function узел(page, route){
  const req = route.request();
  let q; try{ q = JSON.parse(req.postData() || '{}'); } catch(e){ q = {}; }
  узлы.push(new URL(req.url()).host);
  const st = await page.evaluate(() => ({ b: window.__behaviour || {}, a: window.__allowance || '0' })).catch(() => ({ b:{}, a:'0' }));
  const b = st.b;
  if (b.nodesDown) return route.fulfill({ status: 503, body: 'down' });
  const w = v => '0x' + BigInt(v).toString(16).padStart(64, '0');
  let result = '0x';
  if (q.method === 'eth_getBalance') result = b.noGas ? '0x0' : '0x16345785d8a0000';
  else if (q.method === 'eth_call'){
    const d = q.params[0].data;
    if (d.startsWith('0x55f5e7de')) result = w(1n);
    else if (d.startsWith('0x38d56afe')) result = b.taken ? '0x' + '0'.repeat(24) + 'ee'.repeat(20) + '0'.repeat(64 * 6) : '0x' + '0'.repeat(64 * 7);
    else if (d.startsWith('0x70a08231')) result = w(b.poor ? 5n * 10n ** 18n : 100n * 10n ** 18n);
    else if (d.startsWith('0xdd62ed3e')) result = w(st.a);
  }
  else if (q.method === 'eth_getTransactionReceipt'){
    result = b.receipt === 'never' ? null : b.receipt === 'zero' ? { status: '0x0' } : { status: '0x1' };
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) });
}

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const errors = [];

async function freshPage(opts = {}){
  const ctx = await browser.newContext(Object.assign({ viewport:{ width:390, height:844 }, locale:'ru-RU' }, opts.ctx || {}));
  await ctx.addInitScript(FAKE, { buyer: BUYER });
  const page = await ctx.newPage();
  await ctx.route(/bsc-dataseed|bnbchain\.org|publicnode\.com/, route => узел(page, route));
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.dismiss().catch(()=>{}));
  return { ctx, page };
}
const видно = (page, sel) => page.evaluate(s => { const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; }, sel);

// ======================= выбор кошелька =======================
let { ctx, page } = await freshPage();
await page.goto(PAGE); await page.waitForTimeout(500);

ok('ПРЯМОГО ПЕРЕВОДА МИМО КОНТРАКТА БОЛЬШЕ НЕТ',
  !(await page.evaluate(() => document.documentElement.innerHTML.includes('ethereum:0x'))));
ok('кнопка «другим кошельком» на месте', await видно(page, '#openOther'));
ok('и это кнопка, а не ссылка, которую телефон отдаст кому захочет',
  await page.evaluate(() => document.getElementById('openOther').tagName === 'BUTTON'));

await page.click('#openOther'); await page.waitForTimeout(300);
ok('ОТКРЫЛСЯ ВЫБОР КОШЕЛЬКА', await видно(page, '#wSheet'));
const names = await page.$$eval('#wFound .wrow .wt', els => els.map(e => e.firstChild.textContent));
ok('ВИДНЫ ОБА КОШЕЛЬКА ЭТОГО БРАУЗЕРА, А НЕ ТОЛЬКО METAMASK',
  names.includes('MetaMask') && names.includes('Trust Wallet'), names.join(', '));
const icons = await page.$$eval('#wFound .wrow img', els => els.map(e => e.getAttribute('src')));
ok('значок из data: показан', icons.some(s => s.startsWith('data:image/svg+xml')));
ok('ЗНАЧОК javascript: НЕ ПРОШЁЛ', !icons.some(s => /^javascript:/i.test(s)), icons.join(' | '));
ok('на компьютере ссылок в приложения нет — они ведут на загрузку, а не в кошелёк',
  !(await видно(page, '#wAppsBox')));

// ======================= оплата =======================
await page.evaluate(() => { window.__calls.length = 0; });
await page.click('#wFound .wrow:nth-child(1)');
await page.waitForFunction(() => /Оплата отправлена/.test(document.getElementById('wErr').textContent), null, { timeout: 15000 }).catch(()=>{});
const calls = await page.evaluate(() => window.__calls.filter(c => c.wallet === 'MetaMask'));
const methods = calls.map(c => c.method);
ok('кошелёк подключён', methods.includes('eth_requestAccounts'));
const sw = calls.find(c => c.method === 'wallet_switchEthereumChain');
ok('СЕТЬ ПЕРЕКЛЮЧЕНА НА BNB CHAIN (0x38)', sw && sw.params[0].chainId === '0x38', sw && JSON.stringify(sw.params));

const sends = calls.filter(c => c.method === 'eth_sendTransaction').map(c => c.params[0]);
ok('ОПЕРАЦИЙ РОВНО ДВЕ: РАЗРЕШЕНИЕ И ОПЛАТА', sends.length === 2, sends.length);

const units = E.utils.parseUnits('42', 18);
const erc = new E.utils.Interface(['function approve(address,uint256)']);
const pay = new E.utils.Interface(['function pay(address merchant, address token, uint256 amount, bytes32 invoice)']);
const wantApprove = erc.encodeFunctionData('approve', [PAY, units]).toLowerCase();
/* ethers строго проверяет регистр букв в адресе (контрольную сумму);
   сверяем байты, поэтому адрес для библиотеки приводим к нижнему регистру. */
const wantPay = pay.encodeFunctionData('pay', [MERCHANT.toLowerCase(), USDT, units, INVOICE]).toLowerCase();

ok('разрешение — токену USDT', sends[0] && sends[0].to.toLowerCase() === USDT.toLowerCase(), sends[0] && sends[0].to);
ok('РАЗРЕШЕНИЕ БАЙТ-В-БАЙТ КАК У ETHERS: КОНТРАКТУ ОПЛАТЫ, РОВНО 42 USDT',
  sends[0] && sends[0].data.toLowerCase() === wantApprove, sends[0] && sends[0].data);
ok('оплата — контракту Tavarov Pay', sends[1] && sends[1].to.toLowerCase() === PAY.toLowerCase(), sends[1] && sends[1].to);
ok('ОПЛАТА БАЙТ-В-БАЙТ КАК У ETHERS: ПРОДАВЕЦ, МОНЕТА, СУММА, НОМЕР СЧЁТА',
  sends[1] && sends[1].data.toLowerCase() === wantPay, sends[1] && sends[1].data);
ok('от имени покупателя', sends.every(s => s.from.toLowerCase() === BUYER.toLowerCase()));
ok('бессрочного разрешения не просили — только на эту сумму',
  !(sends[0] && /f{60}/.test(sends[0].data)));

оплачено = true;
await page.waitForTimeout(5000);
ok('СТРАНИЦА САМА УВИДЕЛА ОПЛАТУ', /Оплачено/.test(await page.textContent('#stateText')), await page.textContent('#stateText'));
ok('и шторка убралась', !(await видно(page, '#wSheet')));
оплачено = false;
await ctx.close();

// ======================= отказы — по-человечески =======================
async function попытка(behaviour){
  const { ctx, page } = await freshPage();
  await page.goto(PAGE); await page.waitForTimeout(400);
  await page.evaluate(b => { window.__behaviour = b; }, behaviour);
  await page.click('#openOther'); await page.waitForTimeout(200);
  await page.click('#wFound .wrow:nth-child(1)');
  await page.waitForFunction(() => !document.getElementById('wErr').classList.contains('hidden'), null, { timeout: 10000 }).catch(()=>{});
  const text = await page.textContent('#wErr');
  const sent = await page.evaluate(() => window.__calls.filter(c => c.method === 'eth_sendTransaction').length);
  const retry = await видно(page, '#wRetry');
  await ctx.close();
  return { text, sent, retry };
}
let r = await попытка({ reject: true });
ok('ОТМЕНА В КОШЕЛЬКЕ — «ВЫ ОТМЕНИЛИ», А НЕ КОД ОШИБКИ', /отменили/.test(r.text), r.text);
ok('и ничего не отправлено', r.sent === 0);
ok('и можно попробовать ещё раз', r.retry);

r = await попытка({ account: MERCHANT });
ok('ПРОДАВЕЦ НЕ ПЛАТИТ САМ СЕБЕ — СКАЗАНО ДО ПОДПИСИ', /продавца/.test(r.text) && r.sent === 0, r.text);

r = await попытка({ poor: true });
ok('НЕ ХВАТАЕТ ДЕНЕГ — СКАЗАНО ЧИСЛАМИ И ДО ПОДПИСИ', /5 USDT/.test(r.text) && r.sent === 0, r.text);

r = await попытка({ noGas: true });
ok('НЕТ BNB НА КОМИССИЮ — СКАЗАНО ПРЯМО', /BNB/.test(r.text) && r.sent === 0, r.text);

r = await попытка({ noChain: true });
ok('СЕТИ НЕТ В КОШЕЛЬКЕ — ДОБАВЛЯЕМ И ПЛАТИМ', /отправлена/.test(r.text) && r.sent === 2, r.text);

// ======================= телефон: приложения =======================
({ ctx, page } = await freshPage({ ctx: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true } }));
await page.goto(PAGE); await page.waitForTimeout(400);
await page.click('#openOther'); await page.waitForTimeout(300);
ok('НА ТЕЛЕФОНЕ ЕСТЬ ПРИЛОЖЕНИЯ-КОШЕЛЬКИ', await видно(page, '#wAppsBox'));
const hrefs = await page.$$eval('#wApps a', els => els.map(e => e.href));
const mm = hrefs.find(h => h.includes('metamask.app.link')) || '';
const tw = hrefs.find(h => h.includes('link.trustwallet.com')) || '';
const okx = hrefs.find(h => h.includes('web3.okx.com')) || '';
ok('MetaMask — по его формату, адрес без https://', mm.startsWith('https://metamask.app.link/dapp/localhost:' + PORT + '/pay?p='), mm.slice(0, 80));
ok('Trust Wallet — сразу в сеть BNB Chain (coin_id 20000714)', /open_url\?coin_id=20000714&url=/.test(tw), tw.slice(0, 80));
ok('OKX — двойное кодирование, как в их документации', /download\?deeplink=okx%3A%2F%2Fwallet%2Fdapp%2Furl%3FdappUrl%3D/.test(okx), okx.slice(0, 90));
ok('ДАННЫЕ СЧЁТА В ССЫЛКЕ — В ЗАПРОСЕ, А НЕ ПОСЛЕ РЕШЁТКИ (часть кошельков её теряет)',
  mm.includes('?p=') && !mm.includes('#'), mm.slice(0, 60));
await ctx.close();

// ======================= пришли из кошелька =======================
({ ctx, page } = await freshPage());
const fromApp = 'http://localhost:' + PORT + '/pay?p=' + b64(invoice) + '&pick=1&lang=tr';
await page.goto(fromApp); await page.waitForTimeout(900);
ok('СЧЁТ ПРОЧИТАН ИЗ СТРОКИ ЗАПРОСА', /42 USDT/.test(await page.textContent('#amount')), await page.textContent('#amount'));
ok('И ТУТ ЖЕ ПЕРЕНЕСЁН ЗА РЕШЁТКУ', await page.evaluate(() => location.search === '' && location.hash.startsWith('#p=')),
  await page.evaluate(() => location.search + ' ' + location.hash.slice(0, 20)));
ok('язык из ссылки сохранился', await page.evaluate(() => LANG === 'tr'));
ok('ШТОРКА ВЫБОРА ОТКРЫЛАСЬ САМА — ЧЕЛОВЕК УЖЕ ВЫБРАЛ КОШЕЛЁК', await видно(page, '#wSheet'));

/* Все новые слова — на всех пяти языках, а не русским по-турецки. */
const пропуски = await page.evaluate(() => {
  const out = [];
  Object.keys(T2.ru).forEach(k => ['en','es','tr','pt'].forEach(l => {
    if (!T2[l] || !T2[l][k] || T2[l][k] === T2.ru[k]) out.push(l + ':' + k);
  }));
  return out;
});
ok('ВСЕ НОВЫЕ СЛОВА ПЕРЕВЕДЕНЫ НА ЧЕТЫРЕ ЯЗЫКА', пропуски.length === 0, пропуски.join(', '));
await ctx.close();

// ======================= после аудита 23 сентября =======================
async function открыть(url, behaviour, lang){
  const { ctx, page } = await freshPage(lang ? { ctx: { locale: lang } } : {});
  await page.goto(url); await page.waitForTimeout(400);
  if (behaviour) await page.evaluate(b => { window.__behaviour = b; }, behaviour);
  return { ctx, page };
}
async function заплатить(page){
  await page.click('#openOther'); await page.waitForTimeout(200);
  await page.click('#wFound .wrow:nth-child(1)');
}
const ждатьОшибку = page => page.waitForFunction(() => !document.getElementById('wErr').classList.contains('hidden'), null, { timeout: 12000 }).catch(()=>{});
const отправлено = page => page.evaluate(() => window.__calls.filter(c => c.method === 'eth_sendTransaction').map(c => c.params[0].data.slice(0, 10)));

// --- номер счёта магазина уже занят: не подписываем ничего ---
({ ctx, page } = await открыть(PAGE, { taken: true }));
await заплатить(page); await ждатьОшибку(page);
ok('ЗАНЯТЫЙ НОМЕР СЧЁТА МАГАЗИНА — ГОВОРИМ ПРАВДУ ДО ПОДПИСИ',
  /занят/.test(await page.textContent('#wErr')) && (await отправлено(page)).length === 0,
  (await page.textContent('#wErr')) + ' / ' + (await отправлено(page)).join(','));
await ctx.close();

// --- у кассы номер занят: берём свой новый и платим ---
const tillInv = Object.assign({}, invoice, { ft: 1 });
const TILLPAGE = 'http://localhost:' + PORT + '/pay#p=' + b64(tillInv);
({ ctx, page } = await открыть(TILLPAGE, { taken: true }));
await заплатить(page);
await page.waitForFunction(() => /отправлена/.test(document.getElementById('wErr').textContent), null, { timeout: 15000 }).catch(()=>{});
{
  const payData = (await page.evaluate(() => window.__calls.filter(c => c.method === 'eth_sendTransaction').map(c => c.params[0].data))).find(d => d.startsWith('0x3e8bca68')) || '';
  ok('У КАССЫ ЗАНЯТЫЙ НОМЕР ЗАМЕНЁН СВОИМ — ОПЛАТА ПРОШЛА', payData && !payData.toLowerCase().endsWith(INVOICE.slice(2)), payData.slice(-20));
}
await ctx.close();

// --- касса: заплатил ДРУГОЙ человек ---
статус = { paid: true, source: 'sale', payer: '0x9999999999999999999999999999999999999999' };
({ ctx, page } = await открыть(TILLPAGE));
await page.waitForTimeout(4600);
{
  const st = await page.textContent('#stateText');
  ok('ВТОРОЙ ПОКУПАТЕЛЬ У КАССЫ НЕ ВИДИТ «ОПЛАЧЕНО» ЗА ЧУЖУЮ ОПЛАТУ', !/^Оплачено$/.test(st.trim()) && /уже заплатили/.test(st), st);
  ok('и видит, с какого кошелька заплатили', /0x9999/.test(await page.textContent('#stateNote')));
}
await ctx.close();

// --- магазин: прямой перевод той же суммы — не наша оплата ---
статус = { paid: true, source: 'transfer', direct: true, uncertain: true, payer: '0x9999999999999999999999999999999999999999' };
({ ctx, page } = await открыть(PAGE));
await page.waitForTimeout(4600);
ok('ЧУЖОЙ ПРЯМОЙ ПЕРЕВОД НЕ ПРЕВРАЩАЕТСЯ В «ОПЛАЧЕНО»', !/Оплачено/.test(await page.textContent('#stateText')), await page.textContent('#stateText'));
await ctx.close();

// --- оплачено: кнопки убраны ---
статус = { paid: true, source: 'sale', payer: BUYER };
({ ctx, page } = await открыть(PAGE));
await page.waitForTimeout(4600);
ok('ПОСЛЕ «ОПЛАЧЕНО» ПЛАТИТЬ ВТОРОЙ РАЗ НЕЧЕМ — КНОПКИ УБРАНЫ',
  /Оплачено/.test(await page.textContent('#stateText')) && !(await видно(page, '#openOther')) && !(await видно(page, '#openWallet')));
await ctx.close();
статус = null;

// --- просроченный счёт ---
const old = Object.assign({}, invoice, { t: Math.floor(Date.now() / 1000) - 3600 });
({ ctx, page } = await открыть('http://localhost:' + PORT + '/pay?p=' + b64(old) + '&pick=1'));
await page.waitForTimeout(1200);
ok('ПРОСРОЧЕННЫЙ СЧЁТ ОПЛАТИТЬ НЕЛЬЗЯ — КНОПОК НЕТ, ШТОРКА НЕ ОТКРЫЛАСЬ',
  !(await видно(page, '#openOther')) && !(await видно(page, '#wSheet')));
await ctx.close();

// --- откат в сети числом 0 ---
({ ctx, page } = await открыть(PAGE, { receipt: 'zero' }));
await заплатить(page); await ждатьОшибку(page);
ok('ОТКАТ (статус 0) — ЭТО ОТКАТ, А НЕ «ГОТОВО»', /отклонила/.test(await page.textContent('#wErr')), await page.textContent('#wErr'));
await ctx.close();

// --- английский: откат ≠ «вы отменили» ---
({ ctx, page } = await открыть(PAGE + '&lang=en', { receipt: 'zero' }));
await заплатить(page); await ждатьОшибку(page);
ok('ПО-АНГЛИЙСКИ ОТКАТ НЕ ВЫДАЁТСЯ ЗА «YOU CANCELLED»', /rejected the operation/.test(await page.textContent('#wErr')), await page.textContent('#wErr'));
await ctx.close();

// --- кошелёк молчит: шторка закрывается ---
({ ctx, page } = await открыть(PAGE, { hang: true }));
await заплатить(page); await page.waitForTimeout(600);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('МОЛЧАЩИЙ КОШЕЛЁК НЕ ЗАПИРАЕТ: ESC ЗАКРЫВАЕТ ШТОРКУ', !(await видно(page, '#wSheet')));
await page.click('#openOther'); await page.waitForTimeout(200);
ok('и выбрать другой кошелёк можно сразу', await видно(page, '#wPick'));
await ctx.close();

// --- кривые ссылки ---
for (const [что, o] of [['сумма «1,000»', { a: '1,000' }], ['сумма «1e3»', { a: '1e3' }],
                        ['незнакомая сеть', { net: 'bnbtestnet' }], ['монета «__proto__»', { c: '__proto__' }]]){
  ({ ctx, page } = await открыть('http://localhost:' + PORT + '/pay#p=' + b64(Object.assign({}, invoice, o))));
  ok('НЕ ПОКАЗЫВАЕМ КРИВОЙ СЧЁТ: ' + что, await видно(page, '#err') && !(await видно(page, '#main')));
  await ctx.close();
}
({ ctx, page } = await открыть('http://localhost:' + PORT + '/pay#p=' + b64(Object.assign({}, invoice, { r: 'https://wallet.tavarov.com/?pay=tavarov:pay?to=0xAAA' }))));
ok('ВОЗВРАТ «В МАГАЗИН» НА НАШ ЖЕ КОШЕЛЁК ОТБРОШЕН', await page.evaluate(() => inv && inv.r === null));
await ctx.close();

// ======================= MetaMask на iPhone: шаг 3 =======================
/* Двадцать третьего сентября оплата из MetaMask на iPhone вставала на
   «Разрешение на эту сумму»: после переключения сети кошелёк перестаёт
   отвечать на чтения. Двойник теперь ведёт себя так же — любая просьба
   прочитать цепь через кошелёк повисает навсегда. */
({ ctx, page } = await открыть(PAGE, { silentAfterSwitch: true }));
await заплатить(page);
await page.waitForFunction(() => /отправлена/.test(document.getElementById('wErr').textContent), null, { timeout: 40000 }).catch(()=>{});
ok('КОШЕЛЁК, МОЛЧАЩИЙ ПОСЛЕ ПЕРЕКЛЮЧЕНИЯ СЕТИ, НЕ ОСТАНАВЛИВАЕТ ОПЛАТУ',
  /отправлена/.test(await page.textContent('#wErr')) && (await отправлено(page)).length === 2,
  (await page.textContent('#wErr')) + ' / ' + (await отправлено(page)).join(','));
ok('ЧИТАЕМ ЦЕПЬ САМИ — У КОШЕЛЬКА НЕ СПРОШЕНО НИ ОДНОГО ЧТЕНИЯ',
  (await page.evaluate(() => window.__walletReads || 0)) === 0);
ok('чтения ушли на публичные узлы BNB Chain', узлы.some(h => /bsc-dataseed|bnbchain|publicnode/.test(h)), узлы.slice(0, 3).join(','));
await ctx.close();

// --- окно подписи не появилось: подсказка, а не вечное колёсико ---
({ ctx, page } = await открыть(PAGE, { signHang: true }));
await заплатить(page);
await page.waitForTimeout(10500);
ok('ЖДЁМ ПОДПИСЬ ДОЛЬШЕ 9 СЕКУНД — ПОДСКАЗКА ОТКРЫТЬ КОШЕЛЁК ВРУЧНУЮ', await видно(page, '#wHint'),
  await page.textContent('#wHint'));
ok('и шаг «Разрешение» при этом честно в работе, а не «ошибка»',
  (await page.evaluate(() => document.querySelector('#wSteps li[data-s="approve"]').className)) === 'run',
  await page.evaluate(() => document.querySelector('#wSteps li[data-s="approve"]').className));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('и шторку можно закрыть', !(await видно(page, '#wSheet')));
await ctx.close();

// --- узлы лежат: говорим это, а не висим ---
({ ctx, page } = await открыть(PAGE, { nodesDown: true }));
await заплатить(page); await ждатьОшибку(page);
ok('УЗЛЫ СЕТИ НЕ ОТВЕЧАЮТ — СКАЗАНО ПО-ЧЕЛОВЕЧЕСКИ И НИЧЕГО НЕ ПОДПИСАНО',
  !(await page.textContent('#wErr')).includes('Unknown') && (await page.textContent('#wErr')).length > 10 && (await отправлено(page)).length === 0,
  await page.textContent('#wErr'));
await ctx.close();

/* Новые слова на пяти языках. */
{
  ({ ctx, page } = await открыть(PAGE));
  const нет = await page.evaluate(() => ['wHint','wStuck','wNetDown'].flatMap(k => ['ru','en','es','tr','pt']
    .filter(l => !(T3[l] && T3[l][k]) || (l !== 'ru' && T3[l][k] === T3.ru[k])).map(l => l + ':' + k)));
  ok('ПОДСКАЗКИ ПРО ЗАВИСШИЙ КОШЕЛЁК — НА ВСЕХ ПЯТИ ЯЗЫКАХ', нет.length === 0, нет.join(','));
  await ctx.close();
}

// ======================= подписи функций =======================
const src = fs.readFileSync(path.join(WWW, 'pay.html'), 'utf8');
for (const [name, sig] of [['balanceOf','balanceOf(address)'], ['allowance','allowance(address,address)'],
                           ['approve','approve(address,uint256)'], ['acceptedToken','acceptedToken(address)'],
                           ['pay','pay(address,address,uint256,bytes32)'], ['saleOf','saleOf(bytes32)']]){
  const m = src.match(new RegExp(name + ":'(0x[0-9a-f]{8})'"));
  ok('подпись ' + sig + ' совпадает с keccak', m && m[1] === E.utils.id(sig).slice(0, 10), m && m[1]);
}

ok('НИ ОДНОЙ ОШИБКИ В КОДЕ СТРАНИЦЫ', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); srv.close();
const bad = rows.filter(x => !x).length;
console.log('\n--- ' + (rows.length - bad) + ' из ' + rows.length + ' ---');
process.exit(bad ? 1 : 0);
