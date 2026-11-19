/* t110: X Layer in NoN Wallet (www/index.html), 20 Nov 2026.

   The wallet runs in a real browser; every X Layer node is a fake one
   (http://xlayer.mock/), every other outside host is refused and written
   down. What is checked:

   1. The network is listed: a pill "X Layer", chain 196, OKB, USDT0 and
      Circle USDC with 6 decimals, logSpan 100; the bridged USDT is nowhere.
   2. Balances: OKB, USDT (= USDT0) and USDC are read from exactly those two
      contracts, through Multicall3, on the chain-196 node only.
   3. Receive: the EVM address, the network name and a QR of the address.
   4. Send USDT0: one ERC-20 transfer(to, 1500000) to the USDT0 contract,
      signed for chain 196, gas price from the node; the explorer link is
      web3.okx.com/explorer/x-layer/tx/…
   5. Send OKB: a plain transfer with value, chain 196.
   6. No OKB for gas: honest "not enough OKB", nothing sent, no relayer.
   7. History: eth_getLogs only in ranges of at most 100 blocks, about an
      hour deep; an incoming USDT0 transfer shows with an OKX explorer link.
      Incoming payments for the till (loadIncoming) — also ≤100 blocks.
   8. Explorer links for address and transaction.
   9. Hidden on X Layer: swap, cross-chain swap target, USDC without gas
      (Base relayer), BNB gas help, partners, donations, card top-up.
  10. Invoice: a tavarov:pay link with net=xlayer (as the payment page's
      "Pay in NoN Wallet" button gives it) switches to X Layer and pays
      through TavarovPay 0x29a3…a1D4: approve exactly 2 USDT0, then
      pay(merchant, USDT0, 2000000, invoice), both on chain 196. The payment
      page's https link and an EIP-681 code with @196 are understood too.

   Run: cd audit && node t110-xlayer-wallet.mjs
   (AUDIT_WWW=<checkout>/www to test another working copy.) */
import { boot, reporter, answerConfirm } from './boot.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EL = require('../www/lib/ethers.umd.min.js');
const E = EL.ethers || EL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = process.env.AUDIT_WWW || path.resolve(HERE, '../www');

const R = reporter();
const USDT0 = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';
const USDC  = '0xB6CEceAB302E2E4948951eE7843FC24E92933061';
const PAY   = '0x29a318431053127E2fBf3C0Ae9cbaF84Cb6Aa1D4';
const MC3   = '0xcA11bde05977b3631167028862bE2a173976CA11';
const OLD_USDT = '0x1e4a5963abfd975d8c9021ce480b42188849d41d';
const MOCK = 'http://xlayer.mock/';
const lc = a => String(a || '').toLowerCase();
const W = v => '0x' + BigInt(v).toString(16).padStart(64, '0');

/* 1a. Source: the bridged USDT must not be anywhere in the wallet. */
const src = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
R.ok('source: no bridged USDT 0x1e4a…d41d and no USDC.e 0x74b7…', !src.toLowerCase().includes(OLD_USDT) && !/0x74b7f16337b8972027f6196a17a631ac6de26d22/i.test(src));
const hdr = fs.readFileSync(path.join(WWW, '_headers'), 'utf8');
R.ok('CSP connect-src allows the OKX nodes (dRPC is under *.drpc.org)', (hdr.match(/https:\/\/rpc\.xlayer\.tech https:\/\/xlayerrpc\.okx\.com/g) || []).length === 2 && /\*\.drpc\.org/.test(hdr));

const { browser, page, errors } = await boot({ role: 'buyer' });
const me = await page.evaluate(() => wallet.evm.address);
const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

