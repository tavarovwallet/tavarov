/* Tavarov Pay (pay-app/www): the till that is not a wallet.

   What this proves, in a real browser against the fake node (mocknode.mjs):
     1. There is nothing in the app that holds a secret or moves money:
        no password field, no seed / key / send / swap words in either
        language, no blockchain library, and every request it makes to a
        node is a plain read.
     2. Setup takes a NoN name or a 0x address, shows the resolved address,
        and catches a mistyped address.
     3. The payment code for 3.50 USDT is exactly what the NoN Wallet till
        makes, and NoN Wallet itself reads it back from the QR picture,
        understands it, and pays it through the payment contract with our
        invoice number. The payment-page link is understood by the wallet too.
     4. When the chain records that payment, the till flips to "Paid" with
        the right split (1% fee) and the transaction link, and makes its sound.
     5. A plain transfer from any wallet app is recognised too (no fee); an
        underpayment and a transfer made before the code was shown are not.
     6. Both sales land in today's history with a day total, and survive a
        restart.

   Run:  cd audit && NODE_PATH=/home/claude/.npm-global/lib/node_modules timeout 170 node t100-tavarov-pay.mjs
   PAY_SHOTS=<folder> also saves the phone screenshots there. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';
import { boot, reporter, answerTotp } from './boot.mjs';
import { start, state, ADDR, paidLog, transferLog } from './mocknode.mjs';
const require = createRequire(import.meta.url);
const EL = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const E = EL.ethers || EL;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../pay-app/www');
const APP_PORT = 8098, RPC_PORT = 8557;
const MOCK = 'http://localhost:' + RPC_PORT;
const APP = 'http://localhost:' + APP_PORT + '/index.html';
const SHOTS = process.env.PAY_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const R = reporter();
const srv = await start(RPC_PORT);
state.payVersion = 3;                           // saleOf() exists, as on BNB Chain today

const SELLER = E.utils.getAddress('0x5e11e7c0ffee000000000000000000000000beef');
state.names.kofeinya = SELLER;
const OTHER = '0x' + '77'.repeat(20);

/* ---------- serve pay-app/www ---------- */
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json',
                '.png':'image/png', '.woff2':'font/woff2' };
const appSrv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => appSrv.listen(APP_PORT, r));

/* ---------- the till in a phone-sized browser ---------- */
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('tavarov.pay.testnet.v1', '1'); } catch (e) {} });

/* The app talks to the real public testnet nodes. Every such request is
   answered by the fake node instead, and its method is written down. */
const methods = [];
const foreign = [];
await ctx.route(u => u.protocol === 'https:', async route => {
  const body = route.request().postData() || '';
  let calls = [];
  try { calls = [].concat(JSON.parse(body)); } catch (e) {}
  calls.forEach(c => methods.push(c.method));
  /* The fake node says "contract" about every address; the seller here is an
     ordinary wallet, as a real seller's would be. */
  const one = calls.length === 1 ? calls[0] : null;
  if (one && one.method === 'eth_getCode' && String(one.params[0]).toLowerCase() === SELLER.toLowerCase()){
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
                          body: JSON.stringify({ jsonrpc: '2.0', id: one.id, result: '0x' }) });
    return;
  }
  const r = await fetch(MOCK, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await r.text() });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('request', r => { const u = r.url(); if (!u.startsWith('http://localhost:' + APP_PORT) && !u.startsWith('https://') && !u.startsWith('data:')) foreign.push(u); });
page.on('dialog', d => d.accept());

const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };
const visible = sel => page.isVisible(sel);

await page.goto(APP, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.payGoBack === 'function');

