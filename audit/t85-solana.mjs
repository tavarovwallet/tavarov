/* Solana в кошельке (1 октября 2026): оплата одной операцией с комиссией 1%.

   Узел Solana подделан: он отвечает как настоящий и записывает операции,
   которые приложение отправило. Каждую операцию разбираем байт за байтом:
   кому, сколько, какой монетой, с какой меткой, и проверяем подпись. Что
   сами операции принимаются сетью, проверено отдельно — симуляцией на
   настоящей сети Solana (см. ОТЧЁТ). */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { boot, reporter } from './boot.mjs';
const require = createRequire(import.meta.url);
const nacl = require('/home/claude/apk/www/lib/nacl-fast.min.js');
const SOL = new Function(fs.readFileSync('/home/claude/sol/solcore.js', 'utf8') + '; return SOL;')();
const R = reporter();
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TREASURY = 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU';
const MERCHANT = 'GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw';

const { browser, page, errors } = await boot({ role: 'buyer' });
const RPC = 'https://sol.mock/rpc';
await page.evaluate(url => { MAINNET.solana.rpc = url; MAINNET.solana.rpcs = [url]; }, RPC);
const state = { lamports: 50_000_000n, usdc: 100_000_000n, sent: [], exists: new Set() };
const { SOL: SOLC } = await import('/home/claude/apk/functions/api/_sol.js');
state.payer = await page.evaluate(() => wallet.solana && wallet.solana.address);
await page.route(RPC, async route => {
  const q = route.request().postDataJSON();
  const ok = result => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) });
  switch (q.method){
    case 'getVersion': return ok({ 'solana-core': '2.0' });
    case 'getBalance': return ok({ value: Number(state.lamports) });
    case 'getLatestBlockhash': return ok({ value: { blockhash: '9HTCXxaceMEAdwwUBuSyVHbS7iN14iH4UndyZ89J7qGi', lastValidBlockHeight: 1 } });
    case 'getAccountInfo': {
      /* Свой счёт USDC — читаем как счёт (jsonParsed): так кошелёк узнаёт остаток. */
      if (q.params[1] && q.params[1].encoding === 'jsonParsed' && state.payer && q.params[0] === SOLC.b58enc(await SOLC.ata(SOLC.b58dec(state.payer, 32), SOLC.b58dec(USDC, 32))))
        return ok({ value: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports: 2039280, data: { program: 'spl-token', parsed: { type: 'account',
          info: { mint: USDC, owner: state.payer, tokenAmount: { amount: String(state.usdc), decimals: 6, uiAmount: Number(state.usdc) / 1e6 } } } } } });
      return ok({ value: state.exists.has(q.params[0]) ? { owner: 'x', lamports: 1 } : null });
    }
    /* Как publicnode с 1 октября 2026: «поисковые» запросы закрыты. */
    case 'getTokenAccountBalance':
    case 'getTokenAccountsByOwner':
      return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: -32602, message: 'Indexed requests require a personal token.' } }) });
    case 'getSignaturesForAddress': return ok([]);
    case 'sendTransaction': { state.sent.push(Buffer.from(q.params[0], 'base64')); return ok('5'.repeat(88)); }
    case 'getSignatureStatuses': return ok({ value: [{ confirmationStatus: 'confirmed', err: null }] });
    default: return ok(null);
  }
});

/* Разбор операции Solana (legacy). */
function decode(tx){
  let o = 0; const rdCu = () => { let v = 0, s = 0; for (;;){ const b = tx[o++]; v |= (b & 0x7f) << s; if (!(b & 0x80)) return v; s += 7; } };
  const nSig = rdCu(); const sigs = []; for (let i = 0; i < nSig; i++){ sigs.push(tx.subarray(o, o + 64)); o += 64; }
  const msgStart = o;
  const header = [tx[o++], tx[o++], tx[o++]];
  const nk = rdCu(); const keys = []; for (let i = 0; i < nk; i++){ keys.push(SOL.b58enc(tx.subarray(o, o + 32))); o += 32; }
  o += 32;
  const ni = rdCu(); const ixs = [];
  for (let i = 0; i < ni; i++){ const p = tx[o++]; const na = rdCu(); const acc = [...tx.subarray(o, o + na)].map(x => keys[x]); o += na; const nd = rdCu(); const data = tx.subarray(o, o + nd); o += nd; ixs.push({ program: keys[p], acc, data }); }
  return { sigs, header, keys, ixs, message: tx.subarray(msgStart) };
}
const u64 = d => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[i]); return v; };
const transfers = d => d.ixs.filter(x => x.program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && x.data[0] === 12)
  .map(x => ({ src: x.acc[0], mint: x.acc[1], dst: x.acc[2], owner: x.acc[3], extra: x.acc.slice(4), amount: u64(x.data.subarray(1, 9)), dec: x.data[9] }));
