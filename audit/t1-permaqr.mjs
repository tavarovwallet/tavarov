/* Постоянный код убран по просьбе — проверяем, что от него не осталось следов
   и что касса при этом цела. */
import { boot, reporter } from './boot.mjs';

const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller' });
await page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
await page.waitForTimeout(400);

R.ok('кнопки постоянного кода больше нет', await page.evaluate(() => !document.getElementById('permaQrBtn')));
R.ok('панели постоянного кода больше нет', await page.evaluate(() => !document.getElementById('permaQr')));
R.ok('функция постоянного кода убрана', await page.evaluate(() => typeof togglePermaQr === 'undefined'));
R.ok('слова «наклейка» в приложении не осталось', !(await page.content()).toLowerCase().includes('наклейк'));
R.ok('касса на месте', await page.isVisible('#kassaGroup'));
R.ok('кнопка «Выставить счёт» на месте', await page.isVisible('#createTicketBtn'));

R.done(errors.filter(e=>!/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e)));
await browser.close();
