/* A fake X Layer node for the deploy and TapeOut tools (audit/t105, t108).

   It is not an EVM. It knows exactly the contracts the tools deal with and
   answers the way the real node would: creation code run through eth_call
   returns the code that would be stored; a signed transaction is decoded
   with ethers, its chain id, sender and nonce are checked, and a contract
   creation gets the address the real chain would give it. Everything the
   tools send is written to `sent` so a test can compare the bytes.

   Used in-process: pass `mockFetch(node)` as the tools' fetch. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EL = require('../www/lib/ethers.umd.min.js');
export const E = EL.ethers || EL;

const sel = sig => E.utils.id(sig).slice(0, 10);
const W = v => '0x' + BigInt(v).toString(16).padStart(64, '0');
const lc = a => String(a || '').toLowerCase();

export function makeNode({ chainId = 196, build, tokens = {}, balances = {}, gasPrice = 20000000n, baseFee = 10000000n } = {}){
  const n = {
    chainId, build, gasPrice, baseFee,
    code: {},          // address -> hex code
    pays: {},          // address -> { owner, treasury, reward, halving, vesting, vault, accepted:{}, rate:{} }
    tokens: {},        // address -> decimals
    balances: Object.assign({}, balances),
    nonces: {},
    receipts: {},
    sent: [],          // decoded transactions, in order
    calls: [],         // every rpc method asked
    block: 1000,
    failNext: null,    // 'reject' -> next sendRawTransaction is mined with status 0
    names: {},         // address -> { v2, treasury }
    tapeout: null      // set by t108: an object with handle(to, data) for TapeOut contracts
  };
  for (const [a, d] of Object.entries(tokens)){ n.tokens[lc(a)] = d; n.code[lc(a)] = '0x6080token'; }
  return n;
}

function creationKind(n, data){
  const d = lc(data).replace(/^0x/, '');
  for (const k of ['TavarovPayV3', 'MerchantVaultV2', 'TavarovCharges'])
    if (d.startsWith(n.build[k].bytecode)) return { kind: k, args: d.slice(n.build[k].bytecode.length) };
  if (n.namesBytecode && d.startsWith(n.namesBytecode)) return { kind: 'names', args: d.slice(n.namesBytecode.length) };
  return null;
}

function revert(msg){ const e = new Error('execution reverted: ' + msg); e.revert = true; return e; }

function viewCall(n, to, data, from, value, ov){
  to = lc(to); data = lc(data);
  if (n.tapeout && n.tapeout.owns(to)) return n.tapeout.call(to, data, lc(from), value, ov || null);
  const s = data.slice(0, 10), arg = i => '0x' + data.slice(10 + i * 64 + 24, 10 + i * 64 + 64);
  if (n.tokens[to] !== undefined){
    if (s === sel('decimals()')) return W(n.tokens[to]);
    throw revert('token: unknown');
  }
  const p = n.pays[to];
  if (p){
    if (s === sel('owner()')) return W(p.owner);
    if (s === sel('treasury()')) return W(p.treasury);
    if (s === sel('feeBps()')) return W(100);
    if (s === sel('REF_SHARE_BPS()')) return W(2000);
    if (s === sel('VERSION()')) return W(3);
    if (s === sel('vaultImplementation()')) return W(p.vault);
    if (s === sel('rewardToken()')) return W(p.reward);
    if (s === sel('acceptedToken(address)')) return W(p.accepted[arg(0)] ? 1 : 0);
    if (s === sel('rewardPerUnit(address)')) return W(p.rate[arg(0)] || 0);
    /* a write simulated with eth_call: the same checks, no change */
    if (s === sel('configureToken(address,bool,uint256)') || s === sel('transferOwnership(address)')){
      if (lc(from) !== p.owner) throw revert('Pay: not the owner');
      return '0x';
    }
    throw revert('pay: unknown view ' + s);
  }
  if (n.code[to] && n.code[to] === '0x' + n.build.TavarovCharges.deployed){
    if (s === sel('MAX_TTL()')) return W(3600);
  }
  if (!n.code[to]) return '0x';
  throw revert('unknown call');
}

/* State change of a call to an existing contract. */
function applyCall(n, from, to, data, rec){
  to = lc(to); data = lc(data); from = lc(from);
  if (n.tapeout && n.tapeout.owns(to)){ rec.logs = n.tapeout.tx(to, data, from, rec.value) || []; return; }
  const p = n.pays[to];
  const s = data.slice(0, 10), arg = i => '0x' + data.slice(10 + i * 64 + 24, 10 + i * 64 + 64), word = i => BigInt('0x' + data.slice(10 + i * 64, 10 + i * 64 + 64));
  if (p && s === sel('configureToken(address,bool,uint256)')){
    if (from !== p.owner) throw revert('Pay: not the owner');
    p.accepted[arg(0)] = word(1) !== 0n; p.rate[arg(0)] = word(2); return;
  }
  if (p && s === sel('transferOwnership(address)')){
    if (from !== p.owner) throw revert('Pay: not the owner');
    p.owner = arg(0); return;
  }
  throw revert('unexpected call');
}

