/* Переезд на свой адрес.

   Браузер хранит кошелёк ВМЕСТЕ С АДРЕСОМ САЙТА. Переехали на свой домен — и
   на новом адресе человек открывает пустое приложение, а его деньги остаются
   привязанными к старому. Ошибиться здесь можно двумя способами, и оба
   кончаются одинаково плохо:

     · поставить на старом адресе глухую переадресацию — тогда человек не
       сможет даже добраться до своего кошелька, чтобы сделать копию;
     · не сказать ничего — тогда он заведёт на новом адресе новый кошелёк,
       решит, что старый пропал, и будет прав в своём ужасе.

   Поэтому на прежних адресах приложение продолжает работать и показывает
   полосу с порядком действий. Здесь проверяется, что полоса появляется
   ИМЕННО ТАМ, где надо, и не появляется больше нигде.

   И второе, незаметное. Продавец, открывавший настройки до переезда, хранит
   у себя прежний адрес сайта для счетов. Ссылки на оплату, которые он даёт
   покупателям, вели бы на площадку, которую мы больше не обновляем. Сам он
   об этом не узнает никогда. */
import { reporter } from './boot.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/claude/apk/www';
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8',
                '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };

const R = reporter();
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

/* Настоящий адрес, а не подделка через localhost: полоса завязана на имя
   узла, и проверять её на localhost значило бы проверять не то. Страницы
   отдаём с диска, никуда не ходя. */
async function openAt(host){
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 414, height: 896 } });
  /* Язык закрепляем: проверки написаны по-русски, а приложение подстраивается
     под язык браузера и по умолчанию показало бы английский. */
  await ctx.addInitScript(() => { try{ localStorage.setItem('tavarov.lang.v1', 'ru'); }catch(e){} });
  await ctx.route('https://' + host + '/**', route => {
    const url = new globalThis.URL(route.request().url());
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      return route.fulfill({ status: 404, body: 'нет такого файла' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream',
                    body: fs.readFileSync(file) });
  });
  /* Узлы сети и котировки из проверки недоступны — отвечаем отказом сразу,
     чтобы не ждать таймаутов по пятнадцать секунд на каждом шаге. */
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('https://' + host + '/')) return route.fallback();
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('https://' + host + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderWalletState === 'function');
  return { ctx, page, errors };
}

const visible = (page, id) => page.evaluate(i => {
  const e = document.getElementById(i);
  return !!e && !e.classList.contains('hidden');
}, id);

// ---------- старый адрес, кошелька в браузере нет ----------
{
  const { ctx, page } = await openAt('tavarov-wallet.pages.dev');
  await page.evaluate(() => renderWalletState());
  R.ok('на пустом браузере полосы про переезд нет', !(await visible(page, 'moveBanner')));

  /* Теперь в браузере есть кошелёк — ровно случай человека, переехавшего
     с нами. Хранилище трогаем напрямую: заводить кошелёк целиком здесь
     незачем, проверяется не он, а условие показа. */
  await page.evaluate(() => { localStorage.setItem(VAULT_KEY, 'какая-то зашифрованная строка');
                              renderWalletState(); });
  R.ok('НА СТАРОМ АДРЕСЕ С КОШЕЛЬКОМ ПОЛОСА ПОЯВЛЯЕТСЯ', await visible(page, 'moveBanner'));

  const text = await page.textContent('#moveBanner');
  R.ok('в ней сказано, что адрес сменился', /переехал/i.test(text), text.slice(0, 60));
  R.ok('и что кошелёк остался здесь, а не пропал',
    /хранится именно здесь|остался/i.test(text), text.slice(0, 140));
  R.ok('И НАПИСАН ПОРЯДОК: КОПИЯ ЗДЕСЬ — ВОССТАНОВЛЕНИЕ ТАМ',
    /Резервная копия/i.test(text) && /[Вв]осстанов/i.test(text), text.slice(0, 220));
  R.ok('и прямо сказано не заводить кошелёк заново',
    /заново не нужно|не создавайте/i.test(text), text.slice(-90));

  const href = await page.getAttribute('#moveLink', 'href');
  R.ok('ССЫЛКА ВЕДЁТ НА НОВЫЙ АДРЕС', href === 'https://wallet.tavarov.com', String(href));

  /* Приложение на старом адресе обязано продолжать работать: человеку надо
     войти и сделать копию. Полоса — это подсказка, а не заглушка. */
  R.ok('приложение при этом работает, а не заменено заглушкой',
    await page.evaluate(() => !!document.getElementById('scroller')
                           && typeof openBackupSheet === 'function'));
  await ctx.close();
}

