/* Кабинет продавца и страница покупателя на пяти языках.

   Зачем проверять. Продавец, ради которого всё это сделано, чаще всего не
   русский: фрилансер с заграничными заказчиками, торговец ключами, автор
   курсов. И покупатель у него — из третьей страны. Русская страница для них
   не «неудобство», а стена: человек не понимает, куда он платит.

   Что проверяем именно здесь:

   1. Словарь полон. Пропущенный ключ — это не пустое место, а русская фраза
      посреди английской страницы, и заметить её на глаз нельзя.
   2. Каждый data-t в разметке существует в словаре, иначе на экране окажется
      само имя ключа.
   3. Англичанину показывают английское — без единой русской буквы.
   4. Выбор языка держится после перезагрузки.
   5. Предупреждение о тестовой сети переведено. Это не украшение: оно ловит
      мошенника, и на английском оно нужно ровно так же.
   6. Выгрузка в файл на английском пишет дробь через точку — иначе Excel
      съест копейки как отдельную колонку.                                  */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const R = (() => {
  const rows = [];
  return { ok(name, cond, detail){ rows.push(!!cond);
      console.log((cond ? 'OK   ' : 'ПРОВАЛ ') + name + (detail ? '  [' + detail + ']' : '')); },
    done(){ const bad = rows.filter(x => !x).length;
      console.log('\n--- ' + (rows.length - bad) + ' из ' + rows.length + ' ---');
      return bad === 0; } };
})();

const WWW = '/home/claude/apk/www';
const PORT = 8798;
const LANGS = ['ru','en','es','tr','pt'];

// ---------- словари читаем прямо из файлов ----------
/* Разбираем не регулярками по всему файлу, а вырезаем блок словаря и
   спрашиваем у самого движка: так опечатка в кавычках видна сразу. */
async function dictOf(file){
  const src = fs.readFileSync(path.join(WWW, file), 'utf8');
  const i = src.indexOf('const RU = {');
  const j = src.indexOf('const NAMES', i);
  if (i < 0 || j < 0) return null;
  const body = src.slice(i, j) + '\nexport default { RU, T };';
  const url = 'data:text/javascript;base64,' + Buffer.from(body, 'utf8').toString('base64');
  return (await import(url)).default;
}

for (const file of ['invoice.html', 'pay.html']){
  const d = await dictOf(file);
  R.ok('СЛОВАРЬ ' + file + ' НАЙДЕН И РАЗБИРАЕТСЯ', !!d && !!d.RU && !!d.T);
  if (!d) continue;
  const keys = Object.keys(d.RU);
  R.ok('  в нём есть все пять языков',
    LANGS.every(l => d.T[l] && typeof d.T[l] === 'object'),
    Object.keys(d.T).join(','));

  for (const l of LANGS.filter(x => x !== 'ru')){
    const miss  = keys.filter(k => d.T[l][k] === undefined);
    const extra = Object.keys(d.T[l]).filter(k => d.RU[k] === undefined);
    R.ok('  ' + l + ': НИ ОДНОЙ ПРОПУЩЕННОЙ СТРОКИ',
      miss.length === 0, miss.length ? miss.join(', ') : 'строк ' + keys.length);
    R.ok('  ' + l + ': и ни одной лишней', extra.length === 0, extra.join(', '));
    /* Русская буква в чужом словаре — почти всегда недоперевод, который на
       экране выглядит как половина фразы на своём языке, половина на нашем. */
    const cyr = Object.keys(d.T[l]).filter(k => /[А-Яа-яЁё]/.test(String(d.T[l][k])));
    R.ok('  ' + l + ': НИ ОДНОЙ РУССКОЙ БУКВЫ В ПЕРЕВОДЕ', cyr.length === 0, cyr.join(', '));
    /* %s в шаблоне должен уцелеть, иначе сумма или срок просто пропадут. */
    const lost = keys.filter(k => String(d.RU[k]).includes('%s') && !String(d.T[l][k] || '').includes('%s'));
    R.ok('  ' + l + ': подстановки на месте', lost.length === 0, lost.join(', '));
  }

  // ---------- разметка не просит того, чего нет ----------
  const src = fs.readFileSync(path.join(WWW, file), 'utf8');
  const asked = [...src.matchAll(/data-t(?:p|t)?="([a-zA-Z0-9]+)"/g)].map(m => m[1]);
  const unknown = [...new Set(asked)].filter(k => d.RU[k] === undefined);
  R.ok('  КАЖДЫЙ data-t В РАЗМЕТКЕ ЕСТЬ В СЛОВАРЕ', unknown.length === 0,
    unknown.length ? unknown.join(', ') : 'подписей ' + asked.length);
}

