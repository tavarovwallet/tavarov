/* Fake BNB Chain, Ethereum and TRON nodes for the USDT checker
   (site/check-core.js, site/en/check.html).

   Answers have the shape real public nodes give (JSON-RPC for BNB Chain and
   Ethereum, the TRON HTTP API for TRON), built by hand from a small world of
   transactions. Every endpoint can be told to misbehave: time out, answer
   with garbage, an HTTP error, or lie about one transfer.

   Used two ways:
   - t102-usdt-check-core.mjs calls handle() through a fake fetch (Node);
   - t103-usdt-check-page.mjs routes the real endpoint hosts to handle()
     inside Chromium (page.route), with the site's real CSP. */

import { evalNetlist } from '../tools/xlayer/tapeout/circuit.mjs';

export const TRANSFER = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const USDT = {
  bsc: '0x55d398326f99059ff775485246999027b3197955',
  eth: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  tron: 'a614f803b6fd780986a42c78ec9c7f77e6ded13c',          // TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
  xlayer: '0x779ded0c9e1022225f8e0630b35a9b54be713736',       // USDT0
  xlayerOld: '0x1e4a5963abfd975d8c9021ce480b42188849d41d'     // old bridged USDT
};
export const USDC = { bsc: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', eth: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  tronOld: '3487b63d30b5b2c87fb7ffa8bcfade38eaac1abe',
  xlayer: '0xb6ceceab302e2e4948951ee7843fc24e92933061', xlayerE: '0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035' };

const pad = (h, n = 64) => h.replace(/^0x/, '').padStart(n, '0');
const hx = n => '0x' + BigInt(n).toString(16);
const utf8hex = s => Buffer.from(s, 'utf8').toString('hex');
export function abiString(s) {
  const d = utf8hex(s); const len = d.length / 2;
  return pad('20') + pad(len.toString(16)) + d.padEnd(Math.ceil(d.length / 64) * 64 || 64, '0');
}
export const abiUint = n => pad(BigInt(n).toString(16));

export function makeWorld() {
  const now = Math.floor(Date.now() / 1000);
  const evmChain = () => ({ head: 50000000n, txs: new Map(), tokens: new Map() });
  const w = {
    now,
    bsc: evmChain(), eth: evmChain(), xlayer: evmChain(),
    circuit: null,       // { address, id, netlist, nIn, nOut, lie } — the TapeOut rule circuit on X Layer
    tron: { head: 70000000, txs: new Map(), tokens: new Map() },
    faults: {},          // endpoint url -> 'timeout' | 'garbage' | 'http500' | 'html' | 'lie' | 'null' | 'shape'
    calls: []
  };
  w.bsc.tokens.set(USDT.bsc, { symbol: 'USDT', name: 'Tether USD', decimals: 18 });
  w.bsc.tokens.set(USDC.bsc, { symbol: 'USDC', name: 'USD Coin', decimals: 18 });
  w.eth.tokens.set(USDT.eth, { symbol: 'USDT', name: 'Tether USD', decimals: 6 });
  w.eth.tokens.set(USDC.eth, { symbol: 'USDC', name: 'USD Coin', decimals: 6 });
  w.tron.tokens.set(USDT.tron, { symbol: 'USDT', name: 'Tether USD', decimals: 6 });
  w.tron.tokens.set(USDC.tronOld, { symbol: 'USDC', name: 'USD Coin', decimals: 6 });
  w.xlayer.tokens.set(USDT.xlayer, { symbol: 'USDT0', name: 'USDT0', decimals: 6 });
  w.xlayer.tokens.set(USDC.xlayer, { symbol: 'USDC', name: 'USD Coin', decimals: 6 });
  w.xlayer.tokens.set(USDT.xlayerOld, { symbol: 'USDT', name: 'Tether USD', decimals: 6 });
  w.xlayer.tokens.set(USDC.xlayerE, { symbol: 'USDC.e', name: 'Bridged USDC', decimals: 6 });
  return w;
}

