/* Главная проверка: доходит ли сумма от кассы до покупателя.

   Сеть поддельная, но отвечает настоящим ABI-кодом, поэтому проверяется
   именно то, что делает приложение: какой вопрос задаёт контракту, как
   разбирает ответ и что в итоге отправляет в сеть. */
import { boot, reporter, answerTotp } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = (require('/home/claude/apk/www/lib/ethers.umd.min.js')).ethers || require('/home/claude/apk/www/lib/ethers.umd.min.js');

const srv = await start(8555);
const R = reporter();

// ---------- продавец: выставляет счёт на наклейку ----------
const seller = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });
const sellerAddr = await seller.page.evaluate(() => wallet.evm.address);
const VAULT = '0x1111111111111111111111111111111111111111';
state.vaults[sellerAddr.toLowerCase()] = VAULT;
state.balances[sellerAddr.toLowerCase()] = { native: 1, USDT: 0, TVR: 0 };
state.balances[VAULT.toLowerCase()] = { native: 0, USDT: 0, TVR: 0 };

await seller.page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
await seller.page.evaluate(() => refreshVault(true));
await seller.page.waitForTimeout(500);

/* Приёмников больше нет: продавцу нечего подключать, и код кассы ведёт
   прямо на его собственный кошелёк. Проверяем именно это — что лишней
   сущности между продавцом и его деньгами не осталось. */
R.ok('отдельного приёмника у продавца нет',
  await seller.page.evaluate(() => !(vaultState && vaultState.vault)));

await seller.page.evaluate(() => saveShopName('Кофейня на углу'));

// кассир набирает и выставляет счёт
await seller.page.fill('#kassaItem', 'Кофе латте');
await seller.page.fill('#kassaAmount', '3.5');
await seller.page.selectOption('#kassaCurrency', 'USDT');
R.ok('кнопка «Выставить счёт в сети» видна', await seller.page.isVisible('#publishChargeBtn'));

await seller.page.click('#publishChargeBtn');
await seller.page.waitForTimeout(6000);

const setChargeTx = state.sent.find(t => t.to && t.to.toLowerCase() === ADDR.charges.toLowerCase());
R.ok('счёт ушёл в контракт счетов', !!setChargeTx, setChargeTx ? setChargeTx.to : 'ничего не отправлено');
if (setChargeTx) {
  const iface = new E.utils.Interface(['function setCharge(address token, uint128 amount, string item, uint32 ttl)']);
  const d = iface.parseTransaction({ data: setChargeTx.data });
  R.ok('в счёте тот токен', d.args[0].toLowerCase() === ADDR.usdt.toLowerCase(), d.args[0]);
  R.ok('в счёте та сумма', d.args[1].toString() === '3500000', d.args[1].toString());
  R.ok('в счёте то описание', d.args[2] === 'Кофе латте', d.args[2]);
  R.ok('срок счёта 15 минут', Number(d.args[3]) === 900, String(d.args[3]));
}

// касса должна перейти в ожидание оплаты сама
R.ok('касса перешла в ожидание оплаты', await seller.page.isVisible('#kassaTicket'));
R.ok('видна подсказка про счёт в сети', await seller.page.isVisible('#ticketStickerHint'));
R.ok('строка состояния счёта показана', await seller.page.isVisible('#chargeLive'));
const liveText = await seller.page.evaluate(() => document.getElementById('chargeLive').textContent);
R.ok('в строке состояния сумма и товар', liveText.includes('3.5') && liveText.includes('Кофе латте'), liveText.slice(0, 90));

// ---------- покупатель: приходит по коду продавца ----------
const perma = await seller.page.evaluate(() => buildPayLink({ to: (vaultState && vaultState.vault) || wallet.evm.address, m: wallet.evm.address, name: shopName() }));
const buyer = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
const buyerAddr = await buyer.page.evaluate(() => wallet.evm.address);
state.balances[buyerAddr.toLowerCase()] = { native: 0.5, USDT: 100, TVR: 0 };

await buyer.page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await buyer.page.evaluate(link => applyScannedPayment(link), perma);
await buyer.page.waitForTimeout(1500);

