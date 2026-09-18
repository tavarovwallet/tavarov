/* Две площадки вместе: витрина и кошелёк на разных адресах.

   Разделение сделано ради одного: у кошелька своё хранилище, и скрипт с
   витрины до ключей не дотянется. Но у разделения есть цена — теперь любая
   ссылка между площадками ведёт на ЧУЖОЙ адрес, и ошибиться в ней можно
   молча. Относительная «./» на витрине даёт 404 вместо приложения; забытый
   старый адрес уводит человека туда, где его кошелька нет.

   Проверять это по одной папке бессмысленно: обе по отдельности зелёные.
   Поэтому здесь поднимаются ОБА адреса сразу, из тех самых папок, которые
   уедут на хостинг, и по ним ходят как человек: с витрины в приложение, из
   приложения на страницу оплаты.

   И отдельно — то, ради чего всё затевалось: что витрина действительно не
   видит хранилища кошелька. */
import { reporter } from './boot.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const SITE   = '/home/claude/apk/site';
const WALLET = '/home/claude/apk/www';
const TYPES  = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                 '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8',
                 '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };

const R = reporter();
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1180, height: 900 } });
await ctx.addInitScript(() => { try{ localStorage.setItem('tavarov.lang.v1', 'ru'); }catch(e){} });

const serve = (root) => (route) => {
  const u = new globalThis.URL(route.request().url());
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  let file = path.join(root, rel);
  /* КАК НАСТОЯЩИЙ ХОСТИНГ: /invoice отдаётся из invoice.html — правило из
     файла _redirects. Повторяем, иначе ходим по несуществующим адресам. */
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    return route.fulfill({ status: 404, contentType: 'text/html; charset=utf-8',
                           body: '<h1>404</h1>' });
  route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream',
                  body: fs.readFileSync(file) });
};
await ctx.route('https://tavarov.com/**', serve(SITE));
await ctx.route('https://wallet.tavarov.com/**', serve(WALLET));
/* Всё постороннее — узлы сети, котировки — отклоняем сразу, чтобы не ждать
   таймаутов на каждом шаге. */
