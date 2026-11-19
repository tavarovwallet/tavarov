/* t109: X Layer in the Tavarov Pay till (pay-app/www), against the fake node.

   1. With XLAYER_PAY = null (served that way, as before the deploy; turning
      X Layer off again is one line): no X Layer anywhere in the till —
      Settings lists BNB Chain, Ethereum and Base only.
   2. As committed (XLAYER_PAY = the mainnet contract deployed 19 Nov 2026;
      the test serves the fake node's contract and token in its place):
      Settings offers "X Layer"; turning it on checks the seller's address is
      not a contract there; the till offers the network; a 2.5 USDT sale on X
      Layer makes a payment-page link with net "xlayer" and the same invoice,
      an EIP-681 code for chain 196 with 6-decimal units; the till watches X
      Layer nodes only; a Paid event from the X Layer contract flips it to
      Paid with the 1% split and an X Layer explorer link.

   Run: cd audit && NODE_PATH=/home/claude/.npm-global/lib/node_modules timeout 170 node t109-xlayer-till.mjs */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';
import { reporter } from './boot.mjs';
import { start, state, ADDR, paidLog } from './mocknode.mjs';
const require = createRequire(import.meta.url);
const EL = require('../www/lib/ethers.umd.min.js');
const E = EL.ethers || EL;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../pay-app/www');
const APP_PORT = 8097, RPC_PORT = 8558;
const MOCK = 'http://localhost:' + RPC_PORT;
const R = reporter();
await start(RPC_PORT);
state.payVersion = 3;
const SELLER = E.utils.getAddress('0x5e11e7c0ffee000000000000000000000000beef');
const USDT0 = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';

let patched = false;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const appSrv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (rel === 'app.js'){
    let s = body.toString('utf8');
    const line = /^const XLAYER_PAY = [^\n]*$/m;
    if (!line.test(s) || s.split(USDT0).length !== 2) throw new Error('app.js X Layer block not as expected');
    s = patched ? s.replace(line, "const XLAYER_PAY = '" + ADDR.pay + "';").replace(USDT0, ADDR.usdt) : s.replace(line, 'const XLAYER_PAY = null;');
    body = Buffer.from(s, 'utf8');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise(r => appSrv.listen(APP_PORT, r));
R.ok('as committed: XLAYER_PAY = the X Layer mainnet contract deployed 19 Nov 2026', /^const XLAYER_PAY = '0x29a318431053127E2fBf3C0Ae9cbaF84Cb6Aa1D4';/m.test(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const hosts = [], errors = [];
async function phone(){
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 1, locale: 'en-US' });
  await ctx.addInitScript(s => { try{ localStorage.setItem('tavarov.pay.cfg.v1', JSON.stringify({ address: s, name: '', shop: 'X Shop', coins: ['USDT'], askNote: false, nets: ['bnb'] })); } catch(e){} }, SELLER);
  await ctx.route(u => u.protocol === 'https:', async route => {
    const body = route.request().postData() || '';
    hosts.push(new URL(route.request().url()).host);
    let calls = []; try{ calls = [].concat(JSON.parse(body)); } catch(e){}
    const one = calls.length === 1 ? calls[0] : null;
    if (one && one.method === 'eth_getCode' && String(one.params[0]).toLowerCase() === SELLER.toLowerCase())
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: one.id, result: '0x' }) });
    const r = await fetch(MOCK, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await r.text() });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:' + APP_PORT + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.payGoBack === 'function');
  return { ctx, page };
}
const visible = (page, sel) => page.isVisible(sel);
const netRows = page => page.$$eval('#setNets .netrow .row-title', a => a.map(x => x.textContent.trim()));

// ---------- 1. as committed ----------
let { ctx, page } = await phone();
R.ok('off: XLAYER_PAY is null and there is no X Layer network', await page.evaluate(() => XLAYER_PAY === null && !NETS.xlayer));
await page.click('#navSettings');
const offRows = await netRows(page);
R.ok('off: Settings lists BNB Chain, Ethereum, Base only', offRows.length === 3 && !offRows.some(x => /X Layer/.test(x)), offRows.join(' | '));
await ctx.close();

