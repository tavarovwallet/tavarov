/* Покупка без кода продавца.

   Живая история, стоившая нескольких дней. Касса начисляла бонусы только за
   платёж, собранный по QR-коду. В магазине это верно — там код перед глазами.
   Но человек, которому адрес продиктовали, прислали в переписке или который
   просто проверяет кошелёк с компьютера, кода не имеет. Он вбивал адрес
   руками, платил, ждал бонусов — и не получал ничего, потому что для
   контракта это был обычный перевод. Приложение при этом молчало.

   Теперь у него есть переключатель «это покупка у продавца». Здесь
   проверяется всё, что с ним связано, включая главное: выключенный
   переключатель по-прежнему означает перевод, и с перевода другу не берётся
   ни процента. */
import { boot, reporter, answerTotp } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = (require('/home/claude/apk/www/lib/ethers.umd.min.js')).ethers
       || require('/home/claude/apk/www/lib/ethers.umd.min.js');

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });

const me = await page.evaluate(() => wallet.evm.address);
const SHOP = '0x2222222222222222222222222222222222222222';
state.balances[me.toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };

const iPay = new E.utils.Interface(['function pay(address merchant, address token, uint256 amount, bytes32 invoice)']);
const iErc = new E.utils.Interface(['function transfer(address to, uint256 value) returns (bool)']);
const sent = () => ({
  pay:   state.sent.find(t => t.data.startsWith(iPay.getSighash('pay'))),
  plain: state.sent.find(t => t.data.startsWith(iErc.getSighash('transfer')))
});

async function send({ purchase }){
  state.sent.length = 0;
  await page.evaluate(m => { tab = 'pay'; setPayMode(m); }, purchase ? 'buy' : 'transfer');
  await page.waitForTimeout(400);
  await page.fill('#sendTo', SHOP);
  await page.fill('#sendAmount', '10');
  await page.selectOption('#sendCurrency', 'USDT');
  await page.evaluate(() => renderWalletState());
  await page.waitForTimeout(300);
  await page.evaluate(() => reviewSend());
  await page.waitForTimeout(800);
  const hint = await page.evaluate(() => ({
    text: document.getElementById('confirmCashback').textContent,
    shown: !document.getElementById('confirmCashback').classList.contains('hidden')
  }));
  /* doSend ждёт кода, а page.evaluate ждёт doSend — если ждать оба, стенд
     запрётся сам на себя. Поэтому запускаем отправку и не ждём её. */
  page.evaluate(() => doSend());
  await answerTotp(page, 8000);
  await page.waitForTimeout(9000);
  return { hint, ...sent() };
}

// ---------- дела разделены и видны отдельно ----------
await page.evaluate(() => { tab = 'pay'; setPayMode(null); });
await page.waitForTimeout(400);
R.ok('список дел показан', await page.isVisible('#payHub'));

/* Здесь раньше проверялись пять дел: оплатить покупку, перевести человеку,
   вывести на биржу, получить перевод, пополнить с биржи. 18 сентября меню
   свели к двум — «Отправить» и «Принять», — потому что четыре из пяти делали
   по сути одно и то же и человек тратил время на выбор, который ни на что
   не влиял.

   Проверяем теперь то, что осталось верным: дела по-прежнему РАЗДЕЛЕНЫ на
   отправку и приём и видны отдельно, а старые названия должны были исчезнуть
   не только с экрана, но и из кода. */
for (const [id, label] of [['hubBuy','оплатить покупку'], ['hubSend','отправить'],
                           ['hubReceive','принять']]){
  R.ok('в списке есть «' + label + '»', await page.isVisible('#' + id));
}
R.ok('СТАРЫХ ЧЕТЫРЁХ ПУНКТОВ НЕ ОСТАЛОСЬ',
  await page.evaluate(() => !document.getElementById('hubTransfer')
                         && !document.getElementById('hubWithdraw')
                         && !document.getElementById('hubDeposit')));
/* И старые имена режимов должны по-прежнему работать: по ним приходят с
   быстрых кнопок и из ссылок, выписанных до упрощения. Если они перестанут
   пониматься, человек нажмёт кнопку и не попадёт никуда. */
