/* Обмен в Ethereum, Base и Solana (1 октября 2026).

   EVM: тот же KyberSwap, но свой адрес сервиса на каждую сеть, монета сети
   своя (ETH), комиссия 0,5% на наш кошелёк. Solana: Jupiter; комиссия на
   счёт кошелька развития в долларовой монете пары; операция разбирается и
   прогоняется вхолостую до подписи — подмена (разрешение на списание,
   чужой плательщик, без комиссии, меньше обещанного) не подписывается. */
import { boot, reporter, answerConfirm } from './boot.mjs';
import { start } from './mocknode.mjs';
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');
await start(8593);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', rpc: 'http://localhost:8593' });
const wait = ms => page.waitForTimeout(ms);
const vis = id => page.evaluate(i => { const el = document.getElementById(i); return !!el && !el.classList.contains('hidden') && !el.closest('.hidden'); }, id);

const FEE_TO = '0x73BBCD23735257660A9f6BE57d057dC4A2ABf432';
const TREASURY = 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const WSOL = 'So11111111111111111111111111111111111111112';
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', SYSTEM = '11111111111111111111111111111111', BUDGET = 'ComputeBudget111111111111111111111111111111';
const ataOf = async (o, m) => SOL.b58enc(await SOL.ata(SOL.b58dec(o, 32), SOL.b58dec(m, 32)));
const FEE_USDC = await ataOf(TREASURY, USDC);

