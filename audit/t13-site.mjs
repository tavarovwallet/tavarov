/* Сайт-визитка: проверяем то, что видит человек, а не то, что мы написали.
   Отдельно — что английский переведён целиком: непереведённая строка на
   витрине выглядит хуже, чем её отсутствие. */
import { chromium } from 'playwright';
import { reporter } from './boot.mjs';
import http from 'node:http';
import fs from 'node:fs';

const FILE = '/home/claude/apk/site/index.html';
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(fs.readFileSync(FILE));
});
await new Promise(r => srv.listen(8096, r));

const R = reporter();
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox']
});
const errors = [];

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const outside = [];
  page.on('request', q => { const u = q.url();
    if (!u.startsWith('http://localhost:8096') && !u.startsWith('data:')) outside.push(u); });
  await page.goto('http://localhost:8096/', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { page, outside };
}

// ---------- русский телефон ----------
const { page, outside } = await open({ locale: 'ru-RU', viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });

R.ok('русский телефон — открылась русская страница',
  (await page.evaluate(() => document.documentElement.lang)) === 'ru');
const ru = await page.evaluate(() => document.body.innerText);
R.ok('заголовок на месте', ru.includes('Платите криптой, не меняя её на деньги'));
/* Про комиссию нельзя говорить в шапке. Покупатель читает «комиссия один
   процент» как «с меня возьмут процент» — и уходит, хотя платит её продавец.
   Поэтому в первом экране про процент не сказано вовсе, а там, где сказано,
   обязательно названо, кто платит. */
const hero = await page.evaluate(() => {
  const h = document.querySelector('.hero');
  return h ? h.innerText : '';
});
R.ok('В ШАПКЕ ПРО ПРОЦЕНТ НЕ СКАЗАНО НИ СЛОВА', !/процент|%/.test(hero), hero.slice(0, 90));
/* Из рекламных карточек процент убран намеренно — это решение владельца.
   Но совсем прятать цену нельзя: человек, спросивший «сколько это стоит»,
   обязан получить ответ. Поэтому ищем его там, где ищет он сам, — в ответах
   на вопросы. Свёрнутый <details> в innerText не попадает, поэтому читаем
   текст вопросов целиком. */
const faq = await page.evaluate(() =>
  [...document.querySelectorAll('details')].map(d => d.textContent).join(' '));
R.ok('но на странице он назван', /один процент|1%/i.test(faq), faq.slice(0, 80));
R.ok('И СКАЗАНО, ЧТО ПЛАТИТ ЕГО ПРОДАВЕЦ', /платит его продавец|платит продавец/.test(faq));
R.ok('есть честный раздел', /^Честно$/m.test(ru));
/* Контракты в основной сети развёрнуты 4 сентября. Старая оговорка «их ещё
   нет» стала неправдой — а неправда в честном разделе хуже, чем её
   отсутствие. Проверяем, что она убрана. */
R.ok('нет устаревшего «контракты ещё не развёрнуты»', !/ещё не развёрнуты/.test(ru));
R.ok('честно сказано, что аудита нет', /аудита у контрактов нет/.test(ru));
R.ok('честно сказано, что TVR не продаётся', /TVR не продаётся/.test(ru));
/* Оговорка про страны осталась, но больше не про одну: мы выходим на весь
   мир, и правила у всех разные. Проверяем, что предупреждение не потерялось
   вовсе — без него честный раздел неполон. */
R.ok('сказано, что правила у стран разные',
  /[Пп]равила у стран разные|ограничены или запрещены/.test(ru), ru.slice(0, 0));
/* Обещаний дохода быть не должно. Отрицания («не обещает дохода») — можно
   и нужно: это как раз то, что человеку важно прочитать. */
const promises = ru.split('\n')
  .filter(l => /гарантир|доход|прибыл|заработа|вложени|инвестиц|иксы|х2|x2/i.test(l))
  .filter(l => !/\bне\b|нельзя|запрещ/i.test(l));
R.ok('обещаний дохода нет', promises.length === 0, promises.join(' | ').slice(0, 120));

/* Витрина и кошелёк теперь на разных адресах. Ссылка обязана быть
   абсолютной и вести на адрес кошелька: относительная даёт 404, а прежний
   адрес уводит туда, где кошелька человека нет. */
