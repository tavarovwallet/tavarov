/* t83: страница оплаты в Ethereum и Base (1 октября 2026). Основа — t58.
   Главное: USDT в Ethereum с шестью знаками, остаток разрешения сначала
   обнуляется, сеть переключается на 0x1, подписи говорят про ETH, а не BNB.

   Оплата чужим кошельком — через контракт, с выбором кошелька.

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

const WWW = '/home/claude/apk/www', PORT = 8832;
const MERCHANT = '0x73BBaAbB4c9Ee01e3Bf7C9D0Fd5C0b3f0D1eF432';
const BUYER    = '0x1111111111111111111111111111111111111111';
const USDT     = '0xdAC17F958D2ee523a2206206994597C13D831ec7';   // USDT в Ethereum
const PAY      = '0x5046399643c387d93e1467bad3fd7edf3fb459da';   // контракт оплаты в Ethereum (выпущен 1 октября)
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
const invoice = { m: MERCHANT, a: '42', c: 'USDT', h: INVOICE, net: 'eth', n: 'Кофейня', o: 'A-17' };
const PAGE = 'http://localhost:' + PORT + '/pay#p=' + b64(invoice);
const PAGE_BASE = 'http://localhost:' + PORT + '/pay#p=' + b64({ m: MERCHANT, a: '7', c: 'USDC', h: INVOICE, net: 'base', n: 'Shop' });
const PAGE_BAD = 'http://localhost:' + PORT + '/pay#p=' + b64({ m: MERCHANT, a: '7', c: 'USDT', h: INVOICE, net: 'base' });
const PAGE_UNKNOWN = 'http://localhost:' + PORT + '/pay#p=' + b64({ m: MERCHANT, a: '7', c: 'USDC', h: INVOICE, net: 'polygon' });

/* Кошелёк-двойник. Ведёт себя как настоящий: спрашивает сеть, переключает
   её, отвечает на eth_call про контракт и токен, принимает операции и
   выдаёт квитанции. Всё, о чём его просили, пишет в window.__calls. */
const FAKE = ({ buyer, behaviour }) => {
  window.__calls = [];
  const mk = (name, rdns, icon, opts) => {
    let chain = '0x38', switched = false;   // кошелёк открыт в BNB — страница обязана переключить
    const units = 42n * 10n ** 6n;
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
        if (tx.data.startsWith('0x095ea7b3')) window.__allowance = BigInt('0x' + tx.data.slice(74)).toString();
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
    else if (d.startsWith('0x70a08231')) result = w(b.poor ? 5n * 10n ** 6n : 100n * 10n ** 6n);
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
  await ctx.route(/bsc-dataseed|bnbchain\.org|publicnode\.com|drpc\.org|1rpc\.io|base\.org/, route => узел(page, route));
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.dismiss().catch(()=>{}));
  return { ctx, page };
}
const видно = (page, sel) => page.evaluate(s => { const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; }, sel);


// ===== 1. Пока контракт в сети не выпущен — оплаты чужим кошельком нет =====
let { ctx, page } = await freshPage();
await page.goto(PAGE); await page.waitForTimeout(500);
ok('счёт в Ethereum показан', await видно(page, '#main'));
ok('сеть подписана как Ethereum', (await page.textContent('#net')) === 'Ethereum', await page.textContent('#net'));
ok('контракт в Ethereum выпущен — кнопка «другим кошельком» есть', await видно(page, '#openOther'));
ok('адрес контракта в странице — настоящий', (await page.evaluate(() => PAY_CONTRACT.eth)) === PAY);
ok('тестовой плашки нет', !(await видно(page, '#testnetWarn')));
const sChain = await page.evaluate(() => t('sChain')), wSub = await page.evaluate(() => t('wSub')), wNoGas = await page.evaluate(() => t('wNoGas'));
ok('шаг «Сеть Ethereum»', sChain === 'Сеть Ethereum', sChain);
ok('подписи про комиссию — в ETH, без BNB', /ETH/.test(wSub) && !/BNB/.test(wSub + wNoGas), wNoGas);
const tr = await page.evaluate(() => { applyLang('tr'); const v = t('wWrongChain'); applyLang('ru'); return v; });
ok('по-турецки «Ethereum’a» (окончание по сети)', /Ethereum’a/.test(tr), tr);
ok('ссылка в наше приложение несёт net=eth', /net=eth/.test(await page.evaluate(() => payLink())));
const trust = await page.evaluate(() => walletApps().find(a => a.name === 'Trust Wallet').href);
ok('Trust Wallet открывается в Ethereum (coin_id=60)', /coin_id=60&/.test(trust), trust.slice(0, 70));