// ===================== EVM =====================
const kyber = [];
await page.route('https://aggregator-api.kyberswap.com/**', route => {
  const u = new URL(route.request().url());
  kyber.push(u.pathname + '?' + u.searchParams.toString());
  const q = Object.fromEntries(u.searchParams);
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ code: 0, data: { routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      routeSummary: { amountIn: q.amountIn, amountOut: '2690000', amountInUsd: '27', amountOutUsd: '26.9', gasUsd: '0.4' } } }) });
});
for (const [net, slug, toks] of [['eth', 'ethereum', 'ETH,USDT,USDC'], ['base', 'base', 'ETH,USDC']]){
  await page.evaluate(n => switchNetwork(n), net); await wait(200);
  const st = await page.evaluate(() => ({ ok: swapAvailable(), toks: Object.keys(swapTokens()).join(','), api: swapApi() }));
  R.ok(net + ': обмен есть, монеты ' + toks, st.ok && st.toks === toks && st.api === 'https://aggregator-api.kyberswap.com/' + slug + '/api/v1', JSON.stringify(st));
  R.ok(net + ': кнопка «Обмен» на главном', await vis('quickSwap'));
  kyber.length = 0;
  await page.evaluate(() => openSwap('ETH'));
  await page.selectOption('#swapTo', 'USDC');
  await page.fill('#swapAmount', '0.01'); await page.evaluate(() => swapInput());
  await page.waitForFunction(() => !document.getElementById('swapQuoteBox').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
  const req = kyber.find(x => /\/routes\?/.test(x)) || '';
  R.ok(net + ': курс у KyberSwap ' + slug + ', комиссия 0,5% на наш кошелёк', req.startsWith('/' + slug + '/api/v1/routes?') && /feeAmount=50/.test(req) && req.includes('feeReceiver=' + FEE_TO) && /tokenIn=0xEeee/i.test(req), req.slice(0, 160));
  R.ok(net + ': показан курс и сумма', (await page.textContent('#swapOut')).replace(',', '.').includes('2.69'), await page.textContent('#swapOut'));
  await page.evaluate(() => closeSwap());
}

// ===================== Solana =====================
const SOLRPC = 'https://sol.mock/rpc';
await page.evaluate(url => { MAINNET.solana.rpc = url; MAINNET.solana.rpcs = [url]; }, SOLRPC);
await page.evaluate(() => switchNetwork('solana')); await wait(300);
const ME = await page.evaluate(() => wallet.solana.address);
const MY_USDC = await ataOf(ME, USDC), MY_WSOL = await ataOf(ME, WSOL), MY_USDT = await ataOf(ME, USDT);
const tokAcc = (amount, mint, owner) => { const b = Buffer.alloc(165); SOL.b58dec(mint, 32).forEach((x, i) => b[i] = x); SOL.b58dec(owner, 32).forEach((x, i) => b[32 + i] = x); b.writeBigUInt64LE(BigInt(amount), 64); b[108] = 1; return { lamports: 2039280, owner: TOKEN, data: [b.toString('base64'), 'base64'], executable: false }; };
const S = { lamports: 500_000_000n, usdc: 3_000_000n, usdt: 7_000_000n, feeUsdc: 1_000_000n, sent: [], post: null };
const sysAcc = (l, owner) => ({ lamports: Number(l), owner: owner || SYSTEM, data: ['', 'base64'] });
S.pre = () => ({ [FEE_USDC]: tokAcc(S.feeUsdc, USDC, TREASURY), [ME]: sysAcc(S.lamports), [MY_USDC]: tokAcc(S.usdc, USDC, ME), [MY_USDT]: tokAcc(S.usdt, USDT, ME) });
await page.route(SOLRPC, async route => {
  const q = route.request().postDataJSON();
  const ok = result => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) });
  const parsed = (mint, owner, amount) => ({ value: { owner: TOKEN, lamports: 2039280, data: { program: 'spl-token', parsed: { type: 'account', info: { mint, owner, tokenAmount: { amount: String(amount), decimals: 6 } } } } } });
  switch (q.method){
    case 'getBalance': return ok({ value: Number(S.lamports) });
    case 'getAccountInfo': {
      const a = q.params[0];
      if (a === FEE_USDC) return ok(parsed(USDC, TREASURY, S.feeUsdc));
      if (a === MY_USDC) return ok(parsed(USDC, ME, S.usdc));
      return ok({ value: null });                         // USDT-счёта кошелька развития нет
    }
    case 'getMultipleAccounts': { const pre = S.pre(); return ok({ value: q.params[0].map(a => pre[a] || null) }); }
    case 'simulateTransaction': { const post = S.post(); return ok({ value: { err: null, logs: [], accounts: q.params[1].accounts.addresses.map(a => post[a] || null) } }); }
    case 'sendTransaction': S.sent.push(q.params[0]); return ok('5'.repeat(88));
    case 'getSignatureStatuses': return ok({ value: [{ confirmationStatus: 'confirmed', err: null }] });
    default: return ok(null);
  }
});
// поддельный Jupiter
let jupMode = 'ok';
const jupAsked = [];
/* Хвост инструкции route: in_amount, quoted_out_amount, slippage_bps, platform_fee_bps. */
function jupData(mode){
  /* route: 8 байт вида, вектор шагов (u32 = 1, шаг: вид пула + доля + входы),
     затем хвост. 'hidden' — настоящие доводы спрятаны, а в конец дописан
     «правильный» хвост: 19 лишних байт. */
  const hidden = mode === 'hidden';
  const b = Buffer.alloc(8 + 4 + 4 + 19 + (hidden ? 19 : 0));
  Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]).copy(b, 0);
  b.writeUInt32LE(1, 8); b[12] = 7; b[13] = 100; b[14] = 0; b[15] = 1;
  const t = 8 + 4 + 4 + (hidden ? 19 : 0);
  b.writeBigUInt64LE(100_000_000n, t);
  b.writeBigUInt64LE(mode === 'evilArgs' ? 1n : 11_643_440n, t + 8);
  b.writeUInt16LE(mode === 'evilSlip' ? 10000 : 100, t + 16);
  b[t + 18] = 50;
  return new Uint8Array(b);
}
async function buildTx(mode){
  const me = mode === 'payer' ? '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' : ME;
  const K = (a, s, w) => ({ k: SOL.b58dec(a, 32), s, w });
  const ixs = [
    { program: SOL.b58dec(BUDGET, 32), data: new Uint8Array([2, 0, 53, 12, 0]), keys: [] },
    { program: SOL.b58dec(ATA, 32), data: new Uint8Array([1]), keys: [K(me, true, true), K(MY_WSOL, false, true), K(me, false, false), K(WSOL, false, false), K(SYSTEM, false, false), K(TOKEN, false, false)] },
    { program: SOL.b58dec(SYSTEM, 32), data: new Uint8Array([2, 0, 0, 0, 0, 225, 245, 5, 0, 0, 0, 0]), keys: [K(me, true, true), K(MY_WSOL, false, true)] },
    { program: SOL.b58dec(TOKEN, 32), data: new Uint8Array([17]), keys: [K(MY_WSOL, false, true)] },
    { program: SOL.b58dec(JUP, 32), data: jupData(mode), keys: [K(me, true, false), K(MY_WSOL, false, true), K(MY_USDC, false, true), K(FEE_USDC, false, true), ...(mode === 'drain' ? [K(MY_USDT, false, true)] : [])] },
    { program: SOL.b58dec(TOKEN, 32), data: new Uint8Array([9]), keys: [K(MY_WSOL, false, true), K(me, false, true), K(me, true, false)] }
  ];
  if (mode === 'approve') ixs.push({ program: SOL.b58dec(TOKEN, 32), data: new Uint8Array([4, 1, 0, 0, 0, 0, 0, 0, 0]), keys: [K(MY_USDC, false, true), K('CttRr6et6TryhMzCgZyKk9YyXp4TWXeYBkgZUg22Bxnt', false, false), K(me, true, false)] });
  const { message } = SOL.compile(SOL.b58dec(me, 32), SOL.b58dec('9HTCXxaceMEAdwwUBuSyVHbS7iN14iH4UndyZ89J7qGi', 32), ixs);
  return Buffer.concat([Buffer.from([1]), Buffer.alloc(64), Buffer.from(message)]).toString('base64');
}
await page.route('https://lite-api.jup.ag/**', async route => {
  const u = new URL(route.request().url());
  jupAsked.push(u.pathname + '?' + u.searchParams.toString());
  const json = o => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (u.pathname.endsWith('/quote')){
    const q = Object.fromEntries(u.searchParams);
    return json({ inputMint: q.inputMint, outputMint: q.outputMint, inAmount: q.amount, outAmount: '11643440', otherAmountThreshold: '11527000',
                  swapMode: 'ExactIn', slippageBps: 100, platformFee: { amount: '58500', feeBps: 50 }, priceImpactPct: '0.001', routePlan: [] });
  }
  const body = JSON.parse(route.request().postData());
  jupAsked.push('SWAP ' + JSON.stringify({ fee: body.feeAccount, user: body.userPublicKey, legacy: body.asLegacyTransaction }));
  return json({ swapTransaction: await buildTx(jupMode) });
});
const simOk = (feeDelta, outDelta, extra) => () => Object.assign({ [FEE_USDC]: tokAcc(S.feeUsdc + BigInt(feeDelta), USDC, TREASURY), [ME]: sysAcc(S.lamports - 100_000_000n - 10_000n),
  [MY_USDC]: tokAcc(S.usdc + BigInt(outDelta), USDC, ME), [MY_USDT]: tokAcc(S.usdt, USDT, ME) }, extra || {});

