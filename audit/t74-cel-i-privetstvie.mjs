/* Приветствие и цель автора: на странице доната и полосой в OBS.

   Приветствие и название цели пишет автор — но показываются они чужим
   людям, поэтому только текстом. «Собрано» берётся с сервера. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++;
  console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 200) + ']' : '')); };

const AUTHOR = '0x73bbcd23735257660a9f6be57d057dc4a2abf432';
let profile = { greeting: '<img src=x onerror="window.__pwned=1"> Привет, чат!', goal: { title: 'Новый микрофон', target: '300', raised: '120', since: 1 } };
let profAsks = 0;
const WWW = '/home/claude/apk/www', PORT = 8874;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/donate'){
    if (u.searchParams.get('profile') === '1'){ profAsks++; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ profile })); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"items":[]}');
  }
  let rel = u.pathname.startsWith('/d/') ? 'donate.html' : (decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html');
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const B = 'http://localhost:' + PORT;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const hexOf = s => Buffer.from(s, 'utf8').toString('hex');
const encStr = s => { const h = hexOf(s); return '0x' + '0'.repeat(62) + '20' + (h.length / 2).toString(16).padStart(64, '0') + h.padEnd(64, '0'); };
async function open(url, opts = {}){
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' }, opts.ctx || {}));
  await ctx.route(/publicnode\.com|bsc-dataseed|bnbchain\.org/, route => {
    const q = JSON.parse(route.request().postData());
    let result = '0x' + '0'.repeat(64);
    if (q.method === 'eth_blockNumber') result = '0x100';
    else if (q.method === 'eth_getLogs') result = [];
    else if (q.params && q.params[0] && q.params[0].data){
      const d = q.params[0].data;
      if (d.startsWith('0xf5c57382')) result = encStr('streamer');
      if (d.startsWith('0xccf1454a')) result = '0x' + '0'.repeat(24) + AUTHOR.slice(2);
    }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) });
  });
  if (opts.obs) await ctx.addInitScript(() => { window.obsstudio = {}; });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(B + url);
  return { ctx, page };
}
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; }, sel);

// ======================= страница доната =======================
let { ctx, page } = await open('/d/streamer');
await page.waitForTimeout(1500);
ok('НА СТРАНИЦЕ ДОНАТА — ПРИВЕТСТВИЕ АВТОРА', await vis(page, '#greet') && (await page.textContent('#greet')).includes('Привет, чат!'));
ok('ЧУЖАЯ РАЗМЕТКА В ПРИВЕТСТВИИ — ТЕКСТОМ, НЕ ВЫПОЛНЕНА', !(await page.evaluate(() => window.__pwned)) && (await page.$$eval('#greet img', x => x.length)) === 0);
ok('ЦЕЛЬ: название', (await page.textContent('#goalTitle')) === 'Новый микрофон');
ok('полоса на 40%', (await page.evaluate(() => document.getElementById('goalFill').style.width)) === '40%', await page.evaluate(() => document.getElementById('goalFill').style.width));
ok('«Собрано 120 $ из 300 $ · 40%»', (await page.textContent('#goalText')) === 'Собрано 120 $ из 300 $ · 40%', await page.textContent('#goalText'));
await page.click('#langs button[data-l="en"]');
ok('EN: «120 $ raised of 300 $»', (await page.textContent('#goalText')).startsWith('120 $ raised of 300 $'), await page.textContent('#goalText'));
await ctx.close();

profile = { greeting: '', goal: null };
({ ctx, page } = await open('/d/streamer'));
await page.waitForTimeout(1500);
ok('без приветствия и цели — блоков нет', !(await vis(page, '#greet')) && !(await vis(page, '#goalCard')));
await ctx.close();

// ======================= полоса цели в OBS =======================
profile = { greeting: 'x', goal: { title: 'Свет для стрима', target: '450', raised: '405', since: 1 } };
({ ctx, page } = await open('/alert?goal=1&to=' + AUTHOR + '&lang=ru', { obs: true, ctx: { viewport: { width: 800, height: 160 } } }));
await page.waitForTimeout(1200);
ok('ПОЛОСА ЦЕЛИ В OBS: видна', await vis(page, '#goal'));
ok('название и «405 / 450 $»', (await page.textContent('#gTitle')) === 'Свет для стрима' && (await page.textContent('#gSum')).replace(/\s/g, '') === '405/450$', await page.textContent('#gSum'));
ok('заполнено на 90%', (await page.evaluate(() => document.getElementById('gFill').style.width)) === '90%', await page.evaluate(() => document.getElementById('gFill').style.width));
ok('в режиме цели карточки донатов не появляются', !(await page.evaluate(() => document.getElementById('alert').classList.contains('show'))));
ok('фон прозрачный', await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'));
const asks = profAsks;
await page.evaluate(() => {});           // обновление — раз в 20 секунд, не чаще
await page.waitForTimeout(3000);
ok('сервер спрашивает не чаще раза в 20 секунд', profAsks === asks);
await ctx.close();

profile = { greeting: '', goal: null };
({ ctx, page } = await open('/alert?goal=1&to=' + AUTHOR));
await page.waitForTimeout(1200);
ok('цели нет — полосы нет, а вне OBS сказано, где её поставить', !(await vis(page, '#goal')) && /NoN Wallet/.test(await page.textContent('#helpText')));
await ctx.close();

({ ctx, page } = await open('/alert?goal=1&demo=1&to=' + AUTHOR, { obs: true }));
await page.waitForTimeout(700);
ok('пример полосы цели (demo=1)', await vis(page, '#goal') && (await page.textContent('#gTitle')).length > 0);
await ctx.close();

ok('ни одной ошибки JavaScript', errors.length === 0, errors.join(' | '));
await browser.close(); srv.close();
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