function create(n, from, data, addr){
  const c = creationKind(n, data);
  if (!c) throw revert('unknown creation code');
  if (c.kind === 'TavarovPayV3'){
    const w = i => c.args.slice(i * 64, i * 64 + 64);
    const a = i => '0x' + w(i).slice(24);
    if (a(0) === '0x' + '0'.repeat(40) || a(1) === '0x' + '0'.repeat(40)) throw revert('Pay: zero address');
    if (a(4) === '0x' + '0'.repeat(40)) throw revert('Pay: zero implementation');
    if (addr) n.pays[addr] = { owner: from, reward: a(0), treasury: a(1), halving: BigInt('0x' + w(2)), vesting: BigInt('0x' + w(3)), vault: a(4), accepted: {}, rate: {} };
    return '0x' + n.build.TavarovPayV3.deployed;
  }
  if (c.kind === 'names'){
    if (addr) n.names[addr] = { v2: '0x' + c.args.slice(24, 64), treasury: '0x' + c.args.slice(88, 128) };
    return '0x6080names';
  }
  return '0x' + n.build[c.kind].deployed;
}

export function handle(n, method, params){
  n.calls.push(method);
  switch (method){
    case 'eth_chainId': return '0x' + n.chainId.toString(16);
    case 'eth_blockNumber': return '0x' + n.block.toString(16);
    case 'eth_gasPrice': return '0x' + n.gasPrice.toString(16);
    case 'eth_maxPriorityFeePerGas': return '0x' + (1000000n).toString(16);
    case 'eth_getBlockByNumber': return { number: '0x' + n.block.toString(16), baseFeePerGas: '0x' + n.baseFee.toString(16) };
    case 'eth_getCode': return n.code[lc(params[0])] || '0x';
    case 'eth_getBalance': return '0x' + BigInt(n.balances[lc(params[0])] || 0).toString(16);
    case 'eth_getTransactionCount': return '0x' + (n.nonces[lc(params[0])] || 0).toString(16);
    case 'eth_estimateGas': return '0x' + (300000).toString(16);
    case 'eth_call': {
      const t = params[0];
      if (!t.to) return create(n, lc(t.from), t.data, null);
      n.overrides = params[2] || null;
      return viewCall(n, t.to, t.data, t.from, t.value ? BigInt(t.value) : 0n, params[2]);
    }
    case 'eth_sendRawTransaction': {
      const tx = E.utils.parseTransaction(params[0]);
      const from = lc(tx.from);
      if (tx.chainId !== n.chainId) throw new Error('invalid chain id');
      if ((n.nonces[from] || 0) !== tx.nonce) throw new Error('nonce too low/high');
      const rec = { hash: tx.hash, from, to: tx.to ? lc(tx.to) : null, data: lc(tx.data), nonce: tx.nonce, type: tx.type,
                    chainId: tx.chainId, value: BigInt(tx.value.toString()), gasLimit: BigInt(tx.gasLimit.toString()) };
      n.sent.push(rec);
      n.nonces[from] = tx.nonce + 1;
      n.block++;
      let status = 1, contractAddress = null;
      if (n.failNext){ n.failNext = null; status = 0; }
      else if (!tx.to){
        contractAddress = lc(E.utils.getContractAddress({ from, nonce: tx.nonce }));
        n.code[contractAddress] = create(n, from, tx.data, contractAddress);
      } else {
        try{ applyCall(n, from, tx.to, tx.data, rec); } catch(e){ status = 0; rec.error = e.message; }
      }
      n.receipts[tx.hash] = { transactionHash: tx.hash, blockNumber: '0x' + n.block.toString(16), status: '0x' + status.toString(16),
                              contractAddress, logs: rec.logs || [] };
      return tx.hash;
    }
    case 'eth_getTransactionReceipt': return n.receipts[params[0]] || null;
    default: throw new Error('method not supported by the mock: ' + method);
  }
}

export function mockFetch(n){
  return async (url, init) => {
    const body = JSON.parse(init.body);
    let out;
    try{ out = { jsonrpc: '2.0', id: body.id, result: handle(n, body.method, body.params || []) }; }
    catch(e){ out = { jsonrpc: '2.0', id: body.id, error: { code: e.revert ? 3 : -32000, message: e.message } }; }
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
  };
}
