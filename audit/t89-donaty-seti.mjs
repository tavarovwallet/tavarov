/* Донаты в других сетях (1 октября 2026): Solana (по метке операции,
   подпись ed25519, очередь для таймера) и Ethereum (тот же контракт v3). */
import { toRaw } from './solraw.mjs';
import crypto from 'node:crypto';
const DON = await import('/home/claude/apk/functions/api/donate.js');
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');
let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined ? '  [' + String(d).slice(0, 160) + ']' : '')); };

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const TREASURY = 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU';
const BUYER = 'CttRr6et6TryhMzCgZyKk9YyXp4TWXeYBkgZUg22Bxnt';
// автор — свой ключ, чтобы подписать страницу
/* Ключ подбираем так, чтобы адрес строчными не оказался случайно тоже
   точкой на кривой (так бывает примерно в половине случаев). */
let publicKey, privateKey, AUTHOR;
for (;;){
  ({ publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'));
  AUTHOR = SOL.b58enc(new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)));
  let lowOk = false; try{ lowOk = SOL.isOnCurve(SOL.b58dec(AUTHOR.toLowerCase(), 32)); } catch(e){}
  if (!lowOk) break;
}
const ataOf = async (o, m) => SOL.b58enc(await SOL.ata(SOL.b58dec(o, 32), SOL.b58dec(m, 32)));
const hx = n => '0x' + String(n).padStart(4, '0').repeat(16);

const map = new Map();
const env = { V1_NO_THROTTLE: '1', TILL: {
  async get(k){ const v = map.get(k); return v ? v.body : null; },
  async put(k, body, o){ map.set(k, { body, metadata: o && o.metadata ? JSON.parse(JSON.stringify(o.metadata)) : null }); },
  async delete(k){ map.delete(k); },
  async list({ prefix, limit }){ return { list_complete: true, keys: [...map.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit || 1000).map(name => ({ name, metadata: map.get(name).metadata })) }; } } };

