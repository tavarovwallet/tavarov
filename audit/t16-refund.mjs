/* Поступления и возврат денег покупателю.

   Возврат — это второй платёж, и ошибиться в нём так же дорого, как в
   первом. Поэтому проверяем не «кнопка есть», а куда именно и сколько
   уходит, и что человека честно предупредили, чего это ему стоит. */
import { boot, reporter } from './boot.mjs';
import { start, state, paidLog, ADDR } from './mocknode.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = (require('/home/claude/apk/www/lib/ethers.umd.min.js')).ethers
       || require('/home/claude/apk/www/lib/ethers.umd.min.js');

const srv = await start(8554);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8554' });

const BUYER = '0x77AA88bb99Cc00DD11ee22FF33445566778899aA';
const INV   = '0x' + 'be7f'.repeat(16);
const me = await page.evaluate(() => wallet.evm.address);

/* Покупатель заплатил 12.34 USDT: 12.2166 дошло продавцу, 0.1234 — комиссия. */
state.logs = [paidLog({
  merchant: me, payer: BUYER, token: ADDR.usdt,
  toMerchant: E.utils.parseUnits('12.2166', 6),
  fee: E.utils.parseUnits('0.1234', 6),
  reward: E.utils.parseUnits('5', 18),
  invoice: INV, block: 7
})];
state.balances[me.toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };

await page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
await page.waitForTimeout(500);

R.ok('продавцу видна отдельная полка поступлений', await page.isVisible('#incomingPanel'));

await page.evaluate(() => loadIncoming());
await page.waitForTimeout(2500);
const list = await page.evaluate(() => document.getElementById('incomingList').innerText);
R.ok('оплата в списке есть', /12[.,]34/.test(list), list.replace(/\n/g, ' ').slice(0, 90));
R.ok('ПОКАЗЫВАЕМ, СКОЛЬКО ЗАПЛАТИЛ ПОКУПАТЕЛЬ, А НЕ СКОЛЬКО ДОШЛО',
  list.includes('12.34') && !list.includes('12.2166'), list.replace(/\n/g, ' ').slice(0, 90));
R.ok('видно, кто платил', list.toLowerCase().includes('0x77aa'),
  list.replace(/\n/g, ' ').slice(0, 90));
R.ok('кнопка возврата на месте',
  (await page.evaluate(() => [...document.querySelectorAll('#incomingList button')].length)) === 1);

// ================= первая версия контракта: обычный перевод =================
/* Окон будет два: сначала вопрос, потом сообщение об отправке. Запоминаем
   оба — проверять надо именно вопрос, а не последнее, что мелькнуло. */
const dialogs = [];
page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
const askedText = () => dialogs[0] || '';

state.sent.length = 0;
await page.evaluate(() => doRefund(0));
await page.waitForTimeout(9000);

const asked = askedText();
R.ok('перед возвратом спросили подтверждение', asked.length > 20, asked.slice(0, 80));
R.ok('в вопросе названа сумма и кошелёк', /12\.34/.test(asked) && /0x77aa/i.test(asked), asked.slice(0, 90));
R.ok('ЧЕСТНО СКАЗАНО, ЧТО БОНУСЫ ОСТАНУТСЯ И МАГАЗИН НЕ УЗНАЕТ',
  /бонусы[\s\S]*останутся/i.test(asked) && /не узнает/i.test(asked), asked.slice(-140));

const iTransfer = new E.utils.Interface(['function transfer(address,uint256) returns (bool)']);
const iRefund   = new E.utils.Interface(['function refund(bytes32 invoice, uint256 amount)']);
const tr = state.sent.find(tx => tx.data.startsWith(iTransfer.getSighash('transfer')));
R.ok('на старом контракте вернули обычным переводом', !!tr,
  state.sent.map(tx => tx.data.slice(0, 10)).join(','));
const trArgs = tr ? iTransfer.decodeFunctionData('transfer', tr.data) : null;
R.ok('ДЕНЬГИ УШЛИ ИМЕННО ПОКУПАТЕЛЮ',
  !!trArgs && trArgs[0].toLowerCase() === BUYER.toLowerCase(), trArgs ? trArgs[0] : '—');
R.ok('вернули ровно то, что он заплатил',
  !!trArgs && trArgs[1].toString() === '12340000', trArgs ? trArgs[1].toString() : '—');
R.ok('контракт оплаты при этом не звали',
  !state.sent.some(tx => tx.data.startsWith(iRefund.getSighash('refund'))));

// ================= вторая версия: возврат через контракт =================
await page.evaluate(() => { payVersionCache = null; });
state.payVersion = 2;
state.sent.length = 0;
dialogs.length = 0;
await page.evaluate(() => loadIncoming());
await page.waitForTimeout(2000);
await page.evaluate(() => doRefund(0));
await page.waitForTimeout(12000);

const asked2 = askedText();
R.ok('на новом контракте предупреждение другое — про отмену бонусов',
  /отменит бонусы/i.test(asked2), asked2.slice(-140));

const rf = state.sent.find(tx => tx.data.startsWith(iRefund.getSighash('refund')));
R.ok('ВОЗВРАТ ПОШЁЛ ЧЕРЕЗ КОНТРАКТ', !!rf, state.sent.map(tx => tx.data.slice(0, 10)).join(','));
const rfArgs = rf ? iRefund.decodeFunctionData('refund', rf.data) : null;
R.ok('возврат по тому самому счёту',
  !!rfArgs && rfArgs[0].toLowerCase() === INV, rfArgs ? rfArgs[0] : '—');
R.ok('сумма возврата верна',
  !!rfArgs && rfArgs[1].toString() === '12340000', rfArgs ? rfArgs[1].toString() : '—');

const iApprove = new E.utils.Interface(['function approve(address spender, uint256 value) returns (bool)']);
const ap = state.sent.find(tx => tx.data.startsWith(iApprove.getSighash('approve')));
R.ok('разрешение выдано контракту оплаты', !!ap);
const apArgs = ap ? iApprove.decodeFunctionData('approve', ap.data) : null;
R.ok('РАЗРЕШЕНИЕ РОВНО НА СУММУ ВОЗВРАТА, НЕ БЕССРОЧНОЕ',
  !!apArgs && apArgs[1].toString() === '12340000', apArgs ? apArgs[1].toString() : '—');
R.ok('разрешение выдано именно контракту оплаты',
  !!apArgs && apArgs[0].toLowerCase() === ADDR.pay.toLowerCase(), apArgs ? apArgs[0] : '—');

// ================= покупателю полка поступлений не нужна =================
await page.evaluate(() => { userRole = 'buyer'; renderWalletState(); });
await page.waitForTimeout(400);
R.ok('покупателю поступления не показываются',
  await page.evaluate(() => document.getElementById('incomingPanel').classList.contains('hidden')));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
