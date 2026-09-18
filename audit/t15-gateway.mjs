/* Шлюз Tavarov Pay целиком: страница оплаты, чтение платежа из сети и
   сообщение магазину.

   Сеть здесь поддельная, но отвечает настоящим форматом логов, поэтому
   проверяется именно то, что делает шлюз: какой вопрос он задаёт сети,
   как разбирает ответ и что в итоге отправляет магазину. */
import { chromium } from 'playwright';
import { reporter } from './boot.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const R = reporter();
const ROOT = '/home/claude/apk/gateway/public';
const PAID = '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861';
const REFUNDED = '0x434165ae37192dd5692130311535353110088922d6cef5924f04ec0507900601';

const SHOP    = '0x1111111111111111111111111111111111111111';
const PAYER   = '0x2222222222222222222222222222222222222222';
const TOKEN   = '0x3333333333333333333333333333333333333333';
const PAYCONT = '0x4444444444444444444444444444444444444444';
const INV     = '0x' + 'cd34'.repeat(16);

const pad = a => '0x' + '0'.repeat(24) + a.toLowerCase().replace(/^0x/, '');
const w   = n => BigInt(n).toString(16).padStart(64, '0');

// ---------- поддельный узел сети ----------
let askedLogs = null;
const node = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const q = JSON.parse(body || '{}');
    let result = null;
    if (q.method === 'eth_blockNumber') result = '0x3e8';           // блок 1000
    if (q.method === 'eth_getLogs') {
      askedLogs = q.params[0];
      /* Отдаём то, о чём спросили: наблюдатель ходит за платежами и за
         возвратами отдельно, и путать их нельзя — иначе возврат приедет
         магазину как ещё одна оплата. */
      const want = (q.params[0].topics || [])[0];
      if (want === PAID) {
        result = [{
          address: PAYCONT,
          topics: [PAID, pad(SHOP), pad(PAYER), pad(TOKEN)],
          data: '0x' + w(12340000) + w(124646) + w('5000000000000000000') + INV.slice(2),
          transactionHash: '0x' + 'ab'.repeat(32),
          blockNumber: '0x3e7'
        }];
      } else if (want === REFUNDED) {
        result = [{
          address: PAYCONT,
          topics: [REFUNDED, pad(SHOP), pad(PAYER), pad(TOKEN)],
          data: '0x' + w(12340000) + w('3000000000000000000') + INV.slice(2),
          transactionHash: '0x' + 'cd'.repeat(32),
          blockNumber: '0x3e7'
        }];
      } else {
        result = [];
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }));
  });
});
await new Promise(r => node.listen(8094, r));

// ---------- поддельный магазин, который ждёт сообщения ----------
const got = [];
const shopSrv = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    got.push({ headers: req.headers, body });
    res.writeHead(200); res.end('ok');
  });
});
await new Promise(r => shopSrv.listen(8093, r));

// ==========================================================
//  1. Чтение платежа из сети
// ==========================================================
process.env.TAVAROV_RPC = 'http://localhost:8094';
process.env.TAVAROV_PAY = PAYCONT;
process.env.TAVAROV_MERCHANTS = JSON.stringify([{
  id: 'shop1', wallet: SHOP, secret: 'секрет-магазина',
  webhook: 'http://localhost:8093/hook', net: 'bnb'
}]);

const { recentPayments } = await import('/home/claude/apk/gateway/netlify/functions/_chain.mjs');
const list = await recentPayments({
  rpcUrl: 'http://localhost:8094', payAddress: PAYCONT, merchant: SHOP, blocks: 500
});

R.ok('платёж найден', list.length === 1, 'найдено ' + list.length);
const p = list[0] || {};
R.ok('НОМЕР СЧЁТА РАЗОБРАН ВЕРНО', p.invoice === INV, p.invoice);
R.ok('сумма разобрана верно', p.amount === '12340000', p.amount);
R.ok('комиссия разобрана верно', p.fee === '124646', p.fee);
R.ok('видно, кто платил', (p.payer || '').toLowerCase() === PAYER, p.payer);
R.ok('спрашиваем только у контракта оплаты',
  (askedLogs.address || '').toLowerCase() === PAYCONT, askedLogs.address);
R.ok('СПРАШИВАЕМ ТОЛЬКО ПЛАТЕЖИ ЭТОГО ПРОДАВЦА',
  askedLogs.topics[0] === PAID && askedLogs.topics[1] === pad(SHOP),
  JSON.stringify(askedLogs.topics));

