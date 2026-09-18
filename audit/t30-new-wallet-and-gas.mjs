/* Новый кошелёк с чужим именем и нулём монеты сети.

   Живой случай, увиденный человеком, а не машиной. Он завёл НОВЫЙ кошелёк —
   и приложение показало на нём имя предыдущего. Выглядело как «ник
   продублировался», а на деле было хуже: имя принадлежало старому адресу.
   Раздай он это имя покупателям — деньги уходили бы не туда.

   Причина: имя запрашивалось один раз, а флажок «уже спрашивали» больше не
   опускался. Флажок помнил ФАКТ запроса, но не помнил, К ЧЬЕМУ адресу этот
   факт относился. Лечится не сбросом в десяти местах, а тем, что кэш помечен
   адресом и сверяется с текущим.

   Там же вскрылось второе. Кошелёк с 0.88 USDC и нулём BNB выглядит полным,
   но отправить с него нельзя ничего: комиссию сети платят монетой сети.
   Узел отвечал «insufficient funds for intrinsic transaction cost», и человек
   получал это дословно — потому что экран отправки показывал СЫРУЮ ошибку
   вместо разобранной. Весь разбор ошибок, написанный ради таких случаев, до
   человека не доходил вовсе. */
import { boot, reporter, answerTotp } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });

const first = await page.evaluate(() => wallet.evm.address);
state.names['siaura'] = first;
state.balances[first.toLowerCase()] = { native: 1, USDT: 10, TVR: 0 };

// ---------- имя первого кошелька читается ----------
await page.evaluate(() => refreshMyName(true));
await page.waitForTimeout(1500);
R.ok('имя первого кошелька прочитано',
  await page.evaluate(() => myName) === 'siaura', await page.evaluate(() => String(myName)));

// ---------- завели ВТОРОЙ кошелёк ----------
/* Так же, как человек: создали заново, поверх. Имени у нового адреса в сети
   нет, и приложение обязано это увидеть, а не показать прошлое. */
await page.evaluate(async () => {
  /* Ключ и адрес обязаны соответствовать друг другу: подписывать будет
     ethers.Wallet(privateKey), и адрес он выведет сам. Подсунуть чужой адрес
     к чужому ключу — значит проверять несуществующий кошелёк. */
  window.__w1 = wallet;
  const w = ethers.Wallet.createRandom();
  window.__w2 = { evm: { address: w.address, privateKey: w.privateKey } };
  wallet = window.__w2;
  renderWalletState();
});
const second = await page.evaluate(() => wallet.evm.address);
state.balances[second.toLowerCase()] = { native: 0, USDT: 0, USDC: 0.88, TVR: 0 };
await page.waitForTimeout(2500);

const shown = await page.evaluate(() => ({
  name: myName, forWhom: myNameFor,
  onScreen: document.getElementById('myNameText').textContent,
  haveShown: !document.getElementById('myNameHave').classList.contains('hidden')
}));
R.ok('НОВОМУ КОШЕЛЬКУ ЧУЖОЕ ИМЯ НЕ ПОКАЗЫВАЕТСЯ',
  shown.name !== 'siaura', String(shown.name));
R.ok('и на экране его тоже нет',
  !shown.haveShown || shown.onScreen !== 'siaura', shown.onScreen);
R.ok('кэш имени помечен адресом, а не флажком «спрашивали»',
  shown.forWhom === null || shown.forWhom === second,
  String(shown.forWhom));

// ---------- имя по-прежнему принадлежит первому ----------
const who = await page.evaluate(() => namesContract(true).addressOf('siaura'));
R.ok('ИМЯ ПО-ПРЕЖНЕМУ ВЕДЁТ НА СТАРЫЙ АДРЕС — ЭТО И ЕСТЬ ПРАВДА',
  String(who).toLowerCase() === first.toLowerCase(), String(who));

// ---------- вернулись на первый: имя снова наше ----------
await page.evaluate(() => { wallet = window.__w1; renderWalletState(); });
await page.waitForTimeout(2500);
R.ok('вернулись на прежний кошелёк — имя вернулось само',
  await page.evaluate(() => myName) === 'siaura', await page.evaluate(() => String(myName)));

// ---------- остатки чужого кошелька не показываются ----------
await page.evaluate(() => refreshBalances());
await page.waitForTimeout(2000);
await page.evaluate(() => { wallet = window.__w2; tab = 'wallet'; renderWalletState(); });
await page.waitForTimeout(600);
const list = await page.evaluate(() => document.getElementById('tokenList').innerText);
R.ok('ОСТАТКИ ПРЕЖНЕГО КОШЕЛЬКА НЕ ПОКАЗЫВАЮТСЯ НОВОМУ',
  !/10\.00/.test(list), list.replace(/\n/g, ' | ').slice(0, 100));

// ---------- ноль монеты сети: сказать словами ----------
state.balances[second.toLowerCase()] = { native: 0, USDT: 5, TVR: 0 };
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.waitForTimeout(400);
await page.fill('#sendTo', '0x2222222222222222222222222222222222222222');
await page.fill('#sendAmount', '1');
await page.selectOption('#sendCurrency', 'USDT');
await page.evaluate(() => renderWalletState());
await page.waitForTimeout(300);
await page.evaluate(() => reviewSend());
await page.waitForTimeout(600);
state.sent.length = 0;
page.evaluate(() => doSend());
await answerTotp(page, 8000);
await page.waitForTimeout(9000);
const said = await page.evaluate(() => document.getElementById('sendResult').textContent);

R.ok('НОЛЬ МОНЕТЫ СЕТИ НАЗВАН СЛОВАМИ',
  /не хватает/i.test(said) && /комисси/i.test(said), said.slice(0, 120));
R.ok('И НИКАКОЙ АНГЛИЙСКОЙ ПРОСТЫНИ — ЭКРАН ПОКАЗЫВАЕТ РАЗОБРАННУЮ ПРИЧИНУ',
  !/INSUFFICIENT_FUNDS|SERVER_ERROR|providers\/5|intrinsic transaction cost|ethers\.org/i.test(said),
  said.slice(0, 120));
R.ok('и обречённый перевод не отправлен', state.sent.length === 0, 'отправлено ' + state.sent.length);

/* Отдельно: экран отправки обязан звать разбор ошибок, а не показывать сырое
   сообщение. Именно на этом весь разбор годами не доходил до человека. */
const raw = await page.evaluate(() => shortErr({
  code: 'INSUFFICIENT_FUNDS',
  message: 'insufficient funds for intrinsic transaction cost [ See: https://links.ethers.org/v5-errors-INSUFFICIENT_FUNDS ]'
}));
R.ok('разбор такой ошибки существует и он по-русски',
  /не хватает/i.test(raw) && !/insufficient/i.test(raw), raw.slice(0, 90));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
