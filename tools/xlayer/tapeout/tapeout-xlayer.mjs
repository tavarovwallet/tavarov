#!/usr/bin/env node
/* Tape out the checker's payment-acceptance rule (circuit.mjs) on X Layer
   mainnet with TapeOut. Same keystore as deploy-xlayer.mjs.

     node tools/xlayer/tapeout/tapeout-xlayer.mjs plan     dry run: reads fees, simulates, sends nothing
     node tools/xlayer/tapeout/tapeout-xlayer.mjs run      createCPU → mint NANDs → tapeout → check every input
     node tools/xlayer/tapeout/tapeout-xlayer.mjs check    evaluate the taped-out circuit for all 128 inputs

   Environment: XLAYER_KEYSTORE, XLAYER_KEYSTORE_PASSWORD, XLAYER_RPC, XLAYER_YES,
   XLAYER_FROM (plan without a keystore), XLAYER_TAPEOUT_STATE (default tools/xlayer/state-tapeout-196.json).

   WHAT IT DOES (each step skipped when the state file and the chain show it done):
     1. createCPU("Tavarov Pay rules", "TVPAY", story, 10000, mint price 0) on the TapeOut factory
        — our own processor, so the transistors cost nothing but TapeOut's fees;
     2. mint as many NAND transistors as the circuit has gates (one call);
     3. tapeout(netlist, 7, 2) — burns those NANDs, the circuit becomes NFT #1 of our processor;
     4. eval() the circuit for all 128 inputs (free view calls) and compare with the JavaScript rule.
   Prints the processor (circuits contract) address and circuit id: those go
   into site/check-core.js (RULE_CIRCUIT) and into the hackathon form.

   Fees (checked on chain 19 Nov 2026; "plan" prints the current ones):
     createCPU  deployFee 0.1 BEM, pulled by the factory with transferFrom
     mint       protocolFee 0.01 BEM (+ mint price, 0 for our processor),
                pulled by the processor's transistors contract
     tapeout    TAPEOUT_FEE 0.0013 OKB, sent as value
   BEM is TapeOut's ERC-20 on X Layer (factory.bem(), 0x60e6…3952, 8
   decimals; NOT the BEM on BNB Chain). Before each BEM step the tool
   approves exactly that step's fee to exactly that contract, nothing more.
   On 27 Oct all three were in OKB; TapeOut moved the first two to BEM since.

   Addresses: TapeOutProtocol/TapeKit kernel/src/config.js (XLAYER_MAINNET,
   "read-only checked on mainnet 2026-09-19"). The script checks that code
   exists there before using it. TapeOut contracts are upgradeable and not
   audited (their own words); nothing of ours depends on them holding money. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E, HERE as XL, client, fmt, feeFields, keystorePath, keystoreAddress, unlock, askLine } from '../lib.mjs';
import { build, rule, byteToFacts, N_IN, N_OUT } from './circuit.mjs';

export const TAPEOUT = {
  chainId: 196,
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  bem: '0x60e62efa9405d6873c5deabd4e6cc91c25363952',   // factory.bem() on 19 Nov 2026
  /* Storage of that BEM contract, read on chain 19 Nov 2026 (balance of the
     BEM/WOKB pool at mapping slot 5): balances slot 5, allowances slot 6.
     Only used by "plan" to simulate createCPU as if the BEM were there. */
  bemSlots: { balances: 5, allowances: 6 },
  rpcs: ['https://rpc.xlayer.tech', 'https://xlayer.drpc.org']
};
const NAND = 0n;
const CPU = { name: 'Tavarov Pay rules', symbol: 'TVPAY', supply: 10000n, mintPrice: 0n,
  story: 'Payment rules of Tavarov Pay, taped out. Circuit #1 decides whether a USDT/USDC payment checked by tavarov.com/en/check is accepted: inputs are facts read from the chain, outputs are ACCEPT and REJECT. https://tavarov.com' };

export const ABI = new E.utils.Interface([
  'function deployFee() view returns (uint256)',
  'function protocolFee() view returns (uint256)',
  'function cpuCount() view returns (uint256)',
  'function cpuAt(uint256) view returns (address)',
  'function createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address, address)',
  'event CPUCreated(address indexed circuits, address indexed transistors, address indexed creator, string name, uint256 supply, uint256 mintPrice)',
  'function mint(uint256 id, uint256 amount) payable',
  'function mintPrice() view returns (uint256)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function TAPEOUT_FEE() view returns (uint256)',
  'function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)',
  'event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)',
  'function nextId() view returns (uint256)',
  'function transistors() view returns (address)',
  'function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)',
  'function netlist(uint256 id) view returns (bytes)',
  'function eval(uint256 id, bytes inputs) view returns (bytes)',
  'function ownerOf(uint256 id) view returns (address)',
  'function bem() view returns (address)'
]);
export const ERC20 = new E.utils.Interface([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
]);
const fmtBem = v => fmt(v, 8);

