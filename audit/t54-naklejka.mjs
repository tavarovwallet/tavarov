/* Наклейка для прилавка: что в ней напечатано и куда она ведёт.

   Самая дорогая ошибка здесь не в вёрстке. Наклейку печатают один раз и
   вешают на годы — если в код попадёт чужой адрес, неоткрываемый формат или
   ссылка на несуществующую страницу, узнают об этом не сегодня, а когда
   первый покупатель уйдёт, не заплатив. Поэтому проверяется не «нарисовалось
   ли», а то, что напечатанный код честно открывается кассой. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/claude/apk/www';
const PORT = 8125;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8' };

const MERCHANT = '0x73BBaAbB4c9Ee01e3Bf7C9D0Fd5C0b3f0D1eF432';

const srv = http.createServer((req, res) => {
  const [p] = req.url.split('?');
  if (p === '/api/till'){
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ empty: true })); return;
  }
  const file = path.join(ROOT, decodeURIComponent(p).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file)){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => srv.listen(PORT, r));

let ok = 0, bad = 0;
const t = (имя, условие, детали = '') => {
  if (условие) { ok++; console.log('OK   ' + имя + (детали ? '  [' + детали + ']' : '')); }
  else { bad++; console.log('ПРОВАЛ ' + имя + (детали ? '  [' + детали + ']' : '')); }
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
const page = await ctx.newPage();
const ошибки = [];
page.on('pageerror', e => ошибки.push(e.message));
page.on('console', m => { if (m.type() === 'error') ошибки.push(m.text()); });

const видно = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden') && el.offsetParent !== null;
}, sel);
const текст = sel => page.evaluate(s => (document.querySelector(s)?.textContent || '').trim(), sel);

const база = 'http://localhost:' + PORT;

// ======================= пустая страница =======================
await page.goto(база + '/sticker.html', { waitUntil: 'domcontentloaded' });
t('наклейки без адреса не показываем', !(await видно('#stickerBox')));
t('и печатать нечего', await page.evaluate(() => document.getElementById('print').disabled));

// ======================= кривой адрес =======================
await page.fill('#m', '0xабырвалг');
await page.waitForTimeout(150);
t('КРИВОЙ АДРЕС ОСТАНОВЛЕН ДО ПЕЧАТИ', await видно('#err') && !(await видно('#stickerBox')));

// ======================= нормальный адрес =======================
await page.fill('#m', MERCHANT);
await page.fill('#n', 'Кофейня на углу');
await page.selectOption('#k', '2');
await page.selectOption('#lang', 'ru');
await page.waitForTimeout(250);

t('наклейка появилась', await видно('#stickerBox') && !(await видно('#err')));
t('на ней название магазина', (await текст('#sShop')) === 'Кофейня на углу');
t('и номер кассы', (await текст('#sTill')) === 'Касса 2');
t('и подпись на выбранном языке', (await текст('#sCap')) === 'Наведите камеру телефона');
t('ВТОРАЯ ПОДПИСЬ ПО-АНГЛИЙСКИ — ДЛЯ ТЕХ, КТО С УЛИЦЫ',
  (await текст('#sCap2')) === 'Point your phone camera here');
t('адрес напечатан мелким, чтобы продавец мог его сверить',
  (await текст('#sAddr')) === MERCHANT);
t('код нарисован', await page.evaluate(() =>
  document.querySelectorAll('#sCode img, #sCode canvas').length > 0));

// ======================= что именно в коде =======================
const ссылка = await текст('#link');
t('В КОДЕ ОБЫЧНАЯ HTTPS-ССЫЛКА, А НЕ tavarov: И НЕ ethereum:',
  ссылка.startsWith('https://'), ссылка);
t('ведёт на страницу оплаты', ссылка.includes('/pay#t='), ссылка);
t('АДРЕС ПРОДАВЦА ЛЕЖИТ ПОСЛЕ РЕШЁТКИ — НА СЕРВЕР ОН НЕ УЙДЁТ',
  !ссылка.split('#')[0].toLowerCase().includes(MERCHANT.toLowerCase()));
t('суммы в наклейке нет и быть не может',
  !/amount|uint256|&a=/.test(ссылка), ссылка);

{
  const payload = ссылка.split('#t=')[1];
  const j = JSON.parse(Buffer.from(payload.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
  t('внутри тот самый кошелёк', j.m === MERCHANT, j.m);
  t('тот самый номер кассы', j.k === 2);
  t('и настоящая сеть, а не тестовая', j.net === 'bnb');
}

// ======================= язык подписи меняется =======================
await page.selectOption('#lang', 'tr');
await page.waitForTimeout(200);
t('подпись переключилась на турецкий', (await текст('#sCap')).includes('kamera'), await текст('#sCap'));
t('и номер кассы тоже', (await текст('#sTill')) === 'Kasa 2');
await page.selectOption('#lang', 'en');
await page.waitForTimeout(200);
t('на английском вторую строку не дублируем', !(await видно('#sCap2')));
await page.selectOption('#lang', 'ru');
await page.waitForTimeout(200);

// ======================= печать прячет всё лишнее =======================
{
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(150);
  const вПечати = await page.evaluate(() => {
    const ви = el => el && getComputedStyle(el).display !== 'none';
    return { форма: ви(document.querySelector('.card.noprint')),
             наклейка: ви(document.getElementById('sticker')) };
  });
  t('НА ПЕЧАТЬ УХОДИТ ТОЛЬКО НАКЛЕЙКА', !вПечати.форма && вПечати.наклейка,
    JSON.stringify(вПечати));
  await page.emulateMedia({ media: 'screen' });
}

// ======================= память между заходами =======================
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(250);
t('адрес и название не надо вводить заново',
  (await page.inputValue('#m')) === MERCHANT && (await page.inputValue('#n')) === 'Кофейня на углу');
t('и номер кассы тоже помнится', (await page.inputValue('#k')) === '2');

// ======================= НАПЕЧАТАННЫЙ КОД ДЕЙСТВИТЕЛЬНО ОТКРЫВАЕТСЯ =======================
/* Вся проверка ради этой. Всё остальное может быть правильным по отдельности,
   а код — вести в никуда. */
{
  const местная = ссылка.replace('https://wallet.tavarov.com/pay', база + '/pay.html');
  await page.goto(местная, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  t('КОД С НАКЛЕЙКИ ОТКРЫВАЕТ КАССУ', await видно('#tillCard'), await текст('#err'));
  t('с тем же названием', (await текст('#tillShop')) === 'Кофейня на углу');
  t('с тем же получателем', (await текст('#tillTo')).toLowerCase() === MERCHANT.toLowerCase());
  t('с тем же номером кассы', /2/.test(await текст('#tillWho')), await текст('#tillWho'));
  t('и человеку объяснено, чего он ждёт', await видно('#tillWait'));
}

// ======================= из кабинета продавца =======================
{
  await page.goto(база + '/invoice.html', { waitUntil: 'domcontentloaded' });
  /* Название заполняем ПЕРВЫМ. Кабинет сворачивает пару полей, как только
     кошелёк введён и палец ушёл в сторону, — и заполнять название после
     кошелька значит попасть в уже свернувшуюся карточку. Человек туда
     переходит по клику, и для него это работает; проверке надо просто не
     спорить с этим порядком. */
  await page.click('#shop');
  await page.fill('#shop', 'Кофейня на углу');
  await page.click('#wallet');
  await page.fill('#wallet', MERCHANT);
  await page.click('body');
  await page.waitForTimeout(250);
  const href = await page.getAttribute('#stickerLink', 'href');
  t('ИЗ КАБИНЕТА ЕСТЬ ДОРОГА К НАКЛЕЙКЕ', !!href && href.includes('sticker.html'), href);
  t('и кошелёк не надо переписывать руками', (href || '').toLowerCase().includes(MERCHANT.toLowerCase()));
  /* Проверяем не строку адреса, а то, что на странице печати действительно
     оказались кошелёк и название: по дороге их ещё надо правильно разобрать. */
  await page.goto(база + '/' + (href || '').replace(/^\.\//, ''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  t('И НАЗВАНИЕ ДОЕХАЛО ДО СТРАНИЦЫ ПЕЧАТИ',
    (await page.inputValue('#n')) === 'Кофейня на углу', await page.inputValue('#n'));
  t('и кошелёк доехал', (await page.inputValue('#m')) === MERCHANT);
  t('и наклейка сразу готова', await видно('#stickerBox'));
}

t('НИ ОДНОЙ ОШИБКИ В КОДЕ СТРАНИЦ',
  ошибки.filter(e => !/Failed to fetch|ERR_CONNECTION|net::|404/i.test(e)).length === 0,
  ошибки.slice(0, 3).join(' | '));

await browser.close();
srv.close();
console.log('\n--- ' + ok + ' из ' + (ok + bad) + ' ---');
process.exit(bad ? 1 : 0);
