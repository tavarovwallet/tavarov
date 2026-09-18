/* Отказы кассы, сказанные по-человечески.

   Живой случай. Человек нажал «Подтвердить отправку» и получил в лицо две
   тысячи знаков английского текста: UNPREDICTABLE_GAS_LIMIT, SERVER_ERROR,
   abstract-signer/5.7.0 — и где-то в середине настоящая причина: «execution
   reverted: Pay: transfer failed». То есть контракт не смог забрать деньги.
   Причин у этого ровно две: их нет на кошельке либо не выдано разрешение.
   Обе объясняются одной строчкой, а человек получил простыню.

   И вторая беда, поважнее вида. Разрешение мы запрашивали так:

       const ap = await erc.approve(...);
       await waitTx(ap.hash);        // результат никто не смотрел

   waitTx не бросает исключение: не дождался подтверждения — вернул false и
   пошёл дальше. Дальше вызывался pay(), которому нечего забирать, потому что
   разрешения в сети ещё нет. Мы сами отправляли заведомо обречённую операцию
   и сжигали на ней комиссию, а выглядело это как поломка кассы.

   Здесь проверяется, что оба случая теперь ловятся ДО отправки. */
import { boot, reporter, answerTotp } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });

const me = await page.evaluate(() => wallet.evm.address);
const SHOP = '0x2222222222222222222222222222222222222222';

const buy = async (amount) => {
  state.sent.length = 0;
  await page.evaluate(() => { tab = 'pay'; setPayMode('buy'); });
  await page.waitForTimeout(400);
  await page.fill('#sendTo', SHOP);
  await page.fill('#sendAmount', String(amount));
  await page.selectOption('#sendCurrency', 'USDT');
  await page.evaluate(() => renderWalletState());
  await page.waitForTimeout(300);
  await page.evaluate(() => reviewSend());
  await page.waitForTimeout(700);
  page.evaluate(() => doSend());
  await answerTotp(page, 8000);
  await page.waitForTimeout(9000);
  return page.evaluate(() => document.getElementById('sendResult').textContent);
};

// ---------- монет на кошельке нет ----------
state.balances[me.toLowerCase()] = { native: 1, USDT: 0, TVR: 0 };
state.allowance = 0;
let said = await buy('3');
R.ok('ПУСТОЙ КОШЕЛЁК НАЗВАН СЛОВАМИ, А НЕ ОТКАЗОМ УЗЛА',
  /На кошельке 0 USDT/.test(said) && /нужно 3 USDT/.test(said), said.slice(0, 110));
R.ok('и предложено, что делать', /Пополните кошелёк|другую валюту/.test(said), said.slice(0, 130));
R.ok('НИ ОДНОЙ ОПЕРАЦИИ ПРИ ЭТОМ НЕ ОТПРАВЛЕНО — КОМИССИЯ НЕ СОЖЖЕНА',
  state.sent.length === 0, 'отправлено ' + state.sent.length);
R.ok('и стены английского текста человеку не показали',
  !/UNPREDICTABLE_GAS_LIMIT|SERVER_ERROR|abstract-signer/.test(said));

// ---------- монеты есть, но разрешение не доходит ----------
/* Поддельный узел упорно отвечает «разрешения нет» — ровно так выглядит
   неподтверждённый approve. Раньше на этом месте приложение всё равно
   отправляло pay() и получало «Pay: transfer failed». */
state.balances[me.toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };
state.allowance = 0;
state.approveSticks = false;          // разрешение уходит, но не подтверждается
said = await buy('3');
R.ok('НЕДОШЕДШЕЕ РАЗРЕШЕНИЕ ОСТАНАВЛИВАЕТ ОПЛАТУ',
  /[Рр]азрешение на списание не/.test(said), said.slice(0, 110));
R.ok('и человеку сказано, что деньги целы',
  /[Дд]еньги на месте/.test(said), said.slice(0, 130));
R.ok('и сказано, что делать — попробовать ещё раз',
  /ещё раз/.test(said), said.slice(0, 130));

const iPay = '0x3e8bca68';
R.ok('ОБРЕЧЁННАЯ ОПЛАТА НЕ ОТПРАВЛЕНА',
  !state.sent.some(x => String(x.data || '').startsWith(iPay)),
  state.sent.map(x => String(x.data || '').slice(0, 10)).join(',') || 'ничего');

// ---------- разрешение дошло: оплата идёт ----------
state.approveSticks = true;
state.allowance = 0;
said = await buy('3');
R.ok('А КОГДА РАЗРЕШЕНИЕ ЕСТЬ — ОПЛАТА УХОДИТ ЧЕРЕЗ КАССУ',
  state.sent.some(x => String(x.data || '').startsWith(iPay)),
  state.sent.map(x => String(x.data || '').slice(0, 10)).join(',') || 'ничего');

// ---------- перевод отказов контракта на человеческий ----------
const say = (reason) => page.evaluate(r => shortErr({
  reason: 'execution reverted: ' + r, message: 'cannot estimate gas; execution reverted: ' + r,
  code: 'UNPREDICTABLE_GAS_LIMIT' }), reason);

R.ok('«transfer failed» ПЕРЕВЕДЕНО НА ЧЕЛОВЕЧЕСКИЙ',
  /не хватает на кошельке|не выдано разрешение/.test(await say('Pay: transfer failed')),
  (await say('Pay: transfer failed')).slice(0, 90));
R.ok('«cannot pay yourself» тоже',
  /[Сс]амому себе платить нельзя/.test(await say('Pay: cannot pay yourself')),
  (await say('Pay: cannot pay yourself')).slice(0, 70));
R.ok('«amount is zero» тоже',
  /[Сс]умма не подходит/.test(await say('Pay: amount is zero')),
  (await say('Pay: amount is zero')).slice(0, 70));
R.ok('«token not accepted» как было', /валют|принимает/i.test(await say('Pay: token not accepted')),
  (await say('Pay: token not accepted')).slice(0, 70));
R.ok('и ни в одном ответе нет английской простыни',
  !/UNPREDICTABLE|abstract-signer|execution reverted/.test(
    (await say('Pay: transfer failed')) + (await say('Pay: cannot pay yourself'))));

// ---------- обычный перевод: та же вежливость ----------
state.balances[me.toLowerCase()] = { native: 1, USDT: 0, TVR: 0 };
state.sent.length = 0;
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.waitForTimeout(400);
await page.fill('#sendTo', SHOP);
await page.fill('#sendAmount', '2');
await page.selectOption('#sendCurrency', 'USDT');
await page.evaluate(() => renderWalletState());
await page.waitForTimeout(300);
await page.evaluate(() => reviewSend());
await page.waitForTimeout(600);
page.evaluate(() => doSend());
await answerTotp(page, 8000);
await page.waitForTimeout(9000);
const plain = await page.evaluate(() => document.getElementById('sendResult').textContent);
R.ok('И ПРИ ОБЫЧНОМ ПЕРЕВОДЕ ПУСТОЙ КОШЕЛЁК НАЗВАН ЧИСЛАМИ',
  /На кошельке 0 USDT/.test(plain), plain.slice(0, 100));
R.ok('и обречённый перевод тоже не отправлен', state.sent.length === 0,
  'отправлено ' + state.sent.length);

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
