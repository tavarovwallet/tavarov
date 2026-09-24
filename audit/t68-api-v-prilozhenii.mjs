/* API в приложении: «Приём оплаты на сайте» → «Открыть кабинет».

   Проверяется, что вход в кабинет подписан ЭТИМ кошельком и ровно тем
   текстом, который ждёт сервер (иначе кабинет не откроется), что без
   подтверждения паролем подписи нет, и что подпись уходит на страницу
   кабинета после решётки — не в адрес, который попадает в журналы. */
import { createRequire } from 'node:module';
import { boot, reporter, answerConfirm } from './boot.mjs';
import { start } from './mocknode.mjs';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const API = await import('/home/claude/apk/functions/api/v1/[[path]].js');

await start(8563);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8563' });
const me = await page.evaluate(() => wallet.evm.address);
await page.route('**/api/donate**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
const vis = sel => page.evaluate(s => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden') && !el.closest('.hidden'); }, sel);

await page.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; tab = 'wallet'; setTab('pay'); });
await page.waitForTimeout(600);
R.ok('НА ВКЛАДКЕ «ОПЛАТА» ЕСТЬ «ПРИЁМ ОПЛАТЫ НА САЙТЕ (API)»', await vis('#apiBox'));
R.ok('и кнопка «Открыть кабинет»', /Открыть кабинет/.test(await page.textContent('#apiBox')));

/* Отказ от подтверждения — ничего не подписано и не открыто. */
page.evaluate(() => openDevCabinet());
await page.waitForFunction(() => !document.getElementById('confirmModal').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
R.ok('ПЕРЕД ВХОДОМ СПРАШИВАЕТ ПОДТВЕРЖДЕНИЕ, как перевод', await page.evaluate(() => !document.getElementById('confirmModal').classList.contains('hidden')));
await page.evaluate(() => { if (typeof confirmCancel === 'function') confirmCancel(); else if (confirmResolve){ const r = confirmResolve; confirmResolve = null; document.getElementById('confirmModal').classList.add('hidden'); r(false); } });
await page.waitForTimeout(400);
R.ok('отказался — кабинет не открыт', (await page.evaluate(() => window.__opened.length)) === 0);

/* Подтвердил. */
page.evaluate(() => openDevCabinet());
await answerConfirm(page);
await page.waitForFunction(() => window.__opened.length > 0, null, { timeout: 8000 }).catch(() => {});
const url = await page.evaluate(() => window.__opened[0] || '');
R.ok('ОТКРЫТ КАБИНЕТ wallet.tavarov.com/dev', url.startsWith('https://wallet.tavarov.com/dev#login='), url.slice(0, 60));
R.ok('подпись — после решётки, в журнал запросов не попадёт', url.indexOf('#') > 0 && !url.split('#')[0].includes('0x'));
const m = url.match(/#login=(0x[0-9a-fA-F]{40})\.(\d+)\.(0x[0-9a-fA-F]{130})$/);
R.ok('в ссылке адрес, время и подпись', !!m);
if (m){
  R.ok('адрес — этот кошелёк', m[1].toLowerCase() === me.toLowerCase());
  R.ok('время свежее', Math.abs(Date.now() / 1000 - Number(m[2])) < 60);
  const signer = E.utils.verifyMessage(API.loginText(m[1], Number(m[2])), m[3]);
  R.ok('ПОДПИСАН ЭТИМ КОШЕЛЬКОМ И РОВНО ТЕМ ТЕКСТОМ, КОТОРЫЙ ЖДЁТ СЕРВЕР', signer.toLowerCase() === me.toLowerCase(), signer);
}

await page.evaluate(() => { network = 'tron'; renderDonBox(); });
R.ok('В ДРУГОЙ СЕТИ РАЗДЕЛ СКРЫТ', !(await vis('#apiBox')));
await page.evaluate(() => { network = 'bnb'; });

const own = errors.filter(e => !/Failed to load resource|ERR_|net::|503/.test(e));
R.ok('НИ ОДНОЙ ОШИБКИ В КОДЕ СТРАНИЦЫ', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
