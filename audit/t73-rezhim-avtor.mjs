/* Режим «Автор» в приложении.

   Проверяется: третий режим есть при первом запуске и в настройках; у
   автора на «Оплате» — донаты первыми и ничего лишнего, у продавца — API и
   касса без донатов, у покупателя — ни того ни другого; итоги считаются по
   местному времени; приветствие и цель подписаны этим кошельком РОВНО тем
   текстом, который проверяет сервер. */
import { createRequire } from 'node:module';
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const DON = await import('/home/claude/apk/functions/api/donate.js');

await start(8565);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'author', testnet: true, rpc: 'http://localhost:8565' });
const me = await page.evaluate(() => wallet.evm.address);
const vis = sel => page.evaluate(s => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden') && !el.closest('.hidden'); }, sel);

/* сервер донатов — поддельный, но отвечает тем же, что настоящий */
const nowH = Math.floor(Date.now() / 3600000);
let profile = { greeting: 'Спасибо, что вы здесь!', goal: { title: 'Новый микрофон', target: '300', raised: '120', since: 1 } };
const posts = [];
await page.route('**/api/donate**', async route => {
  const req = route.request();
  const u = new URL(req.url());
  let body = { items: [] };
  if (req.method() === 'POST'){
    const b = JSON.parse(req.postData());
    posts.push(b);
    if (b.goal) profile = { greeting: b.greeting, goal: { title: b.goal, target: b.target, raised: b.restart ? '0' : profile.goal ? profile.goal.raised : '0', since: 2 } };
    else profile = { greeting: b.greeting, goal: null };
    body = { ok: true, profile };
  } else if (u.searchParams.get('stats') === '1'){
    body = { stats: { hours: { [nowH]: 500 + 2000, [nowH - 72]: 1000, [nowH - 480]: 700, [nowH - 1000]: 99999 }, count: 4 } };
  } else if (u.searchParams.get('profile') === '1'){
    body = { profile };
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

R.ok('ПРИ ПЕРВОМ ЗАПУСКЕ — ТРИ РЕЖИМА: продавец, покупатель, автор', (await page.$$eval('#roleCard button.row', b => b.length)) === 3 &&
  /Я автор/.test(await page.textContent('#roleCard')));
R.ok('выбран «Автор»', await page.evaluate(() => userRole) === 'author');

await page.evaluate(() => { window.__opened = []; window.open = () => { const w = { opener: 'WALLET', location: {} }; Object.defineProperty(w.location, 'href', { set(v){ window.__opened.push(v); window.__lastWin = w; } }); return w; }; tab = 'wallet'; setTab('pay'); });
await page.waitForTimeout(900);
R.ok('У АВТОРА НА «ОПЛАТЕ» — ДОНАТЫ', await vis('#donBox'));
R.ok('донаты — первыми, выше «Что нужно сделать»', await page.evaluate(() => {
  const d = document.getElementById('donBox'), h = document.getElementById('hubSend');
  return !!(d.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
}));
R.ok('у автора нет «Оплатить покупку» и нет API для сайта', !(await vis('#hubBuy')) && !(await vis('#apiBox')));
R.ok('«Отправить» и «Принять» остались (вывести на биржу, принять перевод)', await vis('#hubSend') && await vis('#hubReceive'));

R.ok('СОБРАНО СЕГОДНЯ 25 $', (await page.textContent('#donStatDay')).replace(/\s/g, '') === '25$', await page.textContent('#donStatDay'));
R.ok('за 7 дней 35 $', (await page.textContent('#donStatWeek')).replace(/\s/g, '') === '35$', await page.textContent('#donStatWeek'));
R.ok('за 30 дней 42 $ (старше месяца — не в счёт)', (await page.textContent('#donStatMonth')).replace(/\s/g, '') === '42$', await page.textContent('#donStatMonth'));

R.ok('приветствие и цель подтянуты с сервера', (await page.inputValue('#donGreet')) === 'Спасибо, что вы здесь!' &&
  (await page.inputValue('#donGoalTitle')) === 'Новый микрофон' && (await page.inputValue('#donGoalSum')) === '300');
R.ok('прогресс цели: 120 / 300 $ · 40%', /120 \/ 300 \$ · 40%/.test(await page.textContent('#donGoalText')), await page.textContent('#donGoalText'));
R.ok('есть «Начать сбор заново»', await vis('#donRestartBtn'));
const goalLink = await page.textContent('#obsGoalLink');
R.ok('ССЫЛКА НА ПОЛОСУ ЦЕЛИ ДЛЯ OBS — ЭТОТ КОШЕЛЁК, goal=1', goalLink.startsWith('https://wallet.tavarov.com/alert?to=' + me.toLowerCase()) && goalLink.includes('&goal=1'), goalLink);

/* цель без суммы — не отправляем */
await page.fill('#donGoalSum', '');
await page.evaluate(() => saveDonProfile(false));
await page.waitForTimeout(300);
R.ok('ЦЕЛЬ БЕЗ СУММЫ — ОБЪЯСНЕНО, НА СЕРВЕР НЕ УШЛО', posts.length === 0 && /название и сумма/.test(await page.textContent('#donProfMsg')));

/* сохранить */
await page.fill('#donGreet', 'Привет, чат! Каждый донат — в новый выпуск');
await page.fill('#donGoalTitle', 'Свет для стрима');
await page.fill('#donGoalSum', '450');
await page.evaluate(() => saveDonProfile(false));
await page.waitForFunction(() => /Сохранено/.test(document.getElementById('donProfMsg').textContent), null, { timeout: 8000 }).catch(() => {});
const b = posts[0] || {};
R.ok('сохранено — сказано', /Сохранено/.test(await page.textContent('#donProfMsg')));
R.ok('на сервер ушли приветствие, цель и сумма', b.action === 'profile' && b.greeting === 'Привет, чат! Каждый донат — в новый выпуск' && b.goal === 'Свет для стрима' && b.target === '450' && b.net === 'bnbTestnet');
let signer = '';
try{ signer = E.utils.verifyMessage(DON.profileText({ to: b.to, net: b.net, greeting: b.greeting, goal: b.goal, target: String(b.target), restart: !!b.restart, ts: b.ts }), b.sig); } catch(e){}
R.ok('ПОДПИСАНО ЭТИМ КОШЕЛЬКОМ И РОВНО ТЕМ ТЕКСТОМ, КОТОРЫЙ ПРОВЕРЯЕТ СЕРВЕР', signer.toLowerCase() === me.toLowerCase(), signer);

/* начать заново — с вопросом */
let asked = '';
page.once('dialog', d => { asked = d.message(); d.accept(); });
await page.evaluate(() => saveDonProfile(true));
await page.waitForTimeout(1200);
R.ok('«НАЧАТЬ ЗАНОВО» — СНАЧАЛА СПРАШИВАЕТ', /с нуля/.test(asked), asked.slice(0, 60));
R.ok('и уходит с restart', posts[1] && posts[1].restart === true);

await page.evaluate(() => openDonPage());
R.ok('«Открыть мою страницу доната» — ссылка на донаты этого кошелька', (await page.evaluate(() => window.__opened.pop() || '')).includes('/d/' + me), '');

/* другие режимы */
await page.evaluate(() => { setRole('seller'); setTab('pay'); });
await page.waitForTimeout(300);
R.ok('У ПРОДАВЦА: донатов нет, API есть, касса есть', !(await vis('#donBox')) && await vis('#apiBox') && await vis('#hubKassa'));
await page.evaluate(() => { setRole('buyer'); setTab('pay'); });
await page.waitForTimeout(300);
R.ok('У ПОКУПАТЕЛЯ: ни донатов, ни API', !(await vis('#donBox')) && !(await vis('#apiBox')) && await vis('#hubBuy'));
await page.evaluate(() => { setRole('author'); setTab('settings'); });
await page.waitForTimeout(300);
R.ok('в настройках режим «Автор» отмечен', await page.evaluate(() => document.getElementById('segRoleAuthor').classList.contains('active')));

/* английский */
await page.evaluate(() => { setLang('en'); setTab('pay'); });
await page.waitForTimeout(400);
R.ok('по-английски: Creator / Raised / Tip page', /Creator/.test(await page.textContent('#segRoleAuthor')) && /Raised/.test(await page.textContent('#donBox')) && /Tip page/.test(await page.textContent('#donBox')));
await page.evaluate(() => setLang('ru'));

const own = errors.filter(e => !/Failed to load resource|ERR_|net::|503/.test(e));
R.ok('НИ ОДНОЙ ОШИБКИ В КОДЕ СТРАНИЦЫ', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