// ---------- новый адрес: полосы нет никогда ----------
{
  const { ctx, page } = await openAt('wallet.tavarov.com');
  await page.evaluate(() => { localStorage.setItem(VAULT_KEY, 'какая-то зашифрованная строка');
                              renderWalletState(); });
  R.ok('НА НОВОМ АДРЕСЕ ПОЛОСЫ ПРО ПЕРЕЕЗД НЕТ', !(await visible(page, 'moveBanner')));

  // ---------- адрес для счетов ----------
  /* Прежнее значение по умолчанию заменяем сами. Продавец о переезде не
     знает и ссылки свои не перепроверит. */
  const healed = await page.evaluate(() => {
    localStorage.setItem(SITE_KEY, 'https://tavarov-wallet.pages.dev');
    const after = siteBase();
    return { after, stored: localStorage.getItem(SITE_KEY) };
  });
  R.ok('СТАРЫЙ АДРЕС ДЛЯ СЧЕТОВ ЗАМЕНЯЕТСЯ НОВЫМ САМ',
    healed.after === 'https://wallet.tavarov.com', healed.after);
  R.ok('и в памяти он не остаётся', healed.stored === null, String(healed.stored));

  const netlify = await page.evaluate(() => {
    localStorage.setItem(SITE_KEY, 'https://tavarov-wallet.netlify.app');
    return siteBase();
  });
  R.ok('и прежний адрес на другом хостинге тоже',
    netlify === 'https://wallet.tavarov.com', netlify);

  /* А вот вписанное руками трогать нельзя: свой домен человек выбрал сам. */
  const own = await page.evaluate(() => {
    localStorage.setItem(SITE_KEY, 'https://shop.example.com');
    return { base: siteBase(), stored: localStorage.getItem(SITE_KEY) };
  });
  R.ok('А ЧУЖОЙ АДРЕС, ВПИСАННЫЙ РУКАМИ, ОСТАЁТСЯ КАК БЫЛ',
    own.base === 'https://shop.example.com' && own.stored === 'https://shop.example.com',
    own.base);

  /* Ссылка на оплату, которую касса даёт покупателю, обязана вести на тот
     же адрес: она и есть то, ради чего всё это. */
  const link = await page.evaluate(() => {
    localStorage.removeItem(SITE_KEY);
    return buildWebInvoice({ merchant: '0x2222222222222222222222222222222222222222',
                             amt: '10', cur: 'USDT', net: 'bnb', order: 'заказ-1' });
  });
  R.ok('ССЫЛКА НА ОПЛАТУ ВЕДЁТ НА НОВЫЙ АДРЕС',
    String(link).startsWith('https://wallet.tavarov.com/pay.html'), String(link).slice(0, 70));
  await ctx.close();
}

// ---------- на своём компьютере полосы тоже нет ----------
/* Разработка и проверки идут на localhost. Полоса, вылезающая там,
   попадала бы и на снимки экрана для витрины. */
{
  const { ctx, page } = await openAt('localhost.tavarov.test');
  await page.evaluate(() => { localStorage.setItem(VAULT_KEY, 'строка'); renderWalletState(); });
  R.ok('на постороннем адресе полосы нет', !(await visible(page, 'moveBanner')));
  await ctx.close();
}

const good = R.done([]);
await browser.close();
process.exit(good ? 0 : 1);