// ---------- 2. with the address ----------
patched = true;
({ ctx, page } = await phone());
R.ok('on: X Layer network: chain 196, 6-decimal USDT and USDC, X Layer explorer', await page.evaluate(() => NETS.xlayer && NETS.xlayer.chainId === 196 && NETS.xlayer.code === 'xlayer'
  && NETS.xlayer.tokens.USDT.d === 6 && NETS.xlayer.tokens.USDC.a === '0xB6CEceAB302E2E4948951eE7843FC24E92933061' && NETS.xlayer.explorer === 'https://web3.okx.com/explorer/x-layer'));
R.ok('on: X Layer nodes are allowed by the page CSP', await page.evaluate(() => { const c = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  return NETS.xlayer.rpcs.every(u => c.includes(u)); }));
await page.click('#navSettings');
const onRows = await netRows(page);
R.ok('on: Settings offers X Layer', onRows.some(x => /X Layer/.test(x)), onRows.join(' | '));
hosts.length = 0;
await page.click('#setNets .netrow:has-text("X Layer") input');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('tavarov.pay.cfg.v1')).nets.includes('xlayer'), null, { timeout: 10000 }).catch(() => {});
R.ok('turning it on checks the address on X Layer, then saves it', hosts.includes('rpc.xlayer.tech') && await page.evaluate(() => JSON.parse(localStorage.getItem('tavarov.pay.cfg.v1')).nets.join()) === 'bnb,xlayer', hosts.join(','));
await page.click('#setBack');
R.ok('the till shows the network choice', await visible(page, '#netSeg'));
await page.click('#netSeg button:has-text("X Layer")');
for (const k of ['2', '.', '5']) await page.click(`#keypad [data-k="${k}"]`);
state.block += 1;
hosts.length = 0;
await page.click('#charge');
await page.waitForSelector('#scrWait:not(.hidden)');
await page.waitForSelector('#qr canvas', { state: 'attached', timeout: 5000 });
const appLink = (await page.textContent('#payLink')).trim();
const webLink = (await page.textContent('#webLink')).trim();
const inv = (appLink.match(/tv_inv=(0x[0-9a-f]{64})/) || [])[1];
R.ok('EIP-681 code for chain 196, 2.5 USDT = 2500000 units', appLink.startsWith('ethereum:' + ADDR.usdt + '@196/transfer?address=' + SELLER + '&uint256=2500000&'), appLink.slice(0, 120));
let web = null; try{ web = JSON.parse(Buffer.from(webLink.split('#p=')[1], 'base64url').toString('utf8')); } catch(e){}
R.ok('the QR on screen is the payment page with net "xlayer" and the same invoice', (await page.getAttribute('#qr', 'data-text')) === webLink
  && !!web && web.net === 'xlayer' && web.a === '2.5' && web.c === 'USDT' && web.h === inv && web.m === SELLER, JSON.stringify(web));
R.ok('the waiting screen names X Layer', /X Layer/.test(await page.textContent('#waitMeta')));
await page.waitForTimeout(2500);
const hs = [...new Set(hosts)];
R.ok('it watches X Layer nodes only', hs.length > 0 && hs.every(h => /xlayer/.test(h)), hs.join(','));

state.block += 3;
state.sales[inv] = { merchant: SELLER, amount: '2500000', buyer: '0x' + '12'.repeat(20), token: ADDR.usdt };
const paid = paidLog({ merchant: SELLER, payer: '0x' + '12'.repeat(20), token: ADDR.usdt, toMerchant: '2475000', fee: '25000', reward: 0, invoice: inv, block: state.block });
state.logs.push(paid);
await page.waitForSelector('#scrPaid:not(.hidden)', { timeout: 20000 }).catch(() => {});
R.ok('PAID on X Layer', await visible(page, '#scrPaid'));
R.ok('seller gets 2.475 USDT after the 1% fee', (await page.textContent('#paidReceived')) === '2.475 USDT', await page.textContent('#paidReceived'));
await page.click('#detailsToggle');
R.ok('transaction link goes to the X Layer explorer', (await page.getAttribute('#paidTx', 'href')) === 'https://web3.okx.com/explorer/x-layer/tx/' + paid.transactionHash, await page.getAttribute('#paidTx', 'href'));
const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('tavarov.pay.history.v1') || '[]'));
R.ok('history keeps the network', hist[0] && hist[0].net === 'xlayer' && hist[0].id === inv);
await ctx.close();

await browser.close(); appSrv.close();
process.exit(R.done(errors) ? 0 : 1);