/* ---------- 1. nothing wallet-like ---------- */
const FORBIDDEN = /seed|mnemonic|private\s*key|secret\s*(phrase|key)|recovery\s*phrase|\bsend\b|\bswap|withdraw|сид|мнемон|секретн|приватн|закрыт\S*\s+ключ|фраз[аеуы]|отправ|обмен|вывести/i;
async function noWalletWords(lang){
  const text = await page.evaluate(() => document.body.textContent + ' ' +
    [...document.querySelectorAll('[placeholder],[aria-label]')].map(e => (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '')).join(' '));
  const m = text.match(FORBIDDEN);
  R.ok('no key / seed / send / swap words on any screen (' + lang + ')', !m, m ? m[0] : '');
}
R.ok('opens on the setup screen', await visible('#scrSetup'));
R.ok('English by default', (await page.evaluate(() => document.documentElement.lang)) === 'en' &&
  /Accept payments/.test(await page.textContent('#scrSetup h1')));
R.ok('no password field anywhere', (await page.$$('input[type=password]')).length === 0);
await noWalletWords('EN');
R.ok('no blockchain library loaded (nothing that could sign)',
  await page.evaluate(() => typeof window.ethers === 'undefined' && typeof window.nacl === 'undefined' && typeof window.solanaWeb3 === 'undefined'));
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const badSrc = src.match(/eth_send|eth_sign|personal_sign|signTypedData|signTransaction|privateKey|mnemonic|window\.ethereum|sendRawTransaction|wallet_/i);
R.ok('the code has no signing or sending calls at all', !badSrc, badSrc ? badSrc[0] : '');
R.ok('the network door refuses anything but reads',
  await page.evaluate(async () => { try { await rpc(netOf('bnb'), 'eth_sendRawTransaction', ['0x00']); return false; } catch (e) { return /not a read/.test(e.message); } }));
R.ok('only the QR library and the app are loaded as scripts',
  JSON.stringify(await page.evaluate(() => [...document.scripts].map(s => s.getAttribute('src')))) === JSON.stringify(['lib/qrcode.min.js', 'app.js']));
R.ok('keccak256 in the app matches ethers',
  (await page.evaluate(s => keccak256Hex(new TextEncoder().encode(s)), 'Tavarov Pay ' + 'x'.repeat(200))) ===
  E.utils.keccak256(E.utils.toUtf8Bytes('Tavarov Pay ' + 'x'.repeat(200))).slice(2));
R.ok('function selectors and event topics match ethers',
  JSON.stringify(await page.evaluate(() => [SEL.addressOf, SEL.saleOf, SEL.balanceOf, SEL.feeBps, TOPIC.Paid, TOPIC.Transfer])) ===
  JSON.stringify([E.utils.id('addressOf(string)').slice(0, 10), E.utils.id('saleOf(bytes32)').slice(0, 10), E.utils.id('balanceOf(address)').slice(0, 10),
                  E.utils.id('feeBps()').slice(0, 10), E.utils.id('Paid(address,address,address,uint256,uint256,uint256,bytes32)'), E.utils.id('Transfer(address,address,uint256)')]));

