/* Оповещения для OBS в приложении: Оплата → Донаты → «Оповещения на стриме».

   Ссылка должна вести на экран оповещений ЭТОГО кошелька, в нужной сети, и
   нести настройки, которые человек выставил. Настройки помнит устройство. */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';

await start(8564);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8564' });
const me = (await page.evaluate(() => wallet.evm.address)).toLowerCase();
await page.route('**/api/donate**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
const vis = sel => page.evaluate(s => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden') && !el.closest('.hidden'); }, sel);

await page.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; tab = 'wallet'; setTab('pay'); });
await page.waitForTimeout(600);
R.ok('В ДОНАТАХ ЕСТЬ «ОПОВЕЩЕНИЯ НА СТРИМЕ (OBS)»', await vis('#obsLink') && /OBS/.test(await page.textContent('#donBox')));
let link = await page.textContent('#obsLink');
R.ok('ССЫЛКА — НА ЭКРАН ОПОВЕЩЕНИЙ ЭТОГО КОШЕЛЬКА, ТЕСТОВАЯ СЕТЬ', link.startsWith('https://wallet.tavarov.com/alert?to=' + me + '&net=bnbTestnet'), link);
R.ok('по умолчанию без лишних настроек', !/min=|&d=|snd=0|msg=0/.test(link), link);

await page.fill('#obsMin', '5');
await page.dispatchEvent('#obsMin', 'change');
await page.selectOption('#obsDur', '12');
await page.evaluate(() => { const s = document.getElementById('obsSnd'); s.checked = false; s.dispatchEvent(new Event('change')); });
await page.evaluate(() => { const s = document.getElementById('obsMsg'); s.checked = false; s.dispatchEvent(new Event('change')); });
link = await page.textContent('#obsLink');
R.ok('НАСТРОЙКИ В ССЫЛКЕ: от 5 $, 12 секунд, без звука, без текста', /&min=5(&|$)/.test(link) && /&d=12(&|$)/.test(link) && /&snd=0/.test(link) && /&msg=0/.test(link), link);

await page.evaluate(() => { document.getElementById('obsMin').value = '0'; renderDonBox(); });
R.ok('НАСТРОЙКИ ЗАПОМНЕНЫ (перерисовка их не сбрасывает)', (await page.inputValue('#obsMin')) === '5' && /&min=5/.test(await page.textContent('#obsLink')));

await page.evaluate(() => obsPreview());
const opened = await page.evaluate(() => window.__opened[0] || '');
R.ok('«ПОСМОТРЕТЬ, КАК ВЫГЛЯДИТ» — тот же экран с примером', opened.startsWith(link) && opened.endsWith('&demo=1'), opened);

await page.evaluate(() => { window.__tn = testnetOn; testnetOn = () => false; renderDonBox(); });
R.ok('в основной сети — без пометки тестовой', !(await page.textContent('#obsLink')).includes('bnbTestnet'), await page.textContent('#obsLink'));
await page.evaluate(() => { testnetOn = window.__tn; renderDonBox(); });
await page.evaluate(() => { network = 'tron'; renderDonBox(); });
R.ok('В ДРУГОЙ СЕТИ РАЗДЕЛ СКРЫТ', !(await vis('#obsLink')));
await page.evaluate(() => { network = 'bnb'; });

const own = errors.filter(e => !/Failed to load resource|ERR_|net::|503/.test(e));
R.ok('НИ ОДНОЙ ОШИБКИ В КОДЕ СТРАНИЦЫ', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
