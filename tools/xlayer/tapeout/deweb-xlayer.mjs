#!/usr/bin/env node
/* OPTIONAL. Publish a static site (the Tavarov Pay till, pay-app/www on the
   xlayer-till branch) on X Layer DeWEB, inside the container of the rule
   circuit made by tapeout-xlayer.mjs. Run tapeout-xlayer.mjs first: this
   reads its state file for the processor and circuit id.

     XLAYER_DEWEB_DIR=/path/to/pay-app/www node tools/xlayer/tapeout/deweb-xlayer.mjs plan
     XLAYER_DEWEB_DIR=/path/to/pay-app/www node tools/xlayer/tapeout/deweb-xlayer.mjs run

   Steps (each skipped when the chain already shows it done):
     1. open the circuit's container (its ERC-6551 account): opener FEE, 0.08 OKB on 27 Oct 2026;
     2. write each file to SiteRegistry: putFile with the first 24,000 bytes and
        its SHA-256, appendChunk for the rest (gas only);
     3. bind the name <circuit>.2.<CPU number>.tape (monthlyFee was 0 on X Layer).
   The site is then served at https://<circuit>-2-<CPU number>.tapekit.org,
   where TapeKit checks every file against its on-chain SHA-256.

   Addresses: TapeOutProtocol/TapeKit kernel/src/config.js (L2_CONTRACTS, same on
   Base and X Layer). Interface: the same calls an X Layer DeWEB site used on
   27 Oct 2026 (Fizzl13/x402-doctor scripts/deweb-xlayer.mjs).

   NOT verified: whether the tapekit.org gateway lets an on-chain page call
   outside JSON-RPC nodes (the till must, to see payments). Publish, open the
   gateway URL, make one test sale before telling anyone it works. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { E, HERE as XL, client, fmt, feeFields, keystorePath, unlock, askLine } from '../lib.mjs';
import { TAPEOUT } from './tapeout-xlayer.mjs';

export const DEWEB = {
  opener: '0x536add8f30f03b69f6fbf29d425a816a0dc50106',
  registry: '0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6',
  binding: '0x68809fd2fb343aa57d0aeb7f33defe477c9666f9',
  area: 2,                // X Layer's area code in TapeOut names
  chunk: 24000
};
export const ABI = new E.utils.Interface([
  'function FEE() view returns (uint256)',
  'function open(address circuits, uint256 tokenId) payable',
  'function accountOf(address circuits, uint256 tokenId) view returns (address)',
  'function isOpened(address circuits, uint256 tokenId) view returns (bool)',
  'function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)',
  'function putFile(address container, string path, string contentType, bytes32 sha256Hash, bytes data)',
  'function appendChunk(address container, string path, uint256 expectIndex, bytes data)',
  'function monthlyFee() view returns (uint256)',
  'function isLive(string name, address container) view returns (bool)',
  'function bind(string name, address container, uint256 months) payable'
]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

/* Files under dir (recursively), index.html first; each with its chunks. */
export function siteFiles(dir){
  const out = [];
  const walk = rel => {
    for (const f of fs.readdirSync(path.join(dir, rel)).sort()){
      const r = rel ? rel + '/' + f : f, abs = path.join(dir, r);
      if (f.startsWith('.')) continue;
      if (fs.statSync(abs).isDirectory()){ walk(r); continue; }
      const bytes = fs.readFileSync(abs), chunks = [];
      for (let i = 0; i < bytes.length; i += DEWEB.chunk) chunks.push('0x' + bytes.subarray(i, i + DEWEB.chunk).toString('hex'));
      out.push({ path: r, contentType: TYPES[path.extname(f)] || 'application/octet-stream', size: bytes.length,
                 sha256: '0x' + crypto.createHash('sha256').update(bytes).digest('hex'), chunks: chunks.length ? chunks : ['0x'] });
    }
  };
  walk('');
  return out.sort((a, b) => (a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : a.path.localeCompare(b.path)));
}
export const siteName = (id, cpu) => id + '.' + DEWEB.area + '.' + cpu + '.tape';
export const gatewayUrl = (id, cpu) => 'https://' + id + '-' + DEWEB.area + '-' + cpu + '.tapekit.org';

export function config(env = process.env){
  const dir = env.XLAYER_DEWEB_DIR;
  if (!dir || !fs.existsSync(path.join(dir, 'index.html'))) throw new Error('Set XLAYER_DEWEB_DIR to a folder with index.html (pay-app/www on the xlayer-till branch)');
  return { dir, rpcs: env.XLAYER_RPC ? [env.XLAYER_RPC] : TAPEOUT.rpcs, keystore: keystorePath(env), yes: env.XLAYER_YES === '1',
           tapeoutState: env.XLAYER_TAPEOUT_STATE || path.join(XL, 'state-tapeout-196.json') };
}
const read = async (c, to, fn, args = []) => ABI.decodeFunctionResult(fn, await c.call(to, ABI.encodeFunctionData(fn, args)));