/* ---------- the fake X Layer node ---------- */
const st = {
  okb: 5n * 10n ** 17n,                                   // 0.5 OKB
  bal: { [lc(USDT0)]: 12500000n, [lc(USDC)]: 3250000n },  // 12.5 USDT0, 3.25 USDC
  allowance: 0n, gasPrice: 20000000n,                     // 0.02 gwei
  head: 0x100000, sent: [], logs: [], mcTargets: [], balCalls: [], receipts: {}, chainIdAsked: 0,
  incomingLog: null
};
const mcI = new E.utils.Interface(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])',
                                   'function getEthBalance(address addr) view returns (uint256 balance)']);
const ercI = new E.utils.Interface(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
                                    'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)']);
const payI = new E.utils.Interface(['function pay(address merchant, address token, uint256 amount, bytes32 invoice)',
                                    'function acceptedToken(address) view returns (bool)', 'function VERSION() view returns (uint16)',
                                    'event Paid(address indexed merchant, address indexed payer, address indexed token, uint256 amountToMerchant, uint256 fee, uint256 reward, bytes32 invoice)']);
function tokenCall(to, data){
  const s = data.slice(0, 10);
  if (s === ercI.getSighash('balanceOf')){ st.balCalls.push(lc(to)); return W(st.bal[lc(to)] || 0n); }
  if (s === ercI.getSighash('allowance')) return W(st.allowance);
  return null;
}
function call(to, data){
  to = lc(to); data = lc(data);
  if (to === lc(MC3)){
    const [calls] = mcI.decodeFunctionData('aggregate3', data);
    const out = calls.map(c => {
      st.mcTargets.push(lc(c.target));
      if (lc(c.target) === lc(MC3)) return [true, W(st.okb)];
      const r = (st.bal[lc(c.target)] !== undefined) ? tokenCall(c.target, lc(c.callData)) : null;
      return r ? [true, r] : [false, '0x'];
    });
    return mcI.encodeFunctionResult('aggregate3', [out]);
  }
  if (st.bal[to] !== undefined){ const r = tokenCall(to, data); if (r) return r; }
  if (to === lc(PAY)){
    if (data.startsWith(payI.getSighash('acceptedToken'))) return W(BigInt('0x' + data.slice(-40)) === BigInt(USDT0) || BigInt('0x' + data.slice(-40)) === BigInt(USDC) ? 1 : 0);
    if (data.startsWith(payI.getSighash('VERSION'))) return W(3);
  }
  return '0x';
}
function answer(q){
  const res = r => ({ jsonrpc: '2.0', id: q.id, result: r });
  switch (q.method){
    case 'eth_chainId': st.chainIdAsked++; return res('0xc4');
    case 'net_version': return res('196');
    case 'eth_blockNumber': return res('0x' + st.head.toString(16));
    case 'eth_getBalance': return res(W(st.okb).replace(/^0x0+(?=.)/, '0x'));
    case 'eth_gasPrice': return res('0x' + st.gasPrice.toString(16));
    case 'eth_estimateGas': return res('0xea60');
    case 'eth_getTransactionCount': return res('0x' + st.sent.length.toString(16));
    case 'eth_getCode': return res('0x');
    case 'eth_call': return res(call(q.params[0].to, q.params[0].data || '0x'));
    case 'eth_getBlockByNumber': return res({ number: q.params[0], timestamp: '0x' + Math.floor(Date.now() / 1000 - 3600).toString(16), transactions: [] });
    case 'eth_getLogs': {
      const f = q.params[0];
      const from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
      st.logs.push({ from, to, address: f.address, topics: f.topics });
      if (to - from + 1 > 100) return { jsonrpc: '2.0', id: q.id, error: { code: -32000, message: 'block range too large, max 100' } };
      const l = st.incomingLog;
      if (l && Array.isArray(f.address) && l.block >= from && l.block <= to && f.topics[2]) return res([l.log]);
      return res([]);
    }
    case 'eth_sendRawTransaction': {
      const t = E.utils.parseTransaction(q.params[0]);
      st.sent.push(t);
      st.receipts[t.hash] = true;
      if (t.to && lc(t.to) === lc(USDT0) && t.data.startsWith(ercI.getSighash('approve')))
        st.allowance = ercI.decodeFunctionData('approve', t.data)[1].toBigInt();
      return res(t.hash);
    }
    case 'eth_getTransactionReceipt': return res(st.receipts[q.params[0]] ? { blockNumber: '0x10', status: '0x1', transactionHash: q.params[0], logs: [] } : null);
  }
  return { jsonrpc: '2.0', id: q.id, error: { code: -32601, message: 'no ' + q.method } };
}
const outside = [];          // every other outside request, by host
const okxAsked = [];         // requests that went to an X Layer node, by method
await page.route(u => u.protocol !== 'about:' && u.hostname !== 'localhost', async route => {
  const u = new URL(route.request().url());
  if (u.hostname === 'xlayer.mock'){
    let body; try{ body = JSON.parse(route.request().postData() || '{}'); } catch(e){ body = {}; }
    (Array.isArray(body) ? body : [body]).forEach(q => okxAsked.push(q));
    const out = Array.isArray(body) ? body.map(answer) : answer(body);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  }
  let body = ''; try{ body = route.request().postData() || ''; } catch(e){}
  outside.push({ host: u.hostname, path: u.pathname, body });
  return route.abort();
});
await page.evaluate(url => { MAINNET.xlayer.rpc = url; MAINNET.xlayer.rpcs = [url]; window.__opened = []; window.open = u => { window.__opened.push(String(u)); return null; }; }, MOCK);

