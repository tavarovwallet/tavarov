/* Обмен между сетями через Relay (1 октября 2026).

   Проверяется: в окне обмена можно выбрать сеть получения; котировка —
   с нашей комиссией 0,5% (appFees) на кошелёк развития и на свой же адрес
   в той сети; разрешение — ровно на сумму и только хранилищу Relay;
   подмены в ответе (чужой получатель, чужой вкладчик, чужое хранилище,
   больше суммы) не подписываются; невыгодный курс (как 1,1 → 0,94 USDC
   в Ethereum) не даёт обменять; из Solana — только программа Relay,
   подпись вписана, отправлено одно. */
import { createRequire } from 'node:module';
import { boot, reporter, answerConfirm } from './boot.mjs';
import { start, state } from './mocknode.mjs';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');

const DEPO = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
const ROUTER = '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';
const FEE_TO = '0x73BBCD23735257660A9f6BE57d057dC4A2ABf432';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RELAY_SOL = '99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2';
await start(8597);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', rpc: 'http://localhost:8597' });
const me = await page.evaluate(() => wallet.evm.address);
const meSol = await page.evaluate(() => wallet.solana.address);
state.balances[me.toLowerCase()] = { native: 1, other: 100 };
state.allowance = 0;
const vis = id => page.evaluate(i => { const el = document.getElementById(i); return !!el && !el.classList.contains('hidden') && !el.closest('.hidden'); }, id);