const st = await page.evaluate(() => ({ ok: swapAvailable(), toks: Object.keys(swapTokens()).join(',') }));
R.ok('SOLANA: ОБМЕН ЕСТЬ — SOL, USDC, USDT', st.ok && st.toks === 'SOL,USDT,USDC' || st.toks === 'SOL,USDC,USDT', JSON.stringify(st));
const bal = await page.evaluate(async () => (await solGetBalances(wallet.solana.address)).USDC);
R.ok('остаток USDC читается', bal === 3, String(bal));

async function quote(from, to, amt){
  await page.evaluate(f => openSwap(f), from);
  await page.selectOption('#swapTo', to);
  await page.fill('#swapAmount', amt); await page.evaluate(() => swapInput());
  await wait(900);
}
await quote('SOL', 'USDT', '0.1');
R.ok('SOL → USDT: у кошелька развития нет счёта USDT — пара честно недоступна', /пока недоступен/.test(await page.textContent('#swapWarn')) && await page.evaluate(() => document.getElementById('swapBtn').disabled), await page.textContent('#swapWarn'));
await page.evaluate(() => closeSwap());
jupAsked.length = 0;
await quote('SOL', 'USDC', '0.1');
const qreq = jupAsked.find(x => /quote/.test(x)) || '';
R.ok('SOL → USDC: курс у Jupiter, комиссия 0,5%, операция старого вида', /platformFeeBps=50/.test(qreq) && /asLegacyTransaction=true/.test(qreq) && /amount=100000000/.test(qreq), qreq.slice(0, 200));
R.ok('показано ≈ 11,64 USDC', (await page.textContent('#swapOut')).replace(',', '.').includes('11.64'), await page.textContent('#swapOut'));

