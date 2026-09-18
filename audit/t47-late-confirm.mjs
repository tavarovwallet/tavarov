/* Подтверждение, которое пришло позже, чем мы ждали.

   Приложение ждёт квитанцию девяносто секунд. Это НАШ предел, а не предел
   сети: занятый узел отвечает и на третьей минуте. Раньше на девяностой
   секунде всё и заканчивалось — человек оставался с надписью «сеть ещё не
   подтвердила» навсегда, хотя деньги дошли. Так 15 сентября выглядел
   перевод TVR: он прошёл, а окно его не подтвердило.

   Теперь после показа экрана приложение продолжает смотреть в фоне и само
   меняет надпись. Здесь проверяется именно это:

   1. пока сеть молчит, человеку сказано «отправлено», а не «ошибка»;
   2. когда сеть ответила — надпись сменилась на «подтвердила» сама;
   3. в журнале пометка «ждёт» снята;
   4. а если сеть операцию отвергла — об этом сказано прямо, и молчанием
      это не заменяется.                                                  */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
page.on('dialog', d => d.accept().catch(()=>{}));

/* Ждём квитанцию не девяносто секунд, а одну: проверка обязана проверять
   поведение, а не терпение. Фоновый досмотр при этом настоящий. */
await page.evaluate(() => {
  const real = window.waitTx;
  window.waitTx = (hash) => real(hash, 1);
});

const addr = await page.evaluate(() => wallet.evm.address);
state.balances[addr.toLowerCase()] = { native: 0.5, USDT: 100, TVR: 50 };
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.waitForTimeout(400);

const send = async (amount) => {
  await page.fill('#sendTo', '0x' + '11'.repeat(20));
  await page.fill('#sendAmount', String(amount));
  await page.evaluate(() => reviewSend());
  await page.waitForTimeout(300);
  await page.evaluate(() => doSend());
};

// ---------- сеть молчит, потом отвечает ----------
state.receiptSilent = 3;          // молчит первые три опроса
state.txStatus = '0x1';
await send('1.5');
await page.waitForTimeout(2500);

let txt = await page.textContent('#sendResult');
R.ok('ПОКА СЕТЬ МОЛЧИТ, ЧЕЛОВЕКУ СКАЗАНО «ОТПРАВЛЕНО»',
  /отправлен/i.test(txt) && !/ошибк/i.test(txt), txt.trim().slice(0, 80));
R.ok('и не сказано, что что-то не так', !/не подтвердила/i.test(txt), txt.trim().slice(0, 60));

/* Ждём фоновый досмотр: он спрашивает раз в пять секунд. */
const changed = await page.waitForFunction(
  () => /подтвердила/i.test(document.getElementById('sendResult').textContent),
  null, { timeout: 30000 }).then(() => true).catch(() => false);
R.ok('НАДПИСЬ СМЕНИЛАСЬ САМА, КОГДА СЕТЬ ОТВЕТИЛА', changed,
  (await page.textContent('#sendResult')).trim().slice(0, 80));

R.ok('в журнале снята пометка «ждёт»',
  await page.evaluate(() => histAll().every(x => x.wait !== true)));

// ---------- а отказ сети остаётся отказом ----------
state.receiptSilent = 2;
state.txStatus = '0x0';
await send('2.5');
await page.waitForTimeout(2500);
const refused = await page.waitForFunction(
  () => /отверг|отклонил/i.test(document.getElementById('sendResult').textContent),
  null, { timeout: 30000 }).then(() => true).catch(() => false);
R.ok('ОТКАЗ СЕТИ НЕ ПРЯЧЕТСЯ ЗА МОЛЧАНИЕМ', refused,
  (await page.textContent('#sendResult')).trim().slice(0, 80));

const clean = errors.filter(x => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(x));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