R.ok('КНОПКА ВЕДЁТ НА АДРЕС КОШЕЛЬКА',
  (await page.getAttribute('a.btn-main', 'href')) === 'https://wallet.tavarov.com/',
  String(await page.getAttribute('a.btn-main', 'href')));

/* Со стороны витрина тянет ровно одно и ровно нарочно: счётчик посещений
   Cloudflare, поставленный 19 сентября. Он без cookie и не следит за
   человеком на других сайтах, и про него прямо написано в политике.

   Список закрытый, и это здесь главное. Запрет «ничего со стороны» стоял
   не из чистоплюйства: чужой скрипт на странице — это чужой код, который
   однажды поменяют без нас. Раз одно исключение сделано, оно должно быть
   названо поимённо, иначе следующее приедет молча.

   В кошельке, кассе и на странице оплаты посторонних скриптов нет вовсе —
   это отдельно проверяет t51. */
const РАЗРЕШЕНО = ['https://static.cloudflareinsights.com/beacon.min.js'];
const чужое = outside.filter(u => !РАЗРЕШЕНО.some(ok => u.startsWith(ok)));
R.ok('СО СТОРОНЫ ТЯНЕТСЯ ТОЛЬКО ТО, ЧТО РАЗРЕШЕНО ПОИМЁННО',
  чужое.length === 0, чужое.slice(0, 3).join(' '));
R.ok('и это счётчик посещений, про который написано в политике',
  outside.some(u => u.includes('cloudflareinsights')), outside.join(' '));

// ширина: ничего не должно вылезать вбок на узком экране
R.ok('на узком экране нет полосы прокрутки вбок',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  await page.evaluate(() => document.documentElement.scrollWidth + ' при ' + window.innerWidth));

await page.screenshot({ path: '/home/claude/apk/audit/shots/сайт-телефон-ru.png', fullPage: true });

// ---------- английский ----------
await page.evaluate(() => apply('en'));
await page.waitForTimeout(300);
const en = await page.evaluate(() => document.body.innerText);
R.ok('переключился на английский',
  (await page.evaluate(() => document.documentElement.lang)) === 'en');
R.ok('русских слов на английской странице не осталось', !/[А-Яа-яЁё]/.test(en),
  (en.match(/[^\n]*[А-Яа-яЁё][^\n]*/) || [''])[0].slice(0, 80));
R.ok('английский заголовок на месте', en.includes('Pay in crypto without cashing it out'));
R.ok('честный раздел переведён', /^Honestly$/m.test(en) && en.includes('independent audit'));

/* Полнота перевода: у каждой метки в разметке должен быть английский
   текст. Иначе кусок витрины молча останется по-русски. */
const missing = await page.evaluate(() => {
  const keys = [...document.querySelectorAll('[data-t]')].map(e => e.dataset.t);
  return keys.filter(k => T.en[k] === undefined);
});
R.ok('английский переведён целиком', missing.length === 0, missing.join(', ').slice(0, 120));

await page.screenshot({ path: '/home/claude/apk/audit/shots/сайт-телефон-en.png', fullPage: true });

// ---------- выбор запоминается ----------
await page.reload();
await page.waitForTimeout(400);
R.ok('после перезагрузки язык остался английским',
  (await page.evaluate(() => document.documentElement.lang)) === 'en');

// ---------- незнакомый язык телефона ----------
const { page: p2 } = await open({ locale: 'ja-JP', viewport: { width: 414, height: 896 } });
R.ok('незнакомый язык — открывается английский',
  (await p2.evaluate(() => document.documentElement.lang)) === 'en');

// ---------- большой экран и тёмная тема ----------
const { page: p3 } = await open({ locale: 'ru-RU', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const bg = await p3.evaluate(() => getComputedStyle(document.body).backgroundColor);
R.ok('тёмная тема действительно тёмная', /rgb\((\d+), (\d+), (\d+)\)/.test(bg) &&
  bg.match(/\d+/g).slice(0, 3).every(n => Number(n) < 60), bg);
await p3.screenshot({ path: '/home/claude/apk/audit/shots/сайт-большой-тёмный.png', fullPage: true });

const { page: p4 } = await open({ locale: 'ru-RU', viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
await p4.screenshot({ path: '/home/claude/apk/audit/shots/сайт-большой-светлый.png', fullPage: true });

const good = R.done(errors);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