/* transfers: [{ token, from, to, raw }] (EVM addresses 0x..., TRON 40-hex)
   opts: { status:1|0, pending, conf (confirmations), value (native wei), nft (count), solid (tron) } */
export function addEvmTx(w, net, hash, transfers = [], opts = {}) {
  const c = w[net];
  const conf = opts.conf == null ? 100 : opts.conf;
  const block = c.head - BigInt(conf) + 1n;
  const blockHash = '0x' + pad((block * 7919n + 0xb10cn).toString(16));   // one hash per block, like a real chain
  const from = opts.from || '0x1111111111111111111111111111111111111111';
  const tx = {
    blockHash: opts.pending ? null : blockHash, blockNumber: opts.pending ? null : hx(block), from,
    gas: '0x186a0', gasPrice: '0x3b9aca00', hash, input: '0xa9059cbb', nonce: '0x7',
    to: transfers[0] ? transfers[0].token : (opts.to || '0x2222222222222222222222222222222222222222'),
    transactionIndex: opts.pending ? null : '0x3', value: hx(opts.value || 0), type: '0x0', chainId: net === 'bsc' ? '0x38' : net === 'xlayer' ? '0xc4' : '0x1',
    v: '0x93', r: '0x' + pad('1'), s: '0x' + pad('2')
  };
  const logs = transfers.map((t, i) => ({
    address: t.token, topics: ['0x' + TRANSFER, '0x' + pad(t.from.slice(2)), '0x' + pad(t.to.slice(2))],
    data: '0x' + abiUint(t.raw), blockNumber: hx(block), transactionHash: hash, transactionIndex: '0x3',
    blockHash, logIndex: hx(i), removed: false
  }));
  for (let i = 0; i < (opts.nft || 0); i++) logs.push({ address: '0x3333333333333333333333333333333333333333',
    topics: ['0x' + TRANSFER, '0x' + pad(from.slice(2)), '0x' + pad('44'.repeat(20)), '0x' + pad('7')], data: '0x',
    blockNumber: hx(block), transactionHash: hash, transactionIndex: '0x3', blockHash, logIndex: hx(logs.length), removed: false });
  const receipt = opts.pending ? null : {
    blockHash, blockNumber: hx(block), contractAddress: null, cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00',
    from, gasUsed: '0xb411', logs, logsBloom: '0x' + '0'.repeat(512), status: opts.status === 0 ? '0x0' : '0x1',
    to: tx.to, transactionHash: hash, transactionIndex: '0x3', type: '0x0'
  };
  c.txs.set(hash.toLowerCase(), { tx, receipt, block, blockHash, time: w.now - (opts.age == null ? 120 : opts.age) });
}

export function addTronTx(w, hash, transfers = [], opts = {}) {
  const c = w.tron;
  const conf = opts.conf == null ? 40 : opts.conf;
  const block = c.head - conf + 1;
  const owner = opts.from || '41' + '55'.repeat(20);
  const native = opts.trx != null;
  const tx = {
    ret: [{ contractRet: opts.ret || 'SUCCESS' }], signature: ['ab'.repeat(65)], txID: hash,
    raw_data: {
      contract: [native
        ? { parameter: { value: { amount: opts.trx, owner_address: owner, to_address: opts.to || '41' + '66'.repeat(20) }, type_url: 'type.googleapis.com/protocol.TransferContract' }, type: 'TransferContract' }
        : { parameter: { value: { data: 'a9059cbb' + '0'.repeat(128), owner_address: owner, contract_address: '41' + (transfers[0] ? transfers[0].token : USDT.tron) }, type_url: 'type.googleapis.com/protocol.TriggerSmartContract' }, type: 'TriggerSmartContract' }],
      ref_block_bytes: '1a2b', ref_block_hash: 'deadbeefdeadbeef', expiration: 1, fee_limit: 100000000, timestamp: (w.now - 60) * 1000
    },
    raw_data_hex: '0a02'
  };
  const info = opts.pending ? {} : {
    id: hash, fee: 13844850, blockNumber: block, blockTimeStamp: (w.now - (opts.age == null ? 90 : opts.age)) * 1000,
    contractResult: [opts.ret && opts.ret !== 'SUCCESS' ? '08c379a0' : ''], contract_address: native ? undefined : '41' + (transfers[0] ? transfers[0].token : USDT.tron),
    receipt: native ? { net_usage: 268 } : { energy_usage_total: 64285, net_usage: 345, result: opts.ret || 'SUCCESS', energy_fee: 13499850 },
    log: native ? undefined : transfers.map(t => ({ address: t.token, topics: [TRANSFER, pad(t.from), pad(t.to)], data: abiUint(t.raw) })),
    ...(opts.ret && opts.ret !== 'SUCCESS' ? { result: 'FAILED', resMessage: '5452433230' } : {})
  };
  if (info.log && !info.log.length) delete info.log;
  c.txs.set(hash.toLowerCase(), { tx, info, solid: opts.solid !== false && !opts.pending });
}

