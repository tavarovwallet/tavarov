/* Shared pieces of the X Layer tools (deploy-xlayer.mjs, tapeout-xlayer.mjs).

   No npm packages: the only library is the ethers 5.7.2 file the wallet
   already ships (www/lib/ethers.umd.min.js), used here for keystores, signing
   and ABI encoding. Every request to a node goes through rpc() below.

   The contract bytes are NOT kept here. They are read from
   site/vypusk-seti.html, the page that deployed TavarovPay v3 on Ethereum and
   Base: the same solc 0.8.20 build that was matched byte for byte against
   the verified BNB Chain contracts. One copy of the bytes, so a deploy on
   X Layer cannot drift from what runs on the other networks. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
const EL = require(path.join(REPO, 'www/lib/ethers.umd.min.js'));
export const E = EL.ethers || EL;

/* ---------- networks ----------
   Sources (checked 19 Nov 2026):
   - chain ids, RPCs, explorers: web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information
     and .../rpc-endpoints (100 requests per second per IP).
   - USDT0: OKX USDT0 FAQ (okx.com/help/usdt0-faq) and the X Layer contracts page.
   - USDC (native, Circle, since 7 Aug 2026): developers.circle.com/stablecoins/usdc-contract-addresses
     (mainnet 0xB6CE…3061, testnet 0xDec9…b9B3). The older 0x74b7…6d22 on OKX's contracts page and
     USDC.e 0xA8CE…C035 are bridged tokens, not Circle's: not accepted here.
   Testnet has no USDT0. */
export const CHAINS = {
  mainnet: { chainId: 196, name: 'X Layer', sym: 'OKB',
    rpcs: ['https://rpc.xlayer.tech', 'https://xlayerrpc.okx.com'],
    explorer: 'https://web3.okx.com/explorer/x-layer',
    tokens: { USDT: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',     // USDT0
              USDC: '0xB6CEceAB302E2E4948951eE7843FC24E92933061' } }, // Circle native USDC
  testnet: { chainId: 1952, name: 'X Layer testnet', sym: 'OKB',
    rpcs: ['https://testrpc.xlayer.tech/terigon', 'https://xlayertestrpc.okx.com/terigon'],
    explorer: 'https://web3.okx.com/explorer/x-layer-testnet',
    tokens: { USDC: '0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3' } }   // Circle testnet USDC
};

/* The same wallet that takes the 1% on BNB Chain, Ethereum and Base. An
   ordinary wallet, so it is the same address on every EVM network. */
export const TREASURY = '0x73BBCD23735257660A9f6BE57d057dC4A2ABf432';
/* Owner of the contracts on BNB Chain. */
export const OWNER_BNB = '0x1840d0883cc5ac1c383d10b4756780d073bc7891';
/* Same numbers as the BNB Chain and Ethereum/Base deploys. There are no
   bonuses here (every rate is 0), but the constructor wants non-zero values. */
export const HALVING = 5000000000000000000000000n;
export const VESTING = 7776000n;
export const FEE_BPS = 100;

/* Selectors, the same table as site/vypusk-seti.html (audit/t105 recomputes
   each one with ethers). */
export const S = { owner: '0x8da5cb5b', treasury: '0x61d027b3', feeBps: '0x24a9d853', VESTING: '0x156ca894',
  halvingStep: '0x030f65cb', rewardToken: '0xf7c618c1', acceptedToken: '0x55f5e7de', rewardPerUnit: '0xd6fa1525',
  configureToken: '0x28e56825', VERSION: '0xffa1ad74', REF_SHARE_BPS: '0x7d8f9641', vaultImplementation: '0xbba48a90',
  MAX_TTL: '0xe01b402d', decimals: '0x313ce567', transferOwnership: '0xf2fde38b' };

export const W = v => BigInt(v).toString(16).padStart(64, '0');
export const A = a => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0');

export function loadBuild(file = path.join(REPO, 'site/vypusk-seti.html')){
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/const BUILD = (\{.*?\});\n/);
  if (!m) throw new Error('BUILD not found in ' + file);
  const b = JSON.parse(m[1]);
  for (const k of ['TavarovPayV3', 'MerchantVaultV2', 'TavarovCharges'])
    if (!b[k] || !/^[0-9a-f]+$/.test(b[k].bytecode) || !/^[0-9a-f]+$/.test(b[k].deployed)) throw new Error('BUILD.' + k + ' is broken');
  return b;
}

