/* Подтверждение опасного действия лицом.

   Google Authenticator из приложения убран. Это могло бы означать, что
   второго рубежа просто не стало, — поэтому здесь проверяется обратное:
   подтверждение спрашивается, и подтверждается оно НЕ на словах.

   Ключ доступа поднимается настоящий — виртуальный ключ Chrome с
   расширением PRF, тот же механизм, что в телефоне. Лицо никто не
   показывает: подтверждение личности эмулируется, всё остальное живое.

   Главное, что здесь доказывается: «лицо подошло» — это расшифровка,
   которая без ключа не получилась бы, а не слово системы, которому мы
   поверили. Убираем ключ — подтверждение перестаёт проходить. */
import { boot, reporter, answerConfirm } from './boot.mjs';
import { start } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const PASS = 'testpassword1';

const { browser, ctx, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
page.on('dialog', d => d.accept().catch(()=>{}));

const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol:'ctap2', ctap2Version:'ctap2_1', transport:'internal',
             hasResidentKey:true, hasUserVerification:true, isUserVerified:true,
             automaticPresenceSimulation:true, hasPrf:true }
});

const видно = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden');
}, sel);

// ======================= Authenticator убран =======================
R.ok('ФУНКЦИЙ ОДНОРАЗОВОГО КОДА В ПРИЛОЖЕНИИ БОЛЬШЕ НЕТ',
  await page.evaluate(() => typeof totpVerifyCode === 'undefined'
                         && typeof totpSecretFor === 'undefined'
                         && typeof requireTotp === 'undefined'));
R.ok('и окна ввода кода тоже',
  await page.evaluate(() => document.getElementById('totpAskModal') === null));
R.ok('и экрана подключения при первом запуске',
  await page.evaluate(() => document.getElementById('totpSetupCard') === null));

// ======================= без лица: спрашивают пароль =======================
/* Ключ доступа есть, но вход по лицу ещё не включён — значит подтверждать
   нечем, кроме пароля. Так же выглядит любой обычный настольный браузер. */
page.evaluate(() => confirmSensitive('проверка'));
await page.waitForTimeout(600);
R.ok('БЕЗ ВКЛЮЧЁННОГО ЛИЦА СРАЗУ ПРЕДЛАГАЕТСЯ ПАРОЛЬ', await видно('#confirmPassField'));
R.ok('и подпись объясняет, чего от человека хотят',
  (await page.textContent('#confirmReason')) === 'проверка');

await page.fill('#confirmPass', 'не тот пароль');
await page.evaluate(() => confirmSubmit());
await page.waitForTimeout(800);
R.ok('НЕВЕРНЫЙ ПАРОЛЬ НЕ ПРОХОДИТ', await видно('#confirmError') && await видно('#confirmModal'));

await page.fill('#confirmPass', PASS);
await page.evaluate(() => confirmSubmit());
await page.waitForTimeout(800);
R.ok('верный проходит', !(await видно('#confirmModal')));

/* Пароль проверяется расшифровкой хранилища, а не сравнением с тем, что
   лежит в памяти вкладки. Подменяем память — подтверждение всё равно
   должно требовать настоящий пароль. */
const подмена = await page.evaluate(async () => {
  const было = sessionPassword;
  sessionPassword = 'подменённый';
  const ok = await vaultPasswordOk('подменённый');
  sessionPassword = было;
  return ok;
});
R.ok('ПАРОЛЬ СВЕРЯЕТСЯ ХРАНИЛИЩЕМ, А НЕ ПЕРЕМЕННОЙ В ПАМЯТИ', подмена === false);

// ======================= включаем лицо =======================
await page.evaluate(async () => { await bioDetect(); renderBioUi(); });
await page.evaluate(() => { tab = 'settings'; renderWalletState(); renderBioUi(); });
await page.waitForTimeout(400);
/* Включение входа по лицу теперь само спрашивает подтверждение (пароль
   от кошелька): иначе чужой человек с телефоном менял бы пароль кошелька
   на PIN телефона. Отвечаем тем, чем ответил бы владелец. */
page.evaluate(() => {
  const el = document.getElementById('bioToggle');
  el.checked = true;
  return toggleBiometrics(el);
});
await answerConfirm(page, PASS);
await page.waitForTimeout(1200);
R.ok('вход по лицу включился', await page.evaluate(() => bioInfo.enabled === true));

R.ok('В НАСТРОЙКАХ НАПИСАНО, ЧЕМ ТЕПЕРЬ ПОДТВЕРЖДАЮТ', await видно('#confirmBioOn'));
R.ok('и не написано разом противоположное',
  !(await видно('#confirmBioOff')) && !(await видно('#confirmBioNone')));

// ======================= с лицом: пароль не спрашивают =======================
const подтвердилось = page.evaluate(() => confirmSensitive('крупный перевод'));
await page.waitForTimeout(2500);
R.ok('ЛИЦОМ ПОДТВЕРЖДАЕТСЯ БЕЗ ПАРОЛЯ', (await подтвердилось) === true);
R.ok('и окно закрылось', !(await видно('#confirmModal')));

// ======================= ключ убрали — подтверждение не проходит =======================
/* Тот самый случай, ради которого всё и сделано через PRF: если бы мы
   просто верили системе на слово, снятие ключа ничего бы не изменило. */
await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
const началось = Date.now();
const безКлюча = page.evaluate(() => confirmSensitive('перевод без ключа'));
await page.waitForFunction(
  () => !document.getElementById('confirmPassField').classList.contains('hidden'),
  null, { timeout: 30000 }).catch(()=>{});
const ждали = Date.now() - началось;
R.ok('КЛЮЧ УБРАЛИ — ЛИЦОМ БОЛЬШЕ НЕ ПРОХОДИТ, ПРОСЯТ ПАРОЛЬ',
  await видно('#confirmPassField'));
/* Системный запрос ключа живёт до минуты. Минуту смотреть на «смотрим на
   телефон», стоя у кассы, человек не станет — он решит, что сломалось. */
R.ok('И ЖДАТЬ МИНУТУ НЕ ПРИШЛОСЬ: ПАРОЛЬ ПОЯВИЛСЯ САМ',
  ждали < 15000, ждали + ' мс');
await page.fill('#confirmPass', PASS);
await page.evaluate(() => confirmSubmit());
R.ok('ПАРОЛЬ ОСТАЁТСЯ ЗАПАСНЫМ ПУТЁМ — СЛОМАННОЕ ЛИЦО НЕ ЗАПИРАЕТ ДЕНЬГИ',
  (await безКлюча) === true);

// ======================= отказ — это отказ =======================
const отказ = page.evaluate(() => confirmSensitive('ещё раз'));
await page.waitForTimeout(600);
await page.evaluate(() => confirmCancel());
R.ok('ОТМЕНА ОТВЕЧАЕТ ОТКАЗОМ, А НЕ ВИСИТ ВЕЧНО', (await отказ) === false);

const чисто = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|NotAllowedError/i.test(e));
const good = R.done(чисто);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