// ---------- живая страница ----------
let paidSet = new Set();
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:' + PORT);
  if (u.pathname === '/api/status'){
    const q = Object.fromEntries(u.searchParams);
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify(paidSet.has(q.h) ? { paid:true, tx:'0x' + 'ab'.repeat(32) } : { paid:false }));
    return;
  }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW) || !fs.existsSync(file)){ res.writeHead(404); res.end('нет'); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js')
    ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => srv.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

const WALLET = '0x68021d70605A375deC030Fab45b99Df21bF39cc2';
const errors = [];
/* Ловим ошибки самих страниц, а не окружения. В этой песочнице нет выхода к
   узлам BNB Chain и нет значка вкладки, поэтому браузер честно ругается на
   недоступную сеть — к переводу это отношения не имеет. */
const noise = (m) => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|favicon/i.test(m);
const watchErrors = (page) => {
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(m.text()); });
};

/* «Своих» русских букв на экране быть не должно. Чужие бывают: название
   магазина и товар пишет продавец, и если он написал их по-русски, то так и
   надо показать. Поэтому в опытах всё, что вводит человек, — латиницей. */
async function openCabinet(locale){
  const ctx = await browser.newContext({ locale, viewport: { width: 414, height: 900 } });
  const page = await ctx.newPage();
  watchErrors(page);
  page.on('dialog', d => d.accept().catch(()=>{}));
  await page.goto('http://localhost:' + PORT + '/invoice.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return { ctx, page };
}

// ---- англичанин видит английское ----
{
  const { ctx, page } = await openCabinet('en-US');
  const txt = await page.innerText('body');
  R.ok('АНГЛИЙСКИЙ БРАУЗЕР — АНГЛИЙСКИЙ КАБИНЕТ, БЕЗ ВЫБОРА ЯЗЫКА РУКАМИ',
    /Create an invoice/.test(txt), txt.trim().slice(0, 60).replace(/\n/g, ' | '));
  R.ok('и на экране не осталось ни одной русской буквы',
    !/[А-Яа-яЁё]/.test(txt), (txt.match(/[А-Яа-яЁё][А-Яа-яЁё ]{0,30}/) || [''])[0]);
  R.ok('подсказки в полях тоже переведены',
    (await page.getAttribute('#shop', 'placeholder')) === 'Corner coffee shop',
    await page.getAttribute('#shop', 'placeholder'));
  R.ok('и язык страницы объявлен честно',
    (await page.getAttribute('html', 'lang')) === 'en');
  await ctx.close();
}

// ---- остальные языки ----
for (const [loc, code, word] of [['es-ES','es','Crear una factura'],
                                 ['tr-TR','tr','Fatura oluştur'],
                                 ['pt-BR','pt','Criar uma fatura']]){
  const { ctx, page } = await openCabinet(loc);
  const txt = await page.innerText('body');
  R.ok(code + ': кабинет на своём языке', txt.includes(word), txt.trim().slice(0, 40));
  R.ok(code + ': русских хвостов не осталось', !/[А-Яа-яЁё]/.test(txt),
    (txt.match(/[А-Яа-яЁё][А-Яа-яЁё ]{0,30}/) || [''])[0]);
  await ctx.close();
}

// ---- переключатель и память выбора ----
{
  const { ctx, page } = await openCabinet('en-US');
  R.ok('ПЕРЕКЛЮЧАТЕЛЬ ЯЗЫКА ЕСТЬ И В НЁМ ПЯТЬ ЯЗЫКОВ',
    (await page.locator('#langs button').count()) === 5);
  await page.click('#langs button[data-code="tr"]');
  await page.waitForTimeout(200);
  R.ok('нажатие переключает страницу целиком',
    (await page.innerText('body')).includes('Fatura oluştur'));
  R.ok('и выбранный язык отмечен',
    (await page.getAttribute('#langs button[data-code="tr"]', 'aria-pressed')) === 'true');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  R.ok('ВЫБОР ЯЗЫКА ПЕРЕЖИВАЕТ ПЕРЕЗАГРУЗКУ',
    (await page.innerText('body')).includes('Fatura oluştur'));
  await ctx.close();
}

// ---- счёт, выставленный по-английски, и его карточка ----
let payUrl = null;
{
  const { ctx, page } = await openCabinet('en-US');
  await page.fill('#wallet', WALLET);
  if (!(await page.isVisible('#shop'))) await page.click('#whoEdit');
  await page.fill('#shop', 'Corner shop');
  await page.fill('#item', 'Game key');
  await page.fill('#amount', '12.34');
  await page.click('#makeBtn');
  await page.waitForTimeout(900);
  const txt = await page.innerText('#doneCard');
  R.ok('КАРТОЧКА ВЫСТАВЛЕННОГО СЧЁТА ТОЖЕ ПО-АНГЛИЙСКИ',
    /Invoice created/.test(txt) && !/[А-Яа-яЁё]/.test(txt), txt.trim().slice(0, 50).replace(/\n/g, ' | '));

  /* Смена языка на готовом счёте не должна ни рисовать второй код, ни
     оставлять половину карточки на прошлом языке. */
  await page.click('#langs button[data-code="pt"]');
  await page.waitForTimeout(300);
  const txt2 = await page.innerText('#doneCard');
  R.ok('ЯЗЫК МЕНЯЕТСЯ И НА УЖЕ ВЫСТАВЛЕННОМ СЧЁТЕ', /Fatura criada/.test(txt2),
    txt2.trim().slice(0, 40).replace(/\n/g, ' | '));
  R.ok('и второй код поверх первого не нарисовался',
    (await page.locator('#qrBox canvas, #qrBox img').count()) <= 2,
    'картинок кода: ' + await page.locator('#qrBox canvas, #qrBox img').count());

  payUrl = await page.textContent('#doneLink');
  await ctx.close();
}

// ---- страница покупателя ----
{
  const ctx = await browser.newContext({ locale: 'tr-TR', viewport: { width: 414, height: 900 } });
  const page = await ctx.newPage();
  watchErrors(page);
  await page.goto(payUrl, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const txt = await page.innerText('body');
  R.ok('ПОКУПАТЕЛЬ ВИДИТ СЧЁТ НА СВОЁМ ЯЗЫКЕ, А НЕ НА ЯЗЫКЕ ПРОДАВЦА',
    /Cüzdanda aç/.test(txt), txt.trim().slice(0, 60).replace(/\n/g, ' | '));
  R.ok('и русского на странице оплаты не осталось', !/[А-Яа-яЁё]/.test(txt),
    (txt.match(/[А-Яа-яЁё][А-Яа-яЁё ]{0,30}/) || [''])[0]);
  R.ok('сумма и получатель на месте',
    txt.includes('12.34') && txt.toLowerCase().includes(WALLET.toLowerCase()));
  await ctx.close();
}

// ---- предупреждение о тестовой сети переведено ----
{
  const bad = { m: WALLET, a: '20', c: 'USDT', o: 'order-1', n: 'Shop', i: 'Key',
                net: 'bnbTestnet', t: Math.floor(Date.now()/1000) + 3600,
                h: '0x' + 'a1'.repeat(32) };
  const b64 = Buffer.from(JSON.stringify(bad), 'utf8').toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 414, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:' + PORT + '/pay.html#p=' + b64, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const warn = await page.innerText('#testnetWarn');
  R.ok('ПРЕДУПРЕЖДЕНИЕ ОБ ОБМАНЕ ПЕРЕВЕДЕНО, А НЕ ОСТАЛОСЬ ПО-РУССКИ',
    /TEST network/.test(warn) && !/[А-Яа-яЁё]/.test(warn),
    warn.trim().slice(0, 60).replace(/\n/g, ' | '));
  R.ok('и сказано прямо, что это обман', /deceived/i.test(warn));
  await ctx.close();
}

// ---- выгрузка в файл: дробь по правилам языка ----
{
  const { ctx, page } = await openCabinet('en-US');
  await page.evaluate((w) => {
    localStorage.setItem('tavarov.invoices.v1', JSON.stringify([{
      h:'0x' + 'c1'.repeat(32), m:w, a:'12.34', c:'USDT', o:'order-7', n:'Shop',
      i:'Key', net:'bnb', t: Math.floor(Date.now()/1000) + 3600, at: Date.now(),
      paid:true, tx:'0x' + 'ee'.repeat(32) }]));
  }, WALLET);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.click('#logCsv');
  const d = await dl;
  R.ok('ВЫГРУЗКА В ФАЙЛ РАБОТАЕТ', !!d, d ? d.suggestedFilename() : 'файла нет');
  if (d){
    const p = await d.path();
    const csv = fs.readFileSync(p, 'utf8');
    R.ok('заголовки в файле на языке страницы', /date;|"date"/.test(csv), csv.split('\r\n')[0].slice(0, 60));
    R.ok('ДРОБЬ ЧЕРЕЗ ТОЧКУ — ИНАЧЕ АНГЛИЙСКИЙ EXCEL СЪЕСТ КОПЕЙКИ',
      /"12\.34"/.test(csv), (csv.split('\r\n')[1] || '').slice(0, 60));
    R.ok('и состояние счёта переведено', /"paid"/.test(csv));
  }
  await ctx.close();
}

R.ok('НИ ОДНОЙ ОШИБКИ В КОДЕ СТРАНИЦ', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
srv.close();
process.exit(R.done() ? 0 : 1);
