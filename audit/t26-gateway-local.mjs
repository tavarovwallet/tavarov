/* Шлюз, поднятый на своём компьютере.

   Продавцу мало услышать «шлюз работает» — ему надо увидеть это самому, до
   того как страницу оплаты покажут покупателям. Выкладывать ради проверки
   нельзя: ошибку тогда первыми увидят чужие люди, а не мы.

   Поэтому у шлюза есть местный запуск: тот же код функций, та же страница
   оплаты, но всё на своём компьютере, а в блокчейн смотрит настоящий.
   Здесь проверяется сам этот запуск — что он отдаёт страницы, отвечает на
   вопрос «оплачено ли», отличает чужой счёт от своего и, главное, не выдаёт
   молчание узла за «не оплачено»: человек, только что заплативший, не должен
   увидеть «не оплачено» и заплатить второй раз.

   Настоящую сеть из этой машины не достать, поэтому цепочку подменяем
   поддельным узлом — но событие оплаты в нём закодировано настоящим ABI. */
import { start, state, paidLog, ADDR } from '/home/claude/apk/audit/mocknode.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const e = require('/home/claude/apk/www/lib/ethers.umd.min.js'); const E = e.ethers || e;

const srv = await start(8556);
const MERCH = '0x9bd90768c17f64b2c33d76bd9d4dd9df4755b77c';
const INV = '0x' + 'a1'.repeat(32);
state.logs = [paidLog({ merchant: MERCH, payer: '0x1111111111111111111111111111111111111111',
  token: ADDR.usdt, toMerchant: E.utils.parseUnits('0.0198', 18),
  fee: E.utils.parseUnits('0.0002', 18), reward: E.utils.parseUnits('0.02', 18),
  invoice: INV, block: 4000 })];

process.env.TAVAROV_PAY = ADDR.pay;
process.env.TAVAROV_RPC = 'http://localhost:8556';
process.env.PORT = '8788';
await import('/home/claude/apk/gateway/проверка-локально.mjs');
await new Promise(r => setTimeout(r, 700));

const q = (h) => 'http://localhost:8788/api/status?net=bnb&m=' + MERCH + '&h=' + h;
const ok  = await (await fetch(q(INV))).json();
const no  = await (await fetch(q('0x' + 'bb'.repeat(32)))).json();
const bad = await fetch(q('мусор'));
const page = await fetch('http://localhost:8788/');
const payPage = await fetch('http://localhost:8788/pay.html');
const missing = await fetch('http://localhost:8788/нет-такого');

const R = [];
const t = (name, cond, detail) => { R.push(cond); console.log((cond ? 'OK   ' : 'ПРОВАЛ ') + name + (detail ? '  [' + detail + ']' : '')); };
t('витрина отдаётся', page.status === 200 && (await page.text()).includes('Оформление заказа'));
t('страница счёта отдаётся', payPage.status === 200);
t('несуществующая страница — 404, а не выдача чужого файла', missing.status === 404);
t('ОПЛАЧЕННЫЙ СЧЁТ ПОКАЗАН КАК ОПЛАЧЕННЫЙ', ok.paid === true, JSON.stringify(ok).slice(0, 90));
t('в ответе номер операции', /^0x/.test(String(ok.tx || '')), String(ok.tx).slice(0, 20));
t('в ответе сумма, которую заплатил покупатель', String(ok.amount).length > 0, String(ok.amount));
t('чужой номер счёта оплаченным не считается', no.paid === false, JSON.stringify(no));
t('мусор в номере счёта отвергнут', bad.status === 400, 'код ' + bad.status);

/* Узел молчит — это НЕ «не оплачено». Иначе человек, который только что
   заплатил, увидит «не оплачено» и заплатит второй раз. */
srv.close();
await new Promise(r => setTimeout(r, 300));
const down = await fetch(q(INV));
const downBody = await down.json();
t('МОЛЧАНИЕ УЗЛА НЕ ВЫДАЁТСЯ ЗА «НЕ ОПЛАЧЕНО»',
  downBody.unknown === true && downBody.paid === false, JSON.stringify(downBody).slice(0, 80));

/* ===================== Витрина глазами продавца =====================

   Продавец заходит попробовать. Страница обещает: «чтобы продавцу было что
   попробовать до того, как он полезет в свой сайт». Значит проверять надо
   именно это обещание: без правки файлов, мышкой, до конца — до страницы
   счёта с кодом. Раньше кнопка на этом месте отвечала «впишите свой адрес в
   переменную SHOP в этом файле», то есть обещание нарушала. */
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const shopPage = await (await browser.newContext({ locale: 'ru-RU', viewport: { width: 900, height: 1000 } })).newPage();
const pageErrors = [];
shopPage.on('pageerror', e => pageErrors.push(String(e.message)));
const said = [];
shopPage.on('dialog', d => { said.push(d.message()); d.accept().catch(() => {}); });

