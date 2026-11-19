/* t106: X Layer in the USDT checker (site/check-core.js) and the published
   payment rule (TapeOut circuit), against fake nodes (usdtmock.mjs).

   1. Off by default: X Layer is not asked, OKX explorer links are not
      special, titles are the old ones — the live site does not change.
   2. On (opts.xlayer): USDT0 and Circle USDC are real; a token named USDT
      at another contract is fake; OKX's old bridged USDT, the old bridged
      USDC and USDC.e are amber, never green and never "fake"; 20
      confirmations; two nodes must agree; explorers recognised by path.
   3. The rule: for every verdict the checker gives (all four networks),
      the facts it found, run through the netlist, give the same colour.
   4. With RULE_CIRCUIT set: each verdict is cross-checked on two X Layer
      nodes; a circuit that disagrees means no verdict; X Layer down keeps the
      verdict but says it is unconfirmed.

   Run: cd audit && node t106-xlayer-check.mjs */
import { createRequire } from 'module';
import { reporter } from './boot.mjs';
import { makeWorld, addEvmTx, addTronTx, mockFetch, USDT, USDC, abiString } from './usdtmock.mjs';
import { build, evalNetlist } from '../tools/xlayer/tapeout/circuit.mjs';
const require = createRequire(import.meta.url);
require('../site/check-core.js');
const EL = require('../www/lib/ethers.umd.min.js');
const C = globalThis.UsdtCheck;
const R = reporter();

const EP = {
  bsc: ['http://bsc-a', 'http://bsc-b', 'http://bsc-c'],
  eth: ['http://eth-a', 'http://eth-b'],
  tron: ['http://tron-a', 'http://tron-b', 'http://tron-c'],
  xlayer: ['http://xl-a', 'http://xl-b', 'http://xl-c']
};
const H = n => '0x' + n.toString(16).padStart(2, '0').repeat(32);
const SELLER = '0x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a', OTHER = '0x7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b';
const BUYER = '0x1212121212121212121212121212121212121212', FAKE = '0xfa4efa4efa4efa4efa4efa4efa4efa4efa4efa4e';
const e6 = 10n ** 6n, e18 = 10n ** 18n;
let w;
const world = () => { w = makeWorld(); w.xlayer.tokens.set(FAKE, { symbol: 'USDT', name: 'Tether USD', decimals: 6 }); return w; };
const run = (input, opts = {}) => C.check(input, Object.assign({ fetch: mockFetch(w, EP), endpoints: EP, timeoutMs: 300, xlayer: false, ruleCircuit: null }, opts));
const runLive = (input, opts = {}) => C.check(input, Object.assign({ fetch: mockFetch(w, EP), endpoints: EP, timeoutMs: 300 }, opts));   // the committed defaults
const runX = (input, opts = {}) => run(input, Object.assign({ xlayer: true }, opts));
const xlCalls = () => w.calls.filter(c => c.startsWith('xlayer ')).length;

// ---------- the tables ----------
R.ok('live since 19 Nov 2026: XLAYER_ON true, RULE_CIRCUIT = CPU #434 circuit #1 on X Layer',
  C.XLAYER_ON === true && C.RULE_CIRCUIT && C.RULE_CIRCUIT.circuits === '0x9C5BDCB1b6c2AFFc3863b08CDe0D2bbb2D7B7fCE' && C.RULE_CIRCUIT.id === 1);
R.ok('X Layer official: USDT0 and Circle USDC, 6 decimals', C.OFFICIAL.xlayer[USDT.xlayer.slice(2)].sym === 'USDT' && C.OFFICIAL.xlayer[USDC.xlayer.slice(2)].sym === 'USDC' &&
  Object.values(C.OFFICIAL.xlayer).every(x => x.decimals === 6) && Object.keys(C.OFFICIAL.xlayer).length === 2);
