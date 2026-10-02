/* Обмен монет в NoN Wallet (KyberSwap, комиссия 0,5%).

   Проверяется то, что стоит денег:
   — комиссия ровно 0,5% и ровно на наш кошелёк — и в запросе, и в готовой
     операции;
   — ответ агрегатора с подменой (чужой получатель, чужая комиссия, другой
     маршрутизатор, другая сумма, нулевой минимум) не подписывается;
   — разрешение на монету — ровно на сумму обмена и ровно маршрутизатору;
   — обмен BNB уходит с value = сумме, без разрешения;
   — курс, упавший при подтверждении, молча не меняется;
   — совсем плохой курс (>10% потерь) обменять не даёт;
   — кнопки нет в тестовой сети и в других сетях. */
import { createRequire } from 'node:module';
import { boot, reporter, answerConfirm } from './boot.mjs';
import { start, state } from './mocknode.mjs';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');

const ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
const FEE_TO = '0x73BBCD23735257660A9f6BE57d057dC4A2ABf432';
const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const IFACE = new E.utils.Interface([
  'function swap((address callTarget,address approveTarget,bytes targetData,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution) payable returns (uint256,uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
]);

await start(8566);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', rpc: 'http://localhost:8566' });
const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, other: 100 };
state.allowance = 0;

/* ---------- поддельный агрегатор ---------- */
const RATE = { 'usdt>bnb': 0.0013, 'bnb>usdt': 765, 'usdt>usdc': 0.999, 'usdc>usdt': 0.999 };
const PRICE = { [USDT.toLowerCase()]: 1, [NATIVE.toLowerCase()]: 770, '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 1 };
const sym = a => a.toLowerCase() === NATIVE.toLowerCase() ? 'bnb' : a.toLowerCase() === USDT.toLowerCase() ? 'usdt' : 'usdc';
let mode = 'ok', rateMul = 1, rateMulNext = null;
const asked = [], builds = [];
await page.route('https://aggregator-api.kyberswap.com/**', async route => {
  const req = route.request();
  const u = new URL(req.url());
  if (u.pathname.endsWith('/routes')){
    const q = Object.fromEntries(u.searchParams);
    asked.push({ q, clientId: req.headers()['x-client-id'] });
    const inN = Number(E.utils.formatUnits(q.amountIn, 18));
    let mul = rateMul;
    if (rateMulNext !== null && asked.length > 1){ mul = rateMulNext; }
    const outN = inN * RATE[sym(q.tokenIn) + '>' + sym(q.tokenOut)] * mul;
    const out = E.utils.parseUnits(outN.toFixed(12), 18).toString();
    const inUsd = inN * PRICE[q.tokenIn.toLowerCase()];
    const outUsd = outN * PRICE[q.tokenOut.toLowerCase()];
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: 0, message: 'successfully', data: { routerAddress: mode === 'badQuoteRouter' ? '0x' + '9'.repeat(40) : ROUTER,
        routeSummary: { tokenIn: q.tokenIn, amountIn: q.amountIn, amountInUsd: String(inUsd), tokenOut: q.tokenOut, amountOut: out,
          amountOutUsd: String(outUsd), gas: '400000', gasPrice: '50000000', gasUsd: '0.02',
          extraFee: { feeAmount: q.feeAmount, chargeFeeBy: q.chargeFeeBy, isInBps: q.isInBps === 'true', feeReceiver: q.feeReceiver },
          route: [], routeID: 'r1', checksum: 'c', timestamp: String(Date.now()) } } }) });
  }
  if (u.pathname.endsWith('/route/build')){
    const b = JSON.parse(req.postData());
    builds.push(b);
    const rs = b.routeSummary;
    const native = rs.tokenIn.toLowerCase() === NATIVE.toLowerCase();
    const desc = { srcToken: rs.tokenIn, dstToken: rs.tokenOut, srcReceivers: [], srcAmounts: [],
      feeReceivers: [FEE_TO], feeAmounts: ['50'], dstReceiver: b.recipient, amount: rs.amountIn,
      minReturnAmount: E.BigNumber.from(rs.amountOut).mul(99).div(100).toString(), flags: 0, permit: '0x' };
    let router = ROUTER, value = native ? rs.amountIn : '0';
    if (mode === 'evilReceiver') desc.dstReceiver = '0x' + '6'.repeat(40);
    if (mode === 'evilFeeTo') desc.feeReceivers = ['0x' + '7'.repeat(40)];
    if (mode === 'evilFeeBig') desc.feeAmounts = ['500'];
    if (mode === 'evilExtraFee'){ desc.feeReceivers = [FEE_TO, '0x' + '7'.repeat(40)]; desc.feeAmounts = ['50', '50']; }
    if (mode === 'evilRouter') router = '0x' + '8'.repeat(40);
    if (mode === 'evilAmount') desc.amount = E.BigNumber.from(rs.amountIn).mul(2).toString();
    if (mode === 'evilMin') desc.minReturnAmount = '0';
    if (mode === 'evilValue') value = E.BigNumber.from(rs.amountIn).add(1).toString();
    if (mode === 'evilToken') desc.dstToken = '0x' + '5'.repeat(40);
    const data = IFACE.encodeFunctionData('swap', [{ callTarget: '0x' + '1'.repeat(40), approveTarget: '0x' + '0'.repeat(40), targetData: '0x1234',
      desc, clientData: '0x' }]);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: 0, message: 'successfully', data: { amountIn: rs.amountIn, amountOut: rs.amountOut, gas: '400000', gasUsd: '0.02',
        data, routerAddress: router, transactionValue: value } }) });
  }
  route.fulfill({ status: 404, body: '{}' });
});

