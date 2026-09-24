/* Донаты: страница wallet.tavarov.com/d/имя.

   Проверяется путь зрителя целиком: нашли автора по имени из блокчейна,
   выбрали сумму, написали сообщение — сообщение ушло на сервер ДО оплаты,
   и страница оплаты получила правильный счёт: кому, сколько, в чём и под
   тем же номером, под которым лежит сообщение. Ошибка в номере — и автор
   никогда не увидит текст; ошибка в адресе — деньги уйдут не тому. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const WWW = '/home/claude/apk/www', PORT = 8835;
const BLOGGER = '0x73bbcd23735257660a9f6be57d057dc4a2abf432';
let posts = [], postStatus = 200;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/donate' && req.method === 'POST'){
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      posts.push(JSON.parse(b));
      res.writeHead(postStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify(postStatus === 200 ? { ok: true } : { error: 'storage is not configured' }));
    });
    return;
  }
  if (u.pathname === '/api/status'){ res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"paid":false}'); }
  let rel = u.pathname.startsWith('/d/') ? 'donate.html' : (decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html');
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));

let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++;
  console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 180) + ']' : '')); };

/* Узлы сети: имена. addressOf("streamer") → автор, nameOf(автор) → streamer. */
const hexOf = s => Buffer.from(s, 'utf8').toString('hex');
const encStr = s => { const h = hexOf(s); return '0x' + '0'.repeat(62) + '20' + (h.length / 2).toString(16).padStart(64, '0') + h.padEnd(64, '0'); };
const namesSeen = [];
async function fresh(opts = {}){
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' }, opts));
  await ctx.route(/bsc-dataseed|bnbchain\.org|publicnode\.com|data-seed-prebsc/, async route => {
    const q = JSON.parse(route.request().postData());
    const { to, data } = q.params[0];
    namesSeen.push(to.toLowerCase());
    let result = '0x' + '0'.repeat(64);
    if (data.startsWith('0xccf1454a')){
      const want = encStr('streamer').slice(2);
      if (data.slice(10) === want) result = '0x' + '0'.repeat(24) + BLOGGER.slice(2);
    } else if (data.startsWith('0xf5c57382')){
      if (data.slice(-40) === BLOGGER.slice(2)) result = encStr('streamer');
      else result = encStr('');
    }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  return { ctx, page };
}
const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const B = 'http://localhost:' + PORT;
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden'); }, sel);

// ======================= автор по имени =======================
let { ctx, page } = await fresh();
await page.goto(B + '/d/streamer'); await page.waitForTimeout(1200);
ok('АВТОР НАЙДЕН ПО ИМЕНИ ИЗ БЛОКЧЕЙНА', (await page.textContent('#who')) === '@streamer', await page.textContent('#who'));
ok('и показан его полный адрес — чтобы сверить', (await page.textContent('#addr')) === BLOGGER);
ok('имя читали из контракта имён основной сети', namesSeen.includes('0xd6e8a78634be366bdbd041227d1e94f5b374338e'));
ok('без суммы кнопка неактивна', await page.isDisabled('#go'));

await page.click('#chips button:nth-child(3)');     // 5 $
ok('КНОПКА «5 $» → «ЗАДОНАТИТЬ 5 USDT»', /5 USDT/.test(await page.textContent('#go')), await page.textContent('#go'));
ok('АВТОРУ ПРИДЁТ 4.95 — ЧЕСТНО ПРО 1%', /4\.95 USDT/.test(await page.textContent('#split')), await page.textContent('#split'));
await page.fill('#amount', '2,5');
ok('запятая превращается в точку', (await page.inputValue('#amount')) === '2.5');
ok('и 99% от 2.5 = 2.475', /2\.475/.test(await page.textContent('#split')), await page.textContent('#split'));
await page.fill('#amount', '0');
ok('ноль — нельзя', await page.isDisabled('#go'));
await page.fill('#amount', '10');
await page.click('#curSeg button:nth-child(2)');
ok('можно выбрать USDC', /10 USDC/.test(await page.textContent('#go')));
await page.click('#curSeg button:nth-child(1)');

/* Текст: переносы, разворот и невидимые символы сервер не примет — страница
   убирает их сразу, а не показывает отказ после нажатия. */
await page.evaluate(() => { const m = document.getElementById('msg');
  m.value = 'Привет\nот' + String.fromCharCode(0x202e) + ' зрителя' + String.fromCharCode(0x200b) + '!';
  m.dispatchEvent(new Event('input')); });
ok('ПЕРЕНОСЫ И НЕВИДИМЫЕ СИМВОЛЫ ВЫРЕЗАНЫ', (await page.inputValue('#msg')) === 'Приветот зрителя!', JSON.stringify(await page.inputValue('#msg')));
await page.fill('#msg', 'Спасибо за стрим! 🔥');
await page.fill('#nick', 'Ваня');
ok('счётчик знаков', (await page.textContent('#msgCount')) === '19/200', await page.textContent('#msgCount'));

// ======================= донат =======================
posts = [];
await Promise.all([page.waitForURL(/\/pay\?lang=ru#p=/, { timeout: 10000 }).catch(() => {}), page.click('#go')]);
ok('СООБЩЕНИЕ УШЛО НА СЕРВЕР', posts.length === 1, JSON.stringify(posts[0] || {}));
const p0 = posts[0] || {};
ok('кому — автору', p0.to && p0.to.toLowerCase() === BLOGGER);
ok('ник и текст как написаны', p0.nick === 'Ваня' && p0.msg === 'Спасибо за стрим! 🔥');
ok('номер счёта — 32 случайных байта', /^0x[0-9a-f]{64}$/.test(p0.h || ''));
ok('сеть основная', p0.net === 'bnb');
const url = page.url();
ok('ДАЛЬШЕ — ОБЫЧНАЯ СТРАНИЦА ОПЛАТЫ', /\/pay\?lang=ru#p=/.test(url), url.slice(0, 80));
const inv = JSON.parse(Buffer.from(url.split('#p=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
ok('В СЧЁТЕ ТОТ ЖЕ НОМЕР, ЧТО У СООБЩЕНИЯ — иначе текст не найдёт оплату', inv.h === p0.h, inv.h);
ok('получатель в счёте — автор', inv.m.toLowerCase() === BLOGGER);
ok('сумма и валюта: 10 USDT', inv.a === '10' && inv.c === 'USDT', inv.a + ' ' + inv.c);
ok('подписано @streamer, помечено как донат', inv.n === '@streamer' && inv.o === 'donate' && /Донат/.test(inv.i));
ok('срок счёта — около часа', inv.t > Date.now() / 1000 + 3000 && inv.t < Date.now() / 1000 + 3700);
await page.waitForTimeout(1200);
ok('СТРАНИЦА ОПЛАТЫ ПРИНЯЛА СЧЁТ: 10 USDT', /10 USDT/.test(await page.textContent('#amount')), await page.textContent('#amount'));
await ctx.close();

// ======================= сервер не ответил =======================
({ ctx, page } = await fresh());
postStatus = 503; posts = [];
await page.goto(B + '/d/streamer'); await page.waitForTimeout(1000);
await page.click('#chips button:nth-child(1)');
await page.click('#go'); await page.waitForTimeout(800);
ok('СЕРВЕР НЕ ПРИНЯЛ ТЕКСТ — СКАЗАНО, И ОПЛАТА НЕ ПОТЕРЯНА', await vis(page, '#goErr') && /без него|без сообщения/i.test(await page.textContent('#goErr')), await page.textContent('#goErr'));
ok('на страницу оплаты сами не ушли', !/\/pay/.test(page.url()));
await Promise.all([page.waitForURL(/\/pay/, { timeout: 8000 }).catch(() => {}), page.click('#goErr button')]);
ok('«без сообщения» — ведёт к оплате', /\/pay\?lang=ru#p=/.test(page.url()));
postStatus = 200;
await ctx.close();

// ======================= ошибки адреса =======================
({ ctx, page } = await fresh());
await page.goto(B + '/d/nosuchname'); await page.waitForTimeout(1000);
ok('НЕТ ТАКОГО ИМЕНИ — ТАК И СКАЗАНО', await vis(page, '#err') && !(await vis(page, '#main')));
await page.goto(B + '/d/<script>'); await page.waitForTimeout(800);
ok('мусор в адресе — «не найдено», без запросов с мусором', await vis(page, '#err'));
await page.goto(B + '/d/0x73BBCD23735257660A9f6BE57d057dC4A2ABf432'); await page.waitForTimeout(1200);
ok('ПО АДРЕСУ — ТОЖЕ РАБОТАЕТ, И ИМЯ ПОДТЯНУЛОСЬ', (await page.textContent('#who')) === '@streamer', await page.textContent('#who'));
await ctx.close();

// ======================= тестовая сеть =======================
({ ctx, page } = await fresh());
namesSeen.length = 0; posts = [];
await page.goto(B + '/d/streamer?net=bnbTestnet'); await page.waitForTimeout(1200);
ok('ТЕСТОВАЯ СЕТЬ — ПРЕДУПРЕЖДЕНИЕ НАВЕРХУ', await vis(page, '#tnCard'));
ok('имя — из тестового контракта имён', namesSeen.includes('0x718e52f81f0ed871bf8aa834faf82d0b257ae27a'));
ok('в тестовой сети только USDT', (await page.$$eval('#curSeg button', b => b.map(x => x.textContent))).join() === 'USDT');
await page.click('#chips button:nth-child(1)');
await Promise.all([page.waitForURL(/\/pay/, { timeout: 8000 }).catch(() => {}), page.click('#go')]);
ok('и сообщение, и счёт — в тестовой сети', posts[0] && posts[0].net === 'bnbTestnet' &&
   JSON.parse(Buffer.from(page.url().split('#p=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).net === 'bnbTestnet');
await ctx.close();

// ======================= языки и узкий экран =======================
({ ctx, page } = await fresh({ viewport: { width: 320, height: 640 }, locale: 'tr-TR' }));
await page.goto(B + '/d/streamer'); await page.waitForTimeout(1200);
ok('ЯЗЫК БРАУЗЕРА — ТУРЕЦКИЙ', /destekle/i.test(await page.textContent('body')));
ok('на 320 px нет горизонтальной прокрутки', await page.evaluate(() => document.documentElement.scrollWidth <= 321),
  await page.evaluate(() => document.documentElement.scrollWidth));
const missing = await page.evaluate(() => {
  const out = [];
  Object.keys(T.ru).forEach(k => ['en', 'es', 'tr', 'pt'].forEach(l => { if (!T[l][k]) out.push(l + ':' + k); }));
  return out;
});
ok('ВСЕ СЛОВА НА ПЯТИ ЯЗЫКАХ', missing.length === 0, missing.join(','));
await ctx.close();

ok('НИ ОДНОЙ ОШИБКИ В КОДЕ СТРАНИЦ', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); srv.close();
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
