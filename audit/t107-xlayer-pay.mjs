/* t107: X Layer on the payment page (www/pay.html) and in /api/status
   (functions/api/status.js). Built on t83 (Ethereum/Base).

   1. With XLAYER_PAY = null (the test serves the page that way, as it was
      before the deploy): an X Layer invoice is refused like any unknown
      network — switching it off again is one line.
   2. As committed (XLAYER_PAY = the mainnet contract deployed 19 Nov 2026,
      the test serves it with a fake address so the fake node answers): the invoice shows "X Layer";
      NoN Wallet's button (20 Nov 2026: the web wallet knows X Layer) is
      shown only when it leads to the web wallet deployed with this page
      (wallet.tavarov.com / tavarov-wallet.pages.dev), never to the old
      Netlify copy; the QR code and the copied link stay the page's own https
      link, so the store apps (older bundled wallet) never get a tavarov:
      code for X Layer; another
      wallet pays through the contract: the wallet is asked to switch to
      0xc4, adds X Layer with OKB when it does not know it, approves exactly
      42 USDT0 (six decimals) and calls pay() byte for byte; reads go to the
      X Layer nodes, never to BNB; texts speak of OKB, not BNB.
   3. /api/status with a deployed address asks X Layer nodes about the X
      Layer contract and the USDT0 token.

   Run: cd audit && node t107-xlayer-pay.mjs */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { reporter } from './boot.mjs';
const require = createRequire(import.meta.url);
const EL = require('../www/lib/ethers.umd.min.js');
const E = EL.ethers || EL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.resolve(HERE, '../www'), PORT = 8833;
const R = reporter();

const MERCHANT = '0x73BBaAbB4c9Ee01e3Bf7C9D0Fd5C0b3f0D1eF432';
const BUYER    = '0x1111111111111111111111111111111111111111';
const USDT0    = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';
const PAY      = '0x9999999999999999999999999999999999999a01';   // stands for the address the deploy will print
const INVOICE  = '0x' + 'cd'.repeat(32);

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/status'){ res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"paid":false}'); }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const on = rel === 'pay-on', off = rel === 'pay';
  if (on) rel = 'pay';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(f);
  if (on || off){
    const s = body.toString('utf8'), line = /^const XLAYER_PAY = [^\n]*$/m;
    if (!line.test(s)) throw new Error('XLAYER_PAY line not found in pay.html');
    body = Buffer.from(s.replace(line, on ? "const XLAYER_PAY = '" + PAY + "';" : 'const XLAYER_PAY = null;'), 'utf8');
  }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(body);
});
await new Promise(r => srv.listen(PORT, r));

const b64 = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const inv = { m: MERCHANT, a: '42', c: 'USDT', h: INVOICE, net: 'xlayer', n: 'Coffee', o: 'X-1' };
const OFF = 'http://localhost:' + PORT + '/pay#p=' + b64(inv);
const ON  = 'http://localhost:' + PORT + '/pay-on#p=' + b64(inv);
const ON7 = 'http://localhost:' + PORT + '/pay-on#p=' + b64(Object.assign({}, inv, { a: '1.0000001' }));
const ON_BNB = 'http://localhost:' + PORT + '/pay-on#p=' + b64(Object.assign({}, inv, { net: 'bnb' }));

/* A wallet that does not know X Layer yet (like a fresh MetaMask): the
   first switch fails with 4902, the page must add the chain. */