R.ok('old bridged USDT / USDC / USDC.e are listed as not-the-issuer\'s', [USDT.xlayerOld, USDC.xlayerE, '0x74b7f16337b8972027f6196a17a631ac6de26d22'].every(a => !!C.DISCONTINUED.xlayer[a.slice(2)] && !C.OFFICIAL.xlayer[a.slice(2)]));
R.ok('X Layer nodes: OKX and dRPC first (two operators)', C.ENDPOINTS.xlayer[0] === 'https://rpc.xlayer.tech' && C.ENDPOINTS.xlayer[1] === 'https://xlayer.drpc.org');
R.ok('X Layer: 20 confirmations, OKB, explorer web3.okx.com/explorer/x-layer', C.NETWORKS.xlayer.minConf === 20 && C.NETWORKS.xlayer.native === 'OKB' && C.NETWORKS.xlayer.explorerTx('0xab') === 'https://web3.okx.com/explorer/x-layer/tx/0xab');
R.ok('eval selector = keccak("eval(uint256,bytes)")', EL.utils.id('eval(uint256,bytes)').slice(2, 10) === '934d06ea');

// ---------- 1. off: nothing changes ----------
world();
addEvmTx(w, 'xlayer', H(1), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 25n * e6 }]);
let r = await run(H(1));
R.ok('off: an X Layer-only payment is "not found on BNB Chain, Ethereum or TRON" (as before)', r.verdict === 'notfound' && r.title === 'Not found on BNB Chain, Ethereum or TRON');
R.ok('off: X Layer nodes are never asked', xlCalls() === 0);
R.ok('off: an OKX X Layer explorer link is not official (as before)', C.parseInput('https://web3.okx.com/explorer/x-layer/tx/' + H(1)).link.official === false);

// ---------- 2. on ----------
r = await runX(H(1));
R.ok('on: USDT0 on X Layer -> green "Real USDT"', r.verdict === 'green' && r.network === 'xlayer' && r.networkName === 'X Layer' && r.title === 'Real USDT', r.title);
R.ok('on: amount 25 USDT, explorer link to web3.okx.com', r.transfers[0].amount === '25' && r.explorer === 'https://web3.okx.com/explorer/x-layer/tx/' + H(1));
R.ok('on: two X Layer nodes asked', new Set(w.calls.filter(c => c.startsWith('xlayer ')).map(c => c.split(' ')[1])).size >= 2);
world(); addEvmTx(w, 'xlayer', H(2), [{ token: USDC.xlayer, from: BUYER, to: SELLER, raw: 7n * e6 }]);
r = await runX(H(2), { myAddress: SELLER, expected: '7' });
R.ok('on: Circle USDC to my address, amount matches -> green', r.verdict === 'green' && r.mine.ok && r.amountCheck.ok && r.title === 'Real USDC');
r = await runX(H(2), { myAddress: OTHER });
R.ok('on: real USDC to someone else -> red not-mine', r.verdict === 'red' && r.kind === 'not-mine');
world(); addEvmTx(w, 'xlayer', H(3), [{ token: FAKE, from: BUYER, to: SELLER, raw: 1000n * e6 }]);
r = await runX(H(3));
R.ok('on: "USDT" at another contract -> red fake, names the real USDT0 contract', r.verdict === 'red' && r.kind === 'fake' && r.transfers[0].realContract === USDT.xlayer);
world(); addEvmTx(w, 'xlayer', H(4), [{ token: USDT.xlayerOld, from: BUYER, to: SELLER, raw: 5n * e6 }]);
r = await runX(H(4));
R.ok('on: OKX\'s old bridged USDT -> amber, not fake, not green', r.verdict === 'amber' && r.kind === 'discontinued' && /Old bridged USDT on X Layer/.test(r.title));
world(); addEvmTx(w, 'xlayer', H(5), [{ token: USDC.xlayerE, from: BUYER, to: SELLER, raw: 5n * e6 }]);
r = await runX(H(5));
R.ok('on: USDC.e -> amber "not Circle\'s USDC"', r.verdict === 'amber' && r.kind === 'discontinued' && /USDC\.e on X Layer/.test(r.title));
world(); addEvmTx(w, 'xlayer', H(6), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 5n * e6 }], { conf: 19 });
r = await runX(H(6));
R.ok('on: 19 confirmations -> amber wait (needs 20)', r.verdict === 'amber' && r.kind === 'wait' && /19 of 20/.test(r.text));
world(); addEvmTx(w, 'xlayer', H(6), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 5n * e6 }], { conf: 20 });
R.ok('on: 20 confirmations -> green', (await runX(H(6))).verdict === 'green');
world(); w.xlayer.tokens.set(USDT.xlayer, { symbol: 'USDT0', name: 'USDT0', decimals: 18 });
addEvmTx(w, 'xlayer', H(7), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 5n * e6 }]);
R.ok('on: USDT0 answering 18 decimals -> could not check', (await runX(H(7))).verdict === 'error');
world(); addEvmTx(w, 'xlayer', H(8), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 5n * e6 }]);
w.faults['http://xl-a'] = 'lie';
r = await runX(H(8));
R.ok('on: one X Layer node lies -> could not check (never green)', r.verdict === 'error', r.verdict);
world(); addEvmTx(w, 'xlayer', H(8), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 5n * e6 }]);
w.faults['http://xl-a'] = 'http500';
R.ok('on: one X Layer node down -> the third answers, green', (await runX(H(8))).verdict === 'green');
world(); addEvmTx(w, 'xlayer', H(8), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 5n * e6 }]);
w.faults['http://xl-a'] = w.faults['http://xl-b'] = 'timeout';
R.ok('on: two of three X Layer nodes down -> could not check', (await runX(H(8))).verdict === 'error');
world();
r = await runX(H(9));
R.ok('on: nowhere -> "Not found on BNB Chain, Ethereum, TRON or X Layer"', r.verdict === 'notfound' && r.title === 'Not found on BNB Chain, Ethereum, TRON or X Layer');
world(); addEvmTx(w, 'bsc', H(10), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }]);
r = await runX(H(10));
R.ok('on: a BNB Chain payment is still judged on BNB Chain', r.verdict === 'green' && r.network === 'bsc');
addEvmTx(w, 'xlayer', H(10), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 3n * e6 }]);
R.ok('on: the same hash on BNB Chain and X Layer -> could not check', (await runX(H(10))).verdict === 'error');
world(); addEvmTx(w, 'xlayer', H(11), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 1n * e6 }], { pending: true });
R.ok('on: pending on X Layer -> amber pending', (await runX(H(11))).kind === 'pending');