// ===== 2. Контракт есть, а у покупателя хвост разрешения 3 USDT =====
await page.evaluate(() => { window.__allowance = String(3n * 10n ** 6n); render(); });
await page.click('#openOther'); await page.waitForTimeout(300);
await page.evaluate(() => { window.__calls.length = 0; });
await page.click('#wFound .wrow:nth-child(1)');
await page.waitForFunction(() => /Оплата отправлена/.test(document.getElementById('wErr').textContent), null, { timeout: 20000 }).catch(()=>{});
const calls = await page.evaluate(() => window.__calls.filter(c => c.wallet === 'MetaMask'));
const sw = calls.find(c => c.method === 'wallet_switchEthereumChain');
ok('СЕТЬ ПЕРЕКЛЮЧЕНА НА ETHEREUM (0x1)', sw && sw.params[0].chainId === '0x1', sw && JSON.stringify(sw.params));
const sends = calls.filter(c => c.method === 'eth_sendTransaction').map(c => c.params[0]);
const erc = new E.utils.Interface(['function approve(address,uint256)']);
const pay = new E.utils.Interface(['function pay(address merchant, address token, uint256 amount, bytes32 invoice)']);
const u42 = E.utils.parseUnits('42', 6);
ok('ОПЕРАЦИЙ ТРИ: ОБНУЛИТЬ, РАЗРЕШИТЬ, ОПЛАТИТЬ', sends.length === 3, sends.length + ' ' + (await page.textContent('#wErr')));
ok('сначала разрешение обнулено', sends[0] && sends[0].data.toLowerCase() === erc.encodeFunctionData('approve', [PAY, 0]).toLowerCase(), sends[0] && sends[0].data);
ok('потом ровно 42 USDT (шесть знаков!)', sends[1] && sends[1].data.toLowerCase() === erc.encodeFunctionData('approve', [PAY, u42]).toLowerCase(), sends[1] && sends[1].data);
ok('оплата байт в байт', sends[2] && sends[2].to.toLowerCase() === PAY.toLowerCase()
  && sends[2].data.toLowerCase() === pay.encodeFunctionData('pay', [MERCHANT.toLowerCase(), USDT, u42, INVOICE]).toLowerCase());
const hosts = [...new Set(узлы)];
ok('читали узлы Ethereum, не BNB', hosts.every(h => /ethereum|eth\.|1rpc/.test(h)) && hosts.length > 0, hosts.join(','));
await ctx.close();

// ===== 3. Base: USDC; USDT в Base нет; незнакомая сеть — не показываем =====
({ ctx, page } = await freshPage());
await page.goto(PAGE_BASE); await page.waitForTimeout(400);
ok('счёт в Base показан, сеть подписана', await видно(page, '#main') && (await page.textContent('#net')) === 'Base');
await ctx.close();
({ ctx, page } = await freshPage());
await page.goto(PAGE_BAD); await page.waitForTimeout(400);
ok('USDT в Base не предлагаем (кнопки нет)', !(await видно(page, '#openOther')));
await ctx.close();
({ ctx, page } = await freshPage());
await page.goto(PAGE_UNKNOWN); await page.waitForTimeout(400);
ok('счёт из незнакомой сети не показан', !(await видно(page, '#main')) && await видно(page, '#err'));
await ctx.close();

await browser.close(); srv.close();
const bad = rows.filter(x => !x).length;
console.log('\n--- ' + (rows.length - bad) + ' из ' + rows.length + ' ---');
if (errors.length) console.log('ОШИБКИ СТРАНИЦЫ:\n  ' + [...new Set(errors)].join('\n  '));
process.exit(0);