R.ok('старые имена режимов не сломались',
  await page.evaluate(() => {
    setPayMode('withdraw'); const a = payMode;
    setPayMode('deposit');  const b = payMode;
    setPayMode('transfer'); const c = payMode;
    setPayMode(null);
    return a === 'send' && b === 'receive' && c === 'send';
  }));
R.ok('пока дело не выбрано, форм на экране нет',
  await page.evaluate(() => document.getElementById('actionsCard').classList.contains('hidden')));

// ---------- выключен: обычный перевод ----------
let r = await send({ purchase: false });
R.ok('ВЫКЛЮЧЕН — платёж идёт обычным переводом, мимо кассы', !r.pay && !!r.plain,
  r.pay ? 'ушло через контракт' : (r.plain ? '' : 'ничего не отправлено'));
R.ok('и человеку сказано заранее, что это перевод',
  r.hint.shown && /обычный перевод, а не покупка/.test(r.hint.text), r.hint.text.slice(0, 60));
if (r.plain){
  const p = iErc.parseTransaction({ data: r.plain.data });
  R.ok('получателю уходит ВСЯ сумма, без процента', p.args[1].toString() === '10000000',
    p.args[1].toString());
}

// ---------- включён: покупка через кассу ----------
r = await send({ purchase: true });
R.ok('ВКЛЮЧЁН — платёж идёт ЧЕРЕЗ КАССУ', !!r.pay,
  r.pay ? '' : 'отправлено: ' + state.sent.map(t => t.data.slice(0, 10)).join(','));
R.ok('и заранее обещан кешбэк, а не тишина',
  r.hint.shown && /вернётся/.test(r.hint.text), r.hint.text.slice(0, 60));
if (r.pay){
  const p = iPay.parseTransaction({ data: r.pay.data });
  R.ok('продавец в операции — тот, кому платим', p.args[0].toLowerCase() === SHOP.toLowerCase(), p.args[0]);
  R.ok('валюта та самая', p.args[1].toLowerCase() === ADDR.usdt.toLowerCase(), p.args[1]);
  R.ok('сумма верна', p.args[2].toString() === '10000000', p.args[2].toString());
  R.ok('номер счёта проставлен, а не пуст',
    /^0x[0-9a-f]{64}$/i.test(p.args[3]) && !/^0x0+$/.test(p.args[3]), p.args[3].slice(0, 14) + '…');
}

// ---------- себе платить нельзя ----------
state.sent.length = 0;
await page.evaluate(() => { tab = 'pay'; setPayMode('buy'); });
await page.waitForTimeout(300);
await page.fill('#sendTo', me);
await page.fill('#sendAmount', '1');
await page.selectOption('#sendCurrency', 'USDT');
await page.evaluate(() => renderWalletState());
await page.waitForTimeout(300);
await page.evaluate(() => reviewSend());
await page.waitForTimeout(600);
R.ok('САМОМУ СЕБЕ ПОКУПКУ НЕ ОФОРМИТЬ',
  await page.evaluate(() => !pendingSend.merchant),
  await page.evaluate(() => String(pendingSend && pendingSend.merchant)));

// ---------- пришли по коду: дело переключается само ----------
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
const link = await page.evaluate(shop => buildQrPayload({
  to: shop, m: shop, cur:'USDT', amt:'3', item:'Кофе', name:'Кофейня' }), SHOP);
await page.evaluate(s => applyScannedPayment(s), link);
await page.waitForTimeout(1500);
await page.evaluate(() => renderWalletState());
await page.waitForTimeout(300);
R.ok('КОД ПРОДАВЦА САМ ПЕРЕКЛЮЧАЕТ НА ПОКУПКУ',
  await page.evaluate(() => payMode === 'buy'), await page.evaluate(() => String(payMode)));
R.ok('и заголовок экрана про покупку, а не про перевод',
  /Оплатить покупку/.test(await page.evaluate(() => document.getElementById('sendTitle').textContent)),
  await page.evaluate(() => document.getElementById('sendTitle').textContent));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