// ----- answers -----
function evmAnswer(w, net, url, body) {
  const c = w[net];
  const lie = w.faults[url] === 'lie';
  const r = result => ({ jsonrpc: '2.0', id: body.id, result });
  const p = body.params || [];
  switch (body.method) {
    case 'eth_blockNumber': return r(hx(c.head));
    case 'eth_getTransactionByHash': { const t = c.txs.get(String(p[0]).toLowerCase()); return r(t ? t.tx : null); }
    case 'eth_getTransactionReceipt': {
      const t = c.txs.get(String(p[0]).toLowerCase()); if (!t || !t.receipt) return r(null);
      if (!lie) return r(t.receipt);
      const rc = JSON.parse(JSON.stringify(t.receipt));
      if (rc.logs[0]) rc.logs[0].data = '0x' + abiUint(BigInt(rc.logs[0].data) * 10n); else rc.status = rc.status === '0x1' ? '0x0' : '0x1';
      return r(rc);
    }
    case 'eth_getBlockByNumber': {
      const n = BigInt(p[0]);
      for (const t of c.txs.values()) if (t.block === n) return r({ number: hx(n), hash: t.blockHash, timestamp: hx(t.time), parentHash: '0x' + pad('9'), transactions: [t.tx.hash] });
      return r({ number: hx(n), hash: '0x' + pad(n.toString(16)), timestamp: hx(w.now), transactions: [] });
    }
    case 'eth_call': {
      const to = String(p[0].to).toLowerCase(), sel = String(p[0].data).slice(2, 10);
      const cc = w.circuit;
      if (net === 'xlayer' && cc && to === cc.address.toLowerCase() && sel === '934d06ea') {
        const d = String(p[0].data).slice(10);
        const id = BigInt('0x' + d.slice(0, 64)), off = Number(BigInt('0x' + d.slice(64, 128))) * 2, len = Number(BigInt('0x' + d.slice(off, off + 64)));
        if (id !== BigInt(cc.id)) return { jsonrpc: '2.0', id: body.id, error: { code: 3, message: 'execution reverted: no circuit' } };
        const inBytes = Buffer.from(d.slice(off + 64, off + 64 + len * 2), 'hex');
        let o = evalNetlist(cc.netlist, cc.nIn, cc.nOut, inBytes);
        if (cc.lie || w.faults[url] === 'lie') o = Uint8Array.from([o[0] ^ 3]);
        w.evals = (w.evals || 0) + 1;
        return r('0x' + abiUint(32) + abiUint(o.length) + Buffer.from(o).toString('hex').padEnd(64, '0'));
      }
      const m = c.tokens.get(to);
      if (!m) return { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'execution reverted' } };
      if (sel === '95d89b41') return r('0x' + (m.symbolRaw || abiString(m.symbol)));
      if (sel === '06fdde03') return r('0x' + abiString(m.name));
      if (sel === '313ce567') return r('0x' + abiUint(m.decimals));
      return { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'execution reverted' } };
    }
  }
  return { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'method not found' } };
}
function tronAnswer(w, url, path, body) {
  const c = w.tron;
  const t = body && body.value ? c.txs.get(String(body.value).toLowerCase()) : null;
  const lie = w.faults[url] === 'lie';
  switch (path) {
    case '/wallet/gettransactionbyid': return t ? t.tx : {};
    case '/wallet/gettransactioninfobyid': {
      if (!t) return {};
      if (!lie || !t.info.log) return t.info;
      const i = JSON.parse(JSON.stringify(t.info)); i.log[0].to = i.log[0].topics[2] = pad('77'.repeat(20)); return i;
    }
    case '/walletsolidity/gettransactioninfobyid': return t && t.solid ? t.info : {};
    case '/wallet/getblock': case '/wallet/getnowblock':
      return { blockID: pad(c.head.toString(16)), block_header: { raw_data: { number: c.head, timestamp: w.now * 1000, witness_address: '41' + '88'.repeat(20) } } };
    case '/wallet/triggerconstantcontract': {
      const m = c.tokens.get(String(body.contract_address).toLowerCase().replace(/^41/, ''));
      if (!m) return { result: { code: 'CONTRACT_VALIDATE_ERROR', message: '636f6e7472616374' } };
      const v = body.function_selector === 'symbol()' ? abiString(m.symbol) : body.function_selector === 'name()' ? abiString(m.name)
        : body.function_selector === 'decimals()' ? abiUint(m.decimals) : null;
      return { result: { result: true }, energy_used: 300, constant_result: [v], transaction: {} };
    }
  }
  return { Error: 'no such path' };
}