const filled = await buyer.page.evaluate(() => ({
  to: document.getElementById('sendTo').value,
  amt: document.getElementById('sendAmount').value,
  cur: document.getElementById('sendCurrency').value,
  note: document.getElementById('scanIntentBox').textContent,
  noteShown: !document.getElementById('scanIntentBox').classList.contains('hidden'),
  merchant: (typeof scannedMerchant!=="undefined" ? scannedMerchant : null)
}));
console.log('после скана:', JSON.stringify(filled, null, 1));

R.ok('СУММА ПОДСТАВИЛАСЬ', filled.amt === '3.5', 'в поле: "' + filled.amt + '"');
R.ok('валюта подставилась', filled.cur === 'USDT', filled.cur);
R.ok('получатель — касса продавца', filled.to.toLowerCase() === sellerAddr.toLowerCase(), filled.to);
R.ok('касса запомнена для оплаты через контракт', (filled.merchant || '').toLowerCase() === sellerAddr.toLowerCase());
R.ok('покупателю видно, за что он платит', filled.noteShown && filled.note.includes('Кофе латте'), filled.note.slice(0, 100));
R.ok('покупателю видно название точки', filled.note.includes('Кофейня на углу'));

// ---------- покупатель платит ----------
state.sent.length = 0;
await buyer.page.evaluate(() => reviewSend());
await buyer.page.waitForTimeout(800);
R.ok('экран подтверждения открылся', await buyer.page.isVisible('#sendConfirm'));
const confirmTo = await buyer.page.evaluate(() => document.getElementById('confirmTo').textContent);
R.ok('в подтверждении видно название точки', confirmTo.includes('Кофейня на углу'), confirmTo);

buyer.page.evaluate(() => doSend());
await answerTotp(buyer.page);
await buyer.page.waitForTimeout(12000);
console.log('результат отправки:', await buyer.page.evaluate(()=>document.getElementById('sendResult').textContent));

const iApprove = new E.utils.Interface(['function approve(address spender, uint256 value) returns (bool)']);
const iPay = new E.utils.Interface(['function pay(address merchant, address token, uint256 amount, bytes32 invoice)']);
const approveTx = state.sent.find(t => t.data.startsWith(iApprove.getSighash('approve')));
const payTx     = state.sent.find(t => t.data.startsWith(iPay.getSighash('pay')));

R.ok('оплата пошла ЧЕРЕЗ КОНТРАКТ, а не обычным переводом', !!payTx,
  payTx ? '' : 'отправлено: ' + state.sent.map(t => t.data.slice(0, 10)).join(','));
if (approveTx) {
  const a = iApprove.parseTransaction({ data: approveTx.data });
  R.ok('разрешение выдано контракту оплаты', a.args[0].toLowerCase() === ADDR.pay.toLowerCase(), a.args[0]);
  R.ok('разрешение РОВНО на сумму покупки, не бессрочное', a.args[1].toString() === '3500000', a.args[1].toString());
}
if (payTx) {
  const p = iPay.parseTransaction({ data: payTx.data });
  R.ok('платим кассе продавца, а не приёмнику', p.args[0].toLowerCase() === sellerAddr.toLowerCase(), p.args[0]);
  R.ok('сумма платежа верна', p.args[2].toString() === '3500000', p.args[2].toString());
}

// ---------- касса замечает оплату напрямую продавцу ----------
// контракт отдал продавцу сумму за вычетом комиссии 1%
state.balances[sellerAddr.toLowerCase()].USDT = 3.465;
state.sent.length = 0;
await seller.page.evaluate(() => pollForPayment());
await seller.page.waitForTimeout(1500);
const pill = await seller.page.evaluate(() => document.getElementById('kassaStatusPill').textContent);
R.ok('КАССА УВИДЕЛА ОПЛАТУ (сумма пришла за вычетом комиссии)', pill.includes('Оплачено'), pill);
await seller.page.waitForTimeout(1500);
const cleared = state.sent.find(t => t.to && t.to.toLowerCase() === ADDR.charges.toLowerCase());
R.ok('счёт снят из сети сразу после оплаты', !!cleared, cleared ? '' : 'снятие не отправлено');

const bad = R.done([...seller.errors, ...buyer.errors].filter(e => !/ERR_TUNNEL|coingecko/i.test(e)));
await seller.browser.close(); await buyer.browser.close(); srv.close();
process.exit(bad ? 0 : 1);