/* ---------- 1. listed ---------- */
const info = await page.evaluate(() => ({
  nets: ENABLED_NETS.join(','), x: NETWORKS.xlayer && { name: NETWORKS.xlayer.name, chainId: NETWORKS.xlayer.chainId, sym: NETWORKS.xlayer.nativeSym,
    dec: NETWORKS.xlayer.decimalsNative, span: NETWORKS.xlayer.logSpan, toks: NETWORKS.xlayer.tokens,
    rpcs: MAINNET.xlayer.rpcs.length },
  pills: [...document.querySelectorAll('#netPills .netpill')].map(p => p.dataset.net + ':' + p.textContent.trim()),
  logo: netLogoHtml('xlayer'), contracts: CONTRACTS.xlayerMainnet, keys: CONTRACT_KEYS.xlayer }));
R.ok('network listed: BNB, Ethereum, Base, X Layer, Solana', info.nets === 'bnb,eth,base,xlayer,solana', info.nets);
R.ok('pill "X Layer" with the OKB mark', info.pills.includes('xlayer:X Layer') && /coin-logo/.test(info.logo), info.pills.join(' | '));
R.ok('chain 196, OKB, 18 decimals, logSpan 100', info.x && info.x.chainId === 196 && info.x.sym === 'OKB' && info.x.dec === 18 && info.x.span === 100);
R.ok('tokens: USDT = USDT0, USDC = Circle, both 6 decimals, nothing else', info.x && Object.keys(info.x.toks).join() === 'USDT,USDC'
  && info.x.toks.USDT.contract === USDT0 && info.x.toks.USDT.decimals === 6 && info.x.toks.USDC.contract === USDC && info.x.toks.USDC.decimals === 6);
R.ok('pay 0x29a3…a1D4 and charges 0xff4d…eB41 (both deployed 19 Nov 2026) wired like Ethereum and Base', info.contracts && info.contracts.pay === PAY && info.contracts.charges === '0xff4deb3aef0aeb958526f1c6ee827a774c0aeb41' && info.keys[0] === 'xlayerMainnet');
R.ok('real node list: rpc.xlayer.tech, xlayerrpc.okx.com, xlayer.drpc.org', /'https:\/\/rpc\.xlayer\.tech','https:\/\/xlayerrpc\.okx\.com','https:\/\/xlayer\.drpc\.org'/.test(src));

