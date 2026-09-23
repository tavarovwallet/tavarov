/* Наклейка кассы глазами покупателя — в настоящем браузере.

   Проверяется не «нарисовалось ли», а то, что человек у прилавка увидит
   правду: ту сумму, которую назвал продавец, её возраст, и предупреждение,
   если сумма сменилась у него на глазах. Плюс путь вперёд, когда касса
   молчит: ввести сумму руками, а не смотреть на вечный кружок.

   Касса здесь поддельная — это отдельный сервер, который отвечает то, что
   нужно проверке. Настоящий /api/till проверяется в t52. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/claude/apk/www';
const PORT = 8123;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8' };

const MERCHANT = '0x73BBaAbB4c9Ee01e3Bf7C9D0Fd5C0b3f0D1eF432';

/* Что «касса» ответит на следующий вопрос. Проверка меняет это на ходу. */
let ответКассы = { empty: true };
let вопросов = 0, глубоких = 0;
const статусВопросы = [];

const srv = http.createServer((req, res) => {
  const [p, q] = req.url.split('?');
  if (p === '/api/till'){
    вопросов++;
    if ((q || '').includes('chain=1')) глубоких++;
    const body = JSON.parse(JSON.stringify(ответКассы));
    if (!body.empty && body.now === undefined) body.now = Math.floor(Date.now() / 1000);
    res.writeHead(200, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
    res.end(JSON.stringify(body));
    return;
  }
  /* Слежение за оплатой. Отвечаем «ещё не оплачено», но ЗАПОМИНАЕМ вопрос:
     если страница спросит не про ту сумму, прямой перевод не найдётся
     никогда, и продавец будет ждать денег, которые уже пришли. */
  if (p === '/api/status'){
    статусВопросы.push(Object.fromEntries(new URLSearchParams(q || '')));
    res.writeHead(200, { 'content-type':'application/json; charset=utf-8' });
    res.end(JSON.stringify({ paid: false }));
    return;
  }
  const rel = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404); res.end('нет такого файла'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => srv.listen(PORT, r));

let ok = 0, bad = 0;
const t = (имя, условие, детали = '') => {
  if (условие) { ok++; console.log('OK   ' + имя + (детали ? '  [' + детали + ']' : '')); }
  else { bad++; console.log('ПРОВАЛ ' + имя + (детали ? '  [' + детали + ']' : '')); }
};

const b64url = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport:{ width:414, height:896 } });
const page = await ctx.newPage();
const ошибки = [];
page.on('pageerror', e => ошибки.push(e.message));
page.on('console', m => { if (m.type() === 'error') ошибки.push(m.text()); });
const нетФайла = [];
page.on('response', r => { if (r.status() === 404) нетФайла.push(r.url()); });

/* Номер прохода в адресе — нарочно. Переход между двумя наклейками меняет
   только хвост после решётки, и браузер такую «навигацию» делает без
   перезагрузки: проверка молча осталась бы на прежней странице. */
let проход = 0;
const наклейка = (over) => 'http://localhost:' + PORT + '/pay.html?x=' + (++проход) + '#t=' +
  b64url(Object.assign({ m: MERCHANT, k: 1, n: 'Кофейня на углу', net: 'bnb' }, over || {}));

const видно = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden') && el.offsetParent !== null;
}, sel);
const текст = sel => page.evaluate(s => (document.querySelector(s)?.textContent || '').trim(), sel);

// ======================= касса пока молчит =======================
ответКассы = { empty: true };
await page.goto(наклейка(), { waitUntil: 'networkidle' });

t('наклейка открылась как касса, а не как ошибка', await видно('#tillCard') && !(await видно('#err')));
t('видно название магазина', (await текст('#tillShop')) === 'Кофейня на углу');
t('видно номер кассы', /1/.test(await текст('#tillWho')), await текст('#tillWho'));
t('виден адрес получателя', (await текст('#tillTo')).toLowerCase() === MERCHANT.toLowerCase());
t('человек понимает, чего ждёт', await видно('#tillWait'));
t('и суммы ему не показывают', !(await видно('#tillGot')));
t('нижняя карточка «ждём оплату» НЕ ВРЁТ раньше времени', !(await видно('#stateCard')));

