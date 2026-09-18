/* Журнал счетов у продавца.

   До него выставленный счёт жил ровно столько, сколько была открыта вкладка.
   Продавец закрывал её — и узнать, оплатили ли вчерашний счёт, было неоткуда:
   оставалось выставлять новый, с новым номером, и просить покупателя платить
   заново. Для человека, который продаёт в переписке, это и есть главная беда,
   а вовсе не отсутствие «личного кабинета».

   Журнал — это блокнот, и проверяется он именно как блокнот:

   1. Счета переживают перезагрузку страницы.
   2. «Оплачено» берётся из цепочки, а не из нашей записи, и запрос несёт
      СУММУ И ВАЛЮТУ — иначе любой, кому прислали ссылку, заплатил бы по
      этому номеру копейку, и продавец отдал бы товар.
   3. Старый счёт открывается заново тем же самым, а не новым.
   4. Выручка за день считается по валютам отдельно.
   5. Стереть список можно, и человеку при этом сказано, что деньги от списка
      не зависят.                                                            */
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

const WWW = '/home/claude/apk/www';
const PORT = 8795;

/* Свой ответ «оплачено ли»: настоящую сеть отсюда не достать, а важно тут
   не содержимое ответа, а что именно страница СПРАШИВАЕТ. */
let paidSet = new Set();
let asked = [];
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:' + PORT);
  if (u.pathname === '/api/status'){
    const q = Object.fromEntries(u.searchParams);
    asked.push(q);
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify(paidSet.has(q.h)
      ? { paid:true, tx:'0x' + 'ab'.repeat(32) } : { paid:false }));
    return;
  }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW) || !fs.existsSync(file)){ res.writeHead(404); res.end('нет'); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js')
    ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => srv.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 414, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', d => d.accept().catch(()=>{}));

const WALLET = '0x68021d70605A375deC030Fab45b99Df21bF39cc2';
const open = async () => {
  await page.goto('http://localhost:' + PORT + '/invoice.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
};
await open();

// ---------- пустой список говорит, что он пустой ----------
R.ok('на чистой странице список есть и честно пуст',
  /Пока пусто/.test(await page.textContent('#logRows')),
  (await page.textContent('#logRows')).trim().slice(0, 50));

// ---------- тестовой сети тут не предлагают ----------
/* Счёт в тестовой сети — готовый инструмент обмана: деньги там раздают
   бесплатно, а «Оплачено» на экране выглядит настоящим. Выбора нет, и сеть
   в счёт уходит только основная. */
R.ok('ВЫБОРА СЕТИ НА СТРАНИЦЕ НЕТ',
  (await page.locator('#net').count()) === 0);
R.ok('и на экране написано, какая сеть используется',
  /BNB Chain/.test(await page.textContent('#netFixed')),
  await page.textContent('#netFixed'));

// ---------- выставляем счёт ----------
const issue = async (amount, item, order) => {
  /* Кошелёк и название вводятся один раз: дальше страница показывает их
     строкой и прячет поля, чтобы не предлагать менять то, что не меняется.
     Так делает и живой продавец — значит и проверка обязана так делать. */
  if (await page.isVisible('#fWallet')){
    await page.fill('#wallet', WALLET);
    await page.fill('#shop', 'Кофейня на углу');
  }
  await page.fill('#item', item);
  await page.fill('#amount', amount);
  await page.fill('#order', order);
  await page.click('#makeBtn');
  await page.waitForTimeout(400);
  const h = await page.evaluate(() => inv.h);
  await page.click('#againBtn');
  await page.waitForTimeout(250);
  return h;
};
const h1 = await issue('12.34', 'Капучино', 'заказ-1024');
R.ok('СЧЁТ ПОПАЛ В СПИСОК', (await page.locator('.lrow').count()) === 1,
  'строк ' + await page.locator('.lrow').count());
let txt = await page.textContent('#logRows');
R.ok('в строке видны сумма, товар и номер заказа',
  /12\.34 USDT/.test(txt) && /Капучино/.test(txt) && /заказ-1024/.test(txt), txt.trim().slice(0, 80));
R.ok('и он пока ждёт оплаты', /Ждёт оплаты/.test(txt));

const h2 = await issue('40', 'Букет', 'заказ-1025');
R.ok('второй счёт встал сверху, а первый остался',
  (await page.locator('.lrow').count()) === 2 &&
  /Букет/.test(await page.textContent('.lrow:first-of-type')),
  await page.textContent('.lrow:first-of-type'));

// ---------- переживает перезагрузку ----------
/* Главное свойство. Без него журнал не решает ту самую задачу, ради которой
   он и делается: «закрыл вкладку — счёт пропал». */
/* Список запросов чистим ДО перезагрузки: страница спрашивает цепочку сразу
   при открытии, и очистка после неё стёрла бы как раз то, что проверяем. */
asked = [];
await open();
R.ok('СЧЕТА ПЕРЕЖИВАЮТ ПЕРЕЗАГРУЗКУ СТРАНИЦЫ',
  (await page.locator('.lrow').count()) === 2,
  'строк ' + await page.locator('.lrow').count());

// ---------- что именно спрашивается у цепочки ----------
await page.waitForTimeout(1200);
R.ok('о каждом неоплаченном счёте спрашивают цепочку', asked.length >= 2,
  'запросов ' + asked.length);
const q = asked.find(x => x.h === h1) || {};
R.ok('И В ЗАПРОСЕ ЕСТЬ СУММА И ВАЛЮТА, А НЕ ТОЛЬКО НОМЕР СЧЁТА',
  q.a === '12.34' && q.c === 'USDT', JSON.stringify(q));
R.ok('и продавец с сетью тоже',
  (q.m || '').toLowerCase() === WALLET.toLowerCase() && q.net === 'bnb', JSON.stringify(q));
R.ok('СЧЁТ ВЫСТАВЛЕН В ОСНОВНОЙ СЕТИ, А НЕ В ТЕСТОВОЙ',
  (await page.evaluate(() => logRead().every(v => v.net === 'bnb'))),
  JSON.stringify(await page.evaluate(() => logRead().map(v => v.net))));

// ---------- оплата приходит ----------
paidSet.add(h1);
await page.waitForTimeout(1500);
await page.evaluate(() => logRefresh());
await page.waitForTimeout(1200);
txt = await page.textContent('#logRows');
R.ok('ОПЛАЧЕННЫЙ СЧЁТ ПОМЕЧЕН ОПЛАЧЕННЫМ', /Оплачено/.test(txt), txt.trim().slice(0, 90));
R.ok('а второй по-прежнему ждёт', /Ждёт оплаты/.test(txt));

R.ok('ПОЯВИЛАСЬ ВЫРУЧКА ЗА ДЕНЬ',
  !(await page.locator('#logTotal').getAttribute('class')).includes('hidden')
  && /12\.34 USDT/.test(await page.textContent('#logTotalSum')),
  await page.textContent('#logTotalSum'));

/* Оплату спрашивают только про неоплаченные: дёргать узел из-за уже
   случившегося платежа незачем, а на сотне счетов это заметно. */
asked = [];
await page.evaluate(() => logRefresh());
await page.waitForTimeout(900);
R.ok('про уже оплаченный счёт сеть больше не спрашивают',
  !asked.some(x => x.h === h1), JSON.stringify(asked.map(x => x.h.slice(0, 10))));

// ---------- деньги и список считаются в разных валютах ----------
await page.evaluate(() => {
  const l = logRead();
  l.unshift({ h:'0x' + 'cc'.repeat(32), m: l[0].m, a:'7', c:'USDC', o:'заказ-9', n:'', i:'Чай',
              net:'bnb', t: Math.floor(Date.now()/1000) + 900, at: Date.now(), paid:true, tx:null });
  logWrite(l); renderLog();
});
R.ok('ВЫРУЧКА ПО ВАЛЮТАМ НЕ СКЛАДЫВАЕТСЯ В КУЧУ',
  /USDT/.test(await page.textContent('#logTotalSum')) &&
  /USDC/.test(await page.textContent('#logTotalSum')),
  await page.textContent('#logTotalSum'));

// ---------- просроченный виден просроченным ----------
await page.evaluate(() => {
  const l = logRead();
  const i = l.findIndex(x => !x.paid);
  l[i].t = Math.floor(Date.now()/1000) - 60;
  logWrite(l); renderLog();
});
R.ok('просроченный счёт назван просроченным',
  /Просрочен/.test(await page.textContent('#logRows')));

// ---------- старый счёт открывается заново ТЕМ ЖЕ ----------
/* Покупатель потерял ссылку. Выставлять новый счёт нельзя: номер в контракте
   занимается один раз, и два номера на одну покупку — это два заказа у
   магазина. */
await page.click('.lrow:last-of-type .lbody');
await page.waitForTimeout(500);
const reopened = await page.evaluate(() => inv.h);
R.ok('СТАРЫЙ СЧЁТ ОТКРЫВАЕТСЯ С ТЕМ ЖЕ НОМЕРОМ, А НЕ НОВЫМ',
  reopened === h1 || reopened === h2, reopened.slice(0, 14) + '…');
R.ok('и ссылка для покупателя снова на экране',
  /#p=/.test(await page.textContent('#doneLink')),
  (await page.textContent('#doneLink')).slice(0, 40));
R.ok('а журнал на экране счёта не мешается',
  (await page.getAttribute('#logCard', 'class') || '').includes('hidden'));

await page.click('#againBtn');
await page.waitForTimeout(300);
R.ok('и возвращается, когда вернулись к форме',
  !(await page.getAttribute('#logCard', 'class') || '').includes('hidden'));

// ---------- убрать строку ----------
const before = await page.locator('.lrow').count();
await page.click('.lrow:first-of-type .rm');
await page.waitForTimeout(400);
R.ok('строку можно убрать из списка',
  (await page.locator('.lrow').count()) === before - 1,
  before + ' -> ' + await page.locator('.lrow').count());

// ---------- очистить всё ----------
await page.click('#logClear');
await page.waitForTimeout(400);
R.ok('СПИСОК МОЖНО ОЧИСТИТЬ ЦЕЛИКОМ',
  /Пока пусто/.test(await page.textContent('#logRows')));
R.ok('и после перезагрузки он остаётся пустым',
  (await open(), /Пока пусто/.test(await page.textContent('#logRows'))));

// ---------- честность на экране ----------
/* Две вещи человек обязан прочесть, не спрашивая нас: что список живёт
   только здесь, и что деньги от него не зависят. Иначе стёртый список
   читается как потерянные деньги. */
const note = await page.textContent('#logNote');
R.ok('СКАЗАНО, ЧТО СПИСОК ТОЛЬКО НА ЭТОМ УСТРОЙСТВЕ',
  /только в этом браузере|другом\s+устройстве/i.test(note), note.trim().slice(0, 80));
R.ok('И ЧТО ДЕНЬГИ ОТ СПИСКА НЕ ЗАВИСЯТ',
  /деньги.*не зависят|в блокчейне/i.test(note), note.trim().slice(-80));

// ---------- в списке не оседает ничего лишнего ----------
/* Блокнот — значит блокнот. Ключей, паролей и seed-фразы тут быть не может
   ни при каких обстоятельствах. */
const stored = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    out[k] = String(localStorage.getItem(k));
  }
  return out;
});
const dump = JSON.stringify(stored);
R.ok('В ПАМЯТИ СТРАНИЦЫ НЕТ НИ КЛЮЧЕЙ, НИ ПАРОЛЕЙ',
  !/privateKey|mnemonic|password|"pk"|seed/i.test(dump),
  Object.keys(stored).join(', '));

const clean = errors.filter(e => !/Failed to load resource|net::ERR_FAILED|favicon/i.test(e));
if (clean.length) console.log('ОШИБКИ СТРАНИЦЫ: ' + clean.join(' | '));
const good = R.done() && clean.length === 0;
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