/* ---------- 2. balances ---------- */
const before = outside.length;
st.mcTargets = []; st.balCalls = [];
await page.evaluate(() => { switchNetwork('xlayer'); });
await page.waitForFunction(() => network === 'xlayer' && lastBalances && lastBalances.USDT > 0, null, { timeout: 20000 }).catch(() => {});
const bals = await page.evaluate(() => lastBalances);
R.ok('balances: 0.5 OKB, 12.5 USDT, 3.25 USDC', bals && bals.native === 0.5 && bals.USDT === 12.5 && bals.USDC === 3.25, JSON.stringify(bals));
const tg = [...new Set(st.mcTargets)].sort().join(',');
R.ok('read from exactly OKB (Multicall3) + USDT0 + USDC', tg === [lc(MC3), lc(USDT0), lc(USDC)].sort().join(','), tg);
const leak = outside.slice(before).filter(o => o.body.toLowerCase().includes(lc(me).slice(2)) && /eth_call|eth_getBalance/.test(o.body));
R.ok('balance reads for this address went to no other node', leak.length === 0, leak.map(o => o.host).join(','));
const rows = await page.evaluate(() => document.getElementById('tokenList') ? document.getElementById('tokenList').innerText : '');
R.ok('token list shows OKB, USDT, USDC', /OKB/.test(rows) && /USDT/.test(rows) && /USDC/.test(rows), rows.replace(/\s+/g, ' ').slice(0, 120));

/* ---------- 3. receive ---------- */
await page.evaluate(() => { tab = 'pay'; setPayMode('receive'); });
await page.waitForTimeout(300);
const recv = await page.evaluate(() => ({ a: document.getElementById('recvAddr').textContent, n: document.getElementById('recvNet').textContent,
  q: document.getElementById('recvQr').title || (document.getElementById('recvQr').dataset.addr || ''), note: (document.getElementById('recvNote') || {}).textContent || '' }));
R.ok('receive: the EVM address, network "X Layer", QR of the address', recv.a === me && recv.n === 'X Layer' && recv.q === me, JSON.stringify(recv).slice(0, 160));
R.ok('receive: the network warning names X Layer', /X Layer/.test(recv.note), recv.note.slice(0, 100));

/* ---------- 4. send USDT0 ---------- */
async function sendIt(to, amount, cur){
  await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
  await page.waitForTimeout(250);
  await page.fill('#sendTo', to);
  await page.fill('#sendAmount', amount);
  await page.selectOption('#sendCurrency', cur);
  await page.evaluate(() => reviewSend());
  await page.waitForTimeout(300);
  page.evaluate(() => doSend());
  await answerConfirm(page, 'testpassword1', 5000);
  await page.waitForFunction(() => !document.getElementById('sendResult').classList.contains('hidden')
    && document.getElementById('confirmSendBtn') && !document.getElementById('confirmSendBtn').disabled, null, { timeout: 40000 }).catch(() => {});
  return page.evaluate(() => ({ text: document.getElementById('sendResult').innerText, html: document.getElementById('sendResult').innerHTML }));
}
const TO = '0x2222222222222222222222222222222222222222';
st.sent = [];
const r1 = await sendIt(TO, '1.5', 'USDT');
const t1 = st.sent[0];
R.ok('USDT0: one transaction', st.sent.length === 1, String(st.sent.length) + ' ' + r1.text.slice(0, 100));
R.ok('USDT0: to the USDT0 contract, value 0', t1 && lc(t1.to) === lc(USDT0) && t1.value.isZero());
R.ok('USDT0: data is exactly transfer(to, 1500000) — 6 decimals', t1 && lc(t1.data) === lc(ercI.encodeFunctionData('transfer', [TO, 1500000])), t1 && t1.data);
R.ok('USDT0: the signer asked the node for its chain id (0xc4)', st.chainIdAsked > 0);
R.ok('USDT0: signed for chain 196 by this wallet', t1 && t1.chainId === 196 && lc(t1.from) === lc(me), t1 && (t1.chainId + ' ' + t1.from));
R.ok('USDT0: gas price taken from the node (legacy, paid in OKB)', t1 && t1.gasPrice && t1.gasPrice.toBigInt() === st.gasPrice && (t1.type === 0 || t1.type === null), t1 && String(t1.type));
R.ok('USDT0: explorer link web3.okx.com/explorer/x-layer/tx/<hash>', t1 && r1.html.includes('https://web3.okx.com/explorer/x-layer/tx/' + t1.hash), r1.html.slice(0, 160));
R.ok('USDT0: the journal remembers it as USDT on X Layer', await page.evaluate(h => histAll().some(x => x.hash === h && x.sym === 'USDT'), t1 && t1.hash));

