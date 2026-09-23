/* «По имени» — четвёртая быстрая кнопка на главном экране.

   Поле получателя и раньше понимало имя. Кнопка нужна не коду, а человеку:
   тот, кто знает, что у друга есть имя, ищет глазами слово «имя». Не найдя
   его, он решает, что мы так не умеем, и идёт копировать адрес — то есть
   пользуется именами ровно никто.

   Проверяется три вещи, и все три — про честность кнопки:
   она ведёт туда, куда обещает; она не появляется там, где имена не
   работают; и подсказка не остаётся висеть на чужом экране. */
import { boot, reporter } from './boot.mjs';

const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller' });

const видно = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden') && el.offsetParent !== null;
}, sel);

await page.evaluate(() => { tab = 'wallet'; renderWalletState(); });
await page.waitForTimeout(400);

R.ok('кнопка «По имени» есть на главном экране', await видно('#quickByName'));
R.ok('и подписана понятным словом',
  /имени|name|nombre|isim|nome/i.test(await page.textContent('#quickByName')),
  (await page.textContent('#quickByName')).trim());

// ---------- нажимаем ----------
await page.click('#quickByName');
await page.waitForTimeout(500);

R.ok('ВЕДЁТ НА ЭКРАН ОТПРАВКИ', await видно('#sendPanel'));
R.ok('и подсказка про имя показана', await видно('#byNameHint'));
R.ok('и объяснено, что имя превратится в адрес',
  (await page.textContent('#byNameHint')).length > 60);
R.ok('КУРСОР СТОИТ В ПОЛЕ ПОЛУЧАТЕЛЯ — человеку остаётся только печатать',
  await page.evaluate(() => document.activeElement &&
    document.activeElement.id === 'sendTo'));
R.ok('поле пустое, чужого имени в нём нет',
  (await page.inputValue('#sendTo')) === '');

// ---------- имя и адрес — одно и то же поле ----------
R.ok('ПОЛЕ ТО ЖЕ САМОЕ, что и для адреса — двух экранов под одно дело нет',
  await page.evaluate(() => document.querySelectorAll('#sendTo').length === 1));

// ---------- ушли на другое дело — подсказка не висит ----------
await page.evaluate(() => { setPayMode('receive'); });
await page.waitForTimeout(350);
R.ok('ПОДСКАЗКА НЕ ОСТАЁТСЯ НА ЧУЖОМ ЭКРАНЕ', !(await видно('#byNameHint')));

await page.evaluate(() => { quickAction('withdraw'); });
await page.waitForTimeout(350);
R.ok('и на обычной отправке её тоже нет', !(await видно('#byNameHint')));
R.ok('а сама отправка при этом работает', await видно('#sendPanel'));

// ---------- там, где имён нет, нет и кнопки ----------
/* Обещать действие, которое в этой сети не сработает, хуже, чем не
   показывать его вовсе: человек нажмёт и решит, что сломано. */
const былоБезИмён = await page.evaluate(() => {
  const было = namesAddress;
  window.namesAddress = () => null;
  try {
    tab = 'wallet'; renderWalletState();
    const el = document.getElementById('quickByName');
    return el.classList.contains('hidden');
  } finally {
    window.namesAddress = было;
    tab = 'wallet'; renderWalletState();
  }
});
R.ok('БЕЗ КОНТРАКТА ИМЁН КНОПКИ НЕТ', былоБезИмён);
await page.waitForTimeout(300);
R.ok('а когда контракт есть — вернулась', await видно('#quickByName'));

// ---------- нажатие в сети без имён ничего не ломает ----------
const тихо = await page.evaluate(() => {
  const было = namesAddress;
  window.namesAddress = () => null;
  try { quickAction('byname'); return true; }
  catch (e) { return 'упало: ' + e.message; }
  finally { window.namesAddress = было; }
});
R.ok('и нажатие вслепую не роняет приложение', тихо === true, String(тихо));

R.done(errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e)));
await browser.close();
