/* Tavarov Pay (pay-app/www): the till that is not a wallet.

   What this proves, in a real browser against the fake node (mocknode.mjs):
     1. There is nothing in the app that holds a secret or moves money:
        no password field, no seed / key / send / swap words in any of the
        seven languages, no blockchain library, and every request it makes
        to a node is a plain read.
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
     7. All seven languages of the wallet have every key, the main screens
        show no English in the other six, and the device language is picked
        on the first run.
     8. Each screen shows only its few default things; the rest sits behind
        "Other ways to pay", "Details" or Settings.

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

/* The app talks to the real public testnet nodes. Every such request is
   answered by the fake node instead, and its method is written down. */
const methods = [];
const foreign = [];
const errors = [];
async function phone(locale){
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, locale });
  await ctx.addInitScript(() => { try { localStorage.setItem('tavarov.pay.testnet.v1', '1'); } catch (e) {} });
  await ctx.route(u => u.protocol === 'https:', async route => {
    const body = route.request().postData() || '';
    let calls = [];
    try { calls = [].concat(JSON.parse(body)); } catch (e) {}
    calls.forEach(c => methods.push(c.method));
    /* The fake node says "contract" about every address; the seller here is
       an ordinary wallet, as a real seller's would be. */
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
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith('http://localhost:' + APP_PORT) && !u.startsWith('https://') && !u.startsWith('data:')) foreign.push(u); });
  page.on('dialog', d => d.accept());
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.payGoBack === 'function');
  return { ctx, page };
}

/* ---------- 0. the device language is picked on the first run ---------- */
for (const [loc, want] of [['es-ES', 'es'], ['tg-TJ', 'tg'], ['de-DE', 'en']]){
  const p = await phone(loc);
  R.ok('first run on a ' + loc + ' phone opens in ' + want, (await p.page.evaluate(() => document.documentElement.lang)) === want);
  await p.ctx.close();
}

const { page } = await phone('en-US');
const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };
const visible = sel => page.isVisible(sel);
const shownIds = scr => page.evaluate(s => [...document.querySelectorAll('#' + s + ' [id]')]
  .filter(e => e.offsetParent !== null && !e.closest('.keypad')).map(e => e.id), scr);

/* ---------- 1. nothing wallet-like ---------- */
const FORBIDDEN = new RegExp([
  'seed', 'mnemonic', 'private\\s*key', 'secret\\s*(phrase|key)', 'recovery\\s*phrase', '\\bsend\\b', '\\bswap', 'withdraw',   // en
  'сид[- ]?фраз', 'мнемон', 'секретн', 'приватн', 'закрыт\\S*\\s+ключ', 'фраз[аеуы]', 'отправ', 'обмен', 'вывести',               // ru
  'semilla', 'clave privada', 'enviar', 'intercambi', 'retirar',                                                       // es
  'kurtarma', 'özel anahtar', 'gönder', 'takas', 'para çek',                                                          // tr
  'semente', 'chave privada', 'troca', 'sacar',                                                                        // pt
  'калиди махфӣ', 'калиди шахсӣ', 'ибора', 'мубодила',                                                                // tg
  'frasa', 'kunci pribadi', 'kirim', 'tukar', 'tarik dana'                                                             // id
].join('|'), 'i');
async function noWalletWords(where){
  const text = await page.evaluate(() => document.body.textContent + ' ' +
    [...document.querySelectorAll('[placeholder],[aria-label]')].map(e => (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '')).join(' '));
  const m = text.match(FORBIDDEN);
  R.ok('no key / seed / send / swap words (' + where + ')', !m, m ? m[0] : '');
}
R.ok('opens on the setup screen', await visible('#scrSetup'));
R.ok('English by default', (await page.evaluate(() => document.documentElement.lang)) === 'en' &&
  /Where should payments arrive/.test(await page.textContent('#scrSetup h1')));
R.ok('setup shows one field and one button, nothing else to fill in',
  (await page.$$eval('#scrSetup input[type=text]', a => a.length)) === 1 && (await page.$$eval('#scrSetup button', a => a.length)) === 1);
R.ok('the intro is one sentence', (await page.textContent('#scrSetup .subtitle')).split(/[.!?](\s|$)/).filter(x => x && x.trim()).length === 1,
  await page.textContent('#scrSetup .subtitle'));