/* -> { status, body (string), hang: true for a timeout } */
export function handle(w, net, base, path, rawBody) {
  const url = base;
  w.calls.push(net + ' ' + base + path);
  const f = w.faults[url];
  if (f === 'timeout') return { hang: true };
  if (f === 'http500') return { status: 500, body: 'Internal Server Error' };
  if (f === '429') return { status: 429, body: '{"Error":"rate limit"}' };
  if (f === '429once') { delete w.faults[url]; return { status: 429, body: '{"Error":"rate limit"}' }; }
  if (f === 'html') return { status: 200, body: '<html><body>Cloudflare: checking your browser</body></html>' };
  if (f === 'garbage') return { status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{"weird":true},"x":' };
  let body; try { body = JSON.parse(rawBody || '{}'); } catch (e) { return { status: 400, body: '{}' }; }
  if (f === 'shape') {
    return { status: 200, body: JSON.stringify(net === 'tron' ? { txID: 42, raw_data: 'x' } : { jsonrpc: '2.0', id: 1, result: { hash: body.params && body.params[0], blockNumber: 'soon' } }) };
  }
  if (f === 'null' && net !== 'tron') {     // a node that has never heard of anything
    if (body.method === 'eth_blockNumber') return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: hx(w[net].head) }) };
    return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }) };
  }
  const ans = net === 'tron' ? tronAnswer(w, url, path, body) : evmAnswer(w, net, url, body);
  return { status: 200, body: JSON.stringify(ans) };
}

/* A fetch() for Node that routes the given endpoints to handle(). */
export function mockFetch(w, endpoints) {
  const map = [];
  for (const net of Object.keys(endpoints)) for (const base of endpoints[net]) map.push([base, net]);
  return (url, init = {}) => new Promise((resolve, reject) => {
    const hit = map.find(([b]) => url === b || url.startsWith(b + '/'));
    if (!hit) return reject(new TypeError('Failed to fetch (no route ' + url + ')'));
    const [base, net] = hit;
    const r = handle(w, net, base, url.slice(base.length), init.body);
    if (r.hang) {
      const sig = init.signal;
      if (sig) sig.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      return;
    }
    setTimeout(() => resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body }), 2);
  });
}