// ==========================================================
//  2. Сообщение магазину
// ==========================================================
const watch = (await import('/home/claude/apk/gateway/netlify/functions/watch.mjs')).default;
await watch();
await new Promise(r => setTimeout(r, 300));

R.ok('магазину отправлены сообщения', got.length === 2, 'отправлено ' + got.length);
const msg = got.find(g => { try { return JSON.parse(g.body).event === 'payment'; } catch(e){ return false; } })
         || { headers: {}, body: '{}' };
const parsed = JSON.parse(msg.body || '{}');
R.ok('в сообщении есть номер счёта', parsed.invoice === INV, parsed.invoice);
R.ok('в сообщении есть сумма', parsed.amount === '12340000', parsed.amount);
R.ok('в сообщении есть номер операции — по нему магазин отбросит повтор',
  /^0x[0-9a-f]{64}$/.test(parsed.tx || ''), parsed.tx);

const want = 'sha256=' + crypto.createHmac('sha256', 'секрет-магазина').update(msg.body).digest('hex');
R.ok('СООБЩЕНИЕ ПОДПИСАНО СЕКРЕТОМ МАГАЗИНА',
  msg.headers['x-tavarov-signature'] === want, msg.headers['x-tavarov-signature']);

/* Подпись должна ломаться от любой правки — иначе она бесполезна.
   Проверяем это, а не только то, что она совпала. */
const tampered = msg.body.replace('12340000', '99340000');
const bad = 'sha256=' + crypto.createHmac('sha256', 'секрет-магазина').update(tampered).digest('hex');
R.ok('подделанная сумма ломает подпись', bad !== want);

// ---------- возврат тоже доезжает до магазина ----------
const refundMsg = got.find(g => {
  try { return JSON.parse(g.body).event === 'refund'; } catch (e) { return false; }
});
R.ok('О ВОЗВРАТЕ МАГАЗИН ТОЖЕ УЗНАЁТ', !!refundMsg,
  got.map(g => { try { return JSON.parse(g.body).event; } catch (e) { return '?'; } }).join(','));
const rp = refundMsg ? JSON.parse(refundMsg.body) : {};
R.ok('возврат привязан к тому же счёту', rp.invoice === INV, rp.invoice);
R.ok('в возврате указан покупатель, которому вернули',
  (rp.buyer || '').toLowerCase() === PAYER, rp.buyer);
R.ok('возврат помечен отдельным заголовком',
  refundMsg && refundMsg.headers['x-tavarov-event'] === 'refund',
  refundMsg ? refundMsg.headers['x-tavarov-event'] : '—');
R.ok('у возврата своя подпись',
  !!refundMsg && refundMsg.headers['x-tavarov-signature'] ===
    'sha256=' + crypto.createHmac('sha256', 'секрет-магазина').update(refundMsg.body).digest('hex'));

// чужой продавец сообщений не получает
got.length = 0;
process.env.TAVAROV_MERCHANTS = JSON.stringify([{
  id: 'shop2', wallet: '0x9999999999999999999999999999999999999999',
  secret: 'x', webhook: 'http://localhost:8093/hook', net: 'bnb'
}]);
await watch();
await new Promise(r => setTimeout(r, 200));
R.ok('спрашивали платежи именно второго продавца',
  askedLogs.topics[1] === pad('0x9999999999999999999999999999999999999999'), askedLogs.topics[1]);

/* ---------- Куда сообщение НЕ уходит ----------

   Подпись защищает магазин от подделки, но не от чтения: по открытому HTTP
   посторонний увидит, кто и на сколько купил, а при случае придержит
   сообщение. Поэтому наружу — только HTTPS. Исключение одно, для своего же
   компьютера: без него магазин не смог бы проверить настройку до выхода в
   интернет. Проверяем обе стороны этого правила разом. */
const refuse = async (shop) => {
  got.length = 0;
  process.env.TAVAROV_MERCHANTS = JSON.stringify([Object.assign(
    { id: 'shopX', wallet: SHOP, secret: 'секрет-магазина', net: 'bnb' }, shop)]);
  await watch();
  await new Promise(r => setTimeout(r, 200));
  return got.length;
};
R.ok('ОТКРЫТЫЙ HTTP НАРУЖУ — СООБЩЕНИЕ НЕ УХОДИТ',
  (await refuse({ webhook: 'http://пример.рф/hook' })) === 0);
R.ok('и на чужой адрес с логином-паролем в ссылке тоже',
  (await refuse({ webhook: 'https://кто:то@пример.рф/hook' })) === 0);
R.ok('БЕЗ СЕКРЕТА МАГАЗИНА СООБЩЕНИЕ НЕ УХОДИТ ВОВСЕ',
  (await refuse({ webhook: 'https://пример.рф/hook', secret: '' })) === 0);
