/* Страница продавца: выставить счёт и получить ссылку.

   ЗАЧЕМ ОНА ПОЯВИЛАСЬ. У шлюза было две страницы: витрина-пример — как
   выглядит кнопка в чужом магазине, и страница счёта — что видит покупатель.
   Между ними зияла дыра: сам продавец выставить счёт не мог никак. А
   продавцов со своим сайтом почти нет; есть человек, который продаёт в
   переписке и которому нужно кинуть ссылку на оплату.

   ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ. Что счёт выставляется мышкой и без правки файлов,
   что ссылка настоящая — её принимает страница покупателя, что два счёта
   подряд получают РАЗНЫЕ номера (иначе два покупателя заплатят по одному
   счёту, и продавец увидит одну оплату вместо двух), и что продавцу не дают
   молча выставить счёт в валюте, которую касса не принимает: деньги тогда
   дойдут, а «оплачено» не наступит никогда. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const R = (() => {
  const rows = [];
  return { ok(name, cond, detail){ rows.push(!!cond);
      console.log((cond ? 'OK   ' : 'ПРОВАЛ ') + name + (detail ? '  [' + detail + ']' : '')); },
    done(){ const bad = rows.filter(x => !x).length;
      console.log('\n--- ' + (rows.length - bad) + ' из ' + rows.length + ' ---');
      return bad === 0; } };
})();

const ROOT = '/home/claude/apk/gateway/public';
const PORT = 8791;

/* Свой маленький шлюз: страницы настоящие, а ответ «оплачено ли» мы держим в
   руках, чтобы проверить обе стороны — и ожидание, и приход денег. */
let paid = false, asked = [];
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:' + PORT);
  if (u.pathname === '/api/status'){
    asked.push(Object.fromEntries(u.searchParams));
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify(paid ? { paid:true, tx:'0x' + 'ab'.repeat(32) } : { paid:false }));
    return;
  }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)){ res.writeHead(404); res.end('нет'); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js')
    ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => srv.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 520, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));

const WALLET = '0x68021d70605A375deC030Fab45b99Df21bF39cc2';
await page.goto('http://localhost:' + PORT + '/invoice.html', { waitUntil: 'load' });

// ---------- витрина ведёт сюда ----------
const shopPage = await ctx.newPage();
await shopPage.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
R.ok('ВИТРИНА ВЕДЁТ ПРОДАВЦА НА ВЫСТАВЛЕНИЕ СЧЁТА',
  await shopPage.isVisible('a[href="./invoice"]'));
await shopPage.close();

// ---------- пустые поля ----------
await page.click('#makeBtn');
await page.waitForTimeout(300);
R.ok('БЕЗ АДРЕСА СЧЁТ НЕ ВЫСТАВИТЬ', await page.isVisible('#formErr'));
R.ok('и сказано, что именно не так',
  /адрес кошелька/.test(await page.textContent('#formErr')),
  (await page.textContent('#formErr')).slice(0, 55));

await page.fill('#wallet', WALLET);
await page.fill('#amount', '0');
await page.click('#makeBtn');
await page.waitForTimeout(300);
R.ok('и с нулевой суммой тоже не выставить',
  /сумму больше нуля/.test(await page.textContent('#formErr')),
  (await page.textContent('#formErr')).slice(0, 40));

// ---------- валюта, которой касса не принимает ----------
/* Предупреждение о непринимаемой валюте появляется, только если сеть
   ответила. Здесь настоящей сети нет, и правильное поведение — молчать, а
   не пугать продавца на пустом месте. */
await page.waitForTimeout(2500);
const warn = await page.evaluate(() => ({
  shown: !document.getElementById('curNote').classList.contains('hidden'),
  text: document.getElementById('curNote').textContent
}));
R.ok('ПРО НЕПРИНИМАЕМУЮ ВАЛЮТУ СКАЗАНО ЗАРАНЕЕ',
  !warn.shown || /не принимает/.test(warn.text), warn.text.slice(0, 70));

/* Выбора сети на странице больше нет, и это проверяется, а не
   подразумевается: тестовая сеть выглядит как настоящая, деньги в ней
   раздают бесплатно, и счёт в ней — готовый инструмент обмана. */
R.ok('ВЫБОРА СЕТИ НА СТРАНИЦЕ НЕТ ВОВСЕ',
  (await page.locator('#net').count()) === 0,
  'полей выбора сети: ' + await page.locator('#net').count());
/* Проверяем не слово в исходнике, а возможность выбрать: в коде страницы
   тестовая сеть упоминается нарочно — пояснением, почему выбора нет, и
   подписью к старому счёту, если такой остался в журнале. */
/* Выпадающих списков на странице больше нет вовсе — валюта и срок стали
   переключателями. Проверяем не количество списков, а то, ради чего проверка
   и написана: тестовую сеть выбрать нечем. */
