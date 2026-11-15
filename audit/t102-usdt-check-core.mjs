/* The USDT checker's verdicts (site/check-core.js), against fake nodes.

   This page tells a seller whether to hand over goods. So the test is about
   what it must never say: green for a token that is only named USDT, green
   when a node lied or did not answer, "not found" when a network was simply
   down, "your address" when it is not.

   Run: cd audit && node t102-usdt-check-core.mjs   (no browser needed) */
import { createRequire } from 'module';
import { reporter } from './boot.mjs';
import { makeWorld, addEvmTx, addTronTx, mockFetch, USDT, USDC, abiString } from './usdtmock.mjs';
const require = createRequire(import.meta.url);
require('../site/check-core.js');
const C = globalThis.UsdtCheck;
const R = reporter();

const EP = {
  bsc: ['http://bsc-a', 'http://bsc-b', 'http://bsc-c', 'http://bsc-d'],
  eth: ['http://eth-a', 'http://eth-b', 'http://eth-c'],
  tron: ['http://tron-a', 'http://tron-b']
};
const H = n => '0x' + n.toString(16).padStart(2, '0').repeat(32);            // 0x-hash
const T = n => n.toString(16).padStart(2, '0').repeat(32);                  // tron hash
const SELLER = '0x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a';
const OTHER = '0x7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b';
const BUYER = '0x1212121212121212121212121212121212121212';
const TSELLER_HEX = '9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c';
const FAKE = '0xfa4efa4efa4efa4efa4efa4efa4efa4efa4efa4e';
const e18 = 10n ** 18n, e6 = 10n ** 6n;

let w;
function world() { w = makeWorld(); return w; }
const run = (input, opts = {}) => C.check(input, Object.assign({ fetch: mockFetch(w, EP), endpoints: EP, timeoutMs: 300 }, opts));