async function situation(cfg, c){
  let st; try{ st = JSON.parse(fs.readFileSync(cfg.tapeoutState, 'utf8')); } catch(e){ st = {}; }
  if (!st.circuits || !st.circuitId || st.cpuIndex == null) throw new Error('Run tapeout-xlayer.mjs first: no processor/circuit in ' + cfg.tapeoutState);
  const container = (await read(c, DEWEB.opener, 'accountOf', [st.circuits, st.circuitId]))[0];
  const opened = (await read(c, DEWEB.opener, 'isOpened', [st.circuits, st.circuitId]))[0];
  const openFee = (await read(c, DEWEB.opener, 'FEE'))[0].toBigInt();
  const monthlyFee = (await read(c, DEWEB.binding, 'monthlyFee'))[0].toBigInt();
  const files = siteFiles(cfg.dir);
  const todo = [];
  for (const f of files){
    let same = false;
    try{
      const info = await read(c, DEWEB.registry, 'fileInfo', [container, f.path]);
      same = info.sha256Hash.toLowerCase() === f.sha256 && info.chunkCount.toNumber() === f.chunks.length;
    } catch(e){}
    if (!same) todo.push(f);
  }
  const name = siteName(st.circuitId, st.cpuIndex);
  return { st, container, opened, openFee, monthlyFee, files, todo, name, months: monthlyFee === 0n ? 120n : 1n };
}

export async function plan(cfg, opts = {}){
  const log = opts.log || console.log;
  const c = client(cfg.rpcs, opts);
  const s = await situation(cfg, c);
  const bytes = s.files.reduce((a, f) => a + f.size, 0);
  log('site         ' + cfg.dir + ': ' + s.files.length + ' files, ' + bytes + ' bytes, ' + s.files.reduce((a, f) => a + f.chunks.length, 0) + ' chunks');
  log('container    ' + s.container + (s.opened ? ' (open)' : ' (to open: ' + fmt(s.openFee) + ' OKB)'));
  log('to write     ' + s.todo.length + ' files' + (s.todo.length ? ': ' + s.todo.map(f => f.path).join(', ') : ''));
  log('name         ' + s.name + ' → ' + gatewayUrl(s.st.circuitId, s.st.cpuIndex) + (s.monthlyFee ? ' (' + fmt(s.monthlyFee) + ' OKB a month)' : ' (free)'));
  log('cost         ' + fmt((s.opened ? 0n : s.openFee) + s.months * s.monthlyFee) + ' OKB in fees, plus gas for ~' + Math.ceil(bytes * 1.1 / 1000) + 'k bytes of storage');
  return s;
}

export async function run(cfg, opts = {}){
  const log = opts.log || console.log;
  const c = client(cfg.rpcs, opts);
  const wallet = opts.wallet || await unlock(cfg.keystore);
  const from = wallet.address;
  const s = await situation(cfg, c);
  if (!cfg.yes && !opts.yes){
    const a = await askLine('Publish ' + s.files.length + ' files as ' + s.name + ' from ' + from + '? Type "yes": ');
    if (a !== 'yes') throw new Error('Not confirmed, nothing sent.');
  }
  async function send(to, data, value, label){
    const tx = { from, to, data, value: '0x' + value.toString(16) };
    try{ await c.rpc('eth_call', [tx, 'latest']); } catch(e){ throw new Error(label + ': simulation says it would fail: ' + e.message); }
    let gas = 3000000n;
    try{ gas = BigInt(await c.rpc('eth_estimateGas', [tx])) * 13n / 10n; } catch(e){}
    const nonce = Number(BigInt(await c.rpc('eth_getTransactionCount', [from, 'pending'])));
    const signed = await wallet.signTransaction(Object.assign({ to, data, value, nonce, gasLimit: gas, chainId: TAPEOUT.chainId }, await feeFields(c)));
    const hash = await c.rpc('eth_sendRawTransaction', [signed]);
    log('  sent       ' + label + '  ' + hash);
    for (let i = 0; i < 240; i++){
      const r = await c.rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r && r.blockNumber){ if (BigInt(r.status) !== 1n) throw new Error(label + ': the network rejected ' + hash); return r; }
      await new Promise(res => setTimeout(res, opts.pollMs || 1500));
    }
    throw new Error(label + ': not confirmed in 6 minutes: ' + hash);
  }
  if (!s.opened) await send(DEWEB.opener, ABI.encodeFunctionData('open', [s.st.circuits, s.st.circuitId]), s.openFee, 'open container');
  for (const f of s.todo){
    await send(DEWEB.registry, ABI.encodeFunctionData('putFile', [s.container, f.path, f.contentType, f.sha256, f.chunks[0]]), 0n, 'putFile ' + f.path);
    for (let i = 1; i < f.chunks.length; i++)
      await send(DEWEB.registry, ABI.encodeFunctionData('appendChunk', [s.container, f.path, i, f.chunks[i]]), 0n, 'appendChunk ' + f.path + ' #' + i);
  }
  const live = await read(c, DEWEB.binding, 'isLive', [s.name, s.container]).then(r => r[0], () => false);
  if (!live) await send(DEWEB.binding, ABI.encodeFunctionData('bind', [s.name, s.container, s.months]), s.months * s.monthlyFee, 'bind ' + s.name);
  const url = gatewayUrl(s.st.circuitId, s.st.cpuIndex);
  log('');
  log('==== DEWEB: ' + s.name + ' ====');
  log('container: ' + s.container);
  log('open it:   ' + url);
  return { name: s.name, url, container: s.container };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const cmd = process.argv[2] || 'plan';
  (async () => {
    const cfg = config();
    if (cmd === 'plan'){ await plan(cfg); return; }
    if (cmd === 'run'){ await run(cfg); return; }
    throw new Error('Unknown command "' + cmd + '". Use plan or run.');
  })().catch(e => { console.error('STOPPED: ' + (e && e.message || e)); process.exit(1); });
}