export function config(env = process.env){
  return {
    rpcs: env.XLAYER_RPC ? [env.XLAYER_RPC] : TAPEOUT.rpcs,
    keystore: keystorePath(env), yes: env.XLAYER_YES === '1',
    from: env.XLAYER_FROM && /^0x[0-9a-fA-F]{40}$/.test(env.XLAYER_FROM) ? env.XLAYER_FROM : null,
    stateFile: env.XLAYER_TAPEOUT_STATE || path.join(XL, 'state-tapeout-196.json')
  };
}
const loadState = f => { try{ return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e){ return {}; } };
const saveState = (f, st) => fs.writeFileSync(f, JSON.stringify(st, null, 2) + '\n');

async function read(c, to, fn, args = []){
  const r = await c.call(to, ABI.encodeFunctionData(fn, args));
  return ABI.decodeFunctionResult(fn, r);
}

async function erc(c, to, fn, args = []){
  return ERC20.decodeFunctionResult(fn, await c.call(to, ERC20.encodeFunctionData(fn, args)))[0];
}

async function fees(c){
  const deployFee = (await read(c, TAPEOUT.factory, 'deployFee'))[0].toBigInt();
  const protocolFee = (await read(c, TAPEOUT.factory, 'protocolFee'))[0].toBigInt();
  const bem = (await read(c, TAPEOUT.factory, 'bem'))[0].toLowerCase();
  return { deployFee, protocolFee, bem };
}

/* eth_call state override: `from` holds `amount` BEM and has allowed `spender` to take it. */
function bemOverride(from, spender, amount){
  const k = (a, slot) => E.utils.keccak256(E.utils.defaultAbiCoder.encode(['address', 'bytes32'], [a, slot]));
  const pad = n => E.utils.hexZeroPad(E.utils.hexlify(n), 32);
  const v = E.utils.hexZeroPad(E.utils.hexlify(E.BigNumber.from(amount.toString())), 32);
  const S = TAPEOUT.bemSlots;
  return { [TAPEOUT.bem]: { stateDiff: { [k(from, pad(S.balances))]: v, [k(spender, k(from, pad(S.allowances)))]: v } } };
}

export async function plan(cfg, opts = {}){
  const log = opts.log || console.log;
  const c = client(cfg.rpcs, opts);
  const from = opts.from || cfg.from || keystoreAddress(cfg.keystore);
  const chain = parseInt(await c.rpc('eth_chainId'), 16);
  if (chain !== TAPEOUT.chainId) throw new Error('The node is on chain ' + chain + ', not X Layer mainnet (196). TapeOut is on mainnet only.');
  const code = await c.code(TAPEOUT.factory);
  if (!code || code === '0x') throw new Error('No TapeOut factory at ' + TAPEOUT.factory);
  const nl = build();
  const f = await fees(c);
  const tapeoutFee = 1300000000000000n;          // TAPEOUT_FEE lives on the circuits contract, which does not exist yet; read for real in run
  const bemNeed = f.deployFee + f.protocolFee;   // our mint price is 0
  const okbNeed = tapeoutFee + 2n * 10n ** 15n;  // + gas for 5 transactions, generously
  log('deployer     ' + from);
  log('circuit      ' + nl.gates + ' NAND gates, ' + N_IN + ' inputs, ' + N_OUT + ' outputs, ' + (nl.hex.length - 2) / 2 + ' bytes');
  log('fee token    BEM ' + f.bem + ' (X Layer)' + (f.bem === TAPEOUT.bem ? '' : '  ← NOT the one checked on 19 Nov (' + TAPEOUT.bem + ')'));
  log('fees         createCPU ' + fmtBem(f.deployFee) + ' BEM + mint ' + fmtBem(f.protocolFee) + ' BEM = ' + fmtBem(bemNeed) + ' BEM; tapeout ≈' + fmt(tapeoutFee) + ' OKB; plus gas');
  const bemBal = (await erc(c, f.bem, 'balanceOf', [from])).toBigInt();
  const okbBal = BigInt(await c.rpc('eth_getBalance', [from, 'latest']));
  log('balance      ' + fmtBem(bemBal) + ' BEM, ' + fmt(okbBal) + ' OKB');
  /* createCPU is the only step that can be simulated before the processor
     exists. Without BEM approved yet it reverts on the allowance, so it runs
     as if 1 BEM were there and approved (state override) and 1 OKB for gas. */
  let simOk = true;
  const ov = f.bem === TAPEOUT.bem ? bemOverride(from, TAPEOUT.factory, 10n ** 8n) : {};
  ov[from] = { balance: '0x' + (10n ** 18n).toString(16) };
  try{
    await c.rpc('eth_call', [{ from, to: TAPEOUT.factory, value: '0x0',
      data: ABI.encodeFunctionData('createCPU', [CPU.name, CPU.symbol, CPU.story, CPU.supply, CPU.mintPrice]) }, 'latest', ov]);
  } catch(e){
    simOk = false;
    log('PROBLEM      createCPU simulation failed: ' + e.message);
  }
  if (simOk) log('simulation   createCPU runs (paid in BEM, no OKB value)');
  const okBem = bemBal >= bemNeed, okOkb = okbBal >= okbNeed;
  if (!okBem) log('PROBLEM      need ' + fmtBem(bemNeed) + ' BEM on ' + from + ' (has ' + fmtBem(bemBal) + '): BEM on X Layer, contract ' + f.bem);
  if (!okOkb) log('PROBLEM      need about ' + fmt(okbNeed) + ' OKB on ' + from);
  const total = { bem: bemNeed, okb: tapeoutFee };
  return { ok: simOk && okBem && okOkb, fees: f, total, netlist: nl };
}