// ---------- contracts are what the issuers publish ----------
R.ok('USDT TRON hex = TR7NHqje…', (await C.tronHexToBase58(USDT.tron)) === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
R.ok('official list has exactly 5 contracts', Object.keys(C.OFFICIAL.bsc).length + Object.keys(C.OFFICIAL.eth).length + Object.keys(C.OFFICIAL.tron).length === 5);
R.ok('USDC on TRON is not official', !C.OFFICIAL.tron[USDC.tronOld] && !!C.DISCONTINUED.tron[USDC.tronOld]);
R.ok('decimals in list: BSC 18, ETH 6, TRON 6', C.OFFICIAL.bsc[USDT.bsc.slice(2)].decimals === 18 && C.OFFICIAL.eth[USDT.eth.slice(2)].decimals === 6 && C.OFFICIAL.tron[USDT.tron].decimals === 6);

// ---------- look-alike explorer hosts ----------
const hosts = {
  'bscscan.com': true, 'www.bscscan.com': true, 'etherscan.io': true, 'tronscan.org': true, 'BSCSCAN.COM.': true,
  'bscscan.com.evil.io': false, 'bscscan.co': false, 'bsc-scan.com': false, 'bscscan.com-tx.info': false, 'etherscan.io.tx-view.net': false,
  'etherscan.com.ru': false, 'tronscan.io': false, 'tronscan.org.cn': false, 'tronscan.org-check.top': false, 'xn--bscscn-7nf.com': false,
  'bscscann.com': false, 'evilbscscan.com': false, 'tronscan.org.evil': false, '127.0.0.1': false
};
for (const [h, ok] of Object.entries(hosts)) R.ok('host ' + h + ' -> ' + (ok ? 'official' : 'NOT official'), C.checkHost(h).official === ok);
R.ok('testnet.bscscan.com is flagged as test network', C.checkHost('testnet.bscscan.com').testnet === true);
R.ok('sepolia.etherscan.io flagged', C.checkHost('sepolia.etherscan.io').testnet && C.checkHost('nile.tronscan.org').testnet);
const hh = 'ab'.repeat(32);
const linkCases = [
  ['https://bscscan.com/tx/0x' + hh, true, 'bscscan.com'],
  ['https://bscscan.com.evil.io/tx/0x' + hh, false, 'bscscan.com.evil.io'],
  ['https://bscscan.com@evil.io/tx/0x' + hh, false, 'evil.io'],
  ['https://bscscаn.com/tx/0x' + hh, false, null],            // Cyrillic а -> punycode
  ['https://xn--bscscn-8ve.com/tx/0x' + hh, false, 'xn--bscscn-8ve.com'],   // broken punycode
  ['bscscan.com.tx-check.io/tx/0x' + hh, false, 'bscscan.com.tx-check.io'],
  ['Paid! https://etherscan-io.net/tx/0x' + hh + ' thanks', false, 'etherscan-io.net'],
  ['https://tronscan.org/#/transaction/' + hh, true, 'tronscan.org'],
  ['https://tronscan.io/#/transaction/' + hh, false, 'tronscan.io'],
  ['https://www.etherscan.io/tx/0x' + hh + '?utm=1', true, 'www.etherscan.io']
];
for (const [s, ok, host] of linkCases) {
  const p = C.parseInput(s);
  R.ok('link ' + s.slice(0, 44) + '… -> ' + (ok ? 'official' : 'warn') + ', hash kept',
    p.kind === 'hash' && p.hash === hh && p.link && p.link.official === ok && (host == null || p.link.host === host), JSON.stringify(p.link));
}
R.ok('Cyrillic look-alike host is shown as punycode', /^xn--/.test(C.parseInput(linkCases[3][0]).link.host));
R.ok('bare hash: no link', C.parseInput('  0x' + hh.toUpperCase() + '\n').link === null && C.parseInput('0x' + hh).hash === hh);
R.ok('address is not a hash', C.parseInput('0x' + '12'.repeat(20)).kind === 'address' && C.parseInput('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').kind === 'address');
R.ok('garbage input', C.parseInput('hello').kind === 'unknown' && C.parseInput('').kind === 'empty');
R.ok('65 hex chars is not a hash', C.parseInput('a'.repeat(65)).kind !== 'hash');

// ---------- look-alike names ----------
const names = [['USDT', 'Tether USD', 'copy'], ['USD₮', 'Tether', 'copy'], ['U5DT', '', 'copy'], ['ＵＳＤＴ', '', 'copy'], ['UЅDТ', '', 'copy'],
  ['usdt ', ' tether usd', 'copy'], ['U S D T', '', 'copy'], ['USDT.e', 'Tether USD', 'other'], ['anyUSDT', '', 'other'], ['USDC', 'USD Coin', 'copy'],
  ['BSC-USD', 'Binance-Peg BSC-USD', 'copy'], ['XAUt', 'Tether Gold', null], ['vUSDT', 'Venus USDT', 'other'], ['aBnbUSDT', 'Aave BNB Smart Chain USDT', 'other'], ['USDT', 'Tether USD', 'copy'], ['PEPE', 'Pepe', null], ['USD', 'Dollar', null], ['TUSD', 'TrueUSD', null]];
for (const [s, n, want] of names) {
  const r = C.stableLike(s, n);
  R.ok('name "' + s + '" / "' + n + '" -> ' + want, want === null ? r === null : (r && (r.copy ? 'copy' : 'other') === want), JSON.stringify(r));
}

// ---------- amounts ----------
R.ok('parseAmount 120', C.parseAmount('120', 6) === 120n * e6);
R.ok('parseAmount 1,234.50', C.parseAmount('1,234.50', 6) === 1234500000n);
R.ok('parseAmount 10,5', C.parseAmount('10,5', 6) === 10500000n);
R.ok('parseAmount 1.234,5', C.parseAmount('1.234,5', 6) === 1234500000n);
R.ok('parseAmount junk -> null', C.parseAmount('12abc', 6) === null && C.parseAmount('1.0000001', 6) === null);
R.ok('formatUnits 18 dec', C.formatUnits(125500000000000000000n, 18) === '125.5' && C.formatUnits(1234567n, 6) === '1.234567');

// ---------- 1. real USDT, each network ----------
world(); addEvmTx(w, 'bsc', H(1), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 125n * e18 + 5n * e18 / 10n }]);
let r = await run(H(1));
R.ok('BSC real USDT -> green "Real USDT"', r.verdict === 'green' && r.title === 'Real USDT' && r.network === 'bsc', r.title);
R.ok('BSC amount uses 18 decimals: 125.5', r.transfers[0].amount === '125.5' && r.transfers[0].to === SELLER);
R.ok('BSC confirmations shown', r.confirmations === 100 && r.time > 0);