R.ok('а на свой компьютер по HTTP — уходит, иначе настройку не проверить',
  (await refuse({ webhook: 'http://localhost:8093/hook' })) > 0);

// ==========================================================
//  3. Страница оплаты
// ==========================================================
const site = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (u.startsWith('/api/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ paid: false }));
    return;
  }
  const file = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('нет'); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => site.listen(8095, r));

const inv = {
  m: SHOP, a: '12.34', c: 'USDT', o: 'заказ-1024',
  n: 'Магазин «Пример»', i: 'Кроссовки беговые, 42',
  net: 'bnbTestnet', t: Math.floor(Date.now() / 1000) + 900,
  r: 'http://localhost:8095/?вернулись=1', h: INV
};
const b64url = s => Buffer.from(s, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* Переход на тот же адрес с другой решёткой браузер за перезагрузку не
   считает — страница осталась бы прежней, и проверка мерила бы не то.
   Поэтому каждый раз уходим в пустоту и возвращаемся. */
async function openPay(page, hash){
  await page.goto('about:blank');
  await page.goto('http://localhost:8095/pay.html#p=' + hash, { waitUntil: 'load' });
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox']
});
const errors = [];
const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await openPay(page, b64url(JSON.stringify(inv)));
await page.waitForTimeout(900);

const text = await page.evaluate(() => document.body.innerText);
R.ok('видно название магазина', text.includes('Магазин «Пример»'));
R.ok('видно, за что платим', text.includes('Кроссовки беговые'));
R.ok('видна сумма', text.includes('12.34 USDT'));
R.ok('виден адрес получателя', text.toLowerCase().includes(SHOP.toLowerCase()));
R.ok('виден номер заказа', text.includes('заказ-1024'));
R.ok('счёт показывает, сколько ещё действует', /действует ещё \d+:\d\d/.test(text), '');
R.ok('код нарисован',
  (await page.evaluate(() => document.querySelectorAll('#qr img, #qr canvas').length)) > 0);

const walletUrl = await page.getAttribute('#openWallet', 'href');
const link = decodeURIComponent((walletUrl.split('?pay=')[1] || ''));
/* Кошелёк переехал на свой домен: старый адрес на площадке, которую мы
   больше не обновляем, увёл бы покупателя в прошлогоднюю сборку. */
R.ok('кнопка ведёт в кошелёк', walletUrl.startsWith('https://wallet.tavarov.com/?pay='), walletUrl.slice(0, 60));
R.ok('в ссылке НОМЕР СЧЁТА МАГАЗИНА', link.includes('inv=' + INV), link.slice(0, 120));
R.ok('в ссылке сумма и продавец',
  link.includes('amt=12.34') && link.toLowerCase().includes('m=' + SHOP.toLowerCase()), '');

/* Сломанная ссылка не должна показывать «оплатите» вообще ничего:
   человек, платящий по испорченному счёту, платит неизвестно кому. */
await openPay(page, 'этоненастоящийсчёт');
await page.waitForTimeout(500);
R.ok('испорченный счёт не показывается как оплата',
  await page.evaluate(() => !document.getElementById('err').classList.contains('hidden')));
R.ok('и кода для оплаты там нет',
  (await page.evaluate(() => document.querySelectorAll('#qr img, #qr canvas').length)) === 0);

// счёт без адреса продавца тоже не должен открываться
await openPay(page, b64url(JSON.stringify({ ...inv, m: 'не адрес' })));
await page.waitForTimeout(400);
R.ok('счёт без нормального адреса отвергнут',
  await page.evaluate(() => !document.getElementById('err').classList.contains('hidden')));

// ---------- «оплачено» показывается, когда сеть это подтвердила ----------
await page.route('**/api/status*', route => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ paid: true, tx: '0x' + 'ab'.repeat(32) })
}));
await openPay(page, b64url(JSON.stringify({ ...inv, r: '' })));
await page.waitForTimeout(1500);
R.ok('ОПЛАТА ПОКАЗАНА КАК ПРОШЕДШАЯ',
  (await page.evaluate(() => document.getElementById('stateText').textContent)).includes('Оплачено'),
  await page.evaluate(() => document.getElementById('stateText').textContent));

await page.screenshot({ path: '/home/claude/apk/audit/shots/шлюз-страница-оплаты.png', fullPage: true });

const clean = errors.filter(e => !/favicon|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close();
node.close(); shopSrv.close(); site.close();
process.exit(good ? 0 : 1);