// ---------- поддельный Relay ----------
let mode = 'ok', status = 'success';
const quotes = [];
const w = v => BigInt(v).toString(16).padStart(64, '0');
const wa = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
await page.route('https://api.relay.link/**', async route => {
  const req = route.request(); const u = new URL(req.url());
  const json = o => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (u.pathname === '/intents/status') return json({ status });
  const b = JSON.parse(req.postData()); quotes.push(b);
  const rid = '0x' + 'ab'.repeat(32);
  if (b.originChainId === 792703809){
    const ix = { programId: mode === 'solEvil' ? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' : RELAY_SOL,
      keys: [{ pubkey: b.user, isSigner: true, isWritable: true }, { pubkey: 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU', isSigner: false, isWritable: true }],
      data: '0b9c60da27a3b413002d' };
    return json({ details: { recipient: b.recipient, currencyIn: { amount: b.amount, amountUsd: '20' }, currencyOut: { amount: '19770000000000000000', minimumAmount: '19700000000000000000', amountUsd: '19.77' } },
      fees: { gas: { amountUsd: '0.01' }, relayer: { amountUsd: '0.1' } },
      steps: [{ id: 'deposit', requestId: rid, items: [{ data: { instructions: [ix], addressLookupTableAddresses: [] } }] }] });
  }
  const native = /^0x0{40}$/.test(b.originCurrency);
  let depositor = b.user, depo = DEPO, amount = b.amount, spender = DEPO, recipient = b.recipient;
  if (mode === 'evilRecipient') recipient = '0x' + '6'.repeat(40);
  if (mode === 'evilDepositor') depositor = '0x' + '7'.repeat(40);
  if (mode === 'evilDepo') depo = '0x' + '8'.repeat(40);
  if (mode === 'evilSpender') spender = '0x' + '9'.repeat(40);
  if (mode === 'evilAmount') amount = (BigInt(b.amount) * 2n).toString();
  if (mode === 'router' || mode === 'routerValue' || mode === 'routerErc20') depo = ROUTER;
  const steps = [];
  if (!native) steps.push({ id: 'approve', requestId: rid, items: [{ data: { chainId: b.originChainId, to: b.originCurrency, value: '0', data: '0x095ea7b3' + wa(spender) + w(amount) } }] });
  if ((mode === 'router' || mode === 'routerValue') && native){
    steps.push({ id: 'deposit', requestId: rid, items: [{ data: { chainId: b.originChainId, to: ROUTER, value: mode === 'routerValue' ? (BigInt(amount) * 2n).toString() : amount, data: '0xcd6e13f7' + 'cd'.repeat(200) } }] });
  } else
  steps.push({ id: 'deposit', requestId: rid, items: [{ data: { chainId: b.originChainId, to: depo, value: native ? amount : '0',
    data: native ? '0x49290c1c' + wa(depositor) + 'ab'.repeat(32) : '0xe8017952' + wa(depositor) + wa(b.originCurrency) + w(amount) + 'ab'.repeat(32) } }] });
  const outUsd = mode === 'lossy' ? '0.94' : '19.80';
  const inUsd = mode === 'lossy' ? '1.10' : '20';
  return json({ details: { recipient, currencyIn: { amount: b.amount, amountUsd: inUsd }, currencyOut: { amount: mode === 'lossy' ? '940376' : '19800000', minimumAmount: '19700000', amountUsd: outUsd } },
    fees: { gas: { amountUsd: '0.03' }, relayer: { amountUsd: '0.05' }, app: { amountUsd: '0.1' } }, steps });
});

async function quote(from, toNet, to, amount){
  await page.evaluate(([f, n, tt]) => { openSwap(f); document.getElementById('swapToNet').value = n; swapPickNet(); document.getElementById('swapTo').value = tt; swapPick('to'); }, [from, toNet, to]);
  await page.fill('#swapAmount', String(amount));
  await page.evaluate(() => swapInput());
  await page.waitForFunction(() => !document.getElementById('swapQuoteBox').classList.contains('hidden') || !document.getElementById('swapWarn').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
}
async function run(){
  state.sent.length = 0;
  page.evaluate(() => doSwap());
  await answerConfirm(page, 'testpassword1', 4000);
  await page.waitForFunction(() => !swapState.busy && (!document.getElementById('swapWarn').classList.contains('hidden') || /Готово|Мост/.test(document.getElementById('swapInfo').textContent)), null, { timeout: 25000 }).catch(() => {});
  return { warn: await page.textContent('#swapWarn'), info: await page.textContent('#swapInfo') };
}

await page.evaluate(() => switchNetwork('bnb'));
await page.evaluate(() => openSwap('USDT'));
const nets = await page.$$eval('#swapToNet option', o => o.map(x => x.textContent));
R.ok('В ОКНЕ ОБМЕНА — ВЫБОР СЕТИ ПОЛУЧЕНИЯ', JSON.stringify(nets) === '["BNB Chain","Ethereum","Base","Solana"]', nets.join(','));
await quote('USDT', 'base', 'USDC', 20);
const q = quotes[quotes.length - 1];
R.ok('котировка: из BNB в Base, на свой же адрес, 20 USDT', q && q.originChainId === 56 && q.destinationChainId === 8453 && q.recipient === me && q.user === me && q.originCurrency === USDT && q.destinationCurrency === BASE_USDC && q.amount === '20000000000000000000', JSON.stringify(q).slice(0, 200));
R.ok('НАША КОМИССИЯ 0,5% — НА КОШЕЛЁК РАЗВИТИЯ', q && q.appFees && q.appFees[0].recipient === FEE_TO && q.appFees[0].fee === '50');
R.ok('без поля referrer (с ним Relay отвечает 401 «нужен ключ API»)', q && !('referrer' in q), JSON.stringify(q).slice(0, 120));
R.ok('показано: ≈ 19,8 USDC в Base, «Комиссия сети и моста»', /19[.,]8/.test(await page.textContent('#swapOut')) && /Base/.test(await page.textContent('#swapRate')) && /моста/.test(await page.textContent('#swapGasLbl')), await page.textContent('#swapOut') + ' | ' + await page.textContent('#swapRate'));
let r = await run();
const ap = state.sent.find(t => t.data && t.data.startsWith('0x095ea7b3'));
const dp = state.sent.find(t => t.to && t.to.toLowerCase() === DEPO);
R.ok('ОБМЕН МЕЖДУ СЕТЯМИ ВЫПОЛНЕН — «пришли в сети Base»', /Монеты пришли в сети Base/.test(r.info), r.info + ' | ' + r.warn);
R.ok('разрешение — ровно 20 USDT и только хранилищу Relay', ap && ap.to.toLowerCase() === USDT.toLowerCase() && ap.data.slice(34, 74) === DEPO.slice(2) && BigInt('0x' + ap.data.slice(74, 138)) === 20000000000000000000n);
R.ok('вклад в хранилище Relay от этого кошелька', dp && dp.data.startsWith('0xe8017952') && dp.data.slice(34, 74) === me.toLowerCase().slice(2) && dp.value === '0');
R.ok('после отправки второй раз нажать нельзя (котировка снята)', await page.evaluate(() => swapState.quote === null && document.getElementById('swapBtn').disabled));

for (const [m, name] of [['evilRecipient', 'получатель — чужой адрес'], ['evilDepositor', 'вкладчик — чужой'], ['evilDepo', 'не хранилище Relay'],
                         ['evilSpender', 'разрешение чужому'], ['evilAmount', 'вдвое больше суммы']]){
  mode = m;
  await quote('USDT', 'base', 'USDC', 5);
  r = await run();
  R.ok('ПОДМЕНА «' + name + '» — НИЧЕГО НЕ УШЛО', state.sent.length === 0 && (r.warn.length > 0), r.warn);
}
mode = 'lossy';
await quote('USDT', 'eth', 'USDC', 1.1);
R.ok('1,1 → 0,94 (потери ~14%) — обменять не даёт', await page.evaluate(() => document.getElementById('swapBtn').disabled) && /невыгодн/i.test(await page.textContent('#swapWarn')) && /побольше/.test(await page.textContent('#swapWarn')), await page.textContent('#swapWarn'));
mode = 'ok'; status = 'refund';
await quote('BNB', 'eth', 'ETH', 0.01);
r = await run();
const dn = state.sent.find(t => t.to && t.to.toLowerCase() === DEPO);
R.ok('BNB → ETH: вклад монетой сети, value = сумме, без разрешения', dn && dn.data.startsWith('0x49290c1c') && dn.value === '10000000000000000' && !state.sent.some(t => t.data && t.data.startsWith('0x095ea7b3')));
R.ok('мост вернул — честно сказано про возврат', /возвращает монеты/.test(r.warn), r.warn);
status = 'success';
mode = 'router';
await quote('BNB', 'base', 'ETH', 0.01);
r = await run();
const rt = state.sent.find(t => t.to && t.to.toLowerCase() === ROUTER);
R.ok('монета сети через RelayRouterV3 (набор вызовов не проверить) — ничего не ушло', !rt && state.sent.length === 0 && /depository/.test(r.warn), r.info + ' | ' + r.warn);
mode = 'routerValue';
await quote('BNB', 'base', 'ETH', 0.01);
r = await run();
R.ok('через роутер, но value вдвое больше — ничего не ушло', state.sent.length === 0 && /depository|value/.test(r.warn), r.warn);
mode = 'routerErc20';
await quote('USDT', 'base', 'USDC', 5);
r = await run();
R.ok('токен через роутер (не хранилище) — ничего не ушло', !state.sent.some(t => t.to && t.to.toLowerCase() === ROUTER) && /depository/.test(r.warn), r.warn);
mode = 'ok';

// ---------- из Solana ----------
const SOLRPC = 'https://sol.mock/rpc';
await page.evaluate(url => { MAINNET.solana.rpc = url; MAINNET.solana.rpcs = [url]; }, SOLRPC);
await page.evaluate(() => { closeSwap(); switchNetwork('solana'); });
const S = { lamports: 500_000_000n, sent: [] };
await page.route(SOLRPC, async route => {
  const qq = route.request().postDataJSON();
  const ok = result => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: qq.id, result }) });
  switch (qq.method){
    case 'getBalance': return ok({ value: Number(S.lamports) });
    case 'getLatestBlockhash': return ok({ value: { blockhash: '9HTCXxaceMEAdwwUBuSyVHbS7iN14iH4UndyZ89J7qGi', lastValidBlockHeight: 1 } });
    case 'getMultipleAccounts': return ok({ value: [{ lamports: Number(S.lamports), data: ['', 'base64'] }] });
    case 'simulateTransaction': return ok({ value: { err: null, accounts: [{ lamports: Number(S.lamports - 100_000_000n - 5000n), data: ['', 'base64'] }] } });
    case 'sendTransaction': S.sent.push(qq.params[0]); return ok('5'.repeat(88));
    default: return ok({ value: null });
  }
});
quotes.length = 0;
await quote('SOL', 'bnb', 'USDT', 0.1);
const qs = quotes[quotes.length - 1];
R.ok('SOLANA → BNB: из Solana на свой адрес в BNB', qs && qs.originChainId === 792703809 && qs.destinationChainId === 56 && qs.user === meSol && qs.recipient === me && qs.originCurrency === '11111111111111111111111111111111', JSON.stringify(qs).slice(0, 200));
r = await run();
const raw = S.sent.length ? Buffer.from(S.sent[0], 'base64') : Buffer.alloc(0);
R.ok('отправлена одна операция с подписью', S.sent.length === 1 && raw[0] === 1 && raw.slice(1, 65).some(x => x !== 0) && /пришли в сети BNB/.test(r.info), r.info + ' | ' + r.warn);
const keys = []; { let o = 65 + 3; const nk = raw[o++]; for (let i = 0; i < nk; i++){ keys.push(SOL.b58enc(raw.slice(o, o + 32))); o += 32; } }
R.ok('в операции — программа Relay, плательщик — этот кошелёк', keys[0] === meSol && keys.includes(RELAY_SOL), keys.join(' ').slice(0, 120));
mode = 'solEvil';
await quote('SOL', 'bnb', 'USDT', 0.1);
r = await run();
R.ok('из Solana с чужой программой — не подписано', S.sent.length === 1 && /program/.test(r.warn), r.warn);

const own = errors.filter(e => !/Failed to load resource|ERR_|net::|503|relay\.link|sol\.mock/.test(e));
R.ok('ошибок в коде страницы нет', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