// explorers
const L = u => C.parseInput(u, { xlayer: true }).link;
const tx = '/tx/' + H(1);
R.ok('explorer: web3.okx.com/explorer/x-layer is official X Layer', L('https://web3.okx.com/explorer/x-layer' + tx).official && L('https://web3.okx.com/explorer/x-layer' + tx).network === 'xlayer');
R.ok('explorer: www.okx.com/web3/explorer/xlayer (older address) is official', L('https://www.okx.com/web3/explorer/xlayer' + tx).official);
R.ok('explorer: with a language segment (okx.com/zh-hans/web3/explorer/xlayer)', L('https://www.okx.com/zh-hans/web3/explorer/xlayer' + tx).official);
R.ok('explorer: oklink.com/x-layer is official', L('https://www.oklink.com/x-layer' + tx).official);
R.ok('explorer: x-layer-testnet / xlayer-test are test networks', L('https://web3.okx.com/explorer/x-layer-testnet' + tx).testnet && L('https://www.okx.com/web3/explorer/xlayer-test' + tx).testnet && L('https://www.oklink.com/x-layer-testnet' + tx).testnet);
R.ok('explorer: okx.com without /explorer/ is not an explorer', !L('https://web3.okx.com/x-layer' + tx).official);
R.ok('explorer: oklink.com for another chain stays not-official (as before)', !L('https://www.oklink.com/bsc' + tx).official);
R.ok('explorer: look-alike hosts are not official', !L('https://web3.okx.com.evil.io/explorer/x-layer' + tx).official && !L('https://web3-okx.com/explorer/x-layer' + tx).official && !L('https://web3.0kx.com/explorer/x-layer' + tx).official);
R.ok('explorer: punycode host is not official', !L('https://xn--kx-xxa.com/explorer/x-layer' + tx).official);
R.ok('explorer: bscscan still official, hash still found', L('https://bscscan.com' + tx).official && C.parseInput('https://web3.okx.com/explorer/x-layer' + tx, { xlayer: true }).hash === H(1).slice(2));

