/* "Is this USDT payment real?" — the checker behind tavarov.com/en/check.

   Plain script, no libraries, no build step. It defines window.UsdtCheck
   (globalThis.UsdtCheck in Node, where audit/t102-usdt-check-core.mjs tests
   it with recorded-shape responses).

   What it does: takes what a buyer sent (a transaction hash or an explorer
   link), checks the link's host, finds the transaction on BNB Chain,
   Ethereum or TRON through public nodes (read-only), and decides by the
   token CONTRACT, never by its name.

   Rules that must not be loosened:
   - Fail closed. A network error, an odd answer, or two nodes that disagree
     give "could not check", never a green verdict.
   - Every verdict comes from two independent nodes that agree.
   - Nothing is sent anywhere except the read-only queries below. */
(function (root) {
  'use strict';

  // ---------- official contracts ----------
  /* Verified 15 Nov 2026:
     Ethereum USDT and TRON USDT — tether.to/en/supported-protocols (issuer)
       and coingecko.com/en/coins/tether.
     Ethereum USDC — developers.circle.com/stablecoins/usdc-contract-addresses
       (issuer) and coingecko.com/en/coins/usdc.
     BNB Chain USDT and USDC are issued by Binance ("Binance-Peg"); Tether and
       Circle do not list BNB Chain. Addresses from coingecko.com (Binance
       Bridged USDT / USDC) and the same addresses used everywhere in this
       repository (www/index.html, functions/api/status.js, TavarovPayV3).
     USDC on TRON (TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8): Circle stopped minting
       it on 21 Feb 2024 and ended support. Not listed as real. */
  const OFFICIAL = {
    bsc: {
      '0x55d398326f99059ff775485246999027b3197955': { sym: 'USDT', decimals: 18, note: 'Binance-Peg USDT, the standard USDT on BNB Chain' },
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { sym: 'USDC', decimals: 18, note: 'Binance-Peg USDC, the standard USDC on BNB Chain' }
    },
    eth: {
      '0xdac17f958d2ee523a2206206994597c13d831ec7': { sym: 'USDT', decimals: 6, note: 'Tether USDT on Ethereum' },
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { sym: 'USDC', decimals: 6, note: 'Circle USDC on Ethereum' }
    },
    tron: {
      // hex form of TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t without the 41 prefix (asserted in tests)
      'a614f803b6fd780986a42c78ec9c7f77e6ded13c': { sym: 'USDT', decimals: 6, note: 'Tether USDT on TRON' }
    }
  };
  // keys as stored by the readers: 40 hex, lowercase, no 0x
  for (const n of Object.keys(OFFICIAL)) for (const k of Object.keys(OFFICIAL[n])) {
    const v = OFFICIAL[n][k]; delete OFFICIAL[n][k]; OFFICIAL[n][k.replace(/^0x/, '').toLowerCase()] = v;
  }
  // Real token, but the issuer has withdrawn it: never green.
  const DISCONTINUED = {
    tron: { '3487b63d30b5b2c87fb7ffa8bcfade38eaac1abe': { sym: 'USDC', note: 'Circle stopped issuing and supporting USDC on TRON in 2024' } }
  };

  const NETWORKS = {
    bsc:  { name: 'BNB Chain', native: 'BNB', nativeDecimals: 18, minConf: 15, explorerTx: h => 'https://bscscan.com/tx/' + h },
    eth:  { name: 'Ethereum',  native: 'ETH', nativeDecimals: 18, minConf: 12, explorerTx: h => 'https://etherscan.io/tx/' + h },
    tron: { name: 'TRON',      native: 'TRX', nativeDecimals: 6,  minConf: 19, explorerTx: h => 'https://tronscan.org/#/transaction/' + h }
  };

  /* Public endpoints, no keys. Each one must also be in connect-src of
     site/_headers. Order matters a little: the first two are asked at once,
     the rest only if one of those fails. */
  const ENDPOINTS = {
    bsc:  ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.bnbchain.org', 'https://bsc.drpc.org'],
    eth:  ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth'],
    tron: ['https://api.trongrid.io', 'https://tron-rpc.publicnode.com']
  };

  // ---------- explorers ----------
  /* Official explorer domains. bscscan.com and etherscan.io are run by
     Etherscan; tronscan.org is the explorer named in the TRON developer docs
     (developers.tron.network). tronscan.io serves a copy of the TRONSCAN page,
     but no official source names it, so it is NOT on the list. */
  const EXPLORERS = { 'bscscan.com': 'bsc', 'etherscan.io': 'eth', 'tronscan.org': 'tron' };
  const TESTNET_SUB = /^(testnet|sepolia|holesky|hoodi|goerli|rinkeby|ropsten|kovan|nile|shasta|opbnb-testnet)\./;

  function checkHost(rawHost) {
    let host = String(rawHost || '').toLowerCase();
    if (host.endsWith('.')) host = host.slice(0, -1);
    for (const d of Object.keys(EXPLORERS)) {
      if (host === d || host === 'www.' + d) return { host, official: true, network: EXPLORERS[d], testnet: false };
      if (host.endsWith('.' + d)) {
        const sub = host.slice(0, -d.length);
        return { host, official: true, network: EXPLORERS[d], testnet: TESTNET_SUB.test(sub) };
      }
    }
    // punycode (xn--) hosts, IP addresses, look-alikes: all simply "not official"
    return { host, official: false, network: null, testnet: false, idn: /(^|\.)xn--/.test(host) };
  }

  // ---------- input ----------
  const RE_HASH0X = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
  const RE_HASH = /(?<![0-9a-fA-Fx])[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
  const RE_URL = /(?:https?:\/\/)?(?:[^\s\/?#@]+@)?[^\s\/?#:@]+\.[a-z¡-￿0-9-]{2,}(?::\d+)?(?:[\/?#][^\s]*)?/i;

  function parseInput(text) {
    const s = String(text || '').trim();
    if (!s) return { kind: 'empty' };
    let link = null, scan = s;
    const looksUrl = /^https?:\/\//i.test(s) || (!/^(0x)?[0-9a-f]{64}$/i.test(s) && /[\/.]/.test(s) && /[a-z]/i.test(s));
    if (looksUrl) {
      const m = s.match(/https?:\/\/[^\s]+/i) || s.match(RE_URL);
      if (m) {
        let u = m[0];
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        try {
          const url = new URL(u);           // the URL parser turns IDN into xn-- and drops user@
          link = checkHost(url.hostname);
          link.href = url.href;
          scan = decodeURIComponent(url.pathname + ' ' + url.search + ' ' + url.hash);
        } catch (e) {
          // the URL parser refused it (broken punycode, odd characters): never "official"
          const hm = u.match(/^https?:\/\/(?:[^\s\/?#@]*@)?([^\s\/?#:]+)/i);
          link = { host: hm ? hm[1].toLowerCase() : u, official: false, network: null, testnet: false, invalid: true, href: u };
          scan = u;
        }
      }
    }
    // prefer a hash after /tx/ or /transaction/
    let hash = null;
    const tagged = scan.match(/(?:\/tx\/|\/transaction\/|[?&#]hash=|[?&#]txid=)(0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/i);
    if (tagged) hash = tagged[2];
    else {
      const m0 = scan.match(RE_HASH0X);
      const m1 = m0 ? null : scan.match(RE_HASH);
      if (m0) hash = m0[0].slice(2); else if (m1) hash = m1[0];
    }
    const prefixed = !!(tagged ? tagged[1] : scan.match(RE_HASH0X));
    if (hash) return { kind: 'hash', hash: hash.toLowerCase(), prefixed, link };
    if (/(^|[^0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.test(scan) || /(^|[^1-9A-Za-z])T[1-9A-HJ-NP-Za-km-z]{33}(?![1-9A-Za-z])/.test(scan))
      return { kind: 'address', link };
    return { kind: 'unknown', link };
  }

  // ---------- small helpers ----------
  const HEX = /^0x[0-9a-fA-F]*$/;
  const isHex = (v, bytes) => typeof v === 'string' && HEX.test(v) && (bytes == null || v.length === 2 + bytes * 2);
  const qty = v => { if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(v)) throw bad('bad quantity'); return BigInt(v); };
  function bad(msg) { const e = new Error(msg); e.bad = true; return e; }

  function formatUnits(v, decimals) {
    v = BigInt(v); const neg = v < 0n; if (neg) v = -v;
    const d = BigInt(decimals); const base = 10n ** d;
    const whole = v / base; let frac = (v % base).toString().padStart(Number(d), '0').replace(/0+$/, '');
    const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + w + (frac ? '.' + frac : '');
  }
  function parseAmount(text, decimals) {
    let s = String(text || '').trim().replace(/[\s _']/g, '');
    if (!s) return null;
    // "1,234.50" or "1.234,50" or "10,5"
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (s.includes(',')) s = /,\d{3}$/.test(s) && (s.match(/,/g).length > 1 || s.split(',')[0].length <= 3) && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const [w, f = ''] = s.split('.');
    if (f.length > decimals) {
      if (/[1-9]/.test(f.slice(decimals))) return null;
    }
    return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f.slice(0, decimals)).padEnd(decimals, '0') || '0');
  }

  // ---------- base58check (TRON addresses) ----------
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const hexToBytes = h => { h = h.replace(/^0x/, ''); const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; };
  const bytesToHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  async function sha256(bytes) { return new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)); }
  async function tronHexToBase58(hex20) {
    const body = hexToBytes('41' + hex20.replace(/^0x/, '').replace(/^41(?=[0-9a-f]{40}$)/i, '').toLowerCase());
    if (body.length !== 21) throw bad('bad tron address');
    const c = (await sha256(await sha256(body))).slice(0, 4);
    const all = new Uint8Array(25); all.set(body); all.set(c, 21);
    let n = BigInt('0x' + bytesToHex(all)), out = '';
    while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const x of all) { if (x === 0) out = '1' + out; else break; }
    return out;
  }
  async function tronBase58ToHex(addr) {   // -> 40 hex (no 41) or null
    if (typeof addr !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(addr)) return null;
    let n = 0n; for (const ch of addr) n = n * 58n + BigInt(B58.indexOf(ch));
    let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
    const bytes = hexToBytes(hex);
    if (bytes.length !== 25 || bytes[0] !== 0x41) return null;
    const c = (await sha256(await sha256(bytes.slice(0, 21)))).slice(0, 4);
    for (let i = 0; i < 4; i++) if (c[i] !== bytes[21 + i]) return null;
    return bytesToHex(bytes.slice(1, 21));
  }

  /* An address the seller typed, normalised for one network.
     -> { ok:true, key:'<40 hex lowercase>' } or { ok:false, why } */
  async function normalizeAddress(text, network) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (network === 'tron') {
      if (/^T/.test(s)) { const h = await tronBase58ToHex(s); return h ? { ok: true, key: h } : { ok: false, why: 'This is not a valid TRON address (check for a typo).' }; }
      if (/^41[0-9a-fA-F]{40}$/.test(s)) return { ok: true, key: s.slice(2).toLowerCase() };
      if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { ok: false, why: 'This is not a TRON address. The payment is on TRON, so your TRON address starts with T.' };
      return { ok: false, why: 'This is not a valid TRON address.' };
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { ok: true, key: s.slice(2).toLowerCase() };
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return { ok: false, why: 'This is a TRON address, but the payment is on ' + NETWORKS[network].name + '. Your address there starts with 0x.' };
    return { ok: false, why: 'This is not a valid address (it should be 0x followed by 40 characters).' };
  }

  // ---------- look-alike names ----------
  const CONFUSABLE = {
    '₮': 't', 'т': 't', 'τ': 't', 'ţ': 't', 'ť': 't', 'ŧ': 't', '7': 't', '†': 't',
    'ѕ': 's', '5': 's', '$': 's', 'ş': 's', 'š': 's', 'ʂ': 's', '§': 's',
    'υ': 'u', 'ս': 'u', 'µ': 'u', 'μ': 'u', 'ü': 'u', 'ú': 'u', 'ù': 'u', 'û': 'u', 'ц': 'u',
    'ԁ': 'd', 'ď': 'd', 'đ': 'd', 'ɗ': 'd',
    'с': 'c', 'ϲ': 'c', 'ç': 'c', '¢': 'c', '©': 'c',
    'е': 'e', 'є': 'e', 'н': 'h', 'һ': 'h', 'о': 'o', '0': 'o', 'ο': 'o', 'р': 'p', 'ρ': 'p', 'а': 'a', 'α': 'a', 'г': 'r', 'і': 'i', '1': 'l', 'ӏ': 'l', 'ı': 'i'
  };
  function normName(s) {
    s = String(s || '').normalize('NFKC').toLowerCase();
    let out = '';
    for (const ch of s) {
      const m = CONFUSABLE[ch];
      if (m) { out += m; continue; }
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (/^[a-z]$/.test(base)) out += base;
    }
    return out;
  }
  /* -> null, or { family:'USDT'|'USDC', copy:true when the name is an exact
     copy (USDT, Tether USD, USD₮, U5DT ...), false when it only contains it
     (USDT.e, anyUSDT, ...). */
  function stableLike(symbol, name) {
    const a = normName(symbol), b = normName(name);
    const exactT = ['usdt', 'tether', 'tetherusd', 'usdtether', 'tetherusdt', 'bscusd', 'binancepegbscusd'];
    const exactC = ['usdc', 'usdcoin', 'usdcircle'];
    // the symbol decides; the name only when there is no readable symbol
    if (exactT.includes(a) || (!a && exactT.includes(b))) return { family: 'USDT', copy: true };
    if (exactC.includes(a) || (!a && exactC.includes(b))) return { family: 'USDC', copy: true };
    /* "Tether" alone is not enough: Tether Gold (XAUt) is a real Tether token,
       just not a dollar. A name counts only when it is about a dollar. */
    if (a.includes('usdt') || a.includes('bscusd') || b.includes('usdt') || b.includes('bscusd') ||
        ((a.includes('tether') || b.includes('tether')) && (a.includes('usd') || b.includes('usd')))) return { family: 'USDT', copy: false };
    if (a.includes('usdc') || b.includes('usdc') || b.includes('usdcoin')) return { family: 'USDC', copy: false };
    return null;
  }

  // ---------- ABI ----------
  const TRANSFER = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const SEL = { symbol: '95d89b41', name: '06fdde03', decimals: '313ce567' };
  function decodeString(hex) {
    hex = String(hex || '').replace(/^0x/, '');
    if (!/^[0-9a-f]*$/i.test(hex) || hex.length < 64) return null;
    let bytes;
    if (hex.length === 64) bytes = hexToBytes(hex).filter(b => b !== 0);           // bytes32 tokens
    else {
      const off = parseInt(hex.slice(0, 64), 16) * 2;
      if (!(off >= 64) || off + 64 > hex.length) return null;
      const len = parseInt(hex.slice(off, off + 64), 16);
      if (!(len >= 0) || len > 256 || off + 64 + len * 2 > hex.length) return null;
      bytes = hexToBytes(hex.slice(off + 64, off + 64 + len * 2));
    }
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64); } catch (e) { return null; }
  }
  function decodeUint8(hex) {
    hex = String(hex || '').replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
    const v = BigInt('0x' + hex); return v <= 255n ? Number(v) : null;
  }

  // ---------- transport ----------
  async function fetchJson(ctx, url, body) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ac && ac.abort(), ctx.timeoutMs);
    try {
      const r = await ctx.fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        signal: ac ? ac.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'
      });
      if (!r || !r.ok) throw new Error('http ' + (r && r.status));
      const text = await r.text();
      if (text.length > 2000000) throw bad('answer too big');
      try { return JSON.parse(text); } catch (e) { throw bad('not json'); }
    } finally { clearTimeout(t); }
  }
  async function rpc(ctx, url, method, params) {
    const j = await fetchJson(ctx, url, { jsonrpc: '2.0', id: 1, method, params });
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw bad('bad rpc answer');
    if (j.error) throw new Error('rpc error ' + (j.error && j.error.message));
    if (!('result' in j)) throw bad('no result');
    return j.result;
  }

  // ---------- EVM ----------
  async function readEvm(ctx, net, url, hash) {
    const h = '0x' + hash;
    const [tx, head] = await Promise.all([rpc(ctx, url, 'eth_getTransactionByHash', [h]), rpc(ctx, url, 'eth_blockNumber', [])]);
    const headN = qty(head);
    if (tx === null) return { found: false, head: headN };
    if (!tx || typeof tx !== 'object' || String(tx.hash).toLowerCase() !== h) throw bad('tx shape');
    if (!isHex(tx.from, 20)) throw bad('tx from');
    const value = qty(tx.value || '0x0');
    const base = { found: true, head: headN, from: tx.from.toLowerCase(), to: tx.to ? String(tx.to).toLowerCase() : null, value };
    if (tx.blockNumber == null) return Object.assign(base, { pending: true, transfers: [], nft: 0 });
    const blockN = qty(tx.blockNumber);
    const [rc, blk] = await Promise.all([
      rpc(ctx, url, 'eth_getTransactionReceipt', [h]),
      rpc(ctx, url, 'eth_getBlockByNumber', [tx.blockNumber, false])
    ]);
    if (!rc || typeof rc !== 'object' || String(rc.transactionHash).toLowerCase() !== h) throw bad('receipt shape');
    if (qty(rc.blockNumber) !== blockN) throw bad('receipt block');
    if (rc.status !== '0x1' && rc.status !== '0x0') throw bad('receipt status');
    if (!blk || typeof blk !== 'object' || qty(blk.number) !== blockN) throw bad('block shape');
    if (String(blk.hash).toLowerCase() !== String(rc.blockHash).toLowerCase()) throw bad('block hash');
    if (!Array.isArray(rc.logs)) throw bad('logs');
    const transfers = []; let nft = 0;
    for (const lg of rc.logs) {
      if (!lg || !isHex(lg.address, 20) || !Array.isArray(lg.topics) || !isHex(lg.data)) throw bad('log shape');
      if (lg.removed === true) throw bad('removed log');
      if (!lg.topics.length || String(lg.topics[0]).toLowerCase() !== '0x' + TRANSFER) continue;
      if (lg.topics.length === 4) { nft++; continue; }
      if (lg.topics.length !== 3 || !isHex(lg.topics[1], 32) || !isHex(lg.topics[2], 32) || lg.data.length !== 66) continue;
      transfers.push({ token: lg.address.slice(2).toLowerCase(), from: lg.topics[1].slice(26).toLowerCase(), to: lg.topics[2].slice(26).toLowerCase(), raw: BigInt(lg.data) });
    }
    const meta = {};
    for (const t of [...new Set(transfers.map(x => x.token))].slice(0, 12)) meta[t] = await tokenMetaEvm(ctx, url, t);
    return Object.assign(base, {
      pending: false, success: rc.status === '0x1', block: blockN, blockHash: String(rc.blockHash).toLowerCase(),
      time: Number(qty(blk.timestamp)), transfers, nft, meta
    });
  }
  async function tokenMetaEvm(ctx, url, token) {
    const call = sel => rpc(ctx, url, 'eth_call', [{ to: '0x' + token, data: '0x' + sel }, 'latest']).then(r => r, e => { if (e.bad) throw e; return null; });
    const [s, n, d] = await Promise.all([call(SEL.symbol), call(SEL.name), call(SEL.decimals)]);
    return { symbol: s ? decodeString(s) : null, name: n ? decodeString(n) : null, decimals: d ? decodeUint8(d) : null };
  }

  // ---------- TRON ----------
  async function tronPost(ctx, url, path, body) {
    const j = await fetchJson(ctx, url + path, body);
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw bad('bad tron answer');
    if (j.Error || j.error) throw new Error('tron error');
    return j;
  }
  async function tronHead(ctx, url) {
    let b = await tronPost(ctx, url, '/wallet/getblock', { detail: false });
    let n = b && b.block_header && b.block_header.raw_data && b.block_header.raw_data.number;
    if (!Number.isSafeInteger(n)) {
      b = await tronPost(ctx, url, '/wallet/getnowblock', {});
      n = b && b.block_header && b.block_header.raw_data && b.block_header.raw_data.number;
    }
    if (!Number.isSafeInteger(n) || n <= 0) throw bad('tron head');
    return BigInt(n);
  }
  async function readTron(ctx, net, url, hash) {
    const [tx, info, head] = await Promise.all([
      tronPost(ctx, url, '/wallet/gettransactionbyid', { value: hash }),
      tronPost(ctx, url, '/wallet/gettransactioninfobyid', { value: hash }),
      tronHead(ctx, url)
    ]);
    if (!Object.keys(tx).length) {
      if (Object.keys(info).length) throw bad('info without tx');
      return { found: false, head };
    }
    if (String(tx.txID).toLowerCase() !== hash) throw bad('tron tx shape');
    const c = tx.raw_data && Array.isArray(tx.raw_data.contract) && tx.raw_data.contract[0];
    if (!c || typeof c.type !== 'string') throw bad('tron contract');
    const pv = (c.parameter && c.parameter.value) || {};
    const hex41 = v => (typeof v === 'string' && /^41[0-9a-fA-F]{40}$/.test(v)) ? v.slice(2).toLowerCase() : null;
    const from = hex41(pv.owner_address);
    let value = 0n, to = null;
    if (c.type === 'TransferContract') { value = BigInt(pv.amount || 0); to = hex41(pv.to_address); }
    else if (c.type === 'TriggerSmartContract') { to = hex41(pv.contract_address); value = BigInt(pv.call_value || 0); }
    const base = { found: true, head, from, to, value, kind: c.type };
    if (!Object.keys(info).length) return Object.assign(base, { pending: true, transfers: [], nft: 0 });
    if (String(info.id).toLowerCase() !== hash || !Number.isSafeInteger(info.blockNumber) || !Number.isSafeInteger(info.blockTimeStamp)) throw bad('tron info shape');
    const ret = Array.isArray(tx.ret) && tx.ret[0] && tx.ret[0].contractRet;
    if (typeof ret !== 'string') throw bad('tron ret');
    const rr = info.receipt && info.receipt.result;
    const success = ret === 'SUCCESS' && info.result !== 'FAILED' && (rr == null || rr === 'SUCCESS');
    const logs = info.log || [];
    if (!Array.isArray(logs)) throw bad('tron logs');
    const transfers = []; let nft = 0;
    for (const lg of logs) {
      if (!lg || typeof lg.address !== 'string' || !Array.isArray(lg.topics)) throw bad('tron log shape');
      const addr = lg.address.toLowerCase().replace(/^41(?=[0-9a-f]{40}$)/, '');
      if (!/^[0-9a-f]{40}$/.test(addr)) throw bad('tron log address');
      if (!lg.topics.length || String(lg.topics[0]).toLowerCase() !== TRANSFER) continue;
      if (lg.topics.length === 4) { nft++; continue; }
      const t1 = String(lg.topics[1] || ''), t2 = String(lg.topics[2] || ''), data = String(lg.data || '');
      if (lg.topics.length !== 3 || !/^[0-9a-f]{64}$/i.test(t1) || !/^[0-9a-f]{64}$/i.test(t2) || !/^[0-9a-f]{64}$/i.test(data)) continue;
      transfers.push({ token: addr, from: t1.slice(24).toLowerCase(), to: t2.slice(24).toLowerCase(), raw: BigInt('0x' + data) });
    }
    // solidified = irreversible on TRON
    const sol = await tronPost(ctx, url, '/walletsolidity/gettransactioninfobyid', { value: hash });
    const solid = !!Object.keys(sol).length && sol.blockNumber === info.blockNumber;
    const meta = {};
    for (const t of [...new Set(transfers.map(x => x.token))].slice(0, 12)) meta[t] = await tokenMetaTron(ctx, url, t);
    return Object.assign(base, {
      pending: false, success, block: BigInt(info.blockNumber), blockHash: String(info.blockNumber), solid,
      time: Math.floor(info.blockTimeStamp / 1000), transfers, nft, meta, contractRet: ret
    });
  }
  async function tokenMetaTron(ctx, url, token) {
    const call = fn => tronPost(ctx, url, '/wallet/triggerconstantcontract', {
      owner_address: '410000000000000000000000000000000000000000', contract_address: '41' + token,
      function_selector: fn, parameter: '', visible: false
    }).then(j => (j.result && j.result.result && Array.isArray(j.constant_result)) ? j.constant_result[0] : null, e => { if (e.bad) throw e; return null; });
    const [s, n, d] = await Promise.all([call('symbol()'), call('name()'), call('decimals()')]);
    return { symbol: s ? decodeString(s) : null, name: n ? decodeString(n) : null, decimals: d ? decodeUint8(d) : null };
  }

  // ---------- two nodes, one answer ----------
  function fingerprint(r) {
    if (!r.found) return 'notfound';
    if (r.pending) return 'pending';
    const meta = Object.keys(r.meta || {}).sort().map(k => k + ':' + JSON.stringify(r.meta[k])).join('|');
    return [r.success, r.block, r.blockHash, r.time, r.from, r.to, r.value, r.nft,
      r.transfers.map(t => [t.token, t.from, t.to, t.raw].join(',')).join(';'), meta].join('#');
  }
  /* Ask two endpoints of one network; if one fails, ask the next.
     -> { state:'ok', read, head } | { state:'notfound' } | { state:'error' } | { state:'disagree' } */
  async function readNetwork(ctx, net, hash) {
    const list = (ctx.endpoints[net] || []).slice();
    const reader = net === 'tron' ? readTron : readEvm;
    const got = []; let i = 0;
    const next = async () => {
      while (i < list.length) {
        const url = list[i++];
        try { got.push(await reader(ctx, net, url, hash)); return; } catch (e) { ctx.log && ctx.log(net, url, e && e.message); }
      }
    };
    await Promise.all([next(), next()]);
    if (got.length < 2) return { state: 'error' };
    const [a, b] = got;
    if (fingerprint(a) !== fingerprint(b)) return { state: 'disagree' };
    if (!a.found) return { state: 'notfound' };
    const head = a.head < b.head ? a.head : b.head;   // the more cautious node
    return { state: 'ok', read: a, head, solid: net === 'tron' ? (a.solid && b.solid) : undefined };
  }

  // ---------- verdict ----------
  async function addrOut(net, hex40) { return net === 'tron' ? tronHexToBase58(hex40) : toChecksumless(hex40); }
  function toChecksumless(hex40) { return '0x' + hex40; }

  async function check(input, opts) {
    opts = opts || {};
    const ctx = {
      fetch: opts.fetch || (root.fetch && root.fetch.bind(root)),
      endpoints: opts.endpoints || ENDPOINTS,
      timeoutMs: opts.timeoutMs || 6000,
      now: opts.now || (() => Date.now()),
      log: opts.log
    };
    const p = parseInput(input);
    const out = { input: p, link: p.link || null };
    if (p.kind === 'empty') return Object.assign(out, { verdict: 'input', title: 'Paste the transaction hash or link first' });
    if (p.kind === 'address') return Object.assign(out, { verdict: 'input', title: 'This is a wallet address, not a payment',
      text: 'Ask the buyer for the transaction hash (also called TxID or Transaction ID). Or open your own wallet and look at its history.' });
    if (p.kind !== 'hash') return Object.assign(out, { verdict: 'input', title: 'No transaction hash found',
      text: 'Paste a transaction hash (64 characters, usually starting with 0x on BNB Chain and Ethereum) or an explorer link that contains one.' });

    const nets = ['bsc', 'eth', 'tron'];
    let results;
    try {
      results = await Promise.all(nets.map(n => readNetwork(ctx, n, p.hash).catch(() => ({ state: 'error' }))));
    } catch (e) { results = nets.map(() => ({ state: 'error' })); }
    const found = nets.map((n, k) => ({ net: n, r: results[k] })).filter(x => x.r.state === 'ok');
    if (found.length > 1) return Object.assign(out, couldNot('The same hash answered on two networks, which should not happen.'));
    if (!found.length) {
      if (results.every(r => r.state === 'notfound'))
        return Object.assign(out, { verdict: 'notfound', title: 'Not found on BNB Chain, Ethereum or TRON',
          text: 'A real payment always exists on the blockchain. Do not hand over the goods.' });
      const dis = results.some(r => r.state === 'disagree');
      return Object.assign(out, couldNot(dis
        ? 'Two blockchain nodes gave different answers. If the payment was sent in the last minute, wait a little and check again.'
        : 'Some blockchain nodes did not answer.'));
    }
    const { net, r } = found[0];
    return Object.assign(out, await judge(net, p.hash, r.read, r.head, r.solid, ctx, opts));
  }
  function couldNot(why) {
    return { verdict: 'error', title: 'Could not check right now', text: why + ' Try again in a minute. Until then, treat the payment as not confirmed.' };
  }

  async function judge(net, hash, rd, head, solid, ctx, opts) {
    const N = NETWORKS[net];
    const base = { network: net, networkName: N.name, hash, explorer: N.explorerTx(net === 'tron' ? hash : '0x' + hash) };
    if (rd.pending) return Object.assign(base, { verdict: 'amber', kind: 'pending', title: 'Pending: not money yet',
      text: 'The transaction is waiting to be included in a block. It may still fail or never happen. Wait, then check again.' });
    const conf = head >= rd.block ? Number(head - rd.block + 1n) : 0;
    const nowS = Math.floor(ctx.now() / 1000);
    if (rd.time > nowS + 600) return Object.assign(base, couldNot('The block time is in the future.'));
    Object.assign(base, { time: rd.time, confirmations: conf, block: rd.block.toString() });
    if (!rd.success) return Object.assign(base, { verdict: 'amber', kind: 'failed', title: 'Failed transaction: no money moved',
      text: 'The transaction is on the blockchain but it failed' + (rd.contractRet && rd.contractRet !== 'SUCCESS' ? ' (' + rd.contractRet + ')' : '') + '. Nothing was paid. Do not hand over the goods.' });

    const off = OFFICIAL[net], disc = DISCONTINUED[net] || {};
    const items = [];
    for (const t of rd.transfers) {
      const meta = (rd.meta && rd.meta[t.token]) || {};
      const o = off[t.token];
      const it = { token: await addrOut(net, t.token), from: await addrOut(net, t.from), to: await addrOut(net, t.to), toKey: t.to,
        symbol: meta.symbol, name: meta.name, raw: t.raw };
      if (o) {
        // decimals read from the chain must be what the contract has always had
        if (meta.decimals !== o.decimals) return Object.assign(base, couldNot('Could not read the token details.'));
        Object.assign(it, { cls: 'real', family: o.sym, decimals: o.decimals, amount: formatUnits(t.raw, o.decimals), note: o.note });
      } else if (disc[t.token]) {
        Object.assign(it, { cls: 'discontinued', family: disc[t.token].sym, decimals: meta.decimals,
          amount: meta.decimals != null ? formatUnits(t.raw, meta.decimals) : t.raw.toString(), note: disc[t.token].note });
      } else {
        const like = stableLike(meta.symbol, meta.name);
        Object.assign(it, { cls: like ? (like.copy ? 'fake' : 'other-stable') : 'other', family: like && like.family, decimals: meta.decimals,
          amount: meta.decimals != null ? formatUnits(t.raw, meta.decimals) : t.raw.toString() + ' (raw units)' });
      }
      items.push(it);
    }
    base.transfers = items;
    base.officialContracts = Object.keys(off).map(k => ({ sym: off[k].sym }));
    for (const it of items) if (it.cls === 'fake' || it.cls === 'other-stable')
      it.realContract = await addrOut(net, Object.keys(off).find(k => off[k].sym === it.family) || Object.keys(off)[0]);

    const real = items.filter(x => x.cls === 'real');
    const fakes = items.filter(x => x.cls === 'fake' || x.cls === 'other-stable');
    const discs = items.filter(x => x.cls === 'discontinued');

    // seller's own address / amount
    let mine = null, amountCheck = null, myKey = null;
    if (opts.myAddress && String(opts.myAddress).trim()) {
      const a = await normalizeAddress(opts.myAddress, net);
      if (!a.ok) mine = { ok: false, invalid: true, why: a.why };
      else {
        myKey = a.key;
        const toMe = real.filter(x => x.toKey === a.key);
        mine = { ok: toMe.length > 0, invalid: false, count: toMe.length, address: await addrOut(net, a.key) };
      }
    }
    if (opts.expected && String(opts.expected).trim() && real.length) {
      // compare with the real transfers to the seller if we know the address, else with each real transfer
      const pool = myKey && mine.ok ? real.filter(x => x.toKey === myKey) : real;
      const fam = pool[0].family, dec = pool[0].decimals;
      const sameFam = pool.filter(x => x.family === fam);
      const want = parseAmount(opts.expected, dec);
      if (want == null) amountCheck = { ok: false, invalid: true, why: 'Could not read the expected amount. Type a number like 120 or 120.50.' };
      else if (myKey && mine.ok) {
        const got = sameFam.reduce((s, x) => s + x.raw, 0n);
        amountCheck = { ok: got === want, more: got > want, got: formatUnits(got, dec), want: formatUnits(want, dec), family: fam };
      } else {
        const got = sameFam.length === 1 ? sameFam[0].raw : null;
        amountCheck = { ok: sameFam.some(x => x.raw === want), more: got != null && got > want,
          got: got != null ? formatUnits(got, dec) : null, want: formatUnits(want, dec), family: fam };
      }
    }
    Object.assign(base, { mine, amountCheck, solid });

    const enough = net === 'tron' ? !!solid : conf >= N.minConf;
    if (fakes.length) {
      const f = fakes[0];
      const copy = fakes.some(x => x.cls === 'fake');
      return Object.assign(base, { verdict: 'red', kind: 'fake',
        title: copy ? 'Fake token: not real ' + f.family : 'Not ' + (f.family === 'USDC' ? 'Circle’s USDC' : 'Tether’s USDT') + ': a bridged or other token',
        text: copy
          ? 'This transaction moves a token named “' + (f.symbol || f.name) + '”, but its contract is not the official ' + f.family + ' contract on ' + N.name + '. It has no value as ' + f.family + '. Do not hand over the goods.'
          : 'This transaction moves “' + (f.symbol || f.name) + '”. Its contract is not the official ' + f.family + ' contract on ' + N.name + ', so it is not ' + f.family + '. It may be a bridged or wrapped token or a fake; either way it is not what you asked for.'
          ,
        alsoReal: real.length > 0 });
    }
    if (real.length) {
      if (mine && !mine.invalid && !mine.ok) return Object.assign(base, { verdict: 'red', kind: 'not-mine',
        title: 'Real ' + real[0].family + ', but not to your address', text: 'The payment went to a different address. You have not been paid by this transaction.' });
      if (!enough) return Object.assign(base, { verdict: 'amber', kind: 'wait', title: 'Real ' + real[0].family + ' — wait for confirmations',
        text: net === 'tron' ? 'The transfer is in a block but TRON has not made it final yet. This takes about a minute. Check again shortly.'
          : 'The transfer is in a block, but only ' + conf + ' of ' + N.minConf + ' confirmations so far. Wait a little and check again.' });
      const fams = [...new Set(real.map(x => x.family))];
      return Object.assign(base, { verdict: 'green', kind: 'real', title: 'Real ' + fams.join(' and ') });
    }
    if (discs.length) return Object.assign(base, { verdict: 'amber', kind: 'discontinued', title: 'Old USDC on TRON, no longer supported by Circle',
      text: 'This is the USDC contract Circle stopped supporting on TRON in 2024. Many wallets and exchanges no longer accept it. Do not count it as a USDC payment.' });
    const other = items.filter(x => x.cls === 'other');
    if (other.length) {
      const names = [...new Set(other.map(x => x.symbol || x.name || 'an unknown token'))].slice(0, 3).join(', ');
      return Object.assign(base, { verdict: 'amber', kind: 'other-token', title: 'No USDT or USDC in this transaction',
        text: 'It moves ' + names + ', not USDT or USDC.' });
    }
    if (rd.value > 0n) return Object.assign(base, { verdict: 'amber', kind: 'native', title: 'No USDT here: only ' + N.native,
      native: { amount: formatUnits(rd.value, N.nativeDecimals), sym: N.native, to: rd.to ? await addrOut(net, rd.to) : null },
      text: 'This transaction sends ' + formatUnits(rd.value, N.nativeDecimals) + ' ' + N.native + ' (the network’s own coin), not USDT or USDC.' });
    if (rd.nft) return Object.assign(base, { verdict: 'amber', kind: 'nft', title: 'No USDT here: an NFT transfer', text: 'This transaction moves an NFT, not USDT or USDC.' });
    return Object.assign(base, { verdict: 'amber', kind: 'empty', title: 'No token transfer in this transaction',
      text: 'It succeeded, but it did not move USDT, USDC or any other token. It is not a payment.' });
  }

  root.UsdtCheck = {
    check, parseInput, checkHost, normName, stableLike, normalizeAddress, parseAmount, formatUnits,
    tronHexToBase58, tronBase58ToHex, decodeString, OFFICIAL, DISCONTINUED, ENDPOINTS, NETWORKS, EXPLORERS
  };
})(typeof window !== 'undefined' ? window : globalThis);