/* ---------- 5. send OKB ---------- */
st.sent = [];
const r2 = await sendIt(TO, '0.1', 'native');
const t2 = st.sent[0];
R.ok('OKB: plain transfer, value 0.1 OKB, no data, chain 196', st.sent.length === 1 && lc(t2.to) === lc(TO) && t2.value.toString() === '100000000000000000'
  && (t2.data === '0x' || !t2.data) && t2.chainId === 196, r2.text.slice(0, 100));
R.ok('OKB: gas limit 21000-ish from the node estimate, price from the node', t2 && t2.gasPrice && t2.gasPrice.toBigInt() === st.gasPrice);

/* ---------- 6. no OKB for gas ---------- */
st.sent = []; const okb = st.okb; st.okb = 0n;
const outBefore = outside.length;
const r3 = await sendIt(TO, '1', 'USDC');
R.ok('no OKB: nothing sent, the message names OKB', st.sent.length === 0 && /OKB/.test(r3.text) && /не хватает|нужно|нет/i.test(r3.text), r3.text.slice(0, 140));
R.ok('no OKB: no relayer / gas-help server asked', !outside.slice(outBefore).some(o => /relay-base|drip|gasless/.test(o.path)),
  outside.slice(outBefore).map(o => o.host + o.path).join(','));
st.okb = okb;

/* ---------- 7. history ---------- */
st.logs = [];
const inHash = '0x' + 'ab'.repeat(32);
st.incomingLog = { block: st.head - 2 - 150, log: { address: lc(USDT0), blockNumber: '0x' + (st.head - 2 - 150).toString(16), transactionHash: inHash, logIndex: '0x0',
  topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x' + '0'.repeat(24) + '3333333333333333333333333333333333333333', '0x' + '0'.repeat(24) + lc(me).slice(2)],
  data: W(2000000) } };
