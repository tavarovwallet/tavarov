/* Старый постоянный код убран по просьбе — проверяем, что от него не осталось
   следов и что касса при этом цела.

   19 сентября постоянный код вернулся, но СОВСЕМ ДРУГОЙ, и разницу стоит
   записать, чтобы её не потеряли.

   Старый жил внутри приложения и был в формате «tavarov:pay?…». Его понимало
   только наше приложение: покупатель с обычной камерой наводил телефон и не
   получал ничего. Для наклейки на прилавке это приговор — продавец не
   выбирает, чем платит покупатель.

   Новый — печатная наклейка со страницы sticker.html, и внутри у неё обычная
   https-ссылка, которую открывает камера любого телефона. Суммы в ней нет:
   сумму продавец называет с кассы, и она уходит в черновик на десять минут.

   Поэтому здесь по-прежнему проверяется, что СТАРОГО в приложении нет, — а
   новый проверяется в t53 и t54. */
import { boot, reporter } from './boot.mjs';

const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller' });
await page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
await page.waitForTimeout(400);

R.ok('кнопки постоянного кода больше нет', await page.evaluate(() => !document.getElementById('permaQrBtn')));
R.ok('панели постоянного кода больше нет', await page.evaluate(() => !document.getElementById('permaQr')));
R.ok('функция постоянного кода убрана', await page.evaluate(() => typeof togglePermaQr === 'undefined'));
/* Раньше здесь стояло «слова наклейка в приложении не осталось». Теперь
   оно есть и должно быть: в настройках кассы появилась ссылка на печать.
   Проверяем то, ради чего писалась та строчка, — что не вернулся СТАРЫЙ код
   внутри приложения. */
R.ok('внутриприложенного постоянного кода нет',
  await page.evaluate(() => !document.getElementById('permaQr') && !document.getElementById('permaQrBtn')));
R.ok('а ссылка на ПЕЧАТНУЮ наклейку есть и ведёт на страницу печати',
  await page.evaluate(() => {
    const a = document.getElementById('stickerPrint');
    return !!a && a.getAttribute('href').includes('sticker.html');
  }));
R.ok('и номер кассы у продавца настраивается',
  await page.evaluate(() => !!document.getElementById('tillNo')));
R.ok('касса на месте', await page.isVisible('#kassaGroup'));
R.ok('кнопка «Выставить счёт» на месте', await page.isVisible('#createTicketBtn'));

/* ---------- наклейку надо НАЙТИ, а не знать, где она ----------
   19 сентября раздел «Касса» в настройках показывался только тому, кто
   перед этим заходил в Оплату и выбирал режим кассы. Человек шёл в
   настройки искать, где напечатать наклейку, — и не находил там раздела
   вовсе. В настройки идут именно тогда, когда не нашли нужного в другом
   месте, и зависеть от предыдущего экрана они не должны. */
await page.evaluate(() => { tab = 'settings'; payMode = null; renderWalletState(); });
await page.waitForTimeout(400);
R.ok('РАЗДЕЛ «КАССА» В НАСТРОЙКАХ ВИДЕН СРАЗУ, без захода в кассу',
  await page.isVisible('#kassaSetGroup'));
R.ok('и ссылка на печать наклейки в нём есть',
  await page.isVisible('#stickerPrint'));

R.done(errors.filter(e=>!/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e)));
await browser.close();
