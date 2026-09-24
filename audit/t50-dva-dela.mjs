/* Экран «Оплата» после упрощения: два дела вместо четырёх.

   Было: «Перевести человеку», «Вывести на биржу», «Получить перевод»,
   «Пополнить с биржи». Первые два — один и тот же перевод на указанный
   адрес, вторые два — один и тот же показ своего адреса. Человек стоял
   и выбирал там, где выбора нет.

   Опасность упрощения ровно одна, и проверяется она здесь в первую
   очередь: раньше предупреждение про СЕТЬ показывалось только тому, кто
   выбрал строчку «Пополнить с биржи». Перепутанная сеть — самая дорогая
   ошибка в кошельке: деньги не приходят никуда и не возвращаются. Теперь
   эта строчка меню исчезла, и предупреждение обязано показываться всегда. */
import { boot, reporter } from './boot.mjs';

const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer' });

await page.evaluate(() => { tab = 'pay'; payMode = null; renderWalletState(); });
await page.waitForTimeout(200);

/* Дела — это строки-кнопки. Строки настроек (оповещения для OBS) делами
   не считаются: их не нажимают, в них переключают. */
const rows = await page.$$eval('#payHub button.row:not(.hidden) .row-title',
  els => els.map(e => e.textContent.trim()));
R.ok('ДЕЛ НА ЭКРАНЕ ОСТАЛОСЬ ДВА-ТРИ, А НЕ ПЯТЬ', rows.length <= 3, rows.join(' | '));
R.ok('есть «Отправить»', rows.includes('Отправить'), rows.join(' | '));
R.ok('есть «Принять»',  rows.includes('Принять'),  rows.join(' | '));
R.ok('строчки про биржу больше нет', !rows.some(r => /бирж/i.test(r)), rows.join(' | '));
R.ok('строчки «Перевести человеку» больше нет', !rows.some(r => /человеку/i.test(r)), rows.join(' | '));

// ---------- отправка ----------
await page.click('#hubSend');
await page.waitForTimeout(300);
R.ok('«Отправить» открывает отправку', await page.evaluate(() => actionTab) === 'send');
R.ok('дело названо «Отправить»', (await page.textContent('#sendTitle')).trim() === 'Отправить',
  (await page.textContent('#sendTitle')).trim());
const sn = (await page.textContent('#sendIntentNote')).trim();
R.ok('В ОТПРАВКЕ СКАЗАНО ПРО СЕТЬ', /сет/i.test(sn), sn.slice(0, 80));

// ---------- приём ----------
await page.evaluate(() => { payMode = null; renderWalletState(); });
await page.waitForTimeout(150);
await page.click('#hubReceive');
await page.waitForTimeout(300);
R.ok('«Принять» открывает приём', await page.evaluate(() => actionTab) === 'receive');
const rn = (await page.textContent('#recvNote')).trim();
R.ok('В ПРИЁМЕ ПРЕДУПРЕЖДЕНИЕ ПРО СЕТЬ ТЕПЕРЬ ВСЕГДА', /сет/i.test(rn), rn.slice(0, 90));
R.ok('и названа именно наша сеть', /BNB Smart Chain/.test(rn), rn.slice(0, 90));
R.ok('адрес показан', /^0x[0-9a-fA-F]{40}$/.test((await page.textContent('#recvAddr')).trim()));

// ---------- старые названия дел не ломаются ----------
for (const [старое, ждём] of [['transfer', 'send'], ['withdraw', 'send'], ['deposit', 'receive']]) {
  await page.evaluate(m => setPayMode(m), старое);
  await page.waitForTimeout(120);
  R.ok('старое дело «' + старое + '» ведёт в «' + ждём + '»',
    await page.evaluate(() => payMode) === ждём, String(await page.evaluate(() => payMode)));
}

// ---------- быстрые кнопки на главном экране ----------
await page.evaluate(() => { tab = 'home'; payMode = null; renderWalletState(); });
await page.waitForTimeout(200);
const quick = await page.$$eval('.quick .quick-item span:last-child', els => els.map(e => e.textContent.trim()));
/* Кнопок стало четыре: к трём добавилась «По имени». Проверка не про их
   число, а про то, ради чего она писалась: чтобы две кнопки не вели в одно
   и то же место. Считать их штуки — значит ломать проверку на каждой
   новой кнопке и ничего при этом не проверять. */
R.ok('ДВУХ КНОПОК ПОД ОДНО ДЕЙСТВИЕ БОЛЬШЕ НЕТ',
  new Set(quick.map(x => x.toLowerCase())).size === quick.length && quick.length >= 3,
  quick.join(' | '));
R.ok('среди быстрых кнопок «Принять» и «Отправить»',
  quick.includes('Принять') && quick.includes('Отправить'), quick.join(' | '));

/* Быстрая кнопка и строчка меню обязаны вести в одно место: два разных
   пути к одному делу — это два места, где можно разойтись. */
await page.evaluate(() => quickAction('withdraw'));
await page.waitForTimeout(250);
R.ok('быстрая «Отправить» ведёт туда же, куда строчка меню',
  await page.evaluate(() => payMode) === 'send', String(await page.evaluate(() => payMode)));
await page.evaluate(() => quickAction('deposit'));
await page.waitForTimeout(250);
R.ok('быстрая «Принять» ведёт туда же, куда строчка меню',
  await page.evaluate(() => payMode) === 'receive', String(await page.evaluate(() => payMode)));

// ---------- переводы ----------
for (const [код, отпр, прин] of [['en', 'Send', 'Receive'], ['es', 'Enviar', 'Recibir'],
                                 ['tr', 'Gönder', 'Al'],    ['pt', 'Enviar', 'Receber']]) {
  await page.evaluate(c => setLang(c), код);
  await page.evaluate(() => { tab = 'pay'; payMode = null; renderWalletState(); });
  await page.waitForTimeout(150);
  const r2 = await page.$$eval('#payHub .row:not(.hidden) .row-title', els => els.map(e => e.textContent.trim()));
  R.ok('на ' + код + ' дела переведены', r2.includes(отпр) && r2.includes(прин), r2.join(' | '));
  const sub = await page.$$eval('#payHub .row:not(.hidden) .row-sub', els => els.map(e => e.textContent.trim()));
  R.ok('и подписи на ' + код + ' не остались по-русски',
    !sub.some(x => /[А-Яа-яЁё]/.test(x)), sub.join(' | ').slice(0, 80));
}
await page.evaluate(() => setLang("ru"));

const good = R.done(errors);
await browser.close();
process.exit(good ? 0 : 1);