R.ok('и выбрать тестовую сеть невозможно ничем',
  (await page.locator('option[value="bnbTestnet"]').count()) === 0
  && (await page.locator('[data-v="bnbTestnet"]').count()) === 0
  && (await page.locator('#curSeg button').count()) === 2
  && (await page.locator('#ttlSeg button').count()) === 3,
  'кнопок валюты: ' + await page.locator('#curSeg button').count());

// ---------- выставляем ----------
await page.fill('#amount', '12.34');
/* Название прячется под свёрнутой шапкой, как только кошелёк введён целиком:
   это нарочно — менять его от счёта к счёту не надо. Поэтому сначала
   разворачиваем, а не бьёмся в невидимое поле. */
if (!(await page.isVisible('#shop'))) await page.click('#whoEdit');
await page.fill('#shop', 'Кофейня на углу');
await page.fill('#item', 'Капучино');
await page.click('#curSeg button[data-v="USDC"]');
await page.click('#makeBtn');
await page.waitForTimeout(1200);

R.ok('СЧЁТ ВЫСТАВЛЕН', await page.isVisible('#doneCard'));
R.ok('видна сумма', (await page.textContent('#doneAmount')).indexOf('12.34 USDC') >= 0,
  await page.textContent('#doneAmount'));
R.ok('виден кошелёк, куда придут деньги',
  (await page.textContent('#doneTo')).toLowerCase() === WALLET.toLowerCase(),
  await page.textContent('#doneTo'));
R.ok('КОД НАРИСОВАН', (await page.evaluate(() =>
  document.querySelectorAll('#qrBox canvas, #qrBox img').length)) > 0);

const link1 = await page.textContent('#doneLink');
R.ok('ссылка ведёт на страницу счёта', /\/pay\.html#p=/.test(link1), link1.slice(0, 60));

// ---------- ссылка настоящая: её принимает страница покупателя ----------
const buyer = await ctx.newPage();
await buyer.goto(link1, { waitUntil: 'load' });
await buyer.waitForTimeout(2000);
const seen = await buyer.evaluate(() => document.body.innerText);
R.ok('СТРАНИЦА ПОКУПАТЕЛЯ ПРИНИМАЕТ ЭТУ ССЫЛКУ',
  !/испорчен|не показыва/i.test(seen) && seen.indexOf('12.34') >= 0,
  seen.slice(0, 80).replace(/\n/g, ' | '));
R.ok('покупателю видно название точки', seen.indexOf('Кофейня на углу') >= 0);
R.ok('и за что он платит', seen.indexOf('Капучино') >= 0);
await buyer.close();

// ---------- продавец видит приход ----------
R.ok('продавец спрашивает шлюз про свой счёт', asked.length > 0, 'запросов ' + asked.length);
const q = asked[asked.length - 1] || {};
R.ok('спрашивает по своему кошельку и своему номеру счёта',
  (q.m || '').toLowerCase() === WALLET.toLowerCase() && /^0x[0-9a-f]{64}$/.test(q.h || ''),
  JSON.stringify(q).slice(0, 80));

paid = true;
await page.waitForFunction(() =>
  document.getElementById('doneStatus').textContent.indexOf('Оплачено') >= 0,
  null, { timeout: 20000 }).catch(() => {});
R.ok('ПРИХОД ДЕНЕГ ПРОДАВЕЦ ВИДИТ САМ, БЕЗ ОБНОВЛЕНИЯ СТРАНИЦЫ',
  /Оплачено/.test(await page.textContent('#doneStatus')),
  await page.textContent('#doneStatus'));

// ---------- второй счёт — другой номер ----------
paid = false;
await page.click('#againBtn');
await page.waitForTimeout(400);
R.ok('«выставить другой» возвращает к форме', await page.isVisible('#formCard'));
R.ok('и сумма прошлого счёта не осталась в поле',
  (await page.inputValue('#amount')) === '', await page.inputValue('#amount'));
R.ok('а кошелёк и название запомнились',
  (await page.inputValue('#wallet')).toLowerCase() === WALLET.toLowerCase()
  && (await page.inputValue('#shop')) === 'Кофейня на углу');

await page.fill('#amount', '5');
await page.click('#makeBtn');
await page.waitForTimeout(900);
const link2 = await page.textContent('#doneLink');
const idOf = l => JSON.parse(Buffer.from(
  l.split('#p=')[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8')).h;
R.ok('У ДВУХ СЧЁТОВ РАЗНЫЕ НОМЕРА — ИНАЧЕ ДВЕ ОПЛАТЫ СОЛЬЮТСЯ В ОДНУ',
  idOf(link1) !== idOf(link2), idOf(link1).slice(0, 14) + '… / ' + idOf(link2).slice(0, 14) + '…');

R.ok('страница нигде не падает', errors.length === 0, errors.join(' | ').slice(0, 90));

const good = R.done();
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