export async function run(cfg, opts = {}){
  const log = opts.log || console.log;
  const c = client(cfg.rpcs, opts);
  const wallet = opts.wallet || await unlock(cfg.keystore);
  const from = wallet.address;
  const chain = parseInt(await c.rpc('eth_chainId'), 16);
  if (chain !== TAPEOUT.chainId) throw new Error('Not X Layer mainnet (chain ' + chain + ').');
  const nl = build();
  const st = loadState(cfg.stateFile);
  const save = () => saveState(cfg.stateFile, st);
  if (!cfg.yes && !opts.yes){
    const a = await askLine('Create the processor and tape out ' + nl.gates + ' gates on X Layer from ' + from + '? Type "yes": ');
    if (a !== 'yes') throw new Error('Not confirmed, nothing sent.');
  }
  async function send(to, data, value, label){
    const tx = { from, to, data, value: '0x' + value.toString(16) };
    try{ await c.rpc('eth_call', [tx, 'latest']); }
    catch(e){ throw new Error(label + ': simulation says it would fail: ' + e.message); }
    let gas = 1000000n;
    try{ gas = BigInt(await c.rpc('eth_estimateGas', [tx])) * 13n / 10n; } catch(e){}
    const nonce = Number(BigInt(await c.rpc('eth_getTransactionCount', [from, 'pending'])));
    const signed = await wallet.signTransaction(Object.assign({ to, data, value, nonce, gasLimit: gas, chainId: TAPEOUT.chainId }, await feeFields(c)));
    const hash = await c.rpc('eth_sendRawTransaction', [signed]);
    log('  sent       ' + label + '  ' + hash);
    for (let i = 0; i < 240; i++){
      const r = await c.rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r && r.blockNumber){
        if (BigInt(r.status) !== 1n) throw new Error(label + ': the network rejected ' + hash);
        /* Let the other nodes catch up before the next read. */
        await new Promise(res => setTimeout(res, opts.settleMs != null ? opts.settleMs : 3000));
        return r;
      }
      await new Promise(res => setTimeout(res, opts.pollMs || 1500));
    }
    throw new Error(label + ': not confirmed in 6 minutes: ' + hash);
  }

  /* Let `spender` take exactly `amount` BEM from us (only if it may not already). */
  async function payBem(bem, spender, amount, label){
    const bal = (await erc(c, bem, 'balanceOf', [from])).toBigInt();
    if (bal < amount) throw new Error(label + ': needs ' + fmtBem(amount) + ' BEM on ' + from + ', it has ' + fmtBem(bal) + ' (BEM on X Layer, contract ' + bem + '). Nothing more was sent.');
    const have = (await erc(c, bem, 'allowance', [from, spender])).toBigInt();
    if (have >= amount) return;
    await send(bem, ERC20.encodeFunctionData('approve', [spender, amount]), 0n, 'approve ' + fmtBem(amount) + ' BEM for ' + label);
  }

  if (!st.circuits){
    const f = await fees(c);
    await payBem(f.bem, TAPEOUT.factory, f.deployFee, 'createCPU');
    const r = await send(TAPEOUT.factory, ABI.encodeFunctionData('createCPU', [CPU.name, CPU.symbol, CPU.story, CPU.supply, CPU.mintPrice]), 0n, 'createCPU');
    const ev = r.logs.map(l => { try{ return ABI.parseLog(l); } catch(e){ return null; } }).find(x => x && x.name === 'CPUCreated');
    if (!ev || ev.args.creator.toLowerCase() !== from.toLowerCase()) throw new Error('createCPU: no CPUCreated event for us in ' + r.transactionHash);
    st.circuits = ev.args.circuits; st.transistors = ev.args.transistors; st.createTx = r.transactionHash;
    const count = (await read(c, TAPEOUT.factory, 'cpuCount'))[0].toBigInt();
    for (let i = count - 1n; i >= 0n && i >= count - 50n; i--){
      if ((await read(c, TAPEOUT.factory, 'cpuAt', [i]))[0].toLowerCase() === st.circuits.toLowerCase()){ st.cpuIndex = Number(i); break; }
    }
    save();
  }
  log('processor    ' + st.circuits + (st.cpuIndex != null ? ' (CPU #' + st.cpuIndex + ')' : '') + ', transistors ' + st.transistors);
  if (!st.circuitId){
    const have = (await read(c, st.transistors, 'balanceOf', [from, NAND]))[0].toBigInt();
    if (have < BigInt(nl.gates)){
      const price = (await read(c, st.transistors, 'mintPrice'))[0].toBigInt();
      const pf = (await read(c, st.transistors, 'protocolFee'))[0].toBigInt();
      const n = BigInt(nl.gates) - have;
      const bem = (await fees(c)).bem;
      await payBem(bem, st.transistors, n * price + pf, 'mint');
      await send(st.transistors, ABI.encodeFunctionData('mint', [NAND, n]), 0n, 'mint ' + n + ' NAND');
    }
    const fee = (await read(c, st.circuits, 'TAPEOUT_FEE'))[0].toBigInt();
    const r = await send(st.circuits, ABI.encodeFunctionData('tapeout', [nl.hex, N_IN, N_OUT]), fee, 'tapeout');
    const ev = r.logs.map(l => { try{ return ABI.parseLog(l); } catch(e){ return null; } }).find(x => x && x.name === 'TapedOut');
    if (!ev) throw new Error('tapeout: no TapedOut event in ' + r.transactionHash);
    st.circuitId = ev.args.circuitId.toNumber(); st.tapeoutTx = r.transactionHash; save();
  }
  const res = await check(cfg, Object.assign({}, opts, { state: st }));
  st.checked = res.ok; save();
  return { state: st, check: res };
}