const ataOf = async (o, m) => SOL.b58enc(await SOL.ata(SOL.b58dec(o, 32), SOL.b58dec(m, 32)));

// ---- сеть ----
await page.evaluate(() => { renderNetPills(); switchNetwork('solana'); });
const st = await page.evaluate(() => ({ pills: [...document.querySelectorAll('#netPills .netpill')].map(e => e.textContent), net: network, toks: Object.keys(tokensFor('solana')), me: wallet.solana && wallet.solana.address }));
R.ok('четыре сети, Solana среди них', st.pills.includes('Solana') && st.pills.length === 4, st.pills.join(', '));
R.ok('у кошелька есть адрес Solana', SOL.isAddress(st.me || ''), st.me);
const ME = st.me;

// ---- касса: код Solana Pay ----
const qr = await page.evaluate(() => buildQrPayload({ to: wallet.solana.address, m: wallet.solana.address, cur: 'USDC', amt: '25', item: 'Кофе', name: 'Кофейня', inv: '0x' + 'ab'.repeat(32) }));
R.ok('код кассы — Solana Pay с нашим сервером', /^solana:https%3A%2F%2Fwallet\.tavarov\.com%2Fapi%2Fsolpay%3F/.test(qr), qr.slice(0, 70));
const qurl = new URL(decodeURIComponent(qr.slice(7)));
R.ok('в коде: продавец, сумма, монета, метка = номер счёта', qurl.searchParams.get('m') === ME && qurl.searchParams.get('a') === '25'
  && qurl.searchParams.get('c') === 'USDC' && qurl.searchParams.get('r') === SOL.refFromInvoice('0x' + 'ab'.repeat(32)));