world(); addEvmTx(w, 'eth', H(2), [{ token: USDT.eth, from: BUYER, to: SELLER, raw: 1500n * e6 }]);
r = await run(H(2));
R.ok('ETH real USDT -> green, 1,500 (6 decimals)', r.verdict === 'green' && r.network === 'eth' && r.transfers[0].amount === '1,500', r.transfers && r.transfers[0].amount);

world(); addTronTx(w, T(3), [{ token: USDT.tron, from: '55'.repeat(20), to: TSELLER_HEX, raw: 99990000n }]);
r = await run(T(3));
const tSeller = await C.tronHexToBase58(TSELLER_HEX);
R.ok('TRON real USDT -> green, 99.99, base58 recipient', r.verdict === 'green' && r.network === 'tron' && r.transfers[0].amount === '99.99' && r.transfers[0].to === tSeller, r.title);
R.ok('TRON token shown as TR7NH…', r.transfers[0].token === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');

world(); addTronTx(w, T(4), [{ token: USDT.tron, from: '55'.repeat(20), to: TSELLER_HEX, raw: 5n * e6 }]);
r = await run('0x' + T(4));
R.ok('0x-prefixed hash found on TRON too', r.verdict === 'green' && r.network === 'tron');
world(); addEvmTx(w, 'bsc', H(5), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: e18 }]);
r = await run(H(5).slice(2));
R.ok('hash without 0x found on BNB Chain too', r.verdict === 'green' && r.network === 'bsc');

world(); addEvmTx(w, 'eth', H(6), [{ token: USDC.eth, from: BUYER, to: SELLER, raw: 20n * e6 }]);
r = await run(H(6));
R.ok('ETH real USDC -> green "Real USDC"', r.verdict === 'green' && r.title === 'Real USDC');

// ---------- 2. fake tokens ----------
for (const [net, sym, name, title] of [['bsc', 'USDT', 'Tether USD', 'Fake token: not real USDT'], ['eth', 'USD₮', 'Tether USD', 'Fake token: not real USDT'],
  ['bsc', 'U5DT', 'Tether', 'Fake token: not real USDT'], ['bsc', 'USDT.e', 'Tether USD.e', 'Not Tether’s USDT: a bridged or other token'],
  ['eth', 'USDC', 'USD Coin', 'Fake token: not real USDC']]) {
  world(); w[net].tokens.set(FAKE, { symbol: sym, name, decimals: 18 });
  addEvmTx(w, net, H(7), [{ token: FAKE, from: BUYER, to: SELLER, raw: 5000n * e18 }]);
  r = await run(H(7));
  R.ok(net + ' token "' + sym + '" on another contract -> RED "' + title + '"', r.verdict === 'red' && r.kind === 'fake' && r.title === title, r.verdict + ' ' + r.title);
  R.ok('  shows both contracts', r.transfers[0].token === FAKE && /^0x/.test(r.transfers[0].realContract) && r.transfers[0].realContract !== FAKE);
  R.ok('  never "Real"', !/^Real/.test(r.title));
}
world(); w.tron.tokens.set('fa'.repeat(20), { symbol: 'USDT', name: 'Tether USD', decimals: 6 });
addTronTx(w, T(8), [{ token: 'fa'.repeat(20), from: '55'.repeat(20), to: TSELLER_HEX, raw: 1000n * e6 }]);
r = await run(T(8));
R.ok('TRON fake USDT -> RED, real contract TR7NH… shown', r.verdict === 'red' && r.transfers[0].realContract === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', r.title);
// seen live on BNB Chain on 15 Nov 2026: a token named USDT / Tether USD whose
// contract mimics the real one's first and last characters (0x55…7955)
world(); const LOOK = '0x5591a8e9a5001f6052d9d749518ae1e6287b7955';
w.bsc.tokens.set(LOOK, { symbol: 'USDT', name: 'Tether USD', decimals: 18 });
addEvmTx(w, 'bsc', H(40), [{ token: LOOK, from: BUYER, to: SELLER, raw: 300n * e18 }]);
r = await run(H(40));
R.ok('look-alike contract 0x5591…7955 named USDT -> RED fake', r.verdict === 'red' && r.kind === 'fake' && r.transfers[0].token === LOOK);
world(); w.bsc.tokens.set(FAKE, { symbol: 'XAUt', name: 'Tether Gold', decimals: 6 });
addEvmTx(w, 'bsc', H(41), [{ token: FAKE, from: BUYER, to: SELLER, raw: e6 }]);
r = await run(H(41));
R.ok('Tether Gold -> amber "No USDT or USDC", not red', r.verdict === 'amber' && r.kind === 'other-token' && /XAUt/.test(r.text));
// bytes32 symbol (old-style token)
world(); w.bsc.tokens.set(FAKE, { symbol: 'USDT', symbolRaw: Buffer.from('USDT').toString('hex').padEnd(64, '0'), name: 'Tether', decimals: 18 });
addEvmTx(w, 'bsc', H(9), [{ token: FAKE, from: BUYER, to: SELLER, raw: e18 }]);
r = await run(H(9));
R.ok('fake with bytes32 symbol -> RED', r.verdict === 'red');
// real + fake in one transaction
world(); w.bsc.tokens.set(FAKE, { symbol: 'USDT', name: 'Tether USD', decimals: 18 });
addEvmTx(w, 'bsc', H(10), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: e18 }, { token: FAKE, from: BUYER, to: SELLER, raw: 999n * e18 }]);
r = await run(H(10));
R.ok('1 real + 999 fake in one tx -> RED (not green)', r.verdict === 'red' && r.alsoReal === true);