const solTx = {};          // метка -> [операции]
const evmSales = {};       // h -> { merchant, amount, token }
let rpcDown = false;
const w = v => BigInt(v).toString(16).padStart(64, '0');
const wa = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
globalThis.fetch = async (url, init) => {
  const q = JSON.parse(init.body);
  if (rpcDown) return { ok: false, status: 502, json: async () => ({}) };
  let result = null;
  if (q.method === 'getSignaturesForAddress') result = (solTx[q.params[0]] || []).map((t, i) => ({ signature: q.params[0] + ':' + i, err: null }));
  else if (q.method === 'getTransaction'){ const [ref, i] = q.params[0].split(':'); result = toRaw(solTx[ref][Number(i)]); }
  else if (q.method === 'eth_call'){
    const p = q.params[0]; result = '0x' + '0'.repeat(64 * 7);
    if (p.data.startsWith('0x38d56afe')){
      const s = evmSales['0x' + p.data.slice(10)];
      if (s && p.to.toLowerCase() === '0x5046399643c387d93e1467bad3fd7edf3fb459da')
        result = '0x' + wa(s.merchant) + w(s.amount) + wa('0x' + '77'.repeat(20)) + w(0) + wa(s.token) + w(0) + w(0);
    }
  }
  else if (q.method === 'eth_blockNumber') result = '0x1000';
  else if (q.method === 'eth_getLogs') result = [];
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: q.id, result }) };
};
async function pay(h, toM, toT, mint, owner){
  const ref = SOL.refFromInvoice(h);
  (solTx[ref] = solTx[ref] || []).push({ meta: { err: null, innerInstructions: [] }, transaction: { message: {
    accountKeys: [{ pubkey: BUYER }, { pubkey: ref }],
    instructions: [
      { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint, destination: await ataOf(owner || AUTHOR, mint), authority: BUYER, tokenAmount: { amount: String(toM) } } } },
      { program: 'spl-token', parsed: { type: 'transferChecked', info: { mint, destination: await ataOf(TREASURY, mint), authority: BUYER, tokenAmount: { amount: String(toT) } } } } ] } } });
}
const post = async body => { const r = await DON.onRequestPost({ env, request: new Request('https://wallet.tavarov.com/api/donate', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }); return { status: r.status, body: await r.json() }; };
const get = async qs => { const r = await DON.onRequestGet({ env, request: new Request('https://wallet.tavarov.com/api/donate?' + qs) }); return { status: r.status, body: await r.json() }; };

// ---- адрес ----
let r = await post({ net: 'solana', to: AUTHOR.toLowerCase(), h: hx(1), nick: 'a', msg: 'b' });
ok('base58 строчными — не тот адрес, отказ', r.status === 400, JSON.stringify(r.body));
const pda = await ataOf(AUTHOR, USDC);
r = await post({ net: 'solana', to: pda, h: hx(1), nick: 'a', msg: 'b' });
ok('адрес программы (не кошелёк) — отказ', r.status === 400, JSON.stringify(r.body));
r = await post({ net: 'solana', to: '0x' + '11'.repeat(20), h: hx(1) });
ok('0x-адрес в Solana — отказ', r.status === 400);

// ---- сообщение до оплаты ----
r = await post({ net: 'solana', to: AUTHOR, h: hx(1), nick: 'Ваня', msg: 'Спасибо за стрим' });
ok('сообщение принято', r.status === 200 && r.body.ok, JSON.stringify(r.body));
ok('ждущий ключ — с адресом как есть, без строчных', map.has('donp:solana:' + AUTHOR + ':' + hx(1)));
const q0 = JSON.parse(map.get('donsolq').body);
ok('счёт лёг в очередь Solana', q0.length === 1 && q0[0].to === AUTHOR && q0[0].h === hx(1), JSON.stringify(q0));
r = await get('net=solana&to=' + AUTHOR + '&h=' + hx(1));
ok('оплаты нет — ждёт', r.body.item === null && r.body.pending === true, JSON.stringify(r.body));

// ---- оплата без комиссии и копеечная ----
await pay(hx(1), 4_950_000, 0, USDC);
r = await get('net=solana&to=' + AUTHOR + '&h=' + hx(1));
ok('без 1% в казну — не донат', r.body.item === null, JSON.stringify(r.body));

r = await post({ net: 'solana', to: AUTHOR, h: hx(2), nick: '', msg: 'копейка' });
await pay(hx(2), 49_500, 500, USDC);
r = await get('net=solana&to=' + AUTHOR + '&h=' + hx(2));
ok('5 центов — на экран не идёт', r.body.item === null);

// ---- настоящая оплата ----
await pay(hx(1), 4_950_000, 50_000, USDC);
r = await get('net=solana&to=' + AUTHOR + '&h=' + hx(1));
ok('оплата 4.95 + 0.05 USDC — донат 5 USDC', r.body.item && r.body.item.amount === '5' && r.body.item.cur === 'USDC' && r.body.item.nick === 'Ваня', JSON.stringify(r.body));
ok('плательщик — как в сети, регистр сохранён', r.body.item && r.body.item.payer === BUYER, r.body.item && r.body.item.payer);
r = await get('net=solana&to=' + AUTHOR.toLowerCase() + '&h=' + hx(1));
ok('тот же донат по адресу строчными — не отдаём', r.status === 400);
r = await post({ net: 'solana', to: AUTHOR, h: hx(1), msg: 'чужой текст' });
ok('второе сообщение к оплаченному — отказ', r.status === 409);
r = await post({ net: 'solana', to: AUTHOR, h: hx(3), msg: 'после оплаты' });
await pay(hx(4), 990_000, 10_000, USDT);
r = await post({ net: 'solana', to: AUTHOR, h: hx(4), msg: 'к чужой оплате' });
ok('сообщение к уже оплаченному счёту — отказ', r.status === 409, JSON.stringify(r.body));

// ---- USDT, оплата другому автору ----
await pay(hx(3), 1_980_000, 20_000, USDT, BUYER);
r = await get('net=solana&to=' + AUTHOR + '&h=' + hx(3));
ok('деньги ушли другому — не донат этому автору', r.body.item === null);

// ---- таймер ----
r = await post({ net: 'solana', to: AUTHOR, h: hx(5), nick: 'Kate', msg: 'из таймера' });
await pay(hx(5), 2_970_000, 30_000, USDT);
const before = JSON.parse(map.get('donsolq').body).length;
const cr = await DON.promoteSolDonations(env);
ok('таймер подтвердил донат и почистил очередь', cr && cr.promoted >= 1 && JSON.parse(map.get('donsolq').body).length < before, JSON.stringify(cr));
r = await get('net=solana&to=' + AUTHOR);
ok('в списке автора — два доната, новые сверху', r.body.items.length === 2 && r.body.items[0].msg === 'из таймера' && r.body.items[0].cur === 'USDT' && r.body.items[0].amount === '3', JSON.stringify(r.body.items.map(i => i.amount + i.cur)));
const cr2 = await DON.promoteSolDonations(env);
ok('повторный проход таймера ничего не пишет зря', cr2.promoted === 0);

// ---- экран OBS ----
r = await get('net=solana&to=' + AUTHOR + '&atas=1');
ok('адреса долларовых счетов автора', r.body.atas && r.body.atas.USDC === await ataOf(AUTHOR, USDC) && r.body.atas.USDT === await ataOf(AUTHOR, USDT), JSON.stringify(r.body));
await new Promise(res => setTimeout(res, 20));
const t0 = Date.now();
r = await post({ net: 'solana', to: AUTHOR, h: hx(6), nick: 'Obs', msg: 'с экрана' });
await pay(hx(6), 990_000, 10_000, USDC);
r = await get('net=solana&to=' + AUTHOR + '&recent=1&since=' + t0);
ok('экран: свежий донат найден и подтверждён', r.body.items.length === 1 && r.body.items[0].nick === 'Obs', JSON.stringify(r.body));

// ---- страница автора: подпись ed25519 ----
await new Promise(res => setTimeout(res, 1100));
const ts = Math.floor(Date.now() / 1000);
const prof = { action: 'profile', net: 'solana', to: AUTHOR, greeting: 'Привет', goal: 'Микрофон', target: '100', restart: false, ts };
const sign = o => SOL.b58enc(new Uint8Array(crypto.sign(null, Buffer.from(DON.profileText(o)), privateKey)));
r = await post(Object.assign({}, prof, { sig: sign(prof) }));
ok('подпись кошелька Solana принята', r.status === 200 && r.body.ok && r.body.profile.goal.target === '100', JSON.stringify(r.body));
const other = crypto.generateKeyPairSync('ed25519');
const bad = SOL.b58enc(new Uint8Array(crypto.sign(null, Buffer.from(DON.profileText(prof)), other.privateKey)));
r = await post(Object.assign({}, prof, { ts: ts + 1, sig: bad }));
ok('чужая подпись — отказ', r.status === 403, JSON.stringify(r.body));
r = await post(Object.assign({}, prof, { greeting: 'Подменил', sig: sign(prof) }));
ok('подпись от другого текста — отказ', r.status === 403);
r = await post(Object.assign({}, prof, { sig: '0x' + 'ab'.repeat(65) }));
ok('подпись EVM вместо Solana — отказ', r.status === 400);
// цель: донат после постановки цели считается
await new Promise(res => setTimeout(res, 1100));
r = await post({ net: 'solana', to: AUTHOR, h: hx(7), nick: 'G', msg: 'на цель' });
await pay(hx(7), 9_900_000, 100_000, USDC);
await get('net=solana&to=' + AUTHOR + '&h=' + hx(7));
r = await get('net=solana&to=' + AUTHOR + '&profile=1');
ok('цель считает донаты с момента постановки', r.body.profile.goal && r.body.profile.goal.raised === '10' && r.body.profile.greeting === 'Привет', JSON.stringify(r.body));
r = await get('net=solana&to=' + AUTHOR + '&stats=1');
ok('итоги автора в центах', r.body.stats.count === 4, JSON.stringify(r.body));

// ---- узел молчит ----
rpcDown = true;
r = await post({ net: 'solana', to: AUTHOR, h: hx(8), msg: 'x' });
ok('узел Solana молчит — честное «попробуйте ещё», а не «принято»', r.status === 503, JSON.stringify(r.body));
rpcDown = false;

// ---- Ethereum ----
const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const STREAMER = '0x' + 'aB'.repeat(20);
r = await post({ net: 'eth', to: STREAMER, h: hx(20), nick: 'Eth', msg: 'gm' });
ok('Ethereum: сообщение принято', r.status === 200, JSON.stringify(r.body));
evmSales[hx(20)] = { merchant: STREAMER, amount: 2_000_000n, token: ETH_USDC };
r = await get('net=eth&to=' + STREAMER + '&h=' + hx(20));
ok('Ethereum: оплата через контракт v3 — донат 2 USDC (6 знаков)', r.body.item && r.body.item.amount === '2' && r.body.item.cur === 'USDC', JSON.stringify(r.body));
ok('Ethereum: ключ — адрес строчными', map.has('donidx:eth:' + STREAMER.toLowerCase()));
r = await get('net=bnb&to=' + STREAMER + '&h=' + hx(20));
ok('тот же счёт в другой сети не отдаём', r.body.item === null);
r = await post({ net: 'base', to: STREAMER, h: hx(21), msg: 'base' });
ok('Base: сообщение принято', r.status === 200);
r = await get('net=bnb&to=' + STREAMER);
ok('неизвестная сеть по-старому = BNB', r.status === 200);

console.log('--- ' + okN + ' из ' + (okN + badN) + ' ---');
