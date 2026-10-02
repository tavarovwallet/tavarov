/* Кнопка «Назад»: стрелка в шапке, жест браузера и вызов из Android.
   Шаг назад: окно → подэкран → вкладка → главный; с главного — ничего
   (Android тогда сворачивает приложение). */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';
await start(8581);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', rpc: 'http://localhost:8581' });
const vis = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && e.offsetParent !== null; }, sel);
const st = () => page.evaluate(() => ({ tab, tokenView, payMode }));
const wait = ms => page.waitForTimeout(ms);

R.ok('на главном стрелки нет', !(await vis('#navBack')));
R.ok('с главного назад некуда (Android свернёт)', (await page.evaluate(() => window.nonGoBack())) === false);

await page.evaluate(() => setTab('settings')); await wait(200);
R.ok('на «Настройках» стрелка есть', await vis('#navBack'));
await page.click('#navBack'); await wait(250);
R.ok('стрелка вернула на «Кошелёк»', (await st()).tab === 'wallet');
R.ok('и спряталась', !(await vis('#navBack')));

await page.evaluate(() => setTab('pay')); await wait(150);
await page.evaluate(() => setPayMode('receive')); await wait(150);
await page.click('#navBack'); await wait(250);
let s = await st();
R.ok('из дела — к списку дел', s.tab === 'pay' && !s.payMode, JSON.stringify(s));
await page.click('#navBack'); await wait(250);
R.ok('со списка дел — на «Кошелёк»', (await st()).tab === 'wallet');

await page.evaluate(() => openToken('native')); await wait(250);
R.ok('в монете стрелка есть', await vis('#navBack'));
R.ok('Android: шаг обработан', (await page.evaluate(() => window.nonGoBack())) === true);
R.ok('из монеты — на главный', (await st()).tokenView === null);

await page.evaluate(() => setTab('history')); await wait(150);
await page.evaluate(() => openTokensSheet()); await wait(250);
R.ok('окно открыто', await page.evaluate(() => !document.getElementById('tokensModal').classList.contains('hidden')));
await page.goBack(); await wait(400);
R.ok('жест браузера закрыл окно', await page.evaluate(() => document.getElementById('tokensModal').classList.contains('hidden')));
R.ok('и остались на вкладке', (await st()).tab === 'history');
await page.goBack(); await wait(400);
R.ok('второй жест — на «Кошелёк»', (await st()).tab === 'wallet');
R.ok('страница не ушла', page.url().includes('index.html'));

for (const L of ['en','es','tr','pt']){
  const v = await page.evaluate(L => I18N[L].k2b0b0225, L);
  R.ok('перевод «Назад» ' + L, !!v && v !== 'Назад', v);
}
await page.evaluate(() => setTab('settings')); await wait(150);
await page.screenshot({ path: '/tmp/claude-0/back-settings.png' });
await page.evaluate(() => { setTab('pay'); setPayMode('receive'); }); await wait(250);
await page.screenshot({ path: '/tmp/claude-0/back-pay.png' });
R.done(errors);
await browser.close();
process.exit(0);