/* ---------- 2. setup ---------- */
const typo = SELLER.slice(0, 2) + SELLER.slice(2, 10).toLowerCase() + SELLER.slice(10).toUpperCase();
await page.fill('#destIn', typo);
await page.click('#destCheck');
await page.waitForSelector('#destErr:not(.hidden)');
R.ok('a mistyped address is caught by its capital letters', /typo/.test(await page.textContent('#destErr')), await page.textContent('#destErr'));
await page.fill('#destIn', 'nobody_here');
await page.click('#destCheck');
await page.waitForFunction(() => /Nobody/.test(document.getElementById('destErr').textContent), null, { timeout: 15000 });
R.ok('an unknown name is reported as unknown', true);
await page.fill('#destIn', '@Kofeinya');
await page.click('#destCheck');
await page.waitForSelector('#destOk:not(.hidden)', { timeout: 15000 });
const shown = await page.textContent('#destAddr');
R.ok('the name is resolved and the full address is shown', shown.includes(SELLER) && shown.includes('kofeinya'), shown);
R.ok('save waits for the seller to confirm the address', await page.isDisabled('#destSave'));
R.ok('an ordinary wallet gets no smart-contract warning', !(await visible('#destContract')));
await page.fill('#shopIn', 'Corner Coffee');
await page.check('#destConfirm');
await shot('01-setup.png');
await page.click('#destSave');
R.ok('saved: the till opens', await visible('#scrTill'));
R.ok('only the address and the name are stored, nothing secret',
  await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tavarov.pay.cfg.v1'))).sort().join(',')) === 'address,name,nets,shop');

/* ---------- 3. amount and the payment code ---------- */
for (const k of ['3', '.', '5', '0']) await page.click(`#keypad [data-k="${k}"]`);
await page.fill('#itemIn', 'Latte');
R.ok('the amount is typed on the keypad', (await page.textContent('#amountShow')).startsWith('3.50'), await page.textContent('#amountShow'));
R.ok('USDT is chosen', await page.evaluate(() => document.querySelector('#curSeg .seg.active').dataset.cur === 'USDT'));
await shot('02-amount.png');

/* A transfer that happened BEFORE the code is shown must not pay this sale. */
state.block += 1;
state.logs.push(transferLog({ token: ADDR.usdt, from: OTHER, to: SELLER, amount: 50, decimals: 6, block: state.block, hash: '0x' + 'e1'.repeat(32) }));

await page.click('#charge');
await page.waitForSelector('#scrWait:not(.hidden)');
await page.waitForSelector('#qr canvas', { state: 'attached', timeout: 5000 });
const appLink = (await page.textContent('#payLink')).trim();
const webLink = (await page.textContent('#webLink')).trim();
const inv = (appLink.match(/tv_inv=(0x[0-9a-f]{64})/) || [])[1];
R.ok('the sale has a fresh 32-byte invoice number', !!inv, appLink.slice(0, 80));
const expected = 'ethereum:' + ADDR.usdt + '@97/transfer?address=' + SELLER + '&uint256=3500000' +
  '&tv_m=' + SELLER + '&tv_item=Latte&tv_name=' + encodeURIComponent('Corner Coffee') + '&tv_inv=' + inv + '&tv_net=bnb';
R.ok('QR code is the NoN Wallet till format (EIP-681 + tv_*), 3.5 USDT = 3500000 units', appLink === expected, appLink);
R.ok('the QR picture carries that very link', (await page.getAttribute('#qr', 'data-text')) === appLink);
let web = null;
try { web = JSON.parse(Buffer.from(webLink.split('#p=')[1], 'base64url').toString('utf8')); } catch (e) {}
R.ok('payment page link points to wallet.tavarov.com/pay.html', webLink.startsWith('https://wallet.tavarov.com/pay.html#p='), webLink.slice(0, 60));
R.ok('payment page link carries seller, amount, coin, network and the same invoice',
  !!web && web.m === SELLER && web.a === '3.50' && web.c === 'USDT' && web.net === 'bnbTestnet' && web.h === inv && web.n === 'Corner Coffee' && web.i === 'Latte' && web.t > Date.now() / 1000,
  JSON.stringify(web));
R.ok('waiting for payment', /Waiting/.test(await page.textContent('#waitPill')));
const qrSrc = await page.evaluate(() => { const c = document.querySelector('#qr canvas'); return c ? c.toDataURL('image/png') : document.querySelector('#qr img').src; });
await shot('03-waiting.png');
await page.click('#qrSeg [data-q="web"]');
R.ok('switching to the payment page QR', (await page.getAttribute('#qr', 'data-text')) === (await page.textContent('#webLink')).trim());
await page.click('#qrSeg [data-q="app"]');

/* ---------- NoN Wallet, the buyer: reads the QR and pays it ---------- */
const buyer = await boot({ role: 'buyer', testnet: true, rpc: MOCK });
const scanned = await buyer.page.evaluate(async src => {
  const img = new Image(); img.src = src; await img.decode();
  try { const r = await QrScanner.scanImage(img, { returnDetailedScanResult: true }); return r && r.data !== undefined ? r.data : r; }
  catch (e) { return 'ERR ' + (e && e.message || e); }
}, qrSrc);
R.ok('NoN Wallet scanner reads the till QR picture back exactly', scanned === appLink, String(scanned).slice(0, 90));
const parsed = await buyer.page.evaluate(l => parsePayLink(l), appLink);
R.ok('NoN Wallet understands it: pay 3.5 USDT to the seller, invoice kept',
  parsed && parsed.to === SELLER && parsed.m === SELLER && parsed.cur === 'USDT' && parsed.amt === '3.5' && parsed.inv === inv &&
  parsed.chainId === 97 && parsed.name === 'Corner Coffee' && parsed.item === 'Latte', JSON.stringify(parsed));
const viaWeb = await buyer.page.evaluate(u => payLinkFromUrl(u), webLink);
R.ok('NoN Wallet understands the payment page link too',
  typeof viaWeb === 'string' && viaWeb.startsWith('tavarov:pay?') && viaWeb.includes('inv=' + inv) && viaWeb.includes('amt=3.50') && viaWeb.includes('m=' + SELLER),
  String(viaWeb).slice(0, 120));

const buyerAddr = await buyer.page.evaluate(() => wallet.evm.address);
state.balances[buyerAddr.toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };
state.sent.length = 0;
await buyer.page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await buyer.page.evaluate(l => applyScannedPayment(l), appLink);
await buyer.page.waitForTimeout(1500);
await buyer.page.evaluate(() => reviewSend());
await buyer.page.waitForTimeout(700);
buyer.page.evaluate(() => doSend());
await answerTotp(buyer.page);
const iPay = new E.utils.Interface(['function pay(address merchant, address token, uint256 amount, bytes32 invoice)']);
const sel = iPay.getSighash('pay');
for (let i = 0; i < 40 && !state.sent.find(tx => tx.data.startsWith(sel)); i++) await buyer.page.waitForTimeout(500);
const payTx = state.sent.find(tx => tx.data.startsWith(sel));
const pa = payTx ? iPay.decodeFunctionData('pay', payTx.data) : null;
R.ok('NoN Wallet pays it THROUGH the payment contract, to the seller, 3.5 USDT, with our invoice',
  !!pa && pa[0] === SELLER && pa[1].toLowerCase() === ADDR.usdt.toLowerCase() && pa[2].toString() === '3500000' && pa[3].toLowerCase() === inv,
  pa ? pa.map(String).join(' ') : 'sent: ' + state.sent.map(tx => tx.data.slice(0, 10)).join(','));
R.ok('the till is still waiting (nothing recorded on chain yet)', await visible('#scrWait'));

/* ---------- 4. the chain records that payment ---------- */
state.block += 3;
state.sales[inv] = { merchant: SELLER, amount: '3500000', buyer: buyerAddr, token: ADDR.usdt };
const paid1 = paidLog({ merchant: SELLER, payer: buyerAddr, token: ADDR.usdt, toMerchant: '3465000', fee: '35000', reward: 0, invoice: inv, block: state.block });
state.logs.push(paid1);
await page.waitForSelector('#scrPaid:not(.hidden)', { timeout: 20000 }).catch(() => {});
R.ok('PAID: the till flips to "Paid"', await visible('#scrPaid'));
R.ok('shows the amount', (await page.textContent('#paidAmount')).startsWith('3.50'), await page.textContent('#paidAmount'));
R.ok('shows what the seller got after the 1% fee', (await page.textContent('#paidReceived')) === '3.465 USDT', await page.textContent('#paidReceived'));
R.ok('shows the fee', (await page.textContent('#paidFee')) === '0.035 USDT', await page.textContent('#paidFee'));
R.ok('links the transaction', (await page.getAttribute('#paidTx', 'href')) === 'https://testnet.bscscan.com/tx/' + paid1.transactionHash,
  await page.getAttribute('#paidTx', 'href'));
R.ok('made the "paid" sound', (await page.evaluate(() => soundCount)) === 1);
R.ok('the payment made before the code was shown was not taken for this one', /NoN Wallet/.test(await page.textContent('#paidHow')));
await shot('04-paid.png');

/* ---------- 5. a plain transfer from any wallet app ---------- */
await page.click('#newSale');
for (const k of ['4']) await page.click(`#keypad [data-k="${k}"]`);
await page.click('#charge');
await page.waitForSelector('#scrWait:not(.hidden)');
await page.waitForTimeout(1800);
state.block += 2;
state.logs.push(transferLog({ token: ADDR.usdt, from: OTHER, to: SELLER, amount: 1, decimals: 6, block: state.block, hash: '0x' + 'a1'.repeat(32) }));
state.logs.push(transferLog({ token: ADDR.usdt, from: OTHER, to: OTHER, amount: 9, decimals: 6, block: state.block, hash: '0x' + 'a2'.repeat(32) }));
await page.waitForTimeout(9000);
R.ok('an underpayment (1 of 4 USDT) or a transfer to someone else does not count', await visible('#scrWait'));
state.block += 2;
state.logs.push(transferLog({ token: ADDR.usdt, from: OTHER, to: SELLER, amount: 4, decimals: 6, block: state.block, hash: '0x' + 'b4'.repeat(32) }));
await page.waitForSelector('#scrPaid:not(.hidden)', { timeout: 20000 }).catch(() => {});
R.ok('PAID by a plain transfer from another wallet app', await visible('#scrPaid'));
R.ok('a plain transfer has no fee', (await page.textContent('#paidFee')) === 'none' && (await page.textContent('#paidReceived')) === '4.00 USDT',
  (await page.textContent('#paidFee')) + ' / ' + (await page.textContent('#paidReceived')));
R.ok('and says how it was paid', /Plain transfer/.test(await page.textContent('#paidHow')), await page.textContent('#paidHow'));
R.ok('links that transfer', (await page.getAttribute('#paidTx', 'href')).endsWith('/tx/0x' + 'b4'.repeat(32)));

/* The same transfer cannot pay a second sale. */
await page.click('#newSale');
await page.click('#keypad [data-k="4"]');
await page.click('#charge');
await page.waitForTimeout(6000);
R.ok('one transfer is never counted for two sales', await visible('#scrWait'));
await page.click('#cancelSale');
R.ok('cancel returns to the till and forgets the sale', await visible('#scrTill') &&
  await page.evaluate(() => localStorage.getItem('tavarov.pay.open.v1') === null));

/* ---------- 6. today's history ---------- */
await page.click('#navHistory');
const rows = await page.$$eval('#histList .row', r => r.length);
R.ok('both sales are in today\'s history', rows === 2, String(rows));
const totalTxt = await page.textContent('#histTotal');
R.ok('day total 7.50 USDT, 7.465 received after fees', /7\.50\s*USDT/.test(totalTxt) && /7\.465 USDT/.test(totalTxt), totalTxt);
await shot('05-history.png');

/* Russian */
await page.click('#langSwitch [data-lang="ru"]');
R.ok('Russian works', (await page.textContent('#scrHistory h1')) === 'Сегодня' && /Выручка/.test(await page.textContent('#histTotal')));
await noWalletWords('RU');
await shot('06-history-ru.png');
await page.click('#histBack');
await page.click('#navSettings');
await noWalletWords('RU, settings');
await page.click('#langSwitch [data-lang="en"]');
await noWalletWords('EN, settings');

/* restart */
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof window.payGoBack === 'function');
R.ok('after a restart the till opens straight away', await visible('#scrTill'));
await page.click('#navHistory');
R.ok('and the history is still there', (await page.$$eval('#histList .row', r => r.length)) === 2);

/* ---------- every request was a read ---------- */
const READS = new Set(['eth_blockNumber', 'eth_call', 'eth_getLogs', 'eth_getCode', 'eth_getTransactionReceipt']);
const notRead = [...new Set(methods)].filter(m => !READS.has(m));
R.ok('every request to the network was a read (' + [...new Set(methods)].join(', ') + ')', methods.length > 0 && !notRead.length, notRead.join(','));
R.ok('no requests anywhere else', !foreign.length, foreign.slice(0, 3).join(' '));

const good = R.done([...errors, ...buyer.errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e))]);
await buyer.browser.close(); await browser.close(); srv.close(); appSrv.close();
process.exit(good ? 0 : 1);
