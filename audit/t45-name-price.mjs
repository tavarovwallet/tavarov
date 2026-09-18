/* Цена имени: три разных ответа, которые нельзя путать.

   Третья версия контракта имён умеет цену. Сегодня все цены в нуле, и имена
   бесплатны — но приложение обязано быть готово к тому дню, когда цена
   появится, и к тому, что рядом живёт старая версия контракта, у которой
   функции цены нет вовсе.

   Три ответа, и каждый значит своё:

     цена есть     — платим ровно её. Отправить ноль — получить отказ сети
                     и заплатить комиссию ни за что.
     цена ноль     — имя бесплатное, и денег слать НЕЛЬЗЯ: контракт отвергает
                     операцию, где за бесплатное имя прислали монеты.
     отказ         — короткие имена придержаны. Это не ноль и не поломка,
                     и человеку надо сказать словами, а не показать «ошибка».

   И отдельная ловушка: у старой версии функции цены нет, узел на неё
   отвечает пустотой — ровно так же, как на запрет короткого имени. Спутать
   их — значит либо объявить бесплатное имя непродающимся, либо показать
   «бесплатно» там, где операция не пройдёт.                               */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();

const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
page.on('dialog', d => d.accept().catch(()=>{}));
await page.evaluate(() => setTab('settings'));
await page.waitForTimeout(1200);

const typeName = async (v) => {
  await page.fill('#nameInput', v);
  await page.waitForTimeout(1600);
  return page.evaluate(() => ({
    hint: document.getElementById('nameHint').textContent.trim(),
    can:  !document.getElementById('claimNameBtn').disabled
  }));
};

/* ---------- старая версия: функции цены нет ---------- */
state.namesV3 = false;
let r = await typeName('kofeinya_long');
R.ok('СО СТАРЫМ КОНТРАКТОМ ИМЯ ОСТАЁТСЯ БЕСПЛАТНЫМ', /свободно/i.test(r.hint) && !/Цена/i.test(r.hint), r.hint);
R.ok('и занять его разрешают', r.can);

/* ---------- новая версия, цена ноль ---------- */
state.namesV3 = true;
state.prices = {};
r = await typeName('kofeinya_long');
R.ok('с новым контрактом бесплатное имя тоже бесплатно', /свободно/i.test(r.hint) && !/Цена/i.test(r.hint), r.hint);
R.ok('и его тоже разрешают занять', r.can);

/* ---------- новая версия, цена есть ---------- */
state.prices = { 13: '20000000000000000' };      // 0.02 за тринадцать знаков
r = await typeName('kofeinya_long');
R.ok('ЦЕНА ПОКАЗАНА ЧИСЛОМ, А НЕ СПРЯТАНА', /Цена/i.test(r.hint) && /0\.02/.test(r.hint), r.hint);
R.ok('и сказано, что сумма уйдёт вместе с операцией', /вместе с операцией/i.test(r.hint), r.hint.slice(-60));
R.ok('занять по-прежнему можно', r.can);

/* ---------- короткое имя: отказ словами ---------- */
state.prices = {};
r = await typeName('abc');
R.ok('ПРО КОРОТКОЕ ИМЯ СКАЗАНО СЛОВАМИ, А НЕ «ОШИБКА»',
  /не продаётся/i.test(r.hint) && !/reverted|error/i.test(r.hint), r.hint);
R.ok('И ЗАНЯТЬ ЕГО НЕ ДАЮТ', !r.can);
R.ok('и это не выдали за «уже занято»', !/занято/i.test(r.hint), r.hint);

/* А если цену для короткого имени назначили — оно продаётся. */
state.prices = { 3: '50000000000000000' };
r = await typeName('abc');
R.ok('назначенная цена открывает и короткое имя', /Цена/i.test(r.hint) && r.can, r.hint);

/* Главное: сумма обязана уйти в сеть. Показать цену и отправить ноль —
   это отказ сети и потраченная комиссия. */
state.balances = { native: 1 };
await page.evaluate(() => { lastBalances = { native: 1 }; });
state.sent.length = 0;
await page.evaluate(() => claimName());
await page.waitForTimeout(2500);
const tx = state.sent[state.sent.length - 1];
R.ok('В СЕТЬ УШЛА ИМЕННО ЦЕНА, А НЕ НОЛЬ',
  !!tx && tx.value === '50000000000000000', tx ? tx.value : 'операции нет');

const clean = errors.filter(x => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(x));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