await shopPage.goto('http://localhost:8788/', { waitUntil: 'load' });
t('витрина открывается и настройки на месте', await shopPage.isVisible('#shopWallet'));

/* Пустой адрес: сказать по-человечески, а не увести на страницу оплаты, где
   человек уже думает, что платит. */
await shopPage.fill('#shopWallet', '');
await shopPage.click('#tavarovBtn');
await shopPage.waitForTimeout(400);
t('БЕЗ АДРЕСА ПРОДАВЦА НА ОПЛАТУ НЕ ПУСКАЕТ',
  shopPage.url().indexOf('/pay.html') < 0 && await shopPage.isVisible('#setupWarn'),
  shopPage.url());
t('и объяснено словами, а не «впишите переменную в файле»',
  /Впишите адрес кошелька продавца/.test(await shopPage.textContent('#setupWarn')),
  (await shopPage.textContent('#setupWarn')).slice(0, 60));

await shopPage.fill('#shopWallet', MERCH);
await shopPage.fill('#shopAmount', '0');
await shopPage.click('#tavarovBtn');
await shopPage.waitForTimeout(400);
t('и с нулевой суммой тоже не пускает',
  shopPage.url().indexOf('/pay.html') < 0 && /сумму больше нуля/.test(await shopPage.textContent('#setupWarn')));

await shopPage.fill('#shopAmount', '0.02');
await shopPage.waitForTimeout(200);
t('сумма в корзине живая, а не вшитые 12.34',
  (await shopPage.textContent('#totalPrice')).indexOf('0.02') >= 0, await shopPage.textContent('#totalPrice'));

await shopPage.click('#tavarovBtn');
await shopPage.waitForURL(/pay\.html/, { timeout: 8000 }).catch(() => {});
t('КНОПКА УВОДИТ НА СТРАНИЦУ СЧЁТА', shopPage.url().indexOf('/pay.html#p=') > 0, shopPage.url().slice(0, 60));

await shopPage.waitForTimeout(2500);
const shown = await shopPage.evaluate(() => ({
  text: document.body.innerText,
  canvases: document.querySelectorAll('canvas, img').length
}));
t('счёт показан, а не «испорченный счёт»', !/испорчен|не показыва/i.test(shown.text), shown.text.slice(0, 70).replace(/\n/g, ' | '));
t('в счёте наша сумма', shown.text.indexOf('0.02') >= 0, shown.text.slice(0, 90).replace(/\n/g, ' | '));
t('КОД ДЛЯ ОПЛАТЫ НАРИСОВАН', shown.canvases > 0, 'картинок ' + shown.canvases);
t('страница счёта не падает с ошибкой', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 90));

await browser.close();

/* ===================== Второй запуск =====================

   Человек забыл, что шлюз уже работает, и запустил его второй раз. Раньше
   на это вываливалась стена английского текста про EADDRINUSE — а это не
   поломка, а самая обычная вещь. Шлюз обязан сказать по-русски, что он уже
   работает, и уйти, оставив первый живым. */
import { spawn } from 'node:child_process';
const second = await new Promise(res => {
  const out = [];
  const p = spawn(process.execPath, ['/home/claude/apk/gateway/проверка-локально.mjs'],
    { env: { ...process.env, PORT: '8788' } });
  p.stdout.on('data', d => out.push(String(d)));
  p.stderr.on('data', d => out.push(String(d)));
  p.on('close', code => res({ code, text: out.join('') }));
  setTimeout(() => { try{ p.kill(); }catch(e){} }, 15000);
});
t('ВТОРОЙ ЗАПУСК НЕ ПУГАЕТ ОШИБКОЙ, А ОБЪЯСНЯЕТ',
  /УЖЕ РАБОТАЕТ/.test(second.text) && !/EADDRINUSE/.test(second.text),
  second.text.split('\n').filter(Boolean)[0] || 'пусто');
t('и уходит спокойно, оставив первый работать', second.code === 0, 'код ' + second.code);

console.log('\n--- ' + R.filter(Boolean).length + ' из ' + R.length + ' ---');
process.exit(R.every(Boolean) ? 0 : 1);
