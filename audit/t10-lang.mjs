/* Языки: переключение, запоминание, определение по языку телефона. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';
import { chromium } from 'playwright';

const srv = await start(8555);
const R = reporter();

/* lang:false — стенд НЕ закрепляет язык: здесь мы как раз проверяем,
   что приложение выбирает и запоминает его само. */
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555', lang: false });

// ---------- по умолчанию русский (браузер стенда — en-US, но проверим сам механизм) ----------
R.ok('словарь загружен', await page.evaluate(() => typeof I18N === 'object' && !!I18N.ru));
const sizes = await page.evaluate(() => ({ ru: Object.keys(I18N.ru).length, en: Object.keys(I18N.en).length }));
R.ok('в русском словаре есть надписи', sizes.ru > 500, 'ключей ' + sizes.ru);
R.ok('английский переведён целиком', sizes.en === sizes.ru, sizes.en + ' из ' + sizes.ru);

// ---------- переключаем на русский и смотрим ----------
await page.evaluate(() => setLang('ru'));
await page.waitForTimeout(400);
R.ok('по-русски вкладка называется «Кошелёк»',
  (await page.evaluate(() => document.body.innerText)).includes('Кошелёк'));

// ---------- английский ----------
await page.evaluate(() => setLang('en'));
await page.waitForTimeout(600);
const en = await page.evaluate(() => document.body.innerText);
R.ok('нижние вкладки переведены', en.includes('Wallet') && en.includes('Settings') && en.includes('Cashback'), '');
R.ok('на экране не осталось русских слов из словаря',
  !/Кошелёк|Настройки|Кешбэк|Оплата|История/.test(en), en.slice(0, 120).replace(/\n/g, ' '));
R.ok('язык страницы помечен как en',
  (await page.evaluate(() => document.documentElement.lang)) === 'en');

await page.evaluate(() => { tab = 'settings'; renderWalletState(); });
await page.waitForTimeout(500);
const set = await page.evaluate(() => document.body.innerText);
const setLow = set.toLowerCase();
R.ok('настройки переведены', setLow.includes('security') && setLow.includes('mode'),
  setLow.slice(0, 90).replace(/\n/g, ' '));
R.ok('переключатель языков показывает все пять',
  await page.evaluate(() => document.querySelectorAll('#langPicker .seg').length) === 5);
await page.screenshot({ path: '/home/claude/apk/audit/shots/язык-английский.png', fullPage: true });

// ---------- сообщения из кода тоже переведены ----------
const msg = await page.evaluate(() => t('k46cb369e'));      // «Неверный ключ»
R.ok('строки из кода берутся из словаря', msg === 'Invalid key', msg);
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.waitForTimeout(300);
R.ok('подсказка в поле адреса переведена',
  (await page.evaluate(() => document.getElementById('sendTo').placeholder)).includes('address'),
  await page.evaluate(() => document.getElementById('sendTo').placeholder));

// ---------- выбор запоминается ----------
await page.reload();
await page.waitForFunction(() => typeof renderWalletState === 'function');
await page.waitForTimeout(800);
R.ok('после перезагрузки язык остался английским',
  (await page.evaluate(() => lang)) === 'en');

// ---------- новый человек с испанским телефоном ----------
const b2 = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const c2 = await b2.newContext({ locale: 'es-ES', viewport:{width:414,height:896} });
const p2 = await c2.newPage();
const err2 = [];
p2.on('pageerror', e => err2.push('pageerror: ' + e.message));
await p2.goto('http://localhost:8099/index.html');
await p2.waitForFunction(() => typeof renderWalletState === 'function');
await p2.waitForTimeout(500);
R.ok('телефон на испанском — приложение выбрало испанский само',
  (await p2.evaluate(() => lang)) === 'es', await p2.evaluate(() => lang));

// незнакомый язык — берём английский, а не русский
const c3 = await b2.newContext({ locale: 'ja-JP', viewport:{width:414,height:896} });
const p3 = await c3.newPage();
p3.on('pageerror', e => err2.push('pageerror: ' + e.message));
await p3.goto('http://localhost:8099/index.html');
await p3.waitForFunction(() => typeof renderWalletState === 'function');
await p3.waitForTimeout(500);
R.ok('незнакомый язык телефона — открывается английский',
  (await p3.evaluate(() => lang)) === 'en', await p3.evaluate(() => lang));

const clean = [...errors, ...err2].filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); await b2.close(); srv.close();
process.exit(good ? 0 : 1);