/* ---------- JSON-RPC ---------- */
export function client(urls, opts = {}){
  const fetchFn = opts.fetch || globalThis.fetch;
  let id = 0;
  async function rpc(method, params = []){
    let last = null;
    for (const url of urls){
      try{
        const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
        if (!r.ok){ last = new Error(url + ': HTTP ' + r.status); continue; }
        const j = await r.json();
        if (j.error){
          const e = new Error((j.error.message || 'rpc error') + (j.error.data ? ' ' + JSON.stringify(j.error.data).slice(0, 200) : ''));
          e.rpc = true; e.data = j.error.data;
          throw e;                      // the node answered: an error is an answer, do not ask the next one
        }
        return j.result;
      } catch(e){ if (e.rpc) throw e; last = e; }
    }
    throw last || new Error('no node answered');
  }
  const call = (to, data, from) => rpc('eth_call', [Object.assign({ to, data }, from ? { from } : {}), 'latest']);
  const num = async (to, data) => { const r = await call(to, data); return BigInt(r && r !== '0x' ? r : '0x0'); };
  const addr = async (to, data) => '0x' + String(await call(to, data)).slice(-40).toLowerCase();
  const code = async a => String(await rpc('eth_getCode', [a, 'latest']));
  return { rpc, call, num, addr, code };
}

/* An ordinary wallet has no code; a wallet with an EIP-7702 delegation has ef0100… Both are wallets. */
export const isWallet = c => !c || c === '0x' || /^0xef0100/i.test(c);

/* Is this the code we built? Compare, skipping the places the constructor fills (immutables). */
export function sameCode(got, b){
  got = String(got).replace(/^0x/, '').toLowerCase();
  const want = b.deployed.toLowerCase();
  if (got.length !== want.length) return false;
  const g = got.split(''), w = want.split('');
  for (const [s, l] of b.immut){ for (let i = s * 2; i < (s + l) * 2; i++){ g[i] = '0'; w[i] = '0'; } }
  return g.join('') === w.join('');
}

export const fmt = (v, d = 18) => { const s = BigInt(v).toString().padStart(d + 1, '0');
  const w = s.slice(0, -d), f = s.slice(-d).replace(/0+$/, ''); return w + (f ? '.' + f.slice(0, 6) : ''); };

/* Fees we name ourselves: base fee of the latest block twice over plus a tip
   the node suggests, kept between 0.001 and 1 gwei. Only base + tip is spent. */
export async function feeFields(c){
  const blk = await c.rpc('eth_getBlockByNumber', ['latest', false]);
  if (!blk || !blk.baseFeePerGas){
    const gp = BigInt(await c.rpc('eth_gasPrice'));
    return { type: 0, gasPrice: gp * 12n / 10n };
  }
  const base = BigInt(blk.baseFeePerGas);
  let tip = 0n;
  try{ tip = BigInt(await c.rpc('eth_maxPriorityFeePerGas')); } catch(e){}
  if (tip < 1000000n) tip = 1000000n;
  if (tip > 1000000000n) tip = 1000000000n;
  return { type: 2, maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip };
}

/* Read a secret from the terminal without echoing it. */
export function askHidden(question){
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('no terminal to ask for the password; set it in the environment instead'));
    process.stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let s = '';
    const on = raw => {
      /* A pasted password arrives wrapped in bracketed-paste markers
         (ESC[200~ … ESC[201~) on macOS Terminal; drop them and any other
         escape sequence so typing and pasting give the same password. */
      const ch = String(raw).replace(/\x1b\[20[01]~/g, '').replace(/\x1b\[[0-9;]*[A-Za-z~]/g, '');
      for (const c of ch){
        if (c === '\r' || c === '\n'){ stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); return resolve(s); }
        if (c === '\u0003'){ stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b'){ s = s.slice(0, -1); continue; }
        s += c;
      }
    };
    stdin.on('data', on);
  });
}
export function askLine(question){
  return new Promise(resolve => {
    process.stdout.write(question);
    process.stdin.resume(); process.stdin.setEncoding('utf8');
    process.stdin.once('data', d => { process.stdin.pause(); resolve(String(d).trim()); });
  });
}

/* ---------- the deployer key ----------
   Kept as an encrypted keystore file (the Ethereum "v3" format geth, Foundry
   and MetaMask's importer use). The password is asked in the terminal, or
   read from XLAYER_KEYSTORE_PASSWORD. The key itself is never printed and
   never written in the clear. */
export function keystorePath(env = process.env){
  return env.XLAYER_KEYSTORE || path.join(env.HOME || '.', '.tavarov', 'xlayer-deployer.json');
}
export function keystoreAddress(file){
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^(0x)?[0-9a-fA-F]{40}$/.test(j.address || '')) throw new Error(file + ' has no address field');
  return E.utils.getAddress('0x' + String(j.address).replace(/^0x/, ''));
}
export async function unlock(file, env = process.env){
  const pw = env.XLAYER_KEYSTORE_PASSWORD != null ? env.XLAYER_KEYSTORE_PASSWORD : await askHidden('Keystore password: ');
  return await E.Wallet.fromEncryptedJson(fs.readFileSync(file, 'utf8'), pw);
}