await page.evaluate(() => { tab = 'history'; renderWalletState(); return loadHistory(); });
await page.waitForTimeout(300);
const spans = st.logs.map(l => l.to - l.from + 1);
R.ok('history: every eth_getLogs range is at most 100 blocks', spans.length > 0 && spans.every(n => n <= 100), 'max ' + Math.max(...spans) + ', requests ' + spans.length);
const uniq = new Set(st.logs.map(l => l.from + '-' + l.to + '-' + (l.topics[1] ? 'out' : 'in')));
const deepest = Math.min(...st.logs.map(l => l.from));
R.ok('history: about an hour deep (36 ranges × 2 directions)', uniq.size === 72 && st.head - 2 - deepest === 3599, uniq.size + ' ranges, ' + (st.head - 2 - deepest + 1) + ' blocks');
R.ok('history: asks the USDT0 and USDC contracts only', st.logs.every(l => Array.isArray(l.address) && l.address.map(lc).sort().join() === [lc(USDT0), lc(USDC)].sort().join()));
R.ok('history: no range was refused as too large', !st.logs.some(l => l.to - l.from + 1 > 100));
const hist = await page.evaluate(() => document.getElementById('historyList').innerHTML);
R.ok('history: incoming +2 USDT with an OKX explorer link', /\+2 USDT/.test(hist.replace(/<[^>]+>/g, ' ')) && hist.includes('https://web3.okx.com/explorer/x-layer/tx/' + inHash), hist.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
st.incomingLog = null;

st.logs = [];
await page.evaluate(() => loadIncoming());
/* Only the till's own requests (a history refresh left over from a send can
   run at the same time and asks the token contracts). */
const tillLogs = st.logs.filter(l => !Array.isArray(l.address));
const inc = tillLogs.map(l => l.to - l.from + 1);
R.ok('till payments list (loadIncoming): ranges ≤ 100 blocks, at most an hour (36), the pay contract only', inc.length > 0 && inc.length <= 36 && inc.every(n => n <= 100)
  && tillLogs.every(l => lc(l.address) === lc(PAY)), inc.length + ' ranges, max ' + Math.max(...inc));

/* ---------- 8. explorer links ---------- */
await page.evaluate(() => openHistoryExplorer());
const opened = await page.evaluate(() => window.__opened);
R.ok('explorer: address page web3.okx.com/explorer/x-layer/address/<addr>', opened.includes('https://web3.okx.com/explorer/x-layer/address/' + me), opened.join(','));
R.ok('explorer: tx link builder', await page.evaluate(() => NETWORKS.xlayer.explorerTx('0xab')) === 'https://web3.okx.com/explorer/x-layer/tx/0xab');

/* ---------- 9. hidden on X Layer ---------- */
await page.evaluate(() => { tab = 'wallet'; renderWalletState(); });
await page.waitForTimeout(200);
const hid = await page.evaluate(() => ({
  swap: swapAvailable(), quick: document.getElementById('quickSwap').classList.contains('hidden'),
  swapNet: !!SWAP_CHAINS.xlayer, relay: !!RELAY_CHAINS.xlayer,
  bridgeTargetsFromBnb: ENABLED_NETS.filter(n => RELAY_CHAINS[n]).join(','),
  baseGasless: relayBaseOk('xlayer', 'USDC', NETWORKS.xlayer.tokens.USDC), bnbGasless: gaslessTokenOk('xlayer', 'USDT', NETWORKS.xlayer.tokens.USDT),
  partners: partnersHere(), don: donNet(), ramp: rampAvailable(), bonus: bonusesHere(), charges: chargesAddress(),
  names: !!namesAddress(), namesHere: namesManagedHere() }));
R.ok('swap hidden: not available, quick button hidden, no KyberSwap chain', hid.swap === false && hid.quick && !hid.swapNet, JSON.stringify(hid));
R.ok('cross-chain swap: X Layer is neither source nor target', !hid.relay && !/xlayer/.test(hid.bridgeTargetsFromBnb));
R.ok('no gas-free sends (Base relayer, BNB help)', hid.baseGasless === false && hid.bnbGasless === false);
R.ok('no partners, donations, card top-up, TVR bonuses; on-chain charges = the X Layer TavarovCharges', hid.partners === false && hid.don === null && hid.ramp === false && hid.bonus === false && String(hid.charges).toLowerCase() === '0xff4deb3aef0aeb958526f1c6ee827a774c0aeb41');
R.ok('names work (read from BNB Chain), claimed only on BNB', hid.names === true && hid.namesHere === false);
await page.evaluate(() => { tab = 'cashback'; renderWalletState(); try{ renderCashback(); }catch(e){} });
const cb = await page.evaluate(() => ({ off: !document.getElementById('cbOff').classList.contains('hidden'), live: !document.getElementById('cbLive').classList.contains('hidden'), text: document.getElementById('cbOffText').textContent }));
R.ok('cashback/partners tab says where it works, nothing to press', cb.off && !cb.live && /BNB Chain/.test(cb.text), cb.text.slice(0, 90));
await page.evaluate(() => { tab = 'wallet'; renderWalletState(); });

/* ---------- 10. invoice ---------- */
/* A real checksum: the wallet refuses a mixed-case address whose checksum
   does not match (a typo), and it should. */
const MERCHANT = E.utils.getAddress('0x73bbaabb4c9ee01e3bf7c9d0fd5c0b3f0d1ef432');
const INV = '0x' + 'cd'.repeat(32);
const b64 = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromPage = await page.evaluate(u => payLinkFromUrl(u), 'https://wallet.tavarov.com/pay#p=' + b64({ m: MERCHANT, a: '2', c: 'USDT', h: INV, net: 'xlayer' }));
R.ok('payment page link with net xlayer is understood', /^tavarov:pay\?/.test(fromPage || '') && /net=xlayer/.test(fromPage), fromPage);
const e681 = await page.evaluate(u => parseEip681(u), 'ethereum:' + USDT0 + '@196/transfer?address=' + MERCHANT + '&uint256=2000000');
R.ok('EIP-681 code with @196 is X Layer', e681 && e681.net === 'xlayer' && e681.chainId === 196, JSON.stringify(e681).slice(0, 120));

await page.evaluate(() => { switchNetwork('bnb'); });
await page.waitForTimeout(300);
st.sent = []; st.allowance = 0n;
const link = 'tavarov:pay?to=' + MERCHANT + '&net=xlayer&m=' + MERCHANT + '&cur=USDT&amt=2&item=Coffee&name=Shop&inv=' + INV;
await page.evaluate(l => { tab = 'pay'; actionTab = 'send'; renderWalletState(); return applyScannedPayment(l); }, link);
await page.waitForTimeout(500);
const sc = await page.evaluate(() => ({ net: network, to: document.getElementById('sendTo').value, amt: document.getElementById('sendAmount').value,
  cur: document.getElementById('sendCurrency').value, m: scannedMerchant, inv: scannedInvoice, box: document.getElementById('scanIntentBox').textContent }));
R.ok('invoice: wallet switched itself to X Layer', sc.net === 'xlayer', sc.box.slice(0, 120));
R.ok('invoice: merchant, 2 USDT and the invoice id filled in', lc(sc.to) === lc(MERCHANT) && sc.amt === '2' && sc.cur === 'USDT' && lc(sc.m) === lc(MERCHANT) && sc.inv === INV);
dialogs.length = 0;
await page.evaluate(() => reviewSend());
await page.waitForTimeout(300);
R.ok('invoice: confirmation shows the merchant and 2 USDT on X Layer', dialogs.length === 0
  && await page.evaluate(() => !!pendingSend && pendingSend.merchant && /2 USDT · X Layer/.test(document.getElementById('confirmAmount').textContent)), dialogs.join(' | '));
page.evaluate(() => doSend());
await answerConfirm(page, 'testpassword1', 5000);
await page.waitForFunction(() => !document.getElementById('sendResult').classList.contains('hidden') && !document.getElementById('confirmSendBtn').disabled, null, { timeout: 60000 }).catch(() => {});
const pr = await page.evaluate(() => document.getElementById('sendResult').innerHTML);
R.ok('invoice: two transactions — approve, then pay', st.sent.length === 2, st.sent.map(t => t.to + ':' + t.data.slice(0, 10)).join(' ') + ' ' + pr.replace(/<[^>]+>/g, ' ').slice(0, 120));
const [ap, pp] = st.sent;
R.ok('invoice: approve exactly 2 USDT0 (2000000) to TavarovPay on X Layer', ap && lc(ap.to) === lc(USDT0) && lc(ap.data) === lc(ercI.encodeFunctionData('approve', [PAY, 2000000])) && ap.chainId === 196);
R.ok('invoice: pay(merchant, USDT0, 2000000, invoice) to 0x29a3…a1D4, chain 196', pp && lc(pp.to) === lc(PAY) && pp.chainId === 196
  && lc(pp.data) === lc(payI.encodeFunctionData('pay', [MERCHANT, USDT0, 2000000, INV])), pp && pp.data.slice(0, 80));
R.ok('invoice: result links to the OKX explorer', pp && pr.includes('https://web3.okx.com/explorer/x-layer/tx/' + pp.hash));

await browser.close();
const pass = R.done(errors.filter(x => !/requestfailed|ERR_|Failed to load resource|net::/.test(x)));
process.exit(pass ? 0 : 1);