// ======================= продавец назвал сумму =======================
const now = Math.floor(Date.now() / 1000);
ответКассы = { amount:'250.5', cur:'USDT', item:'Латте', order:'A-17',
               h:'0x' + 'ab'.repeat(32), setAt: now - 8, expiresAt: now + 600, now };
await page.waitForFunction(() => {
  const el = document.getElementById('tillGot');
  return el && !el.classList.contains('hidden');
}, { timeout: 8000 });

t('СУММА ПОЯВИЛАСЬ САМА, без перезагрузки', (await текст('#tillAmount')) === '250.5 USDT');
t('видно, за что платим', (await текст('#tillItem')) === 'Латте');
t('ВОЗРАСТ СУММЫ НА ЭКРАНЕ', /8|9|10/.test(await текст('#tillAge')), await текст('#tillAge'));
t('ожидание убрано', !(await видно('#tillWait')));
t('предупреждения о смене пока нет', !(await видно('#tillChanged')));

// ======================= продавец поменял сумму =======================
ответКассы = Object.assign({}, ответКассы, { amount:'310', setAt: Math.floor(Date.now()/1000) });
await page.waitForFunction(() => document.getElementById('tillAmount').textContent.startsWith('310'),
  { timeout: 8000 });
t('новая сумма показана', (await текст('#tillAmount')) === '310 USDT');
t('И ЧЕЛОВЕКУ СКАЗАНО, ЧТО ОНА СМЕНИЛАСЬ', await видно('#tillChanged'));

// ======================= возраст считается от часов сервера =======================
{
  const старая = Math.floor(Date.now()/1000);
  ответКассы = Object.assign({}, ответКассы, { amount:'42', setAt: старая - 1800, now: старая });
  await page.waitForFunction(() => document.getElementById('tillAmount').textContent.startsWith('42'),
    { timeout: 8000 });
  const age = await текст('#tillAge');
  t('ПОЛЧАСА НАЗАД — ЭТО ВИДНО, А НЕ СПРЯТАНО', /30/.test(age), age);
  t('и сказано переспросить продавца', age.length > 30, age);
}

// ======================= нажимаем «оплатить» =======================
await page.click('#tillPay');
await page.waitForTimeout(400);
t('перешли к оплате', await видно('#main') && !(await видно('#tillCard')));
t('сумма перенеслась без изменений', (await текст('#amount')) === '42 USDT');
t('получатель тот же', (await текст('#to')).toLowerCase() === MERCHANT.toLowerCase());
t('появилась карточка ожидания платежа', await видно('#stateCard'));
t('код нарисован', await page.evaluate(() => document.querySelectorAll('#qr img, #qr canvas').length > 0));
t('ЕСТЬ КНОПКА ДЛЯ ЧУЖОГО КОШЕЛЬКА', await видно('#openOther'));
{
  const href = await page.getAttribute('#openOther', 'href');
  t('и это настоящий EIP-681 с нужной сетью',
    href.startsWith('ethereum:0x55d398326f99059fF775485246999027B3197955@56/transfer'), href);
  t('получатель в нём — продавец', href.toLowerCase().includes(MERCHANT.toLowerCase()));
  /* 42 USDT на BNB Chain — это 42 с восемнадцатью нулями. Шесть нулей
     вместо восемнадцати — платёж в миллион раз меньше. */
  t('И СУММА ПЕРЕСЧИТАНА В ВОСЕМНАДЦАТЬ ЗНАКОВ',
    href.includes('uint256=42' + '0'.repeat(18)), href.split('uint256=')[1]);
}

// ======================= за платежом следим по ТОЙ ЖЕ сумме =======================
/* Прямой перевод ищется по продавцу и сумме — номера счёта в переводе нет и
   быть не может. Ошибись мы здесь хоть в валюте, и деньги, которые уже
   пришли, для кассы никогда не придут. */
{
  await page.waitForTimeout(300);
  const q = статусВопросы[статусВопросы.length - 1] || {};
  t('слежение спрашивает про ту же сумму', q.a === '42', JSON.stringify(q));
  t('и ту же валюту', q.c === 'USDT');
  t('и того же продавца', (q.m || '').toLowerCase() === MERCHANT.toLowerCase());
  t('и номер счёта взят от кассы, а не выдуман', q.h === '0x' + 'ab'.repeat(32), q.h);
  t('И ПЕРЕДАНО, С КАКОГО МОМЕНТА ИСКАТЬ', Number(q.s) > 0, q.s);
}