// ---------- 3. failed / pending / waits ----------
world(); addEvmTx(w, 'bsc', H(11), [], { status: 0 });
r = await run(H(11));
R.ok('failed BSC tx -> amber failed', r.verdict === 'amber' && r.kind === 'failed');
world(); addTronTx(w, T(12), [], { ret: 'REVERT' });
r = await run(T(12));
R.ok('failed TRON tx (REVERT) -> amber failed', r.verdict === 'amber' && r.kind === 'failed', r.title);
world(); addEvmTx(w, 'eth', H(13), [], { pending: true });
r = await run(H(13));
R.ok('pending ETH tx -> amber pending', r.verdict === 'amber' && r.kind === 'pending');
world(); addTronTx(w, T(14), [{ token: USDT.tron, from: '55'.repeat(20), to: TSELLER_HEX, raw: e6 }], { pending: true });
r = await run(T(14));
R.ok('pending TRON tx -> amber pending', r.verdict === 'amber' && r.kind === 'pending');
world(); addEvmTx(w, 'bsc', H(15), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: e18 }], { conf: 3 });
r = await run(H(15));
R.ok('BSC 3 confirmations -> amber wait, not green', r.verdict === 'amber' && r.kind === 'wait' && r.confirmations === 3);
world(); addEvmTx(w, 'eth', H(16), [{ token: USDT.eth, from: BUYER, to: SELLER, raw: e6 }], { conf: 12 });
r = await run(H(16));
R.ok('ETH 12 confirmations -> green', r.verdict === 'green');
world(); addTronTx(w, T(17), [{ token: USDT.tron, from: '55'.repeat(20), to: TSELLER_HEX, raw: e6 }], { solid: false, conf: 3 });
r = await run(T(17));
R.ok('TRON not solidified -> amber wait', r.verdict === 'amber' && r.kind === 'wait');

// ---------- 4. not found / native only / other ----------
world();
r = await run(H(18));
R.ok('not anywhere -> "Not found on BNB Chain, Ethereum or TRON"', r.verdict === 'notfound' && /Not found on BNB Chain, Ethereum or TRON/.test(r.title) && /Do not hand over the goods/.test(r.text));
world(); w.faults['http://tron-a'] = 'timeout';
r = await run(H(18));
R.ok('not found but TRON node timed out -> could not check (not "not found")', r.verdict === 'error' && r.title === 'Could not check right now');
world(); addEvmTx(w, 'bsc', H(19), [], { value: 5n * e18 / 10n });
r = await run(H(19));
R.ok('native BNB only -> amber "only BNB", 0.5', r.verdict === 'amber' && r.kind === 'native' && r.native.amount === '0.5' && /BNB/.test(r.title));
world(); addTronTx(w, T(20), [], { trx: 250000000 });
r = await run(T(20));
R.ok('TRX only -> amber native 250 TRX', r.verdict === 'amber' && r.kind === 'native' && r.native.amount === '250' && r.native.sym === 'TRX');
world(); addEvmTx(w, 'eth', H(21), []);
r = await run(H(21));
R.ok('no transfers at all -> amber empty', r.verdict === 'amber' && r.kind === 'empty');
world(); w.bsc.tokens.set(FAKE, { symbol: 'PEPE', name: 'Pepe', decimals: 18 });
addEvmTx(w, 'bsc', H(22), [{ token: FAKE, from: BUYER, to: SELLER, raw: e18 }]);
r = await run(H(22));
R.ok('other token (PEPE) -> amber "No USDT or USDC"', r.verdict === 'amber' && r.kind === 'other-token' && /PEPE/.test(r.text));
world(); addTronTx(w, T(23), [{ token: USDC.tronOld, from: '55'.repeat(20), to: TSELLER_HEX, raw: e6 }]);
r = await run(T(23));
R.ok('old USDC on TRON -> amber discontinued, not green', r.verdict === 'amber' && r.kind === 'discontinued');
world(); addEvmTx(w, 'eth', H(24), [], { nft: 1 });
r = await run(H(24));
R.ok('NFT only -> amber nft', r.verdict === 'amber' && r.kind === 'nft');

