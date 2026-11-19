/* t108: the payment rule as a TapeOut circuit (tools/xlayer/tapeout/).

   1. The netlist is exactly the rule: all 128 inputs, run through a NAND
      simulator written to TapeOut's published semantics, give the rule's
      answer; ACCEPT and REJECT are never both on.
   2. The simulator agrees with TapeOut's own published examples (the single
      NAND gate an X Layer DeWEB site taped out, and Cerebr's AND neuron).
   3. The rule is the checker's: for each kind of verdict site/check-core.js
      gives (see t106 for the real thing), the facts → rule → colour match.
   4. The tool against a fake X Layer node with a fake TapeOut (factory,
      transistors, circuits): plan sends nothing; run creates the processor,
      mints exactly 18 NANDs paying exactly the fees, tapes out the netlist
      with 7 inputs / 2 outputs, then checks all 128 inputs on chain; a
      second run sends nothing; a circuit that answers differently is caught.

   Run: cd audit && node t108-xlayer-tapeout.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reporter } from './boot.mjs';
import { makeNode, mockFetch, E } from './xlayermock.mjs';
import { build, rule, evalNetlist, byteToFacts, factsToByte, IN, N_IN, N_OUT } from '../tools/xlayer/tapeout/circuit.mjs';
import { ABI, TAPEOUT, config, plan, run, check } from '../tools/xlayer/tapeout/tapeout-xlayer.mjs';

const R = reporter();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 't108-'));

// ---------- 1. the netlist is the rule ----------
const nl = build();
let mism = 0, both = 0, acc = 0, rej = 0;
for (let v = 0; v < 128; v++){
  const f = byteToFacts(v), want = rule(f), o = evalNetlist(nl.hex, N_IN, N_OUT, [v])[0];
  if (!!(o & 1) !== want.accept || !!(o & 2) !== want.reject) mism++;
  if ((o & 3) === 3) both++;
  if (o & 1) acc++; if (o & 2) rej++;
}
R.ok('netlist = rule for all 128 inputs', mism === 0, mism + ' differ');
R.ok('ACCEPT and REJECT never both on', both === 0);
R.ok('ACCEPT on exactly the 3 input sets the rule allows', acc === 3, acc);       // addr/toSeller: 00, 11, 01
R.ok('18 NAND gates, 7 in, 2 out, 126 bytes', nl.gates === 18 && nl.nIn === 7 && nl.nOut === 2 && (nl.hex.length - 2) / 2 === 126);
R.ok('netlist uses only NAND elements (opcode 00 every 7 bytes)', Array.from({ length: 18 }, (_, i) => nl.hex.slice(2 + i * 14, 4 + i * 14)).every(x => x === '00'));
R.ok('facts ↔ byte round trip', [0, 1, 37, 127].every(v => factsToByte(byteToFacts(v)) === v) && IN.enough === 6);

// ---------- 2. TapeOut's own examples ----------
const nandOut = [0, 1, 2, 3].map(v => evalNetlist('0x00000002000003', 2, 1, [v])[0]);
R.ok('single NAND gate (the X Layer DeWEB example netlist 0x00000002000003)', nandOut.join() === '1,1,1,0');
const andOut = [0, 1, 2, 3].map(v => evalNetlist('0x0000000300000200000004000004', 2, 1, [v])[0]);
R.ok('Cerebr AND neuron 0x00000003…04: 0x03 → 0x01', andOut.join() === '0,0,0,1');
let threw = null; try{ evalNetlist('0x00000009000002', 2, 1, [0]); } catch(e){ threw = e.message; }
R.ok('a gate reading a future signal is refused (as on chain)', /future signal/.test(threw || ''));

// ---------- 3. the rule reads like the checker ----------
const F = (o) => Object.assign({ mined: 1, success: 1, real: 0, fake: 0, addr: 0, toSeller: 0, enough: 1 }, o);
const colour = f => { const r = rule(f); return r.accept ? 'green' : r.reject ? 'red' : 'amber'; };
const cases = [
  ['real USDT, confirmed', F({ real: 1 }), 'green'],
  ['real USDT to my address', F({ real: 1, addr: 1, toSeller: 1 }), 'green'],
  ['real USDT to someone else', F({ real: 1, addr: 1 }), 'red'],
  ['real USDT, too few confirmations', F({ real: 1, enough: 0 }), 'amber'],
  ['fake token', F({ fake: 1 }), 'red'],
  ['fake next to real', F({ fake: 1, real: 1, addr: 1, toSeller: 1 }), 'red'],
  ['fake, unconfirmed: still red (as judge)', F({ fake: 1, enough: 0 }), 'red'],
  ['pending', F({ mined: 0, real: 1 }), 'amber'],
  ['failed transaction', F({ success: 0, real: 1 }), 'amber'],
  ['failed transaction with a fake token log', F({ success: 0, fake: 1 }), 'amber'],
  ['no token at all', F({}), 'amber'],
  ['real to someone else, unconfirmed: red (as judge)', F({ real: 1, addr: 1, enough: 0 }), 'red']
];
for (const [name, f, want] of cases) R.ok('rule: ' + name + ' → ' + want, colour(f) === want, colour(f));

// ---------- 4. the tool against a fake TapeOut ----------
const F_DEPLOY = 6600000000000000n, F_PROTO = 660000000000000n, F_TAPE = 1300000000000000n;
function fakeTapeout(n, opts = {}){
  const factory = TAPEOUT.factory;
  const cpus = [];                         // circuits addresses
  const T = {};                            // transistors addr -> { circuits, bal:{}, mintPrice }
  const C = {};                            // circuits addr -> { transistors, items: {id:{nl,nIn,nOut,owner}}, next }
  n.code[factory] = '0x6080factory';
  for (let i = 0; i < 300; i++) cpus.push('0x' + (0xc0000 + i).toString(16).padStart(40, '0'));
  const enc = (fn, vals) => ABI.encodeFunctionResult(fn, vals);
  const log = (name, vals, address) => { const l = ABI.encodeEventLog(ABI.getEvent(name), vals); return { address, topics: l.topics, data: l.data }; };
  const t = {
    owns: a => a === factory || !!T[a] || !!C[a],
    call(to, data, from, value){
      const p = ABI.parseTransaction({ data });
      if (to === factory){
        if (p.name === 'deployFee') return enc(p.name, [F_DEPLOY]);
        if (p.name === 'protocolFee') return enc(p.name, [F_PROTO]);
        if (p.name === 'cpuCount') return enc(p.name, [cpus.length]);
        if (p.name === 'cpuAt') return enc(p.name, [cpus[p.args[0].toNumber()]]);
        if (p.name === 'createCPU'){ if (value < F_DEPLOY) throw Object.assign(new Error('execution reverted: fee'), { revert: true }); return enc(p.name, [cpus[0], cpus[0]]); }
      }
      if (T[to]){
        const x = T[to];
        if (p.name === 'mintPrice') return enc(p.name, [x.mintPrice]);
        if (p.name === 'protocolFee') return enc(p.name, [F_PROTO]);
        if (p.name === 'balanceOf') return enc(p.name, [x.bal[p.args[0].toLowerCase()] || 0]);
        if (p.name === 'mint'){ if (value < p.args[1].toBigInt() * x.mintPrice + F_PROTO) throw Object.assign(new Error('execution reverted: insufficient'), { revert: true }); return '0x'; }
      }
      if (C[to]){
        const x = C[to];
        if (p.name === 'TAPEOUT_FEE') return enc(p.name, [F_TAPE]);
        if (p.name === 'nextId') return enc(p.name, [x.next]);
        if (p.name === 'tapeout'){ if (value !== F_TAPE) throw Object.assign(new Error('execution reverted: tapeout fee'), { revert: true }); return enc(p.name, [x.next + 1]); }
        const it = x.items[p.args[0] && p.args[0].toNumber()];
        if (!it) throw Object.assign(new Error('execution reverted: no circuit'), { revert: true });
        if (p.name === 'netlist') return enc(p.name, [it.nl]);
        if (p.name === 'circuitInfo') return enc(p.name, [it.nIn, it.nOut, 0, (it.nl.length - 2) / 14]);
        if (p.name === 'eval'){
          let o = evalNetlist(it.nl, it.nIn, it.nOut, E.utils.arrayify(p.args[1]));
          if (opts.liar && E.utils.arrayify(p.args[1])[0] === 0x45) o = Uint8Array.from([o[0] ^ 1]);
          return enc(p.name, [o]);
        }
      }
      throw Object.assign(new Error('execution reverted: unknown ' + p.name), { revert: true });
    },
    tx(to, data, from, value){
      t.call(to, data, from, value);       // same checks first
      const p = ABI.parseTransaction({ data });
      if (to === factory && p.name === 'createCPU'){
        const circuits = '0x' + (0xc1000 + cpus.length).toString(16).padStart(40, '0');
        const transistors = '0x' + (0x71000 + cpus.length).toString(16).padStart(40, '0');
        cpus.push(circuits);
        T[transistors] = { circuits, bal: {}, mintPrice: p.args[4].toBigInt() };
        C[circuits] = { transistors, items: {}, next: 0 };
        n.code[circuits] = '0x60c'; n.code[transistors] = '0x60t';
        t.created = { circuits, transistors, args: p.args, value };
        return [log('CPUCreated', [circuits, transistors, from, p.args[0], p.args[3], p.args[4]], factory)];
      }
      if (T[to] && p.name === 'mint'){ const x = T[to]; x.bal[from] = (x.bal[from] || 0n) + p.args[1].toBigInt(); t.minted = { n: p.args[1].toBigInt(), value }; return []; }
      if (C[to] && p.name === 'tapeout'){
        const x = C[to], gates = (p.args[0].length - 2) / 14, tr = T[x.transistors];
        if ((tr.bal[from] || 0n) < BigInt(gates)) throw new Error('ERC1155InsufficientBalance');
        tr.bal[from] -= BigInt(gates);
        x.next++; x.items[x.next] = { nl: p.args[0].toLowerCase(), nIn: p.args[1], nOut: p.args[2], owner: from };
        t.taped = { nl: p.args[0], nIn: p.args[1], nOut: p.args[2], value };
        return [log('TapedOut', [x.next, from, gates, 0], to)];
      }
      throw new Error('unexpected tx');
    }
  };
  return t;
}

const wallet = E.Wallet.createRandom();
const ME = wallet.address.toLowerCase();
const quiet = []; const logq = s => quiet.push(s);
const cfg = config({ XLAYER_TAPEOUT_STATE: path.join(TMP, 'st.json'), HOME: TMP });
R.ok('TapeOut factory = TapeKit config for X Layer, 2 independent RPC operators', TAPEOUT.factory === '0x1f09daefa827f02cbb40967cc91b259763760761' && cfg.rpcs.join() === 'https://rpc.xlayer.tech,https://xlayer.drpc.org');
let n = makeNode({ chainId: 196, build: {}, balances: { [ME]: 10n ** 17n } });
n.tapeout = fakeTapeout(n);
const O = extra => Object.assign({ fetch: mockFetch(n), log: logq, from: wallet.address, wallet, yes: true, pollMs: 1 }, extra || {});

let p = await plan(cfg, O());
R.ok('plan: OK, nothing sent, fees summed', p.ok && n.sent.length === 0 && p.total === F_DEPLOY + F_PROTO + F_TAPE);
R.ok('plan: says 18 gates and ≈0.00856 OKB', quiet.some(s => /18 NAND gates/.test(s)) && quiet.some(s => /= 0\.00856 OKB/.test(s)), quiet.join(' | '));
p = await plan(cfg, O({ fetch: mockFetch(makeNode({ chainId: 1952, build: {} })) })).catch(e => ({ err: e.message }));
R.ok('plan on testnet: refuses (TapeOut is mainnet only)', /mainnet only/.test(p.err || ''));
const poor = makeNode({ chainId: 196, build: {}, balances: { [ME]: 1000n } }); poor.tapeout = fakeTapeout(poor);
p = await plan(cfg, O({ fetch: mockFetch(poor) }));
R.ok('plan: too little OKB is a problem', !p.ok);

quiet.length = 0;
const r = await run(cfg, O());
const tp = n.tapeout;
R.ok('createCPU: our name, supply 10000, mint price 0, paid deployFee exactly',
  tp.created.args[0] === 'Tavarov Pay rules' && tp.created.args[1] === 'TVPAY' && tp.created.args[3].toString() === '10000' && tp.created.args[4].isZero() && tp.created.value === F_DEPLOY);
R.ok('mint: exactly 18 NAND, paid the protocol fee only', tp.minted.n === 18n && tp.minted.value === F_PROTO);
R.ok('tapeout: our netlist, 7 in, 2 out, exact TAPEOUT_FEE', tp.taped.nl.toLowerCase() === nl.hex && tp.taped.nIn === 7 && tp.taped.nOut === 2 && tp.taped.value === F_TAPE);
R.ok('3 transactions, all chain 196 from the deployer', n.sent.length === 3 && n.sent.every(t => t.chainId === 196 && t.from === ME));
R.ok('checked on chain: all 128 inputs', r.check.ok, (r.check.problems || []).join('; '));
R.ok('state: processor, CPU number, circuit #1', r.state.circuits === E.utils.getAddress(tp.created.circuits) && r.state.circuitId === 1 && r.state.cpuIndex === 300);
R.ok('prints the line for check-core.js', quiet.some(s => s.includes("RULE_CIRCUIT = { circuits: '" + E.utils.getAddress(tp.created.circuits) + "', id: 1 }")));
R.ok('the private key never appears in the output', !quiet.join('\n').toLowerCase().includes(wallet.privateKey.slice(2).toLowerCase()));
const before = n.sent.length;
await run(cfg, O());
R.ok('second run sends nothing', n.sent.length === before);

// a circuit that lies for one input
const n2 = makeNode({ chainId: 196, build: {}, balances: { [ME]: 10n ** 17n } });
n2.tapeout = fakeTapeout(n2, { liar: true });
const cfg2 = config({ XLAYER_TAPEOUT_STATE: path.join(TMP, 'st2.json'), HOME: TMP });
const r2 = await run(cfg2, O({ fetch: mockFetch(n2) }));
R.ok('a circuit that answers differently for one input is caught', !r2.check.ok && r2.check.problems.some(x => /1 of 128/.test(x)));

fs.rmSync(TMP, { recursive: true, force: true });
process.exit(R.done() ? 0 : 1);
