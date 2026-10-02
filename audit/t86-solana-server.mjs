/* Сервер Solana (1 октября 2026): Solana Pay, «оплачено ли», запасной узел. */
import { toRaw } from './solraw.mjs';
const SP = await import('/home/claude/apk/functions/api/solpay.js');
const ST = await import('/home/claude/apk/functions/api/status.js');
const RP = await import('/home/claude/apk/functions/api/solrpc.js');
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');
let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined ? '  [' + String(d).slice(0, 150) + ']' : '')); };
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', TREASURY = 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU';
const M = 'GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw', BUYER = 'CttRr6et6TryhMzCgZyKk9YyXp4TWXeYBkgZUg22Bxnt';
const H = '0x' + 'cd'.repeat(32), REF = SOL.refFromInvoice(H);
const ataOf = async (o, m) => SOL.b58enc(await SOL.ata(SOL.b58dec(o, 32), SOL.b58dec(m, 32)));

let txs = {};        // подпись -> ответ getTransaction
const asked = [];
globalThis.fetch = async (url, init) => {
  const q = JSON.parse(init.body); asked.push({ url: String(url), m: q.method });
  let result = null;
  if (q.method === 'getLatestBlockhash') result = { value: { blockhash: '9HTCXxaceMEAdwwUBuSyVHbS7iN14iH4UndyZ89J7qGi' } };
  else if (q.method === 'getSignaturesForAddress') result = q.params[0] === REF ? Object.keys(txs).map(s => ({ signature: s, err: null })) : [];
  else if (q.method === 'getTransaction') result = toRaw(txs[q.params[0]] || null);
  else if (q.method === 'getSlot') result = 123;
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: q.id, result }) };
};

// ---- Solana Pay: GET ----
let r = await SP.onRequestGet({ request: new Request('https://wallet.tavarov.com/api/solpay?m=' + M) });
let j = await r.json();
ok('GET: название и значок', j.label === 'Tavarov Pay' && /\/icon-192\.png$/.test(j.icon) && r.headers.get('access-control-allow-origin') === '*', JSON.stringify(j));

// ---- Solana Pay: POST собирает операцию ----
const base = 'https://wallet.tavarov.com/api/solpay?m=' + M + '&a=25&c=USDC&r=' + REF + '&n=Shop&i=Coffee';
const post = (u, body) => SP.onRequestPost({ request: new Request(u, { method: 'POST', body: JSON.stringify(body) }), env: {} });
r = await post(base, { account: BUYER }); j = await r.json();
ok('POST: операция выдана', r.status === 200 && typeof j.transaction === 'string', JSON.stringify(j).slice(0, 100));
ok('подпись по-человечески', j.message === 'Shop — 25 USDC · Coffee', j.message);
const tx = Buffer.from(j.transaction, 'base64');
// разбор
let o = 0; const cu = () => { let v = 0, s = 0; for (;;){ const b = tx[o++]; v |= (b & 0x7f) << s; if (!(b & 0x80)) return v; s += 7; } };
const ns = cu(); const emptySig = tx.subarray(o, o + 64).every(x => x === 0); o += 64 * ns;
o += 3; const nk = cu(); const keys = []; for (let i = 0; i < nk; i++){ keys.push(SOL.b58enc(tx.subarray(o, o + 32))); o += 32; } o += 32;
const ni = cu(); const ixs = []; for (let i = 0; i < ni; i++){ const p = tx[o++]; const na = cu(); const acc = [...tx.subarray(o, o + na)].map(x => keys[x]); o += na; const nd = cu(); const data = tx.subarray(o, o + nd); o += nd; ixs.push({ p: keys[p], acc, data }); }
const u64 = d => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[i]); return v; };
const trs = ixs.filter(x => x.p === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && x.data[0] === 12);
ok('одна пустая подпись — подписывает покупатель', ns === 1 && emptySig && keys[0] === BUYER);
ok('продавцу 24.75 с меткой', trs[0] && trs[0].acc[2] === await ataOf(M, USDC) && u64(trs[0].data.subarray(1, 9)) === 24_750_000n && trs[0].acc.includes(REF));
ok('казне 0.25', trs[1] && trs[1].acc[2] === await ataOf(TREASURY, USDC) && u64(trs[1].data.subarray(1, 9)) === 250_000n);
r = await post(base + '&treasury=' + BUYER, { account: BUYER }); j = await r.json();
const tx2 = Buffer.from(j.transaction, 'base64').toString('base64');
ok('казну ссылкой не подменить', tx2 === Buffer.from(tx).toString('base64'));
for (const [name, u, b] of [
  ['чужой аккаунт не адрес', base, { account: 'nope' }],
  ['себе платить нельзя', base, { account: M }],
  ['монета не USDC/USDT', base.replace('c=USDC', 'c=DOGE'), { account: BUYER }],
  ['седьмой знак суммы', base.replace('a=25', 'a=1.0000001'), { account: BUYER }],
  ['метка не адрес', base.replace('r=' + REF, 'r=xyz'), { account: BUYER }]]){
  r = await post(u, b); ok(name + ' — отказ', r.status === 400, (await r.json()).error);
}

// ---- «оплачено ли» в Solana ----
const st = async (extra) => { const q = new URLSearchParams(Object.assign({ h: H, m: M, a: '25', c: 'USDC', net: 'solana' }, extra || {}));
  const res = await ST.onRequestGet({ request: new Request('https://wallet.tavarov.com/api/status?' + q), env: {} }); return { status: res.status, body: await res.json() }; };
