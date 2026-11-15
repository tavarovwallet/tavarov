/* The USDT checker page (site/en/check.html) in a real browser.

   The site is served from site/ with the Content-Security-Policy from
   site/_headers, and the real public node hosts are answered by the fake
   nodes in usdtmock.mjs (page.route). So a node missing from connect-src, a
   CORS mistake, or a verdict drawn wrong shows up here as it would live.

   Also writes phone screenshots (390x844, x2) to /home/claude/usdt-check-out.

   Run: cd audit && node t103-usdt-check-page.mjs */
import { chromium } from 'playwright';
import { reporter } from './boot.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld, addEvmTx, addTronTx, handle, USDT } from './usdtmock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');
const OUT = '/home/claude/usdt-check-out';
fs.mkdirSync(OUT, { recursive: true });

// the CSP exactly as site/_headers gives it to every page
const hdr = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
const CSP = (hdr.match(/^\s*Content-Security-Policy:\s*(.+)$/m) || [])[1];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  let file = path.join(ROOT, rel);
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  // upgrade-insecure-requests would send http://127.0.0.1 subresources to https; the rest is kept as is
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Content-Security-Policy': CSP.replace(/;\s*upgrade-insecure-requests/, '') });
  res.end(fs.readFileSync(file));
});
await new Promise(r => srv.listen(8131, '127.0.0.1', r));
const URL0 = 'http://127.0.0.1:8131/en/check';

const R = reporter();
R.ok('CSP found in _headers', !!CSP);
const core = await import('../site/check-core.js').then(() => globalThis.UsdtCheck);
const EP = core.ENDPOINTS;
for (const net of Object.keys(EP)) for (const u of EP[net]) {
  const origin = new URL(u).origin;
  R.ok('connect-src allows ' + origin, CSP.split(';').find(d => d.trim().startsWith('connect-src')).split(/\s+/).includes(origin));
}

let w = makeWorld();
const H = n => '0x' + n.toString(16).padStart(2, '0').repeat(32);
const T = n => n.toString(16).padStart(2, '0').repeat(32);
const SELLER = '0x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a';
const BUYER = '0x1212121212121212121212121212121212121212';
const FAKE = '0xfa4efa4efa4efa4efa4efa4efa4efa4efa4efa4e';
function seed() {
  w = makeWorld();
  addEvmTx(w, 'bsc', H(1), [{ token: USDT.bsc, from: BUYER, to: SELLER, raw: 125500000000000000000n }]);
  w.bsc.tokens.set(FAKE, { symbol: 'USDT', name: 'Tether USD', decimals: 18 });
  addEvmTx(w, 'bsc', H(2), [{ token: FAKE, from: BUYER, to: SELLER, raw: 5000n * 10n ** 18n }]);
  addTronTx(w, T(3), [{ token: USDT.tron, from: '55'.repeat(20), to: '9c'.repeat(20), raw: 250000000n }]);
  w.eth.tokens.set(FAKE, { symbol: '<img src=x onerror="window.__pwned=1">USDT', name: 'x', decimals: 6 });
  addEvmTx(w, 'eth', H(4), [{ token: FAKE, from: BUYER, to: SELLER, raw: 10n ** 6n }]);
  addEvmTx(w, 'eth', H(5), [], { value: 10n ** 17n });
}
seed();