const FAKE = ({ buyer }) => {
  window.__calls = [];
  let chain = '0x38', known = false;
  const provider = { request: async ({ method, params }) => {
    window.__calls.push({ method, params });
    if (method === 'eth_requestAccounts') return [buyer];
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain'){
      if (params[0].chainId === '0xc4' && !known){ const e = new Error('Unrecognized chain ID "0xc4"'); e.code = 4902; throw e; }
      chain = params[0].chainId; return null;
    }
    if (method === 'wallet_addEthereumChain'){ known = true; chain = params[0].chainId; return null; }
    if (method === 'eth_sendTransaction'){
      const tx = params[0];
      if (tx.data.startsWith('0x095ea7b3')) window.__allowance = BigInt('0x' + tx.data.slice(74)).toString();
      return '0x' + (window.__calls.length).toString(16).padStart(64, 'a');
    }
    return new Promise(() => {});
  } };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider',
    { detail: Object.freeze({ info: { uuid: 'io.metamask', name: 'MetaMask', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>', rdns: 'io.metamask' }, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
};

const hosts = [];
async function node(page, route){
  const req = route.request();
  let q; try{ q = JSON.parse(req.postData() || '{}'); } catch(e){ q = {}; }
  hosts.push(new URL(req.url()).host);
  const a = await page.evaluate(() => window.__allowance || '0').catch(() => '0');
  const w = v => '0x' + BigInt(v).toString(16).padStart(64, '0');
  let result = '0x';
  if (q.method === 'eth_getBalance') result = '0x16345785d8a0000';
  else if (q.method === 'eth_call'){
    const d = q.params[0].data, to = String(q.params[0].to).toLowerCase();
    if (d.startsWith('0x55f5e7de')) result = w(to === PAY.toLowerCase() && d.slice(-40).toLowerCase() === USDT0.slice(2).toLowerCase() ? 1n : 0n);
    else if (d.startsWith('0x38d56afe')) result = '0x' + '0'.repeat(64 * 7);
    else if (d.startsWith('0x70a08231')) result = w(to === USDT0.toLowerCase() ? 100n * 10n ** 6n : 0n);
    else if (d.startsWith('0xdd62ed3e')) result = w(a);
  }
  else if (q.method === 'eth_getTransactionReceipt') result = { status: '0x1' };
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) });
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
async function fresh(locale = 'en-US'){
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale });
  await ctx.addInitScript(FAKE, { buyer: BUYER });
  await ctx.addInitScript(() => { window.__copied = []; try{ Object.defineProperty(navigator, 'clipboard', { value: { writeText: async s => { window.__copied.push(s); } } }); } catch(e){} });
  const page = await ctx.newPage();
  await ctx.route(u => /xlayer|okx\.com|bsc-dataseed|bnbchain\.org|publicnode\.com|drpc\.org|1rpc\.io|base\.org/.test(u.host), route => node(page, route));
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  return { ctx, page };
}
const seen = (page, sel) => page.evaluate(s => { const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; }, sel);

// ===== 1. as committed: off =====
let { ctx, page } = await fresh();
await page.goto(OFF); await page.waitForTimeout(400);
R.ok('off: X Layer invoice is refused like an unknown network', !(await seen(page, '#main')) && await seen(page, '#err'));
R.ok('off: XLAYER_PAY null, X Layer not in KNOWN_NETS', await page.evaluate(() => XLAYER_PAY === null && !KNOWN_NETS.includes('xlayer') && KNOWN_NETS.join() === 'bnb,bnbTestnet,eth,base,solana'));
await ctx.close();

// ===== 2. on =====
({ ctx, page } = await fresh());
await page.goto(ON); await page.waitForTimeout(500);
R.ok('on: invoice shown, network "X Layer", 42 USDT', await seen(page, '#main') && (await page.textContent('#net')) === 'X Layer' && /42 USDT/.test(await page.textContent('#amount')));
const owHref = await page.evaluate(() => document.getElementById('openWallet').href);
R.ok('on: NoN Wallet button shown, leads to the web wallet wallet.tavarov.com with net=xlayer', await seen(page, '#openWallet')
  && owHref.startsWith('https://wallet.tavarov.com/?pay=tavarov%3Apay%3F') && /net%3Dxlayer/.test(owHref), owHref.slice(0, 80));
R.ok('on: QR is the page link, not tavarov: (store apps do not know X Layer); camera hint hidden',
  /^https?:\/\//.test(await page.evaluate(() => document.getElementById('qr').title || ''))
  && !(await seen(page, '#qrHint')) && !(await seen(page, '#iosHint')));
R.ok('on: "pay with another wallet" still offered', await seen(page, '#openOther'));
R.ok('on: table: chain 196, USDT0 and Circle USDC with 6 decimals', await page.evaluate(() => CHAIN_IDS.xlayer === 196 && TOKENS.xlayer.USDT.a === '0x779Ded0c9e1022225f8E0630b35a9b54bE713736'
  && TOKENS.xlayer.USDC.a === '0xB6CEceAB302E2E4948951eE7843FC24E92933061' && TOKENS.xlayer.USDT.d === 6 && TOKENS.xlayer.USDC.d === 6));