const vis = id => page.evaluate(i => { const el = document.getElementById(i); return !!el && !el.classList.contains('hidden'); }, id);
await page.evaluate(() => { network = 'bnb'; renderWalletState(); });
R.ok('КНОПКА «ОБМЕН» ЕСТЬ В ОСНОВНОЙ СЕТИ BNB', await vis('quickSwap'));

async function quote(from, to, amount){
  await page.evaluate(([f, tt]) => { openSwap(f); document.getElementById('swapTo').value = tt; swapPick('to'); }, [from, to]);
  await page.fill('#swapAmount', String(amount));
  await page.evaluate(() => swapInput());
  await page.waitForFunction(() => !document.getElementById('swapQuoteBox').classList.contains('hidden') || !document.getElementById('swapWarn').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
}

R.ok('TVR (баллы) В ОБМЕНЕ НЕТ — только BNB и монеты с ценой', await page.evaluate(() => { const k = Object.keys(swapTokens()); return !k.includes('TVR') && k.includes('BNB') && k.includes('USDT') && k.includes('USDC'); }), await page.evaluate(() => Object.keys(swapTokens()).join(',')));

/* ---------- 1. котировка ---------- */
await quote('USDT', 'BNB', 10);
const q1 = asked[asked.length - 1];
R.ok('ЗАПРОС КУРСА: КОМИССИЯ 50 bps (0,5%) НА НАШ КОШЕЛЁК', q1 && q1.q.feeAmount === '50' && q1.q.isInBps === 'true' && q1.q.feeReceiver === FEE_TO, JSON.stringify(q1 && q1.q));
R.ok('комиссия берётся долларами (USDT → BNB: с того, что отдают)', q1.q.chargeFeeBy === 'currency_in');
R.ok('запрос подписан именем приложения (x-client-id)', q1.clientId === 'NoNWallet');
R.ok('сумма в единицах монеты: 10 USDT = 10e18', q1.q.amountIn === '10000000000000000000');
R.ok('на экране — получите ≈ 0.013 BNB, курс, минимум, 0,5%', /0\.013/.test(await page.textContent('#swapOut')) && /1 USDT ≈/.test(await page.textContent('#swapRate')) && /BNB/.test(await page.textContent('#swapMin')) && /0,5%/.test(await page.textContent('#swapQuoteBox')), (await page.textContent('#swapOut')) + ' | ' + (await page.textContent('#swapRate')));
R.ok('кнопка «Обменять» доступна', await page.evaluate(() => !document.getElementById('swapBtn').disabled));

/* ---------- 2. обмен USDT → BNB ---------- */
state.sent.length = 0;
page.evaluate(() => doSwap());
await answerConfirm(page);
await page.waitForFunction(() => !document.getElementById('swapInfo').classList.contains('hidden') || !document.getElementById('swapWarn').classList.contains('hidden'), null, { timeout: 20000 }).catch(() => {});
const info = await page.textContent('#swapInfo');
R.ok('ОБМЕН ВЫПОЛНЕН — «Готово» и ссылка на операцию', /Готово/.test(info) && /bscscan\.com\/tx\/0x/.test(info), info + ' | warn: ' + await page.textContent('#swapWarn'));
const ap = state.sent.find(t => t.data.slice(0, 10) === IFACE.getSighash('approve'));
const apArgs = ap && IFACE.decodeFunctionData('approve', ap.data);
R.ok('РАЗРЕШЕНИЕ — РОВНО 10 USDT И РОВНО МАРШРУТИЗАТОРУ', ap && ap.to.toLowerCase() === USDT.toLowerCase() && apArgs[0].toLowerCase() === ROUTER.toLowerCase() && apArgs[1].toString() === '10000000000000000000');
const sw = state.sent.find(t => t.to && t.to.toLowerCase() === ROUTER.toLowerCase());
R.ok('операция обмена ушла на маршрутизатор KyberSwap, value = 0', sw && sw.value === '0');
const dec = sw && IFACE.decodeFunctionData('swap', sw.data)[0].desc;
R.ok('в операции: результат — этому кошельку, комиссия 50 bps — нашему', dec && dec.dstReceiver.toLowerCase() === me.toLowerCase() && dec.feeReceivers[0] === FEE_TO && dec.feeAmounts[0].toString() === '50');
const lb = builds[builds.length - 1];
R.ok('сборка: отправитель и получатель — этот кошелёк, проскальзывание 1%', lb.sender === me && lb.recipient === me && lb.slippageTolerance === 100);
R.ok('перед сборкой курс запрошен заново (свежий маршрут)', asked.length >= 2);

/* ---------- 3. подмены в ответе агрегатора ---------- */
for (const [m, name] of [['evilReceiver', 'результат уходит чужому'], ['evilFeeTo', 'комиссия — на чужой кошелёк'], ['evilFeeBig', 'комиссия 5% вместо 0,5%'],
                         ['evilExtraFee', 'вторая, чужая комиссия'], ['evilRouter', 'другой маршрутизатор'], ['evilAmount', 'списать вдвое больше'],
                         ['evilMin', 'нулевой минимум (любой курс)'], ['evilToken', 'другая монета на выходе']]){
  mode = m;
  await quote('USDT', 'BNB', 5);
  state.sent.length = 0;
  page.evaluate(() => doSwap());
  await answerConfirm(page);
  await page.waitForFunction(() => !document.getElementById('swapWarn').classList.contains('hidden') || !document.getElementById('swapInfo').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
  const w = await page.textContent('#swapWarn');
  R.ok('ПОДМЕНА «' + name + '» — НЕ ПОДПИСАНО, НИЧЕГО НЕ УШЛО', state.sent.length === 0 && /не прошёл проверку/.test(w), w);
}
mode = 'ok';

/* ---------- 4. BNB → USDT ---------- */
await quote('BNB', 'USDT', 0.01);
const q2 = asked[asked.length - 1];
R.ok('BNB → USDT: комиссия берётся долларами с результата (currency_out)', q2.q.chargeFeeBy === 'currency_out' && q2.q.tokenIn === NATIVE);
state.sent.length = 0;
page.evaluate(() => doSwap());
await answerConfirm(page);
await page.waitForFunction(() => (!document.getElementById('swapInfo').classList.contains('hidden') && /Готово/.test(document.getElementById('swapInfo').textContent)) || !document.getElementById('swapWarn').classList.contains('hidden'), null, { timeout: 20000 }).catch(() => {});
const sw2 = state.sent.find(t => t.to && t.to.toLowerCase() === ROUTER.toLowerCase());
R.ok('ОБМЕН BNB: value = 0.01 BNB, разрешения нет', sw2 && sw2.value === '10000000000000000' && !state.sent.some(t => t.data.slice(0, 10) === IFACE.getSighash('approve')), JSON.stringify(state.sent.map(t => [t.to, t.value, t.data.slice(0,10)])) + ' warn: ' + await page.textContent('#swapWarn') + ' info: ' + await page.textContent('#swapInfo'));
mode = 'evilValue';
await quote('BNB', 'USDT', 0.01);
state.sent.length = 0;
page.evaluate(() => doSwap());
await answerConfirm(page);
await page.waitForFunction(() => !document.getElementById('swapWarn').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
R.ok('подмена суммы BNB в value — не подписано', state.sent.length === 0 && /не прошёл проверку/.test(await page.textContent('#swapWarn')));
mode = 'ok';

/* ---------- 5. курс упал, пока подтверждали ---------- */
await quote('USDT', 'BNB', 10);
rateMulNext = 0.95;
const askedBefore = asked.length;
state.sent.length = 0;
page.evaluate(() => doSwap());
await answerConfirm(page);
await page.waitForFunction(() => !document.getElementById('swapWarn').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
R.ok('КУРС УПАЛ НА 5% ПРИ ПОДТВЕРЖДЕНИИ — НЕ МЕНЯЕМ, ПОКАЗЫВАЕМ НОВЫЙ', state.sent.length === 0 && /Курс изменился/.test(await page.textContent('#swapWarn')) && asked.length > askedBefore);
rateMulNext = null;

/* ---------- 6. грабительский курс ---------- */
rateMul = 0.8;
await quote('USDT', 'BNB', 10);
R.ok('ПОТЕРИ ~20% — ОБМЕН НЕ ДАЁМ, ОБЪЯСНЯЕМ', await page.evaluate(() => document.getElementById('swapBtn').disabled) && /Слишком невыгодный/.test(await page.textContent('#swapWarn')), await page.textContent('#swapWarn'));
rateMul = 0.96;
await quote('USDT', 'BNB', 10);
R.ok('потери ~4% — предупреждаем, но даём', await page.evaluate(() => !document.getElementById('swapBtn').disabled) && /Невыгодный курс/.test(await page.textContent('#swapWarn')));
rateMul = 1;

/* ---------- 7. подменённый адрес маршрутизатора уже в котировке ---------- */
mode = 'badQuoteRouter';
await quote('USDT', 'BNB', 10);
R.ok('котировка с чужим маршрутизатором — не показываем и не даём менять', await page.evaluate(() => document.getElementById('swapBtn').disabled) && /неизвестный адрес/.test(await page.textContent('#swapWarn')));
mode = 'ok';

/* ---------- 8. не хватает монет ---------- */
await quote('USDT', 'BNB', 500);
state.sent.length = 0;
await page.evaluate(() => doSwap());
await page.waitForTimeout(500);
R.ok('БОЛЬШЕ, ЧЕМ НА КОШЕЛЬКЕ, — ОТКАЗ ДО ПОДПИСИ', state.sent.length === 0 && /меньше, чем вы хотите/.test(await page.textContent('#swapWarn')));

/* ---------- 9. «Всё» у BNB оставляет на комиссию ---------- */
await page.evaluate(() => { document.getElementById('swapFrom').value = 'BNB'; swapPick('from'); });
await page.evaluate(() => swapMax());
await page.waitForTimeout(400);
R.ok('«ВСЁ» ДЛЯ BNB — ОСТАВЛЯЕТ 0.0015 НА КОМИССИЮ СЕТИ', Math.abs(Number(await page.inputValue('#swapAmount')) - 0.9985) < 1e-9, await page.inputValue('#swapAmount'));
await page.evaluate(() => closeSwap());

/* ---------- 9b. кабинет партнёра в приложении ---------- */
await page.route('**/api/v1/partners/**', route => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ partner: me.toLowerCase(), merchants: [{ merchant: '0x' + '4'.repeat(40), active: true, earned: { USDT: '1.25' } }, { merchant: '0x' + '5'.repeat(40), active: false, earned: {} }],
    earned: { USDT: '1.25' }, payments: 3, share_bps: 2000, period_days: 365 }) }));
