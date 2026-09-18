/* Цена газа. Разбор поломки 7 сентября.

   Покупатель с полным кошельком не мог заплатить: узел отвечал
   «gas required exceeds allowance (208808)». Денег хватало с запасом в
   тридцать раз — врала библиотека. Она строит платёж по новым правилам и
   подставляет «чаевые» 1.5 gwei, а в BNB Chain весь газ стоит 0.05 gwei.
   Узел считает по завышенной цене, у человека «не хватает», платёж не идёт.

   Здесь проверяется, что приложение спрашивает цену у сети и не даёт
   библиотеке выдумывать свою. */
import { boot, reporter, answerTotp } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };

const fee = await page.evaluate(async () => {
  const f = await getEvmProvider(network).getFeeData();
  return {
    gasPrice: f.gasPrice ? f.gasPrice.toString() : null,
    maxFee: f.maxFeePerGas ? f.maxFeePerGas.toString() : null,
    prio: f.maxPriorityFeePerGas ? f.maxPriorityFeePerGas.toString() : null
  };
});
R.ok('цена газа берётся у сети', fee.gasPrice !== null, 'gasPrice ' + fee.gasPrice);
R.ok('НИКАКИХ ЧАЕВЫХ ОТ БИБЛИОТЕКИ', fee.maxFee === null && fee.prio === null,
  JSON.stringify(fee));

/* Тот самый платёж, что не проходил: покупка через контракт. */
state.sent.length = 0;
await page.evaluate(() => { tab = 'pay'; setPayMode('buy'); });
await page.waitForTimeout(400);
await page.fill('#sendTo', '0x2222222222222222222222222222222222222222');
await page.fill('#sendAmount', '3');
await page.selectOption('#sendCurrency', 'USDT');
await page.evaluate(() => reviewSend());
await page.waitForTimeout(600);
page.evaluate(() => doSend());
await answerTotp(page, 8000);
await page.waitForTimeout(9000);

const kinds = state.sent.map(t => t.type === undefined ? 'legacy' : String(t.type));
R.ok('платёж ушёл', state.sent.length > 0, kinds.join(','));
R.ok('ПЛАТЁЖ ПОСТРОЕН ПО-СТАРОМУ, БЕЗ maxFeePerGas',
  state.sent.every(t => !t.maxFeePerGas && !t.maxPriorityFeePerGas),
  JSON.stringify(state.sent.map(t => ({ maxFee: t.maxFeePerGas || null, prio: t.maxPriorityFeePerGas || null }))));
R.ok('и цена газа в нём проставлена',
  state.sent.every(t => !!t.gasPrice), JSON.stringify(state.sent.map(t => t.gasPrice || null)));

/* И если денег на газ действительно нет — говорим об этом, а не про
   «условие внутри контракта». */
const said = await page.evaluate(() => shortErr({
  reason:'cannot estimate gas',
  error:{ code:-32000, message:'gas required exceeds allowance (208808)' }
}));
R.ok('НЕХВАТКА ГАЗА НАЗВАНА СВОИМ ИМЕНЕМ', /не хватает/.test(said) && /комиссию сети/.test(said), said);
R.ok('и про контракт при этом ни слова', !/условие внутри контракта/.test(said), said);

/* ---------- Перерисовка посреди платежа ----------

   Ещё одна поломка того же дня: «Cannot read properties of null (reading
   viaName)». Приложение обновляет себя само — по ответу сети, раз в двадцать
   секунд. Пока человек стоял на подтверждении и вводил код, приходил такой
   ответ, экран перерисовывался, и платёж молча отменялся под ним.

   Здесь это воспроизводится нарочно: начинаем платёж и дёргаем перерисовку
   ровно в тот момент, когда человек ещё не подтвердил. */
state.sent.length = 0;
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.waitForTimeout(400);
await page.fill('#sendTo', '0x3333333333333333333333333333333333333333');
await page.fill('#sendAmount', '2');
await page.selectOption('#sendCurrency', 'USDT');
await page.evaluate(() => reviewSend());
await page.waitForTimeout(500);
R.ok('платёж начат', await page.evaluate(() => !!pendingSend));

await page.evaluate(() => { renderWalletState(); renderWalletState(); });
await page.waitForTimeout(300);
R.ok('ПЕРЕРИСОВКА НЕ ОТМЕНЯЕТ НАЧАТЫЙ ПЛАТЁЖ',
  await page.evaluate(() => !!pendingSend),
  await page.evaluate(() => String(pendingSend)));

page.evaluate(() => doSend());
await answerTotp(page, 8000);
await page.waitForTimeout(9000);
const out = await page.evaluate(() => document.getElementById('sendResult').textContent);
R.ok('и платёж доходит до сети', state.sent.length > 0, out.slice(0, 70));
R.ok('без «Cannot read properties of null»', !/null/.test(out), out.slice(0, 70));

/* А если платёж всё-таки потерян — понятные слова, а не английская каша. */
await page.evaluate(() => { pendingSend = null; });
await page.evaluate(() => doSend());
await page.waitForTimeout(500);
const lost = await page.evaluate(() => document.getElementById('sendResult').textContent);
R.ok('потерянный платёж объяснён по-человечески',
  /Наберите сумму заново/.test(lost) && !/null/.test(lost), lost.slice(0, 70));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