// ---- касса: веб-ссылка в Solana ----
page.on('dialog', d => d.accept());
const web = await page.evaluate(async () => {
  setTab('pay'); setPayMode('kassa');
  const cur = document.getElementById('kassaCurrency'); cur.value = 'USDC';
  document.getElementById('kassaAmount').value = '7';
  await createTicket({});
  const u = document.getElementById('ticketWebLink').textContent;
  const m = u.match(/[#?&]p=([A-Za-z0-9_-]+)/); if (!m) return { err: 'no link ' + u.slice(0, 50), cur: cur.value };
  let b = m[1].replace(/-/g,'+').replace(/_/g,'/'); while (b.length % 4) b += '=';
  return { inv: JSON.parse(decodeURIComponent(escape(atob(b)))), qr: document.getElementById('ticketPayLink') ? document.getElementById('ticketPayLink').textContent : '' };
});
R.ok('веб-ссылка кассы: продавец — адрес Solana, сеть solana', web.inv && web.inv.m === ME && web.inv.net === 'solana' && web.inv.c === 'USDC', JSON.stringify(web).slice(0, 160));
R.ok('код на экране кассы — Solana Pay', /^solana:https%3A/.test(web.qr || ''), (web.qr || '').slice(0, 40));
await page.evaluate(() => cancelTicket());

// ---- покупатель сканирует такой код у продавца ----
const shopQr = 'solana:' + encodeURIComponent('https://wallet.tavarov.com/api/solpay?m=' + MERCHANT + '&a=25&c=USDC&r=' + SOL.refFromInvoice('0x' + 'cd'.repeat(32)) + '&n=Shop');
await page.evaluate(async q => { setTab('pay'); setPayMode('send'); await applyScannedPayment(q); }, shopQr);
const f = await page.evaluate(() => ({ to: document.getElementById('sendTo').value, amt: document.getElementById('sendAmount').value, cur: document.getElementById('sendCurrency').value, m: scannedMerchant, inv: scannedInvoice, box: document.getElementById('scanIntentBox').textContent }));
R.ok('код разобран: продавец, 25 USDC', f.to === MERCHANT && f.amt === '25' && f.cur === 'USDC' && f.m === MERCHANT, JSON.stringify(f).slice(0, 140));
R.ok('номер счёта восстановлен из метки', f.inv === '0x' + 'cd'.repeat(32));
await page.evaluate(() => reviewSend());
const res = await page.evaluate(async () => { try { return await solSend(wallet, pendingSend, NETWORKS.solana); } catch(e){ return 'ERR ' + e.message; } });
R.ok('оплата отправлена', /^https:\/\/solscan\.io\/tx\//.test(res), res);
let d = decode(state.sent[state.sent.length - 1]);
let tr = transfers(d);
const ref = SOL.refFromInvoice('0x' + 'cd'.repeat(32));
R.ok('ДВА перевода в одной операции', tr.length === 2, tr.length);
R.ok('продавцу 24.75 USDC в его счёт монеты', tr[0] && tr[0].dst === await ataOf(MERCHANT, USDC) && tr[0].amount === 24_750_000n && tr[0].dec === 6);
R.ok('кошельку развития 0.25 USDC (1%)', tr[1] && tr[1].dst === await ataOf(TREASURY, USDC) && tr[1].amount === 250_000n);
R.ok('метка счёта — в переводе продавцу', tr[0] && tr[0].extra.includes(ref));
R.ok('монета — настоящий USDC, списание со своего счёта', tr.every(x => x.mint === USDC) && tr[0].src === await ataOf(ME, USDC) && tr[0].owner === ME);
R.ok('счета монеты продавцу и казне заводятся при нужде', d.ixs.filter(x => x.program === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL').length === 2);
R.ok('подпись настоящая', nacl.sign.detached.verify(d.message, d.sigs[0], SOL.b58dec(ME, 32)));
R.ok('платит за операцию сам покупатель', d.keys[0] === ME && d.header[0] === 1);

// ---- нет SOL на комиссию: говорим словами ----
state.lamports = 1000n;
await page.evaluate(async q => { await applyScannedPayment(q); reviewSend(); }, shopQr);
const noSol = await page.evaluate(async () => { try { await solSend(wallet, pendingSend, NETWORKS.solana); return 'sent'; } catch(e){ return e.message; } });
R.ok('мало SOL — понятная ошибка, ничего не отправлено', /SOL/.test(noSol) && noSol !== 'sent', noSol.slice(0, 120));
state.lamports = 50_000_000n;

// ---- чужой «запрос перевода» Solana Pay: обычный перевод с их меткой, без комиссии ----
const foreignRef = SOL.b58enc(new Uint8Array(32).fill(7));
const tq = 'solana:' + MERCHANT + '?amount=3.5&spl-token=' + USDC + '&reference=' + foreignRef + '&label=Store';
const n0 = state.sent.length;
await page.evaluate(async q => { setPayMode('send'); await applyScannedPayment(q); reviewSend(); }, tq);
const ps = await page.evaluate(() => ({ m: pendingSend.merchant, ref: pendingSend.solRef, amt: pendingSend.amount }));
R.ok('чужой код: не наша касса (комиссии нет), метка их', !ps.m && ps.ref === foreignRef && ps.amt === '3.5', JSON.stringify(ps));
await page.evaluate(async () => { await solSend(wallet, pendingSend, NETWORKS.solana); });
d = decode(state.sent[state.sent.length - 1]); tr = transfers(d);
R.ok('один перевод 3.5 USDC с их меткой', state.sent.length === n0 + 1 && tr.length === 1 && tr[0].amount === 3_500_000n && tr[0].extra.includes(foreignRef));

// ---- ссылка на страницу оплаты Solana, отсканированная кошельком ----
const pl = await page.evaluate(m => {
  const o = { m, a: '4', c: 'USDC', h: '0x' + '11'.repeat(32), net: 'solana' };
  const b = btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return payLinkFromUrl('https://wallet.tavarov.com/pay#p=' + b);
}, MERCHANT);
R.ok('ссылка на страницу оплаты Solana понимается', /net=solana/.test(pl || '') && (pl || '').includes(MERCHANT), pl);

// ---- чужой сервер «запроса операции» — не подписываем ----
const evil = await page.evaluate(() => parseSolanaPay('solana:' + encodeURIComponent('https://evil.example/api/solpay?m=GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw&a=1&c=USDC&r=GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw')));
R.ok('чужой сервер операций — не принимаем', evil === null);

// ---- обычный перевод SOL ----
await page.evaluate(async () => { setPayMode('send'); document.getElementById('sendTo').value = 'Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU'; document.getElementById('sendAmount').value = '0.0123'; document.getElementById('sendCurrency').value = 'native'; reviewSend(); await solSend(wallet, pendingSend, NETWORKS.solana); });
d = decode(state.sent[state.sent.length - 1]);
const sys = d.ixs.find(x => x.program === '11111111111111111111111111111111');
R.ok('перевод SOL: ровно 12 300 000 лампортов, без дробных ошибок', sys && u64(sys.data.subarray(4, 12)) === 12_300_000n && sys.acc[1] === TREASURY);

state.usdc = 12_345_678n;
const bal = await page.evaluate(async () => { const b = await solGetBalances(wallet.solana.address); return b; });
R.ok('ОСТАТОК USDC ЧИТАЕТСЯ, хотя узел закрыл «поисковые» запросы (403)', Math.abs(bal.USDC - 12.345678) < 1e-9 && bal.USDT === 0, JSON.stringify(bal));
R.done(errors.filter(e => !/ERR_TUNNEL|ERR_NAME|Failed to load resource/.test(e)));
await browser.close();
process.exit(0);