await page.evaluate(() => loadRefStats(true));
await page.waitForTimeout(500);
R.ok('КАБИНЕТ ПАРТНЁРА: привёл 2, доля идёт от 1, заработано 1.25 USDT', (await page.textContent('#refStatN')) === '2' && (await page.textContent('#refStatActive')) === '1' && /1\.25 USDT/.test(await page.textContent('#refStatEarned')) && /срок вышел/.test(await page.textContent('#refStatList')), await page.textContent('#refStatEarned'));
R.ok('ссылка партнёра — страница приглашения для любого кошелька', await page.evaluate(() => refLink()) === 'https://wallet.tavarov.com/ref?by=' + me);

/* ---------- 10. языки и где кнопки нет ---------- */
await page.evaluate(() => { setLang('en'); });
R.ok('по-английски: «Swap»', /Swap/.test(await page.textContent('#quickSwap')));
await page.evaluate(() => { setLang('ru'); network = 'polygon'; renderWalletState(); });
R.ok('В ДРУГОЙ СЕТИ (Polygon) КНОПКИ НЕТ', !(await vis('quickSwap')));
await page.evaluate(() => { network = 'bnb'; localStorage.setItem('tavarov.testnet.v1', '1'); renderWalletState(); });
R.ok('в тестовой сети кнопки нет', !(await vis('quickSwap')));

await browser.close();
process.exit(R.done(errors.filter(e => !/aggregator-api|favicon|coingecko|ERR_|Failed to load resource/.test(e))) ? 0 : 1);
