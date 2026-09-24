/* Донаты в приложении: ссылка для описания канала и список пришедших.

   Проверяется, что ссылка ведёт ровно на этот кошелёк (по имени, если оно
   есть, иначе по адресу), что в тестовой сети она помечена тестовой, и что
   чужой текст из сообщений показывается только текстом — никакой разметки. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

await start(8562);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8562' });
const me = await page.evaluate(() => wallet.evm.address);

let reply = { items: [] }, asked = [];
await page.route('**/api/donate**', route => {
  asked.push(route.request().url());
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
});
const vis = sel => page.evaluate(s => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden') && !el.closest('.hidden'); }, sel);

await page.evaluate(() => { tab = 'wallet'; setTab('pay'); });
await page.waitForTimeout(800);
R.ok('НА ВКЛАДКЕ «ОПЛАТА» ЕСТЬ РАЗДЕЛ ДОНАТОВ', await vis('#donBox'));
const link = await page.textContent('#donLink');
R.ok('ССЫЛКА — НА ЭТОТ КОШЕЛЁК', link === 'https://wallet.tavarov.com/d/' + me + '?net=bnbTestnet', link);
R.ok('имени нет — предложено занять, чтобы ссылка стала короткой', await vis('#donNoName'));
R.ok('список спрошен у сервера для этого кошелька и этой сети', asked.some(u => u.includes('to=' + me) && u.includes('net=bnbTestnet')), asked[0]);
R.ok('пусто — так и сказано', /Пока донатов нет/.test(await page.textContent('#donList')));

/* Имя есть — ссылка короткая. */
await page.evaluate(m => { myName = 'streamer'; myNameFor = m; renderDonBox(); }, me);
R.ok('С ИМЕНЕМ ССЫЛКА КОРОТКАЯ: /d/streamer', (await page.textContent('#donLink')) === 'https://wallet.tavarov.com/d/streamer?net=bnbTestnet', await page.textContent('#donLink'));
R.ok('и предложение занять имя исчезло', !(await vis('#donNoName')));
/* Имя от другого кошелька (переключили кошелёк) — не наше. */
await page.evaluate(() => { myNameFor = '0x0000000000000000000000000000000000000001'; renderDonBox(); });
R.ok('ЧУЖОЕ ИМЯ В ССЫЛКУ НЕ ПОПАДАЕТ', (await page.textContent('#donLink')).includes('/d/' + me));

/* Список. */
reply = { items: [
  { h: '0x' + '1'.repeat(64), nick: 'Ваня', msg: 'Спасибо за стрим!', ts: Date.now() - 120000, amount: '5', cur: 'USDT', payer: '0x3333333333333333333333333333333333333333' },
  { h: '0x' + '2'.repeat(64), nick: '<b>x</b>', msg: '<img src=x onerror="window.__pwned=1">', ts: Date.now() - 7200000, amount: '2.5', cur: 'USDC', payer: '0x4444444444444444444444444444444444444444' }
] };
await page.evaluate(() => loadDonations(true));
await page.waitForTimeout(600);
const list = await page.textContent('#donList');
R.ok('ДОНАТЫ В СПИСКЕ: СУММА, НИК, ТЕКСТ', /\+5 USDT/.test(list) && /Ваня/.test(list) && /Спасибо за стрим!/.test(list), list.slice(0, 120));
R.ok('время по-человечески', /мин назад/.test(list) && /ч назад/.test(list));
R.ok('ЧУЖАЯ РАЗМЕТКА ПОКАЗАНА ТЕКСТОМ, А НЕ ВЫПОЛНЕНА', list.includes('<img src=x') && !(await page.evaluate(() => window.__pwned)) &&
  (await page.$$eval('#donList img', x => x.length)) === 0);

/* Сервер лёг. */
await page.unroute('**/api/donate**');
await page.route('**/api/donate**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"storage is not configured"}' }));
await page.evaluate(() => loadDonations(true)); await page.waitForTimeout(600);
R.ok('СЕРВЕР НЕ ОТВЕТИЛ — СКАЗАНО СЛОВАМИ', /Не удалось загрузить донаты/.test(await page.textContent('#donList')), await page.textContent('#donList'));

/* Не BNB — раздела нет. */
await page.evaluate(() => { network = 'tron'; renderDonBox(); });
R.ok('В ДРУГОЙ СЕТИ РАЗДЕЛ СКРЫТ', !(await page.evaluate(() => !document.getElementById('donBox').classList.contains('hidden'))));
await page.evaluate(() => { network = 'bnb'; });

const own = errors.filter(e => !/Failed to load resource|ERR_|net::|503/.test(e));
R.ok('НИ ОДНОЙ ОШИБКИ В КОДЕ СТРАНИЦЫ', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