// ---------- 5. multiple transfers, address and amount ----------
world(); addEvmTx(w, 'bsc', H(25), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 99n * e18 }, { token: USDT.bsc, from: BUYER, to: OTHER, raw: 1n * e18 }]);
r = await run(H(25));
R.ok('two real transfers -> green, both listed', r.verdict === 'green' && r.transfers.length === 2);
r = await run(H(25), { myAddress: SELLER.toUpperCase().replace('0X', '0x'), expected: '99' });
R.ok('my address in UPPER case matches (EVM case-insensitive)', r.mine && r.mine.ok === true, JSON.stringify(r.mine));
R.ok('amount to me 99 matches', r.amountCheck && r.amountCheck.ok === true, JSON.stringify(r.amountCheck));
r = await run(H(25), { myAddress: SELLER, expected: '100' });
R.ok('expected 100, got 99 -> mismatch', r.amountCheck.ok === false && r.amountCheck.got === '99' && r.verdict === 'green');
r = await run(H(25), { myAddress: SELLER, expected: '50' });
R.ok('expected 50, got 99 -> "more than expected"', r.amountCheck.ok === false && r.amountCheck.more === true);
r = await run(H(25), { myAddress: '0x' + '5e'.repeat(20) });
R.ok('someone else\'s address -> RED "not to your address"', r.verdict === 'red' && r.kind === 'not-mine' && r.mine.ok === false);
r = await run(H(25), { myAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' });
R.ok('TRON address on a BSC payment -> invalid, explained', r.mine.invalid === true && /TRON address/.test(r.mine.why));
r = await run(H(25), { expected: '1,0' });
R.ok('no address, expected 1 -> matches one of the transfers', r.amountCheck.ok === true);

world(); addTronTx(w, T(26), [{ token: USDT.tron, from: '55'.repeat(20), to: TSELLER_HEX, raw: 42n * e6 }]);
r = await run(T(26), { myAddress: tSeller, expected: '42.00' });
R.ok('TRON base58 address matches', r.mine.ok === true && r.amountCheck.ok === true);
r = await run(T(26), { myAddress: '41' + TSELLER_HEX.toUpperCase() });
R.ok('TRON hex (41…) address matches the same account', r.mine.ok === true);
const broken = tSeller.slice(0, -1) + (tSeller.endsWith('a') ? 'b' : 'a');
r = await run(T(26), { myAddress: broken });
R.ok('TRON address with a typo (bad checksum) -> invalid, not a match', r.mine.invalid === true && r.verdict === 'green');
r = await run(T(26), { myAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' });
R.ok('other TRON address -> RED not-mine', r.verdict === 'red' && r.kind === 'not-mine');
r = await run(T(26), { myAddress: '0x' + TSELLER_HEX });
R.ok('0x address on a TRON payment -> invalid, not silently matched', r.mine.invalid === true);

// ---------- 6. nodes that fail, lie or talk nonsense ----------
const real = () => { world(); addEvmTx(w, 'bsc', H(30), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: e18 }]); };
real(); for (const u of EP.bsc) w.faults[u] = 'timeout';
r = await run(H(30));
R.ok('all BSC nodes time out -> could not check', r.verdict === 'error');
real(); for (const u of EP.bsc) w.faults[u] = 'garbage';
r = await run(H(30));
R.ok('all BSC nodes answer garbage -> could not check', r.verdict === 'error');
real(); for (const u of EP.bsc) w.faults[u] = 'html';
r = await run(H(30));
R.ok('all BSC nodes answer an HTML page -> could not check', r.verdict === 'error');
real(); for (const u of EP.bsc) w.faults[u] = 'shape';
r = await run(H(30));
R.ok('all BSC nodes answer a wrong shape -> could not check', r.verdict === 'error');
real(); w.faults['http://bsc-b'] = 'lie';
r = await run(H(30));
R.ok('one node lies about the amount -> could not check (not green)', r.verdict === 'error', r.title);
real(); w.faults['http://bsc-a'] = 'timeout'; w.faults['http://bsc-b'] = 'http500';
r = await run(H(30));
R.ok('two nodes down, two others agree -> green', r.verdict === 'green');
real(); w.faults['http://bsc-a'] = 'timeout'; w.faults['http://bsc-b'] = 'http500'; w.faults['http://bsc-c'] = 'garbage';
r = await run(H(30));
R.ok('only one node answers -> could not check (no green from one source)', r.verdict === 'error');
real(); w.faults['http://bsc-a'] = 'null';
r = await run(H(30));
R.ok('one node has not seen the tx, other has -> could not check', r.verdict === 'error');
real(); w.bsc.tokens.set(USDT.bsc, { symbol: 'USDT', name: 'Tether USD', decimals: 6 });
r = await run(H(30));
R.ok('official contract reports odd decimals -> could not check', r.verdict === 'error');
world(); addTronTx(w, T(31), [{ token: USDT.tron, from: '55'.repeat(20), to: TSELLER_HEX, raw: e6 }]); w.faults['http://tron-b'] = 'timeout';
r = await run(T(31));
R.ok('TRON: one of two nodes times out -> could not check', r.verdict === 'error');
world(); addTronTx(w, T(32), [{ token: USDT.tron, from: '55'.repeat(20), to: TSELLER_HEX, raw: e6 }]); w.faults['http://tron-a'] = 'lie';
r = await run(T(32));
R.ok('TRON: one node lies about the recipient -> could not check', r.verdict === 'error');
world(); addTronTx(w, T(33), [{ token: USDT.tron, from: '55'.repeat(20), to: TSELLER_HEX, raw: e6 }]); w.faults['http://tron-a'] = 'garbage';
r = await run(T(33));
R.ok('TRON: garbage from a node -> could not check', r.verdict === 'error');
// a fetch that throws synchronously, and one that returns nonsense objects
real();
r = await C.check(H(30), { fetch: () => { throw new Error('boom'); }, endpoints: EP, timeoutMs: 200 });
R.ok('fetch throws -> could not check', r.verdict === 'error');
r = await C.check(H(30), { fetch: async () => ({ ok: true, status: 200, text: async () => 'null' }), endpoints: EP, timeoutMs: 200 });
R.ok('nodes answer "null" -> could not check', r.verdict === 'error');
r = await C.check(H(30), { fetch: async () => ({ ok: true, status: 200, text: async () => '{"jsonrpc":"2.0","id":1,"result":null}' }), endpoints: EP, timeoutMs: 200 });
R.ok('every node and every call answers result:null (also eth_blockNumber) -> could not check', r.verdict === 'error');

// ---------- 7. input that is not a payment ----------
world();
r = await run('0x' + '12'.repeat(20));
R.ok('an address pasted -> "This is a wallet address, not a payment"', r.verdict === 'input' && /wallet address/.test(r.title));
r = await run('https://bscscan-tx.com/tx/0x' + 'ab'.repeat(32));
R.ok('fake explorer link: warning kept on the result, hash still checked', r.link && r.link.official === false && r.verdict === 'notfound');

// never words we promised not to say
const all = JSON.stringify(R.rows) + require('fs').readFileSync(new URL('../site/check-core.js', import.meta.url), 'utf8');
R.ok('core never says "safe", "guaranteed" or "100%"', !/\bsafe\b|guarantee|100%/i.test(require('fs').readFileSync(new URL('../site/check-core.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
void all; void abiString;

const ok = R.done();
process.exit(ok ? 0 : 1);