R.ok('no language switch in the header', (await page.$$('.nav select, .nav [data-lang]')).length === 0);
R.ok('no password field anywhere', (await page.$$('input[type=password]')).length === 0);
await noWalletWords('EN, setup');
R.ok('no blockchain library loaded (nothing that could sign)',
  await page.evaluate(() => typeof window.ethers === 'undefined' && typeof window.nacl === 'undefined' && typeof window.solanaWeb3 === 'undefined'));
const src = ['app.js', 'i18n.js', 'index.html'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const badSrc = src.match(/eth_send|eth_sign|personal_sign|signTypedData|signTransaction|privateKey|mnemonic|window\.ethereum|sendRawTransaction|wallet_/i);
R.ok('the code has no signing or sending calls at all', !badSrc, badSrc ? badSrc[0] : '');
R.ok('the network door refuses anything but reads',
  await page.evaluate(async () => { try { await rpc(netOf('bnb'), 'eth_sendRawTransaction', ['0x00']); return false; } catch (e) { return /not a read/.test(e.message); } }));
R.ok('only the QR library, the words and the app are loaded as scripts',
  JSON.stringify(await page.evaluate(() => [...document.scripts].map(s => s.getAttribute('src')))) === JSON.stringify(['lib/qrcode.min.js', 'i18n.js', 'app.js']));
R.ok('keccak256 in the app matches ethers',
  (await page.evaluate(s => keccak256Hex(new TextEncoder().encode(s)), 'Tavarov Pay ' + 'x'.repeat(200))) ===
  E.utils.keccak256(E.utils.toUtf8Bytes('Tavarov Pay ' + 'x'.repeat(200))).slice(2));
R.ok('function selectors and event topics match ethers',
  JSON.stringify(await page.evaluate(() => [SEL.addressOf, SEL.saleOf, SEL.balanceOf, SEL.feeBps, TOPIC.Paid, TOPIC.Transfer])) ===
  JSON.stringify([E.utils.id('addressOf(string)').slice(0, 10), E.utils.id('saleOf(bytes32)').slice(0, 10), E.utils.id('balanceOf(address)').slice(0, 10),
                  E.utils.id('feeBps()').slice(0, 10), E.utils.id('Paid(address,address,address,uint256,uint256,uint256,bytes32)'), E.utils.id('Transfer(address,address,uint256)')]));

/* ---------- 7a. every language has every key ---------- */
const dicts = await page.evaluate(() => DICT);
const LANGS7 = ['en', 'ru', 'es', 'tr', 'pt', 'tg', 'id'];
R.ok('exactly the wallet\'s seven languages', JSON.stringify(Object.keys(dicts).sort()) === JSON.stringify([...LANGS7].sort()));
const enKeys = Object.keys(dicts.en);
for (const l of LANGS7.slice(1)){
  const missing = enKeys.filter(k => typeof dicts[l][k] !== 'string' || !dicts[l][k].trim());
  const extra = Object.keys(dicts[l]).filter(k => !(k in dicts.en));
  const same = enKeys.filter(k => dicts[l][k] === dicts.en[k]);
  const holes = enKeys.filter(k => (dicts.en[k].match(/%[a-z]/g) || []).sort().join() !== ((dicts[l][k] || '').match(/%[a-z]/g) || []).sort().join());
  R.ok(l + ': all ' + enKeys.length + ' keys translated, none left in English, same %-slots',
    !missing.length && !extra.length && !same.length && !holes.length, [missing, extra, same, holes].map(a => a.join(',')).join(' | '));
}
const usedKeys = new Set([...src.matchAll(/data-t(?:-ph|-aria)?="([A-Za-z]+)"/g)].map(m => m[1])
  .concat([...fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').matchAll(/\bt\('([A-Za-z]+)'\)/g)].map(m => m[1])));
const unknown = [...usedKeys].filter(k => !(k in dicts.en));
R.ok('every key the screens use exists', !unknown.length, unknown.join(','));

/* ---------- 2. setup ---------- */
const typo = SELLER.slice(0, 2) + SELLER.slice(2, 10).toLowerCase() + SELLER.slice(10).toUpperCase();
await page.fill('#destIn', typo);
await page.waitForSelector('#destErr:not(.hidden)');
R.ok('a mistyped address is caught by its capital letters', /typo/.test(await page.textContent('#destErr')), await page.textContent('#destErr'));
await page.fill('#destIn', 'nobody_here');
await page.waitForFunction(() => /Nobody/.test(document.getElementById('destErr').textContent), null, { timeout: 15000 });
R.ok('an unknown name is reported as unknown', true);
await page.fill('#destIn', '@Kofeinya');
await page.waitForSelector('#destOk:not(.hidden)', { timeout: 15000 });
const shownAddr = await page.textContent('#destAddr');
R.ok('the name is resolved as it is typed, and the full address is shown', shownAddr.includes(SELLER) && shownAddr.includes('kofeinya'), shownAddr);
R.ok('the button waits for the seller to confirm the address', await page.isDisabled('#destSave'));
R.ok('an ordinary wallet gets no smart-contract warning', !(await visible('#destContract')));
await page.check('#destConfirm');
await shot('01-setup.png');
await page.click('#destSave');
R.ok('saved: the till opens', await visible('#scrTill'));
R.ok('only public settings are stored, nothing secret',
  await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tavarov.pay.cfg.v1'))).sort().join(',')) === 'address,askNote,coins,name,nets,shop');

/* ---------- 8a. the till: amount, keypad, one button ---------- */
R.ok('header: name, history and settings only',
  JSON.stringify(await page.$$eval('.nav button', b => b.filter(x => x.offsetParent !== null).map(x => x.id))) === JSON.stringify(['brand', 'navHistory', 'navSettings']));
R.ok('till shows only the amount, the keypad and one button (no coin choice, no note)',
  (await visible('#keypad')) && JSON.stringify(await shownIds('scrTill')) === JSON.stringify(['amountShow', 'amountCur', 'tillMeta', 'charge']),
  JSON.stringify(await shownIds('scrTill')));

/* Shop name and the "what for" note live in Settings, the note off by default. */
await page.click('#navSettings');
R.ok('settings has the language choice', await visible('#langSel'));
R.ok('the note is off by default', !(await page.isChecked('#setAskNote')));
await page.fill('#setShop', 'Corner Coffee');
await page.check('#setAskNote');
await page.click('#setBack');
for (const k of ['3', '.', '5', '0']) await page.click(`#keypad [data-k="${k}"]`);
R.ok('turned on in Settings, the note field appears', await visible('#itemIn'));
await page.fill('#itemIn', 'Latte');
R.ok('the amount is typed on the keypad', (await page.textContent('#amountShow')).startsWith('3.50'), await page.textContent('#amountShow'));
R.ok('USDT, with no coin choice shown (only one coin on)', (await page.textContent('#amountCur')) === 'USDT' && !(await visible('#curSeg')));
await page.click('#navSettings');
await page.click('#setAskNote');                // back off: the screenshot shows the default till
await page.click('#setBack');
await shot('02-amount.png');
await page.click('#navSettings'); await page.check('#setAskNote'); await page.click('#setBack');

/* A transfer that happened BEFORE the code is shown must not pay this sale. */
state.block += 1;
state.logs.push(transferLog({ token: ADDR.usdt, from: OTHER, to: SELLER, amount: 50, decimals: 6, block: state.block, hash: '0x' + 'e1'.repeat(32) }));

/* ---------- 3. the payment code ---------- */
await page.click('#charge');
await page.waitForSelector('#scrWait:not(.hidden)');
await page.waitForSelector('#qr canvas', { state: 'attached', timeout: 5000 });
const appLink = (await page.textContent('#payLink')).trim();
const inv = (appLink.match(/tv_inv=(0x[0-9a-f]{64})/) || [])[1];
R.ok('the sale has a fresh 32-byte invoice number', !!inv, appLink.slice(0, 80));
const expected = 'ethereum:' + ADDR.usdt + '@97/transfer?address=' + SELLER + '&uint256=3500000' +
  '&tv_m=' + SELLER + '&tv_item=Latte&tv_name=' + encodeURIComponent('Corner Coffee') + '&tv_inv=' + inv + '&tv_net=bnb';
R.ok('QR code is the NoN Wallet till format (EIP-681 + tv_*), 3.5 USDT = 3500000 units', appLink === expected, appLink);
/* The QR on screen is the payment page: it goes through the contract (1% fee)
   from any wallet. The plain code above stays hidden, for reference. */
const webLink = (await page.textContent('#webLink')).trim();
R.ok('THE ONE QR ON SCREEN IS THE PAYMENT PAGE (fee route), not the plain transfer code',
  (await page.getAttribute('#qr', 'data-text')) === webLink && webLink !== appLink && !(await visible('#payLink')));
R.ok('waiting screen shows only amount, QR, status, "Other ways" and Cancel',
  JSON.stringify(await shownIds('scrWait')) === JSON.stringify(['waitAmount', 'waitMeta', 'qr', 'waitHint', 'waitPill', 'otherToggle', 'cancelSale']),
  JSON.stringify(await shownIds('scrWait')));
R.ok('no long fee text on the waiting screen', !/1%/.test(await page.evaluate(() => document.getElementById('scrWait').innerText)));
R.ok('waiting for payment', /Waiting/.test(await page.textContent('#waitPill')));
const qrSrc = await page.evaluate(() => document.querySelector('#qr canvas').toDataURL('image/png'));
await shot('03-waiting.png');
await page.click('#otherToggle');
let web = null;
try { web = JSON.parse(Buffer.from(webLink.split('#p=')[1], 'base64url').toString('utf8')); } catch (e) {}
R.ok('"Other ways to pay" opens Share link and the plain address, and no second QR',
  (await visible('#shareLink')) && (await page.textContent('#manualAddr')) === SELLER && !(await page.$('#qrWeb')));
R.ok('payment page link points to wallet.tavarov.com/pay.html', webLink.startsWith('https://wallet.tavarov.com/pay.html#p='), webLink.slice(0, 60));
R.ok('payment page link carries seller, amount, coin, network and the same invoice',
  !!web && web.m === SELLER && web.a === '3.50' && web.c === 'USDT' && web.net === 'bnbTestnet' && web.h === inv && web.n === 'Corner Coffee' && web.i === 'Latte' && web.t > Date.now() / 1000,
  JSON.stringify(web));
await page.click('#otherToggle');

/* ---------- NoN Wallet, the buyer: reads the QR and pays it ---------- */
const buyer = await boot({ role: 'buyer', testnet: true, rpc: MOCK });
const scanned = await buyer.page.evaluate(async src => {
  const img = new Image(); img.src = src; await img.decode();
  try { const r = await QrScanner.scanImage(img, { returnDetailedScanResult: true }); return r && r.data !== undefined ? r.data : r; }
  catch (e) { return 'ERR ' + (e && e.message || e); }
}, qrSrc);
R.ok('NoN Wallet scanner reads the till QR picture back exactly', scanned === webLink, String(scanned).slice(0, 90));
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
await buyer.page.evaluate(l => applyScannedPayment(l), webLink);   // what the buyer really scans now
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
await buyer.browser.close();

/* ---------- 4. the chain records that payment ---------- */
state.block += 3;
state.sales[inv] = { merchant: SELLER, amount: '3500000', buyer: buyerAddr, token: ADDR.usdt };
const paid1 = paidLog({ merchant: SELLER, payer: buyerAddr, token: ADDR.usdt, toMerchant: '3465000', fee: '35000', reward: 0, invoice: inv, block: state.block });
state.logs.push(paid1);
await page.waitForSelector('#scrPaid:not(.hidden)', { timeout: 20000 }).catch(() => {});
R.ok('PAID: the till flips to "Paid"', await visible('#scrPaid'));
R.ok('paid screen shows only the check, the amount, what you received, "Details" and New sale',
  JSON.stringify(await shownIds('scrPaid')) === JSON.stringify(['paidAmount', 'paidReceived', 'detailsToggle', 'newSale']),
  JSON.stringify(await shownIds('scrPaid')));
R.ok('shows the amount', (await page.textContent('#paidAmount')).startsWith('3.50'), await page.textContent('#paidAmount'));
R.ok('shows what the seller got after the 1% fee', (await page.textContent('#paidReceived')) === '3.465 USDT', await page.textContent('#paidReceived'));
R.ok('made the "paid" sound', (await page.evaluate(() => soundCount)) === 1);
await shot('04-paid.png');
await page.click('#detailsToggle');
R.ok('Details: the fee', (await page.textContent('#paidFee')) === '0.035 USDT', await page.textContent('#paidFee'));
R.ok('Details: the transaction link', (await page.getAttribute('#paidTx', 'href')) === 'https://testnet.bscscan.com/tx/' + paid1.transactionHash,
  await page.getAttribute('#paidTx', 'href'));
R.ok('the payment made before the code was shown was not taken for this one', /NoN Wallet/.test(await page.textContent('#paidHow')));

/* ---------- 5. a plain transfer from any wallet app ---------- */
await page.click('#newSale');
await page.click('#keypad [data-k="4"]');
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
R.ok('Details are closed again for the new sale', !(await visible('#detailsBox')));
await page.click('#detailsToggle');
R.ok('a plain transfer has no fee', (await page.textContent('#paidFee')) === 'none' && (await page.textContent('#paidReceived')) === '4.00 USDT',
  (await page.textContent('#paidFee')) + ' / ' + (await page.textContent('#paidReceived')));
R.ok('and says how it was paid', /plain transfer/.test(await page.textContent('#paidHow')), await page.textContent('#paidHow'));
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
R.ok('history shows the total and the list, nothing else',
  (await page.$$eval('#scrHistory button', b => b.length)) === 0);
await shot('05-history.png');
await noWalletWords('EN, history');

/* ---------- 7b. every language on the main screens ---------- */
const SHOT_N = { ru: '06', es: '07', tr: '08', pt: '09', tg: '10', id: '11' };
const englishOnly = Object.values(dicts.en).filter(v => v.length > 3 && !/%/.test(v));
async function screenSpeaks(l, scr){
  const r = await page.evaluate(([s, l]) => {
    const bad = [];
    document.querySelectorAll('#' + s + ' [data-t], .nav [data-t-aria]').forEach(el => {
      const k = el.dataset.t || el.dataset.tAria;
      const want = DICT[l][k];
      const got = el.dataset.t ? el.textContent : el.getAttribute('aria-label');
      if (!want || got !== want) bad.push(k);
    });
    return { bad, text: document.getElementById(s).innerText };
  }, [scr, l]);
  const leak = l === 'en' ? [] : englishOnly.filter(v => r.text.includes(v) && !Object.values(dicts[l]).some(x => x.includes(v)));
  R.ok(l + ': ' + scr + ' fully in this language', !r.bad.length && !leak.length, r.bad.concat(leak).join(' | '));
}
for (const l of LANGS7){
  await page.click('#navSettings');
  await page.selectOption('#langSel', l);
  R.ok(l + ': chosen in Settings', (await page.evaluate(() => document.documentElement.lang)) === l);
  await screenSpeaks(l, 'scrSettings');
  await noWalletWords(l + ', settings');
  await page.click('#navHistory');
  await screenSpeaks(l, 'scrHistory');
  await noWalletWords(l + ', history');
  await page.click('#brand');
  await screenSpeaks(l, 'scrTill');
  await page.click('#keypad [data-k="2"]');
  await page.click('#charge');
  await page.waitForSelector('#scrWait:not(.hidden)');
  await page.click('#otherToggle');
  await screenSpeaks(l, 'scrWait');
  await noWalletWords(l + ', waiting');
  await page.click('#otherToggle');
  if (SHOT_N[l]) await shot(SHOT_N[l] + '-' + l + '.png');
  await page.click('#cancelSale');
  await page.click('#keypad [data-k="back"]');
}

/* restart (in Indonesian now: the choice is kept) */
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof window.payGoBack === 'function');
R.ok('after a restart the till opens straight away, in the chosen language',
  (await visible('#scrTill')) && (await page.evaluate(() => document.documentElement.lang)) === 'id');
await page.click('#navHistory');
R.ok('and the history is still there', (await page.$$eval('#histList .row', r => r.length)) === 2);

/* ---------- every request was a read ---------- */
const READS = new Set(['eth_blockNumber', 'eth_call', 'eth_getLogs', 'eth_getCode', 'eth_getTransactionReceipt']);
const notRead = [...new Set(methods)].filter(m => !READS.has(m));
R.ok('every request to the network was a read (' + [...new Set(methods)].join(', ') + ')', methods.length > 0 && !notRead.length, notRead.join(','));
R.ok('no requests anywhere else', !foreign.length, foreign.slice(0, 3).join(' '));

const good = R.done([...errors, ...buyer.errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e))]);
await browser.close(); srv.close(); appSrv.close();
process.exit(good ? 0 : 1);
