/* Съёмка ролика «покупатель платит продавцу».

   Снимается НАСТОЯЩИЙ интерфейс: внутри рамок телефонов работают те же
   страницы, что уедут на хостинг. Нарисованного здесь нет ничего, кроме
   подписей и рамок.

   Чего здесь нет и о чём надо сказать вслух: сети. Ответ «оплачено» даёт
   местная заглушка, а не BNB Chain, — из этой песочницы до узлов сети не
   достать. Поэтому ролик честно называется демонстрацией интерфейса, а не
   записью настоящего платежа.                                              */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const WWW   = '/home/claude/apk/www';
const BRAND = '/home/claude/apk/brand';
const PORT  = 8801;
const OUT   = '/home/claude/apk/brand/video';

const LANG = process.argv[2] === 'ru' ? 'ru' : 'en';

const TEXT = {
  en: {
    item: 'Game key', shop: 'Corner Shop',
    c0: ['Selling something digital?', 'No shop, no signup, no account to freeze.'],
    c1: ['The seller creates an invoice', 'Amount, what it is for — that is all.'],
    c2: ['A link and a QR code in seconds', 'Send it in any chat.'],
    c3: ['The buyer opens the link', 'Nothing to install, nothing to sign up for.'],
    c4: ['Paid', 'The money went straight to the seller. Nobody held it.'],
    c5: ['No chargebacks. Nothing to freeze.', 'tavarov.com']
  },
  ru: {
    item: 'Ключ к игре', shop: 'Магазин на углу',
    c0: ['Продаёте цифровой товар?', 'Ни магазина, ни регистрации, ни счёта, который заморозят.'],
    c1: ['Продавец выставляет счёт', 'Сумма и за что — это всё.'],
    c2: ['Ссылка и код за пару секунд', 'Отправьте в любой переписке.'],
    c3: ['Покупатель открывает ссылку', 'Ничего не ставить, нигде не регистрироваться.'],
    c4: ['Оплачено', 'Деньги ушли прямо продавцу. Никто их не держал.'],
    c5: ['Возвратов нет. Замораживать нечего.', 'tavarov.com']
  }
}[LANG];

const WALLET = '0x68021d70605A375deC030Fab45b99Df21bF39cc2';
const LANGTEXT_IDLE = LANG === 'ru' ? 'ждём ссылку…' : 'waiting for a link…';

// ---------- свой ответ «оплачено ли» ----------
let paid = false;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                '.png':'image/png', '.svg':'image/svg+xml', '.css':'text/css; charset=utf-8' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:' + PORT);
  if (u.pathname === '/api/status'){
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify(paid ? { paid:true, tx:'0x' + 'ab'.repeat(32) } : { paid:false }));
    return;
  }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const root = rel === 'stage.html' ? BRAND : WWW;
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file)){ res.writeHead(404); res.end('нет'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => srv.listen(PORT, r));

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'] });

const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  locale: LANG === 'ru' ? 'ru-RU' : 'en-US',
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } }
});

/* Кошелёк и название продавец вписывает один раз в жизни, а не в каждом
   ролике. Кладём заранее — иначе половина видео уйдёт на печать адреса из
   сорока двух знаков. */
await ctx.addInitScript(([w, shop, lang]) => {
  try{
    localStorage.setItem('tavarov.invoice.v1', JSON.stringify({
      wallet: w, shop: shop, cur: 'USDT', ttl: '3600' }));
    localStorage.setItem('tavarov.site.lang', lang);
  } catch(e){}
}, [WALLET, TEXT.shop, LANG]);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));

const wait = (ms) => page.waitForTimeout(ms);
const cap  = (a) => page.evaluate(([t, s]) => window.stage.cap(t, s), a);

await page.goto('http://localhost:' + PORT + '/stage.html', { waitUntil: 'networkidle' });
await page.evaluate((t) => window.stage.idle(t),
  LANGTEXT_IDLE);
await wait(700);

// ---------- 0. о чём вообще речь ----------
await cap(TEXT.c0);
await wait(2400);

// ---------- 1. продавец выставляет счёт ----------
await page.evaluate((u) => window.stage.left(u),
  'http://localhost:' + PORT + '/invoice.html?lang=' + LANG);
await wait(1400);
await cap(TEXT.c1);

const L = page.frameLocator('#left');
await L.locator('#item').scrollIntoViewIfNeeded();
await wait(500);

/* Печатаем через pressSequentially: press() понимает только имена клавиш и
   на русской букве падает, а нам нужен ролик на пяти языках. */
const typeIn = async (sel, text) => {
  const el = L.locator(sel);
  await el.click();
  if (el.pressSequentially) await el.pressSequentially(text, { delay: 60 });
  else await el.type(text, { delay: 60 });
};
await typeIn('#item', TEXT.item);
await wait(350);
await typeIn('#amount', '12.00');
await wait(800);

await L.locator('#makeBtn').click();
await wait(1500);

// ---------- 2. ссылка и код ----------
await cap(TEXT.c2);
await wait(2200);

const payUrl = await L.locator('#doneLink').textContent();

// ---------- 3. ссылка улетает покупателю ----------
await page.evaluate(() => window.stage.fly());
await wait(1000);
await page.evaluate((u) => window.stage.right(u), payUrl);
await wait(900);
await cap(TEXT.c3);
await wait(3000);

// ---------- 4. оплата ----------
/* Настоящая оплата идёт из кошелька покупателя. Здесь её изображает
   заглушка: обе страницы спрашивают «оплачено ли» сами, и мы просто
   начинаем отвечать «да» — ровно так же, как ответила бы сеть.

   Важно для съёмки: у покупателя строка состояния лежит НИЖЕ первого
   экрана. Не подкрутив её в кадр, мы получим подпись «Оплачено» над двумя
   экранами, на которых по-прежнему написано «ждём». */
const Rf = page.frameLocator('#right');
await Rf.locator('#state').scrollIntoViewIfNeeded();
await wait(1200);

paid = true;

/* Ждём, пока страницы САМИ увидят оплату: они опрашивают раз в несколько
   секунд, и подпись должна смениться раньше, чем мы о ней объявим. */
await Rf.locator('.state.ok').waitFor({ timeout: 20000 }).catch(()=>{});
await L.locator('#doneStatus.paid').waitFor({ timeout: 20000 }).catch(()=>{});
await wait(700);
await cap(TEXT.c4);
await wait(4200);

// ---------- 5. вывод ----------
await cap(TEXT.c5);
await wait(3000);

await ctx.close();          // видео дописывается только при закрытии контекста
await browser.close();
srv.close();

const files = fs.readdirSync(OUT).filter(f => f.endsWith('.webm'));
const newest = files.map(f => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs }))
                    .sort((a, b) => b.t - a.t)[0];
const target = path.join(OUT, 'raw-' + LANG + '.webm');
fs.renameSync(path.join(OUT, newest.f), target);
console.log('видео:', target);
if (errors.length) console.log('ошибки страниц:', errors.slice(0, 3).join(' | '));