/* Evaluate the circuit on chain for every one of the 128 inputs and compare with rule(). */
export async function check(cfg, opts = {}){
  const log = opts.log || console.log;
  const c = client(cfg.rpcs, opts);
  const st = opts.state || loadState(cfg.stateFile);
  if (!st.circuits || !st.circuitId) throw new Error('Nothing taped out yet (' + cfg.stateFile + ')');
  const nl = build();
  const problems = [];
  const onchain = (await read(c, st.circuits, 'netlist', [st.circuitId]))[0].toLowerCase();
  if (onchain !== nl.hex.toLowerCase()) problems.push('the netlist on chain is not ours');
  const info = await read(c, st.circuits, 'circuitInfo', [st.circuitId]);
  if (info.nIn !== N_IN || info.nOut !== N_OUT || info.nState !== 0 || info.gateCount !== nl.gates) problems.push('circuitInfo differs: ' + info.join(','));
  let bad = 0;
  for (let v = 0; v < 1 << N_IN; v++){
    const out = (await read(c, st.circuits, 'eval', [st.circuitId, '0x' + v.toString(16).padStart(2, '0')]))[0];
    const o = parseInt(String(out).slice(2, 4) || '0', 16);
    const want = rule(byteToFacts(v));
    if (!!(o & 1) !== want.accept || !!(o & 2) !== want.reject) bad++;
  }
  if (bad) problems.push(bad + ' of 128 inputs give a different answer on chain');
  if (problems.length){ problems.forEach(p => log('PROBLEM      ' + p)); return { ok: false, problems }; }
  log('');
  log('==== TAVAROV PAY RULE CIRCUIT: X LAYER ====');
  log('processor (circuits contract): ' + st.circuits);
  if (st.cpuIndex != null) log('CPU number:                    ' + st.cpuIndex);
  log('circuit id:                    ' + st.circuitId);
  log('gates:                         ' + nl.gates + ' NAND, inputs 7, outputs 2');
  log('checked on chain:              all 128 inputs = the JavaScript rule');
  log('put into site/check-core.js:   RULE_CIRCUIT = { circuits: \'' + st.circuits + '\', id: ' + st.circuitId + ' }');
  return { ok: true, problems: [] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const cmd = process.argv[2] || 'plan';
  (async () => {
    const cfg = config();
    if (cmd === 'plan'){ const r = await plan(cfg); process.exit(r.ok ? 0 : 1); }
    if (cmd === 'run'){ const r = await run(cfg); process.exit(r.check.ok ? 0 : 1); }
    if (cmd === 'check'){ const r = await check(cfg); process.exit(r.ok ? 0 : 1); }
    throw new Error('Unknown command "' + cmd + '". Use plan, run or check.');
  })().catch(e => { console.error('STOPPED: ' + (e && e.message || e)); process.exit(1); });
}