await ctx.route('**', route => {
  const u = route.request().url();
  return /^https:\/\/(tavarov\.com|wallet\.tavarov\.com)\//.test(u) ? route.fallback() : route.abort();
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

// ---------- витрина открывается ----------
await page.goto('https://tavarov.com/', { waitUntil: 'domcontentloaded' });
R.ok('витрина открывается на tavarov.com', (await page.title()).includes('Tavarov'), await page.title());
R.ok('и это именно витрина, а не приложение',
  await page.evaluate(() => !!document.querySelector('.hero') && typeof window.renderWalletState === 'undefined'));

// ---------- переход в приложение ----------
/* Главная кнопка витрины. Если она сломана, всё остальное не имеет значения:
   человек пришёл по рекламе и упёрся в пустую страницу. */
await page.click('a.btn-main');
await page.waitForURL('https://wallet.tavarov.com/**', { timeout: 15000 }).catch(()=>{});
R.ok('КНОПКА «ОТКРЫТЬ КОШЕЛЁК» ПРИВОДИТ НА АДРЕС КОШЕЛЬКА',
  page.url().startsWith('https://wallet.tavarov.com/'), page.url());
await page.waitForFunction(() => typeof window.renderWalletState === 'function', null, { timeout: 15000 });
R.ok('и там действительно поднимается приложение', true);
R.ok('полосы «переехал» на новом адресе нет',
  await page.evaluate(() => document.getElementById('moveBanner').classList.contains('hidden')));

// ---------- страница счёта ----------
await page.goto('https://tavarov.com/', { waitUntil: 'domcontentloaded' });
const invoiceHref = await page.getAttribute('a[href*="/invoice"]', 'href');
/* Витрина дописывает к ссылке выбранный язык: касса живёт на другом адресе и
   про наш выбор ничего не знает, а человек, читавший витрину по-турецки, не
   должен попасть в русскую кассу. */
R.ok('ссылка «выставить счёт» ведёт на кошелёк',
  /^https:\/\/wallet\.tavarov\.com\/invoice(\?lang=[a-z]{2})?$/.test(String(invoiceHref)),
  String(invoiceHref));
R.ok('И БЕЗ .html — ЭТОТ АДРЕС ЧЕЛОВЕК ВИДИТ И КОПИРУЕТ',
  !/\.html/.test(String(invoiceHref)), String(invoiceHref));
R.ok('И УНОСИТ С СОБОЙ ЯЗЫК ВИТРИНЫ', /\?lang=[a-z]{2}$/.test(String(invoiceHref)),
  String(invoiceHref));
const resp = await page.goto(invoiceHref, { waitUntil: 'domcontentloaded' });
R.ok('СТРАНИЦА ВЫСТАВЛЕНИЯ СЧЁТА ОТКРЫВАЕТСЯ, А НЕ ОТДАЁТ 404',
  resp && resp.status() === 200, String(resp && resp.status()));

// ---------- политика ----------
const priv = await page.goto('https://tavarov.com/privacy', { waitUntil: 'domcontentloaded' });
R.ok('политика конфиденциальности лежит на витрине и открывается',
  priv && priv.status() === 200 && (await page.title()).toLowerCase().includes('tavarov'),
  String(priv && priv.status()));

// ---------- ссылка на оплату из кассы ----------
/* Та самая ссылка, которую продавец шлёт интернет-покупателю. Собирается она
   в приложении, а открывается на странице оплаты — то есть проходит ровно
   через границу между площадками. */
await page.goto('https://wallet.tavarov.com/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.buildWebInvoice === 'function');
/* Номер счёта обязателен: без него страница оплаты отвергает ссылку, и
   правильно делает — по номеру она потом узнаёт свой платёж среди чужих.
   Берём его той же функцией, что и касса, а не выдумываем. */
const payUrl = await page.evaluate(() => buildWebInvoice({
  merchant: '0x2222222222222222222222222222222222222222', amt: '12.5',
  cur: 'USDT', net: 'bnb', order: 'заказ-7', name: 'coffee', inv: newInvoiceId() }));
R.ok('ссылка на оплату собирается на адрес кошелька',
  payUrl.startsWith('https://wallet.tavarov.com/pay.html#'), payUrl.slice(0, 60));
/* Ссылка на оплату НАРОЧНО остаётся с .html. Чистый /pay хостинг отдаёт
   переадресацией, а она срезает всё после решётки — то есть сам счёт.
   Проверено на живом сайте: /pay#p=... показывает «Ссылка не читается».
   Менять это можно будет только после выкладки www/_redirects и проверки. */
R.ok('И ЭТО НЕ ОШИБКА: СЧЁТ ЖИВЁТ ПОСЛЕ РЕШЁТКИ, ЕГО ТЕРЯЕТ ПЕРЕАДРЕСАЦИЯ',
  payUrl.includes('/pay.html#p='), payUrl.slice(0, 48));

const payResp = await page.goto(payUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
R.ok('СТРАНИЦА ОПЛАТЫ ПО ЭТОЙ ССЫЛКЕ ОТКРЫВАЕТСЯ',
  payResp && payResp.status() === 200, String(payResp && payResp.status()));
const shown = await page.textContent('body');
/* Надпись «Ссылка не читается» лежит в разметке всегда — важно, ПОКАЗАНА
   ли она. Проверять по тексту страницы тут нельзя: он есть и в порядке. */
const failShown = await page.evaluate(() =>
  !document.getElementById('err').classList.contains('hidden'));
R.ok('И ПОКАЗЫВАЕТ СУММУ ИЗ ССЫЛКИ, А НЕ ОТКАЗ «ССЫЛКА НЕ ЧИТАЕТСЯ»',
  /12\.5/.test(shown) && !failShown, failShown ? 'показан отказ' : (shown.match(/12\.5\s*\S*/) || [''])[0]);
R.ok('и валюту', /USDT/.test(shown));
/* Русский текст в названии заказа обязан доехать целым: счёт едет в адресе
   строкой, и неверное раскодирование ломает не только надпись, а всю
   ссылку — страница просто откажется её читать. */
R.ok('и русское название заказа не портится по дороге',
  /заказ-7/.test(shown), (shown.match(/заказ-\S*/) || ['нет'])[0]);

// ---------- ради чего всё затевалось ----------
/* Хранилище кошелька обязано быть недосягаемо со стороны витрины. Это не
   наша добрая воля, а правило браузера, но проверить его стоит: ошибись мы
   адресом — и разделения не будет, а мы будем думать, что оно есть. */
await page.goto('https://wallet.tavarov.com/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tavarov.vault.v1', 'секрет кошелька'));
await page.goto('https://tavarov.com/', { waitUntil: 'domcontentloaded' });
const leak = await page.evaluate(() => {
  try { return localStorage.getItem('tavarov.vault.v1'); } catch(e){ return 'ошибка: ' + e.message; }
});
R.ok('ВИТРИНА НЕ ВИДИТ ХРАНИЛИЩА КОШЕЛЬКА — РАДИ ЭТОГО ВСЁ И РАЗДЕЛЕНО',
  leak === null, String(leak));

/* И обратно: то, что витрина положила себе, кошельку не мешает и не видно.
   Метку берём заведомо ничью: под своими именами обе площадки пишут сами —
   касса, например, честно помнит на своём адресе выбранный язык, — и тогда
   проверка ловила бы не утечку, а собственную запись кошелька. */
await page.evaluate(() => localStorage.setItem('tavarov.probe.v1', 'метка витрины'));
await page.goto('https://wallet.tavarov.com/', { waitUntil: 'domcontentloaded' });
const back = await page.evaluate(() => localStorage.getItem('tavarov.probe.v1'));
R.ok('и наоборот тоже', back === null, String(back));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load|net::ERR_FAILED|ERR_ABORTED/i.test(e));
const good = R.done(clean);
await browser.close();
process.exit(good ? 0 : 1);
