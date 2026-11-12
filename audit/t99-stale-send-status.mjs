/* Надпись о прошлом переводе не должна висеть над новым (SEND-STALE-V1).

   На записи экрана 12 ноября: человек отправил приз, начал следующий, и на
   экране подтверждения НОВОГО перевода, до нажатия кнопки, стояло
   «Сеть подтвердила» — от прошлого. Выглядело так, будто новый уже ушёл.

   Проверяем:
   1. подтверждённый прошлый перевод — новый экран подтверждения чистый;
   2. прошлый ещё не подтверждён, человек начал новый — поздний ответ сети
      о прошлом не пишет «подтвердила» на экран нового;
   3. а сам новый перевод своё «подтвердила» получает как раньше.       */
import { boot, reporter, answerConfirm } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8556);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8556' });
page.on('dialog', d => d.accept().catch(()=>{}));
await page.evaluate(() => { const real = window.waitTx; window.waitTx = (hash) => real(hash, 1); });

const addr = await page.evaluate(() => wallet.evm.address);
state.balances[addr.toLowerCase()] = { native: 0.5, USDT: 100 };
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.waitForTimeout(400);

const review = async (amount) => {
  await page.fill('#sendTo', '0x' + '11'.repeat(20));
  await page.fill('#sendAmount', String(amount));
  await page.evaluate(() => reviewSend());
  await page.waitForTimeout(300);
};
/* Перевод подтверждается паролем всегда (t44) — отвечаем на окно, не дожидаясь doSend. */
const sendNow = async () => { const p = page.evaluate(() => doSend()); await answerConfirm(page); await p; };
const resultText = () => page.evaluate(() => {
  const b = document.getElementById('sendResult');
  return b.classList.contains('hidden') ? '' : b.textContent.trim();
});

// ---------- 1. прошлый подтверждён ----------
state.receiptSilent = 0; state.txStatus = '0x1';
await review('1');
await sendNow();
const confirmed = await page.waitForFunction(
  () => /подтвердила/i.test(document.getElementById('sendResult').textContent),
  null, { timeout: 30000 }).then(() => true).catch(() => false);
R.ok('первый перевод подтвердился (как раньше)', confirmed);

await review('1');
let txt = await resultText();
R.ok('НА ЭКРАНЕ НОВОГО ПЕРЕВОДА НЕТ «ПОДТВЕРДИЛА» ОТ ПРОШЛОГО', !/подтвердила|отправлен/i.test(txt), txt.slice(0, 80));
await page.evaluate(() => cancelSend());

// ---------- 2. прошлый ещё в пути ----------
state.receiptSilent = 4;          // первые опросы сеть молчит
await review('2');
await sendNow();
await page.waitForTimeout(1500);
await review('3');                // новый перевод начат, прошлый ещё не подтверждён
await page.waitForTimeout(16000); // фоновый досмотр прошлого успевает получить ответ
txt = await resultText();
R.ok('ПОЗДНИЙ ОТВЕТ О ПРОШЛОМ НЕ ПИШЕТ НА ЭКРАН НОВОГО', !/подтвердила|отправлен/i.test(txt), txt.slice(0, 80));
R.ok('экран подтверждения нового на месте',
  await page.evaluate(() => !document.getElementById('sendConfirm').classList.contains('hidden')));

// ---------- 3. новый получает своё ----------
state.receiptSilent = 0;
await sendNow();
const own = await page.waitForFunction(
  () => /подтвердила/i.test(document.getElementById('sendResult').textContent),
  null, { timeout: 30000 }).then(() => true).catch(() => false);
R.ok('новый перевод получил своё «подтвердила»', own);

const clean = errors.filter(x => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(x));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