async function trySwap(mode, post){
  jupMode = mode; S.post = post; S.sent.length = 0; jupAsked.length = 0;
  await page.evaluate(() => { document.getElementById('swapWarn').textContent = ''; doSwap(); });
  await answerConfirm(page);
  await page.waitForFunction(() => !swapState.busy, null, { timeout: 15000 }).catch(() => {});
  await wait(300);
  return { warn: await page.textContent('#swapWarn'), info: await page.textContent('#swapInfo') };
}
let r = await trySwap('approve', simOk(58500, 11600000));
R.ok('В ОПЕРАЦИИ РАЗРЕШЕНИЕ НА СПИСАНИЕ — НЕ ПОДПИСАНО, НИЧЕГО НЕ ОТПРАВЛЕНО', S.sent.length === 0 && /token instruction/.test(r.warn), r.warn);
await quote('SOL', 'USDC', '0.1');
r = await trySwap('payer', simOk(58500, 11600000));
R.ok('чужой плательщик — не подписано', S.sent.length === 0 && /payer|signers/.test(r.warn), r.warn);
await quote('SOL', 'USDC', '0.1');
r = await trySwap('ok', simOk(0, 11600000));
R.ok('без нашей комиссии — не подписано', S.sent.length === 0 && /fee/.test(r.warn), r.warn);
await quote('SOL', 'USDC', '0.1');
r = await trySwap('ok', simOk(58500, 11000000));
R.ok('пришло бы меньше обещанного минимума — не подписано', S.sent.length === 0 && /received/.test(r.warn), r.warn);
await quote('SOL', 'USDC', '0.1');
r = await trySwap('evilArgs', simOk(58500, 11600000));
R.ok('минимум в самой инструкции Jupiter подменён — не подписано', S.sent.length === 0 && /route args/.test(r.warn), r.warn);
await quote('SOL', 'USDC', '0.1');
r = await trySwap('hidden', simOk(58500, 11600000));
R.ok('настоящие доводы спрятаны, «правильный» хвост дописан в конец — не подписано', S.sent.length === 0 && /route args/.test(r.warn), r.warn);
await quote('SOL', 'USDC', '0.1');
r = await trySwap('evilSlip', simOk(58500, 11600000));
R.ok('проскальзывание 100% в инструкции — не подписано', S.sent.length === 0 && /route args/.test(r.warn), r.warn);
await quote('SOL', 'USDC', '0.1');
r = await trySwap('drain', simOk(58500, 11600000, { [MY_USDT]: tokAcc(0, USDT, ME) }));
R.ok('прогон: списали бы с другого моего счёта (USDT) — не подписано', S.sent.length === 0 && /account/.test(r.warn), r.warn);
await quote('SOL', 'USDC', '0.1');
r = await trySwap('ok', simOk(58500, 11600000, { [ME]: sysAcc(S.lamports - 100_000_000n - 10_000n, 'Evi1Program1111111111111111111111111111111') }));
R.ok('прогон: мой счёт переписан на чужую программу — не подписано', S.sent.length === 0 && /owner/.test(r.warn), r.warn);
await quote('SOL', 'USDC', '0.1');
r = await trySwap('ok', simOk(58500, 11600000));
const swapReq = jupAsked.find(x => x.startsWith('SWAP')) || '';
R.ok('ЧЕСТНАЯ ОПЕРАЦИЯ — ПОДПИСАНА И ОТПРАВЛЕНА', S.sent.length === 1 && /solscan/.test(r.info), r.warn + ' | ' + r.info);
R.ok('комиссия — на счёт USDC кошелька развития', swapReq.includes('"fee":"' + FEE_USDC + '"') && swapReq.includes('"legacy":true'), swapReq);
const sent = S.sent.length ? Buffer.from(S.sent[0], 'base64') : Buffer.alloc(0);
R.ok('подпись вписана, сообщение не тронуто', sent.length > 65 && sent.slice(1, 65).some(x => x !== 0) && sent.slice(65).equals(Buffer.from(await buildTx('ok'), 'base64').slice(65)));

const own = errors.filter(e => !/Failed to load resource|ERR_|net::|503|aggregator|jup\.ag|sol\.mock/.test(e));
R.ok('ошибок в коде страницы нет', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