// ---------- 3. the rule agrees with every verdict ----------
const nl = build();
const colourOf = byte => { const o = evalNetlist(nl.hex, 7, 2, [byte])[0]; return o & 1 ? 'green' : o & 2 ? 'red' : 'amber'; };
const scen = [];
const T = n => n.toString(16).padStart(2, '0').repeat(32);
world();
addEvmTx(w, 'bsc', H(20), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }]); scen.push([H(20), {}]); scen.push([H(20), { myAddress: OTHER }]); scen.push([H(20), { myAddress: SELLER }]); scen.push([H(20), { myAddress: 'garbage' }]);
addEvmTx(w, 'bsc', H(21), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }], { conf: 3 }); scen.push([H(21), {}]); scen.push([H(21), { myAddress: OTHER }]);
addEvmTx(w, 'eth', H(22), [{ token: USDT.eth, from: BUYER, to: SELLER, raw: 3n * e6 }], { status: 0 }); scen.push([H(22), {}]);
addEvmTx(w, 'eth', H(23), [{ token: USDT.eth, from: BUYER, to: SELLER, raw: 3n * e6 }], { pending: true }); scen.push([H(23), {}]);
addEvmTx(w, 'xlayer', H(24), [{ token: FAKE, from: BUYER, to: SELLER, raw: 3n * e6 }, { token: USDT.xlayer, from: BUYER, to: SELLER, raw: 1n * e6 }]); scen.push([H(24), { myAddress: SELLER }]);
addEvmTx(w, 'xlayer', H(25), [{ token: USDT.xlayerOld, from: BUYER, to: SELLER, raw: 3n * e6 }]); scen.push([H(25), {}]);
addEvmTx(w, 'xlayer', H(26), [], { value: 10n ** 17n }); scen.push([H(26), {}]);
addEvmTx(w, 'xlayer', H(27), [{ token: FAKE, from: BUYER, to: SELLER, raw: 3n * e6 }], { conf: 1 }); scen.push([H(27), {}]);
addTronTx(w, T(28), [{ token: USDT.tron, from: '55'.repeat(20), to: '9c'.repeat(20), raw: 5n * e6 }]); scen.push([T(28), {}]);
addTronTx(w, T(29), [{ token: USDT.tron, from: '55'.repeat(20), to: '9c'.repeat(20), raw: 5n * e6 }], { solid: false }); scen.push([T(29), {}]);
addTronTx(w, T(30), [{ token: USDC.tronOld, from: '55'.repeat(20), to: '9c'.repeat(20), raw: 5n * e6 }]); scen.push([T(30), {}]);
let agree = 0, withFacts = 0; const seen = new Set();
for (const [h, o] of scen){
  const res = await runX(h, o);
  if (!res.facts) continue;
  withFacts++; seen.add(res.verdict + '/' + res.kind);
  if (colourOf(C.factsByte(res.facts)) === res.verdict) agree++;
  else console.log('   disagree:', h.slice(0, 8), res.verdict, res.kind, JSON.stringify(res.facts));
}
R.ok('rule circuit = checker verdict for all ' + scen.length + ' scenarios (BNB, ETH, TRON, X Layer)', withFacts === scen.length && agree === withFacts, agree + '/' + withFacts + ' ' + [...seen].join(' '));
R.ok('scenarios cover green, red (fake, not-mine), amber (wait, pending, failed, discontinued, native)', ['green/real', 'red/fake', 'red/not-mine', 'amber/wait', 'amber/pending', 'amber/failed', 'amber/discontinued', 'amber/native'].every(k => seen.has(k)), [...seen].join(' '));