const browser = await chromium.launch();
const errors = [], foreign = [];
async function newPage(scheme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme || 'light', isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', r => { const u = new URL(r.url()); if (u.host !== '127.0.0.1:8131' && !Object.values(EP).flat().some(e => r.url().startsWith(e))) foreign.push(r.url()); });
  for (const net of Object.keys(EP)) for (const base of EP[net]) {
    await page.route(u => u.href === base || u.href === base + '/' || u.href.startsWith(base + '/'), async route => {
      const req = route.request();
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const r = handle(w, net, base, req.url().slice(base.length), req.postData());
      if (r.hang) return;               // never answers: the page must time out by itself
      return route.fulfill({ status: r.status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: r.body });
    });
  }
  await page.goto(URL0, { waitUntil: 'networkidle' });
  return page;
}
async function check(page, text, opts = {}) {
  await page.fill('#q', '');
  if (opts.mine != null || opts.amount != null) {
    if (!(await page.$eval('#more', d => d.open))) await page.click('#more summary');
    await page.fill('#mine', opts.mine || ''); await page.fill('#amount', opts.amount || '');
  }
  await page.fill('#q', text);
  await page.click('#go');
  await page.waitForSelector('#result .verdict', { timeout: 20000 });
  await page.waitForTimeout(150);
  return page.$eval('#result .verdict', e => ({ v: e.dataset.verdict, kind: e.dataset.kind, text: e.innerText }));
}
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const scheme of ['light', 'dark']) {
  seed();
  const page = await newPage(scheme);
  const sfx = scheme === 'dark' ? '-dark' : '';
  R.ok(scheme + ': title and H1', (await page.title()).startsWith('Is this USDT payment real?') && (await page.textContent('h1')) === 'Is this USDT payment real?');
  R.ok(scheme + ': optional fields collapsed', !(await page.$eval('#more', d => d.open)));
  R.ok(scheme + ': no horizontal scroll (empty)', await noHScroll(page));
  const tap = await page.$eval('#go', b => b.getBoundingClientRect().height);
  R.ok(scheme + ': button is a big tap target (>=48px)', tap >= 48, String(tap));
  await page.screenshot({ path: `${OUT}/01-empty${sfx}.png` });

  let r = await check(page, H(1));
  R.ok(scheme + ': BSC real USDT -> green', r.v === 'green' && /Real USDT/.test(r.text) && /125\.5 USDT/.test(r.text), r.text.slice(0, 80));
  R.ok(scheme + ': green shows the two things to check', /YOUR address/.test(r.text) && /Check the amount/.test(r.text));
  R.ok(scheme + ': recipient shown in full', r.text.replace(/\s/g, '').includes(SELLER));
  R.ok(scheme + ': no horizontal scroll (green)', await noHScroll(page));
  const said = await page.textContent('#live');
  R.ok(scheme + ': verdict announced (aria-live)', /Real USDT/.test(said), said);
  await page.$eval('#result', e => e.scrollIntoView());
  await page.screenshot({ path: `${OUT}/02-green${sfx}.png` });
  await page.evaluate(() => window.scrollTo(0, 0));

  if (process.env.DBG) console.log(await page.evaluate(async h => { const L = []; const r = await UsdtCheck.check(h, { log: (...a) => L.push(a.join(' ')) }); return JSON.stringify([r.verdict, L]); }, H(2)));
  r = await check(page, H(2));
  R.ok(scheme + ': fake USDT -> red', r.v === 'red' && /Fake token/.test(r.text) && /0xfa4e/i.test(r.text) && /0x55d398/i.test(r.text), r.v + ' ' + r.text.slice(0, 300));
  await page.$eval('#result', e => e.scrollIntoView());
  await page.screenshot({ path: `${OUT}/03-red-fake${sfx}.png` });

  r = await check(page, 'https://bscscan.com.tx-verify.io/tx/' + H(1));
  const warn = await page.$eval('#result .linkwarn', e => e.innerText).catch(() => '');
  R.ok(scheme + ': look-alike link -> warning with host, then real check', /not an official explorer/.test(warn) && /bscscan\.com\.tx-verify\.io/.test(warn) && r.v === 'green');
  R.ok(scheme + ': warning also announced', /not an official explorer/.test(await page.textContent('#live')));
  await page.$eval('#result', e => e.scrollIntoView());
  await page.screenshot({ path: `${OUT}/04-link-warning${sfx}.png` });
  await page.evaluate(() => window.scrollTo(0, 0));

  if (scheme === 'light') {
    r = await check(page, 'https://tronscan.org/#/transaction/' + T(3));
    R.ok('TRON link -> green 250 USDT, no link warning', r.v === 'green' && /250 USDT/.test(r.text) && !(await page.$('#result .linkwarn')));
    r = await check(page, H(1), { mine: SELLER.toUpperCase().replace('0X', '0x'), amount: '125.50' });
    R.ok('address + amount match lines', /Sent to your address/.test(r.text) && /Amount matches/.test(r.text), r.text.slice(-200));
    await page.$eval('#result', e => e.scrollIntoView());
    await page.screenshot({ path: `${OUT}/05-green-with-address.png` });
    r = await check(page, H(1), { mine: '0x' + '5e'.repeat(20), amount: '200' });
    R.ok('wrong address -> red "not to your address"', r.v === 'red' && /not to your address/i.test(r.text));
    r = await check(page, H(4), { mine: '', amount: '' });
    R.ok('token symbol with HTML is shown as text, not run', !(await page.evaluate(() => window.__pwned)) && /<img/.test(r.text) && r.v === 'red');
    r = await check(page, H(5));
    R.ok('ETH only -> amber "only ETH"', r.v === 'amber' && /only ETH/.test(r.text), r.v + ' ' + r.text.slice(0, 200));
    r = await check(page, H(9));
    R.ok('unknown hash -> not found, do not hand over', r.v === 'notfound' && /Do not hand over the goods/.test(r.text));
    for (const u of EP.bsc) w.faults[u] = 'timeout';
    const t0 = Date.now();
    r = await check(page, H(1));
    R.ok('BSC nodes hang -> "Could not check right now", in time', r.v === 'error' && /Could not check right now/.test(r.text) && Date.now() - t0 < 20000, (Date.now() - t0) + 'ms');
    w.faults = {};
    for (const u of EP.bsc) w.faults[u] = 'garbage';
    r = await check(page, H(1));
    R.ok('BSC nodes answer garbage -> could not check', r.v === 'error');
    w.faults = {};
    r = await check(page, '0x' + '12'.repeat(20));
    R.ok('address pasted -> asks for the hash', r.v === 'input' && /wallet address/.test(r.text));
    // keyboard only: focus the field, paste via typing, Enter
    await page.fill('#q', '');
    await page.focus('#q'); await page.keyboard.type(H(1)); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#result .verdict')?.dataset.verdict === 'green');
    R.ok('keyboard: Enter in the field runs the check', true);
    // paste runs the check by itself
    await page.fill('#q', '');
    await page.evaluate(h => { const q = document.getElementById('q'); q.focus(); const dt = new DataTransfer(); dt.setData('text/plain', h);
      q.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); q.value = h; }, H(2));
    await page.waitForFunction(() => document.querySelector('#result .verdict')?.dataset.verdict === 'red', null, { timeout: 15000 });
    R.ok('paste into an empty field runs the check', true);
    const txt = await page.evaluate(() => document.body.innerText);
    R.ok('page never says "safe", "guaranteed" or "100%"', !/\bsafe\b|guarantee|100\s?%/i.test(txt));
    R.ok('"What this check does not cover" always shown', /What this check does not cover/.test(txt));
    R.ok('till line and guide link', !!(await page.$('a[href="https://till.tavarov.com/"]')) && !!(await page.$('a[href="/en/fake-usdt-payment"]')));
  }
  await page.context().close();
}

// guide links to the checker; redirects and sitemap carry it
const guide = fs.readFileSync(path.join(ROOT, 'en/fake-usdt-payment.html'), 'utf8');
R.ok('guide has "Check a payment now" button', /<a class="btn btn-main" href="\/en\/check">Check a payment now<\/a>/.test(guide));
R.ok('/check redirect', /^\/check \/en\/check 301$/m.test(fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8')));
R.ok('sitemap has /en/check', fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').includes('https://tavarov.com/en/check<'));
R.ok('no request to any other host', foreign.length === 0, foreign.slice(0, 3).join(' '));

await browser.close(); srv.close();
const ok = R.done(errors);
process.exit(ok ? 0 : 1);
