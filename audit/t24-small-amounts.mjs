/* Мелкие остатки и подписи на кнопках.

   Два случая с одного экрана, оба замечены человеком, а не машиной.

   ПЕРВЫЙ. Бонус в 0.00027 TVR на кошельке показывался как «0.00»: список
   монет округлял до копеек, как принято у денег. Монеты есть, а человек видит
   ноль — и делает единственный вывод, какой тут можно сделать. Хуже того,
   вкладка бонусов то же самое число показывала с четырьмя знаками и оно было
   видно: два экрана приложения противоречили друг другу.

   ВТОРОЙ. На кнопке возврата стояло дословное «&#8249;&nbsp;Кошелёк». Строки
   переехали в словарь, а подставляются они текстом — разворачивать сущности
   стало некому. Так на видном месте оказалась строка из разметки.

   Оба места здесь и проверяются, вместе с главным правилом: НЕНУЛЕВОЙ ОСТАТОК
   НИКОГДА НЕ ПОКАЗЫВАЕТСЯ НУЛЁМ. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });

const me = await page.evaluate(() => wallet.evm.address);

// ---------- сам счётчик знаков ----------
const cases = [
  [0,                     '0',            'ровный ноль так и пишем'],
  [0.000277778792920523,  '0.000278',     'КРОШЕЧНЫЙ ОСТАТОК ВИДЕН, А НЕ ОКРУГЛЁН В НОЛЬ'],
  [0.00165,               '0.00165',      'тысячные доли видны'],
  [0.0199,                '0.0199',       'сотые доли видны'],
  [0.5,                   '0.50',         'половина монеты — привычные два знака'],
  [2.9857,                '2.99',         'у крупного числа лишние знаки только мешают'],
  [1234.5,                '1234.50',      'тысячи не теряют копейки'],
  [1e-10,                 '<0.00000001',  'то, что не влезает и в восемь знаков, названо честно']
];
for (const [v, want, label] of cases){
  const got = await page.evaluate(x => fmtAmount(x), v);
  R.ok(label, got === want, v + ' → ' + got + ' (ждали ' + want + ')');
}
R.ok('нечего показать — прочерк, а не ноль',
  (await page.evaluate(() => fmtAmount(null))) === '—');

// ---------- то же самое на живых экранах ----------
state.balances[me.toLowerCase()] = { native: 0.00031, USDT: 0, TVR: 0.000277778792920523 };
await page.evaluate(() => { tab = 'wallet'; renderWalletState(); });
await page.evaluate(() => refreshBalances());
await page.waitForTimeout(2500);
const list = await page.evaluate(() => document.getElementById('tokenList').innerText);
R.ok('В СПИСКЕ МОНЕТ БОНУС ВИДЕН, А НЕ «0.00»',
  /0\.000278/.test(list), list.replace(/\n/g, ' | ').slice(0, 120));
R.ok('и мелкий остаток монеты сети тоже виден',
  /0\.00031/.test(list), list.replace(/\n/g, ' | ').slice(0, 120));
R.ok('ноль в списке не показан шестью знаками',
  !/0\.000000/.test(list), list.replace(/\n/g, ' | ').slice(0, 120));

await page.evaluate(() => openToken('TVR'));
await page.waitForTimeout(900);
const big = await page.evaluate(() => document.getElementById('tkBalance').textContent);
R.ok('НА ЭКРАНЕ МОНЕТЫ ТО ЖЕ ЧИСЛО, ЧТО И В СПИСКЕ', /0\.000278 TVR/.test(big), big);

// ---------- кнопка возврата ----------
const back = await page.evaluate(() =>
  document.querySelector('#tokenCard .browser-bar .mini-btn').textContent);
R.ok('НА КНОПКЕ СТРЕЛКА, А НЕ «&#8249;&nbsp;»',
  !/&#|&nbsp;|&[a-z]+;/.test(back) && /Кошелёк/.test(back), JSON.stringify(back));
R.ok('и стрелка — настоящий знак', back.indexOf('‹') >= 0, JSON.stringify(back));
R.ok('и разделитель — неразрывный пробел', back.indexOf(' ') >= 0, JSON.stringify(back));

// ---------- ни одной сущности на всех экранах ----------
const leftovers = await page.evaluate(() => {
  const bad = [];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (/&#\d+;|&nbsp;|&laquo;|&raquo;|&mdash;|&amp;/.test(el.textContent))
      bad.push(el.getAttribute('data-i18n') + ': ' + el.textContent.slice(0, 40));
  });
  return bad;
});
R.ok('НИ НА ОДНОЙ НАДПИСИ НЕ ОСТАЛОСЬ СЫРЫХ СУЩНОСТЕЙ',
  leftovers.length === 0, leftovers.join(' | ').slice(0, 140));

/* Перевод не должен уметь выполнять код: словарь подставляется текстом, и
   разметка внутри строки обязана остаться безобидным текстом. */
const injected = await page.evaluate(() => {
  const el = document.querySelector('#tokenCard .browser-bar .mini-btn');
  const before = el.innerHTML;
  I18N.ru.__probe = '&lt;img src=x onerror=alert(1)&gt;';
  el.setAttribute('data-i18n', '__probe');
  applyI18n(document.getElementById('tokenCard'));
  const after = { html: el.innerHTML, text: el.textContent, imgs: el.querySelectorAll('img').length };
  el.setAttribute('data-i18n', 'k29cf7d0f');
  applyI18n(document.getElementById('tokenCard'));
  void before;
  return after;
});
R.ok('РАЗВЁРНУТАЯ РАЗМЕТКА ОСТАЁТСЯ ТЕКСТОМ, А НЕ СТАНОВИТСЯ РАЗМЕТКОЙ',
  injected.imgs === 0 && injected.html.indexOf('&lt;img') === 0,
  injected.html.slice(0, 60));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