// ---------- 4. cross-check against the taped-out circuit ----------
const CIRC = { circuits: '0x00000000000000000000000000000000000c1aa1', id: 1 };
const withCircuit = () => { world(); w.circuit = { address: CIRC.circuits, id: 1, netlist: nl.hex, nIn: 7, nOut: 2 }; w.evals = 0; };
withCircuit(); addEvmTx(w, 'bsc', H(40), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }]);
r = await run(H(40), { ruleCircuit: CIRC });
R.ok('circuit: green confirmed by the circuit on two X Layer nodes', r.verdict === 'green' && r.circuit.state === 'agrees' && r.circuit.output === 1 && w.evals === 2);
R.ok('circuit: works with X Layer payments off (only eval is asked there)', w.calls.filter(c => c.startsWith('xlayer ')).length === 2);
r = await run(H(40), { ruleCircuit: CIRC, myAddress: OTHER });
R.ok('circuit: red confirmed (output REJECT)', r.verdict === 'red' && r.circuit.state === 'agrees' && r.circuit.output === 2);
withCircuit(); addEvmTx(w, 'bsc', H(41), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }], { conf: 2 });
r = await run(H(41), { ruleCircuit: CIRC });
R.ok('circuit: amber confirmed (neither output)', r.verdict === 'amber' && r.circuit.state === 'agrees' && r.circuit.output === 0);
withCircuit(); addEvmTx(w, 'bsc', H(42), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }]);
w.circuit.lie = true;
r = await run(H(42), { ruleCircuit: CIRC });
R.ok('circuit disagrees -> no verdict ("could not check"), says why', r.verdict === 'error' && r.circuit.state === 'mismatch' && /TapeOut circuit #1 on X Layer/.test(r.text) && !r.transfers);
withCircuit(); addEvmTx(w, 'bsc', H(43), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }]);
w.faults['http://xl-a'] = 'timeout';
r = await run(H(43), { ruleCircuit: CIRC });
R.ok('X Layer node down -> verdict kept, marked unconfirmed', r.verdict === 'green' && r.circuit.state === 'unavailable');
withCircuit(); addEvmTx(w, 'bsc', H(44), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }]);
w.faults['http://xl-b'] = 'lie';
r = await run(H(44), { ruleCircuit: CIRC });
R.ok('X Layer nodes disagree about the circuit -> unconfirmed, not mismatch', r.verdict === 'green' && r.circuit.state === 'unavailable');
withCircuit(); addEvmTx(w, 'bsc', H(45), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }]);
r = await run(H(45), { ruleCircuit: { circuits: CIRC.circuits, id: 2 } });
R.ok('a circuit id that does not exist -> unconfirmed', r.verdict === 'green' && r.circuit.state === 'unavailable');
withCircuit(); addEvmTx(w, 'bsc', H(46), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }]);
r = await run(H(46));
R.ok('RULE_CIRCUIT null: no eval, no circuit field', !r.circuit && w.evals === 0 && xlCalls() === 0);
/* the committed defaults: X Layer payments found, and every verdict cross-checked with the real circuit's address */
world(); w.circuit = { address: C.RULE_CIRCUIT.circuits.toLowerCase(), id: 1, netlist: nl.hex, nIn: 7, nOut: 2 }; w.evals = 0;
addEvmTx(w, 'xlayer', H(47), [{ token: USDT.xlayer, from: BUYER, to: SELLER, raw: 25n * e6 }]);
r = await runLive(H(47));
R.ok('defaults: an X Layer USDT0 payment is found and green, and the circuit agrees', r.verdict === 'green' && r.network === 'xlayer' && r.circuit && r.circuit.state === 'agrees', JSON.stringify({ v: r.verdict, n: r.network, c: r.circuit }));
world(); w.circuit = { address: C.RULE_CIRCUIT.circuits.toLowerCase(), id: 1, netlist: nl.hex, nIn: 7, nOut: 2 }; w.evals = 0;
addEvmTx(w, 'bsc', H(48), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 3n * e18 }]);
r = await runLive(H(48));
R.ok('defaults: a BNB payment is still green, cross-checked on X Layer', r.verdict === 'green' && r.circuit && r.circuit.state === 'agrees');
withCircuit();
r = await run(H(47), { ruleCircuit: CIRC });
R.ok('not found: nothing to cross-check, no eval', r.verdict === 'notfound' && w.evals === 0);

process.exit(R.done() ? 0 : 1);