await page.click('#copyLink');
const copied = await page.evaluate(() => window.__copied[0] || '');
R.ok('on: "copy link" copies the page\'s https link (not tavarov:)', copied.startsWith('http://localhost:' + PORT + '/pay-on?p=') && /pick=1/.test(copied), copied.slice(0, 60));
const back = copied ? JSON.parse(Buffer.from(new URL(copied).searchParams.get('p'), 'base64url').toString('utf8')) : {};
R.ok('on: that link carries the same invoice (net xlayer, 42, USDT, id)', back.net === 'xlayer' && back.a === '42' && back.c === 'USDT' && back.h === INVOICE && back.m === MERCHANT);
const wSub = await page.evaluate(() => t('wSub')), wNoGas = await page.evaluate(() => t('wNoGas')), sChain = await page.evaluate(() => t('sChain'));
R.ok('on: texts speak of X Layer and OKB, not BNB', /X Layer/.test(sChain) && /OKB/.test(wSub + wNoGas) && !/BNB/.test(wSub + wNoGas + sChain), sChain + ' | ' + wNoGas);
const trust = await page.evaluate(() => walletApps().find(a => a.name === 'Trust Wallet').href);
R.ok('on: Trust Wallet opens as an EVM dapp (coin_id=60)', /coin_id=60&/.test(trust));

await page.click('#openOther'); await page.waitForTimeout(300);
await page.evaluate(() => { window.__calls.length = 0; });
await page.click('#wFound .wrow:nth-child(1)');
await page.waitForFunction(() => /sent|отправлен/i.test(document.getElementById('wErr').textContent), null, { timeout: 20000 }).catch(() => {});
const calls = await page.evaluate(() => window.__calls);
const add = calls.find(c => c.method === 'wallet_addEthereumChain');
R.ok('wallet asked to switch to X Layer (0xc4)', calls.some(c => c.method === 'wallet_switchEthereumChain' && c.params[0].chainId === '0xc4'));
R.ok('unknown to the wallet: X Layer added with OKB, official RPC and explorer', !!add && add.params[0].chainId === '0xc4' && add.params[0].nativeCurrency.symbol === 'OKB'
  && add.params[0].nativeCurrency.decimals === 18 && add.params[0].rpcUrls[0] === 'https://rpc.xlayer.tech' && add.params[0].blockExplorerUrls[0] === 'https://web3.okx.com/explorer/x-layer', add && JSON.stringify(add.params[0]));
const sends = calls.filter(c => c.method === 'eth_sendTransaction').map(c => c.params[0]);
const erc = new E.utils.Interface(['function approve(address,uint256)']);
const payI = new E.utils.Interface(['function pay(address merchant, address token, uint256 amount, bytes32 invoice)']);
const u42 = E.utils.parseUnits('42', 6);
R.ok('two operations: approve, pay', sends.length === 2, sends.length + ' ' + (await page.textContent('#wErr')));
R.ok('approve exactly 42 USDT0 (6 decimals) to the X Layer contract, on the USDT0 token', sends[0] && sends[0].to.toLowerCase() === USDT0.toLowerCase()
  && sends[0].data.toLowerCase() === erc.encodeFunctionData('approve', [PAY, u42]).toLowerCase(), sends[0] && sends[0].data);
R.ok('pay() byte for byte to the X Layer contract', sends[1] && sends[1].to.toLowerCase() === PAY.toLowerCase()
  && sends[1].data.toLowerCase() === payI.encodeFunctionData('pay', [MERCHANT.toLowerCase(), USDT0, u42, INVOICE]).toLowerCase());
const hs = [...new Set(hosts)];
R.ok('reads went to X Layer nodes only', hs.length > 0 && hs.every(h => /xlayer|okx/.test(h)), hs.join(','));
await ctx.close();