let s1 = await st();
ok('операций с меткой нет — не оплачено', s1.status === 200 && s1.body.paid === false, JSON.stringify(s1.body));
const mkTx = async (toM, toT, mint, err) => ({ meta: { err: err || null, innerInstructions: [] }, transaction: { message: {
  accountKeys: [{ pubkey: BUYER }, { pubkey: REF }],
  instructions: [
    { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint, destination: await ataOf(M, USDC), authority: BUYER, tokenAmount: { amount: String(toM) } } } },
    { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint, destination: await ataOf(TREASURY, USDC), authority: BUYER, tokenAmount: { amount: String(toT) } } } } ] } } });
txs = { sigA: await mkTx(24_750_000, 250_000, USDC) };
s1 = await st();
ok('полная оплата с комиссией — оплачено', s1.body.paid === true && s1.body.tx === 'sigA' && s1.body.payer === BUYER, JSON.stringify(s1.body));
txs = { sigB: await mkTx(24_000_000, 250_000, USDC) };
s1 = await st();
ok('меньше суммы — не оплачено (underpaid)', s1.body.paid === false && s1.body.underpaid === true, JSON.stringify(s1.body));
txs = { sigC: await mkTx(24_750_000, 0, USDC) };
ok('без комиссии — не считается оплатой через кассу', (await st()).body.paid === false);
txs = { sigD: await mkTx(24_750_000, 250_000, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB') };
ok('не та монета — не оплачено', (await st()).body.paid === false);
txs = { sigE: await mkTx(24_750_000, 250_000, USDC, { InstructionError: [0, 'x'] }) };
ok('упавшая операция — не оплачено', (await st()).body.paid === false);
/* Аудит 2.10.2026: одна операция не должна закрывать несколько счетов. */
const OTHER = SOL.refFromInvoice('0x' + 'ef'.repeat(32));
txs = { sigF: toRaw(await mkTx(24_750_000, 250_000, USDC), { refIn: 'none' }) };
ok('метка в операции, но не в переводе продавцу — не оплачено', (await st()).body.paid === false);
txs = { sigG: toRaw(await mkTx(24_750_000, 250_000, USDC), { extraRefs: [OTHER] }) };
ok('две метки в одном переводе (два счёта одной оплатой) — не оплачено', (await st()).body.paid === false);
{ const t2 = toRaw(await mkTx(24_750_000, 250_000, USDC));
  const m = t2.transaction.message, T = m.instructions[0];
  /* второй перевод продавцу той же суммы с чужой меткой, а 1% — один на двоих */
  const oi = m.accountKeys.length; m.accountKeys.push(OTHER);
  m.instructions.push({ programIdIndex: T.programIdIndex, accounts: [...T.accounts.slice(0, 4), oi], data: T.data });
  txs = { sigH: t2 };
  ok('два перевода продавцу, а 1% только с одного — не оплачено', (await st()).body.paid === false); }
{ const t3 = toRaw(await mkTx(24_750_000, 250_000, USDC));
  const m = t3.transaction.message, T = m.instructions[0];
  /* второй продавец (другой счёт монеты) в той же операции, а 1% — один на двоих */
  const otherAta = await ataOf(BUYER, USDC);
  const oa = m.accountKeys.length; m.accountKeys.push(otherAta); const orf = m.accountKeys.length; m.accountKeys.push(OTHER);
  m.instructions.push({ programIdIndex: T.programIdIndex, accounts: [T.accounts[0], T.accounts[1], oa, T.accounts[3], orf], data: T.data });
  txs = { sigJ: t3 };
  ok('два продавца в одной операции, 1% только с одного — не оплачено', (await st()).body.paid === false); }
txs = { sigI: toRaw(await mkTx(24_750_000, 250_000, USDC)) };
ok('честная оплата в «сыром» виде — оплачено', (await st()).body.paid === true);
txs = {};
asked.length = 0;
const dv = await st({ net: 'solanaTestnet' });
ok('старая ссылка на devnet — 400 «неизвестная сеть», узлы не спрашивали', dv.status === 400 && asked.length === 0, JSON.stringify(dv.body));
ok('кривой адрес продавца — 400', (await st({ m: '0x' + 'ab'.repeat(20) })).status === 400);

// ---- запасной узел ----
const rp = async body => { const res = await RP.onRequestPost({ request: new Request('https://wallet.tavarov.com/api/solrpc', { method: 'POST', body: JSON.stringify(body) }), env: {} }); return { status: res.status, body: await res.json() }; };
{ // аудит 2.10.2026: запасной узел — не бесплатный узел для всех
  const big = await RP.onRequestPost({ request: new Request('https://wallet.tavarov.com/api/solrpc', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['x'.repeat(5000)] }) }), env: {} });
  ok('solrpc: тело больше 4 КБ — отказ', big.status === 413);
  const many = await rp({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [Array(65).fill(M)] });
  ok('solrpc: больше 64 счетов разом — отказ', many.status === 400, JSON.stringify(many.body));
  const lim = await rp({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [M, { limit: 1000 }] });
  ok('solrpc: выборка подписей больше 25 — отказ', lim.status === 400, JSON.stringify(lim.body));
}
let x = await rp({ jsonrpc: '2.0', id: 7, method: 'getSlot', params: [] });
ok('запасной узел отвечает на разрешённое', x.status === 200 && x.body.result === 123 && x.body.id === 7);
x = await rp({ jsonrpc: '2.0', id: 1, method: 'getProgramAccounts', params: [] });
ok('тяжёлое и чужое — нельзя', x.status === 400);

console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(0);
