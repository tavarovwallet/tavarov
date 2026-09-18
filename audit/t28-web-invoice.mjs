/* Интернет-счёт прямо из кассы приложения.

   ЗАЧЕМ. Касса умела показывать QR и ссылку tavarov:pay — обе открываются
   только нашим приложением. Продавцу этого мало: он договорился о цене в
   переписке, а покупатель на том конце нашего приложения не ставил и ставить
   не обязан. Такому человеку нужен обычный адрес, который откроется в
   браузере, покажет сумму и код и сам скажет продавцу, когда придут деньги.

   Отдельная страница на компьютере продавца эту задачу не решала: ссылка на
   localhost работает только у него самого, а ссылка, которую нельзя послать,
   ссылкой не является.

   Здесь проверяется, что касса такую ссылку выдаёт, что она собрана так, как
   её ждёт страница счёта, что номер счёта у двух счетов разный, и что там,
   где касса работать не может, ссылку не показывают вовсе — иначе продавец
   будет смотреть на вечное «ждём оплату». */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });

const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, USDT: 50, TVR: 0 };

const makeTicket = async (cur, amt) => {
  await page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); cancelTicket(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => saveShopName('Кофейня на углу'));
  await page.fill('#kassaItem', 'Капучино');
  await page.fill('#kassaAmount', String(amt));
  await page.selectOption('#kassaCurrency', cur);
  await page.evaluate(() => createTicket());
  await page.waitForTimeout(3000);
  return page.evaluate(() => ({
    web: document.getElementById('ticketWebLink').textContent.trim(),
    shown: !document.getElementById('ticketWebLabel').classList.contains('hidden'),
    own: document.getElementById('ticketPayLink').textContent.trim(),
    inv: ticketInvoice
  }));
};

// ---------- адрес сайта ----------
R.ok('адрес сайта задан по умолчанию, а не пуст',
  /^https:\/\/\S+$/.test(await page.evaluate(() => siteBase())),
  await page.evaluate(() => siteBase()));
R.ok('и его можно поменять, не трогая приложение',
  await page.evaluate(() => { saveSiteBase('https://тавaров.рф/'); return siteBase(); }) === 'https://тавaров.рф',
  await page.evaluate(() => siteBase()));
/* Возвращаем адрес по умолчанию. Раньше здесь стоял прежний адрес на
   pages.dev — и с тех пор, как приложение само заменяет старые адреса на
   новый, эта строка проверяла бы не настройку, а лечение переезда. */
await page.evaluate(() => { localStorage.removeItem(SITE_KEY); });

R.ok('НАСТРОЙКА АДРЕСА ВИДНА ПРОДАВЦУ',
  await page.evaluate(() => { tab='settings'; renderWalletState();
    return !document.getElementById('siteGroup').classList.contains('hidden'); }));
R.ok('и спрятана у покупателя — ему она ни к чему',
  await page.evaluate(() => { setRole('buyer'); tab='settings'; renderWalletState();
    return document.getElementById('siteGroup').classList.contains('hidden'); }));
await page.evaluate(() => setRole('seller'));

// ---------- счёт в валюте, которую касса принимает ----------
let tk = await makeTicket('USDT', '12.34');
R.ok('ИНТЕРНЕТ-ССЫЛКА ВЫДАНА', tk.shown && tk.web.length > 30, tk.web.slice(0, 60));
R.ok('она ведёт на страницу счёта нашего сайта',
  tk.web.startsWith('https://wallet.tavarov.com/pay.html#p='), tk.web.slice(0, 55));
R.ok('а ссылка для нашего приложения осталась на месте',
  /^(ethereum:|tavarov:pay\?)/.test(tk.own), tk.own.slice(0, 24));

/* Самое важное: то, что мы положили в ссылку, страница счёта обязана понять.
   Разбираем ровно по тем же правилам, что и она. */
const payload = JSON.parse(Buffer.from(
  tk.web.split('#p=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
R.ok('СЧЁТ В ССЫЛКЕ СОБРАН ТАК, КАК ЖДЁТ СТРАНИЦА ОПЛАТЫ',
  /^0x[0-9a-fA-F]{40}$/.test(payload.m || '')
  && parseFloat(payload.a) > 0
  && /^0x[0-9a-fA-F]{64}$/.test(payload.h || ''),
  JSON.stringify({ m: payload.m, a: payload.a, h: (payload.h || '').slice(0, 12) + '…' }));
R.ok('деньги адресованы продавцу, а не кому-то ещё',
  payload.m.toLowerCase() === me.toLowerCase(), payload.m);
R.ok('сумма и валюта те самые', payload.a === '12.34' && payload.c === 'USDT',
  payload.a + ' ' + payload.c);
R.ok('покупатель увидит название точки и товар',
  payload.n === 'Кофейня на углу' && payload.i === 'Капучино',
  payload.n + ' / ' + payload.i);
R.ok('сеть проставлена', payload.net === 'bnbTestnet', String(payload.net));
R.ok('и у счёта есть срок', payload.t > Math.floor(Date.now() / 1000), String(payload.t));

/* Номер счёта один и тот же в коде и в ссылке: продавец следит за одним
   номером, и оплата, пришедшая по другому, до него бы не дошла. */
R.ok('НОМЕР СЧЁТА В КОДЕ И В ССЫЛКЕ ОДИН',
  tk.own.indexOf(payload.h.slice(2)) >= 0 || tk.own.indexOf(payload.h) >= 0,
  payload.h.slice(0, 14) + '…');

// ---------- второй счёт — другой номер ----------
const first = payload.h;
tk = await makeTicket('USDT', '5');
const second = JSON.parse(Buffer.from(
  tk.web.split('#p=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).h;
R.ok('У ДВУХ СЧЁТОВ РАЗНЫЕ НОМЕРА — ИНАЧЕ ДВЕ ОПЛАТЫ СОЛЬЮТСЯ В ОДНУ',
  first !== second, first.slice(0, 12) + '… / ' + second.slice(0, 12) + '…');

// ---------- монета сети: касса её не проводит ----------
tk = await makeTicket('native', '0.5');
R.ok('ДЛЯ МОНЕТЫ СЕТИ ССЫЛКИ НЕТ — ПО НЕЙ СЧЁТ НЕ ОТСЛЕДИТЬ',
  !tk.shown && !tk.web, tk.web.slice(0, 40));

// ---------- контрактов нет: ссылку не показываем ----------
await page.evaluate(() => { CONTRACTS.bnbTestnet.pay = null; CONTRACTS.bnbTestnet.token = null; });
tk = await makeTicket('USDT', '3');
R.ok('БЕЗ КОНТРАКТА ОПЛАТЫ ССЫЛКУ НЕ ПОКАЗЫВАЕМ',
  !tk.shown && !tk.web, tk.web.slice(0, 40));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