({ ctx, page } = await fresh());
await page.goto('http://localhost:' + PORT + '/pay-on#p=' + b64(Object.assign({}, inv, { w: 'https://tavarov-wallet.netlify.app' })));
await page.waitForTimeout(400);
R.ok('on: invoice pointing at the old Netlify wallet: NoN Wallet button hidden, other wallet is the main button',
  await seen(page, '#main') && !(await seen(page, '#openWallet')) && await page.evaluate(() => document.getElementById('openOther').classList.contains('btn-main')));
await ctx.close();

({ ctx, page } = await fresh());
await page.goto(ON7); await page.waitForTimeout(300);
R.ok('on: a 7th decimal on X Layer is refused (USDT0 has 6)', !(await seen(page, '#main')) && await seen(page, '#err'));
await ctx.close();

({ ctx, page } = await fresh());
await page.goto(ON_BNB); await page.waitForTimeout(400);
R.ok('on: a BNB invoice still offers NoN Wallet and the tavarov: code', await seen(page, '#openWallet') && /^tavarov:pay\?/.test(await page.evaluate(() => payLink())) && !(await page.evaluate(() => document.getElementById('openOther').classList.contains('btn-main'))));
await ctx.close();
await browser.close(); srv.close();

// ===== 3. /api/status =====
const STATUS = await import('../functions/api/status.js');
const asked = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const q = JSON.parse(init.body); asked.push({ url: String(url), method: q.method, params: q.params });
  let result = '0x';
  if (q.method === 'eth_blockNumber') result = '0x100000';
  else if (q.method === 'eth_getLogs') result = [];
  else if (q.method === 'eth_call') result = '0x' + '0'.repeat(64 * 7);
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
};
const q = 'h=' + INVOICE + '&m=' + MERCHANT + '&net=xlayer&a=42&c=USDT';
let res = await STATUS.onRequestGet({ request: new Request('https://wallet.tavarov.com/api/status?' + q), env: {} });
const LIVE = '0x29a318431053127e2fbf3c0ae9cbaf84cb6aa1d4';
   // X Layer mainnet, deployed 19 Nov 2026
R.ok('/api/status as committed: X Layer deployed -> 200, asks the mainnet contract', res.status === 200
  && asked.some(a => a.method === 'eth_call' && String(a.params[0].to).toLowerCase() === LIVE) && asked.every(a => /xlayer/.test(a.url)), res.status);
asked.length = 0;
res = await STATUS.onRequestGet({ request: new Request('https://wallet.tavarov.com/api/status?' + q), env: { TAVAROV_PAY: PAY } });
const body = await res.json();
R.ok('/api/status: deployed -> 200, unpaid', res.status === 200 && body.paid === false, JSON.stringify(body));
R.ok('/api/status: asks the X Layer nodes', asked.length > 0 && asked.every(a => /xlayer/.test(a.url)), [...new Set(asked.map(a => a.url))].join(','));
R.ok('/api/status: about the X Layer contract', asked.some(a => a.method === 'eth_call' && String(a.params[0].to).toLowerCase() === PAY.toLowerCase()));
/* A direct transfer to the shop is searched in the logs (s = invoice time,
   here 10 minutes ago = ~660 blocks): OKX nodes refuse eth_getLogs over 100
   blocks, so the read must come in pieces that cover the window with no gap. */
asked.length = 0;
res = await STATUS.onRequestGet({ request: new Request('https://wallet.tavarov.com/api/status?' + q + '&s=' + (Math.floor(Date.now() / 1000) - 600)), env: {} });
const lg = asked.filter(a => a.method === 'eth_getLogs').map(a => [parseInt(a.params[0].fromBlock, 16), parseInt(a.params[0].toBlock, 16)]).sort((x, y) => x[0] - y[0]);
const okSpans = lg.length > 1 && lg.every(([a, b]) => b >= a && b - a + 1 <= 100) && lg.every((r, i) => i === 0 || r[0] === lg[i - 1][1] + 1);
R.ok('/api/status: X Layer logs read in pieces of at most 100 blocks, no gaps', okSpans, JSON.stringify(lg.map(([a, b]) => b - a + 1)));
globalThis.fetch = realFetch;

process.exit(R.done(errors) ? 0 : 1);