// ======================= касса сменила сумму после выбора =======================
{
  ответКассы = Object.assign({}, ответКассы, { amount:'9999' });
  const было = вопросов;
  await page.waitForTimeout(3500);
  t('ПОСЛЕ ВЫБОРА КАССУ БОЛЬШЕ НЕ СПРАШИВАЕМ', вопросов === было, 'новых вопросов: ' + (вопросов - было));
  t('и сумма под пальцем не поехала', (await текст('#amount')) === '42 USDT');
}

// ======================= покупатель вводит сумму сам =======================
ответКассы = { empty: true };
await page.goto(наклейка({ k: 3 }), { waitUntil: 'networkidle' });
await page.click('#tillOwn');
t('открылось поле для своей суммы', await видно('#tillManual'));
t('и человека предупредили, что сверять — ему', (await текст('#tillManual')).length > 80);

await page.click('#tillManualPay');
await page.waitForTimeout(200);
t('пустую сумму не пропустили', await видно('#tillProblem') && !(await видно('#main')));

await page.fill('#tillInput', '7.25');
await page.click('#tillManualPay');
await page.waitForTimeout(400);
t('СВОЯ СУММА ПРИНЯТА', await видно('#main') && (await текст('#amount')) === '7.25 USDT');

// ======================= касса не отвечает =======================
/* Страницу открываем, пока сервер ещё жив, и роняем его уже под ней — так
   это и случается в жизни: человек стоит у прилавка с открытой страницей,
   и в эту минуту у нас что-то ломается. */
{
  ответКассы = { empty: true };
  await page.goto(наклейка({ k: 4 }), { waitUntil: 'networkidle' });
  await new Promise(r => srv.close(r));
  await page.waitForTimeout(8000);          // переживём несколько неудачных опросов
  t('страница не разваливается, когда сервер лежит', await видно('#tillCard'));
  t('ПУТЬ ВПЕРЁД ОСТАЛСЯ — ВВЕСТИ СУММУ РУКАМИ', await видно('#tillOwn'));
  t('и человеку сказано, что касса не отвечает', await видно('#tillProblem'),
    await текст('#tillProblem'));
  await page.click('#tillOwn');
  await page.fill('#tillInput', '3');
  await page.click('#tillManualPay');
  await page.waitForTimeout(400);
  t('И ЗАПЛАТИТЬ МОЖНО ДАЖЕ ТАК', await видно('#main') && (await текст('#amount')) === '3 USDT');
  t('свой номер счёта у ручной суммы всё-таки заведён',
    await page.evaluate(() => /^0x[0-9a-f]{64}$/.test(inv.h)));
}

if (нетФайла.length) console.log('   не нашлось на сервере: ' + [...new Set(нетФайла)].join(', '));
// ======================= вкладку свернули — кассу не дёргаем =======================
/* Опрос раз в три секунды из вкладки, на которую никто не смотрит, — это
   чужие деньги за хостинг на пустом месте. Проверяем прямо в коде: при
   скрытой вкладке вопрос не уходит. */
{
  const есть = await page.evaluate(() =>
    /document\.hidden/.test(askTill.toString()) && /TILL_GIVE_UP/.test(askTill.toString()));
  t('СВЁРНУТАЯ ВКЛАДКА КАССУ НЕ СПРАШИВАЕТ, И ОПРОС НЕ ВЕЧЕН', есть);
}

t('НИ ОДНОЙ ОШИБКИ В КОНСОЛИ ЗА ВЕСЬ ПРОХОД', ошибки.filter(
  e => !/Failed to fetch|ERR_CONNECTION|net::/i.test(e)).length === 0,
  ошибки.slice(0, 3).join(' | '));

await browser.close();
try{ srv.close(); } catch(e){}
console.log('\n--- ' + ok + ' из ' + (ok + bad) + ' ---');
process.exit(bad ? 1 : 0);
