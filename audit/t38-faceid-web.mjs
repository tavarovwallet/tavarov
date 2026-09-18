/* Вход по лицу в браузере — и настоящий ли он.

   Соблазн здесь такой: спросить Face ID и, если система сказала «это он»,
   достать пароль из памяти браузера. Выглядит одинаково, а защищает ни от
   чего — пароль лежит открытым, и кто добрался до данных браузера, обошёл
   Face ID стороной.

   Поэтому сделано иначе: у ключа доступа спрашивается секрет (расширение
   PRF), и ИМ шифруется пароль. Нет лица — нет секрета — нечем расшифровать.

   Здесь это и проверяется, причём не на словах: в памяти браузера НЕ ДОЛЖНО
   быть пароля ни в каком виде, а расшифровка без ключа обязана падать.

   Ключ доступа поднимается настоящий — виртуальный ключ Chrome с
   поддержкой PRF, тот же механизм, что и в телефоне. Лицо в проверке никто
   не показывает: подтверждение личности эмулируется, всё остальное
   настоящее. */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const PASS = 'testpassword1';

const { browser, ctx, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });

/* Виртуальный ключ доступа. hasPrf — то самое расширение, без которого мы
   включение запрещаем. */
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
             hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
             automaticPresenceSimulation: true, hasPrf: true }
});

/* Приложение поднялось в браузере: родного плагина нет, значит путь
   браузерный. Диалоги проверка принимает сама — их два, оба предупреждения. */
page.on('dialog', d => d.accept().catch(()=>{}));

R.ok('в браузере родного плагина нет', await page.evaluate(() => bioPlugin() === null));
/* Виртуальный ключ появился уже после загрузки страницы, поэтому просим
   приложение осмотреться заново — так же, как оно делает при открытии. */
await page.evaluate(async () => { await bioDetect(); renderBioUi(); });
await page.waitForTimeout(300);
const info = await page.evaluate(() => ({ ...bioInfo }));
R.ok('КЛЮЧ ДОСТУПА НАЙДЕН И ВХОД ПО ЛИЦУ ПРЕДЛОЖЕН',
  info.web === true && info.available === true, JSON.stringify(info));
R.ok('но пока не включён', info.enabled === false);

// ---------- включаем ----------
await page.evaluate(() => { tab = 'settings'; renderWalletState(); renderBioUi(); });
await page.waitForTimeout(400);
R.ok('переключатель в настройках доступен',
  await page.evaluate(() => !document.getElementById('bioToggle').disabled));

await page.evaluate(async () => {
  const el = document.getElementById('bioToggle');
  el.checked = true;
  await toggleBiometrics(el);
});
await page.waitForTimeout(800);
const rec = await page.evaluate(() => bioWebRecord());
R.ok('ВКЛЮЧИЛОСЬ, И В ПАМЯТИ ПОЯВИЛАСЬ ЗАПИСЬ', !!rec && !!rec.id && !!rec.data, JSON.stringify(rec && Object.keys(rec)));
R.ok('и переключатель это показывает',
  await page.evaluate(() => document.getElementById('bioToggle').checked));

/* Главное во всей затее. Пароля не должно быть нигде в открытом виде —
   ни в записи ключа, ни вообще в памяти браузера. */
const stored = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    out[k] = String(localStorage.getItem(k));
  }
  return out;
});
const leaked = Object.keys(stored).filter(k => stored[k].indexOf(PASS) >= 0);
R.ok('ПАРОЛЯ В ПАМЯТИ БРАУЗЕРА НЕТ НИ В ОДНОЙ ЗАПИСИ',
  leaked.length === 0, leaked.join(', ') || 'нигде');
R.ok('и в записи ключа лежит шифртекст, а не пароль',
  rec.data.length > 10 && rec.data.indexOf(PASS) < 0 && !!rec.iv, rec.data.slice(0, 24) + '…');

// ---------- запираем и открываем лицом ----------
/* Запираем так же, как это выглядит при новом открытии приложения:
   кошелёк из памяти ушёл, хранилище на месте. */
await page.evaluate(() => { wallet = null; sessionPassword = null; flowStage = 'lock'; renderWalletState(); });
await page.waitForTimeout(600);
R.ok('кошелёк заперт', await page.evaluate(() => flowStage === 'lock' && !wallet));
R.ok('и кнопка входа по лицу на экране есть',
  await page.evaluate(async () => { await bioDetect(); renderBioUi();
    return !document.getElementById('bioUnlockBtn').classList.contains('hidden'); }));

const pass = await page.evaluate(() => bioWebUnlockPassword());
R.ok('КЛЮЧ ДОСТУПА ОТДАЁТ ИМЕННО ТОТ ПАРОЛЬ, КОТОРЫМ ЗАПЕРТО', pass === PASS,
  pass === PASS ? 'тот самый' : 'другой');

await page.evaluate(() => bioUnlock());
await page.waitForTimeout(2500);
R.ok('И КОШЕЛЁК ОТКРЫЛСЯ БЕЗ ВВОДА ПАРОЛЯ',
  await page.evaluate(() => flowStage === 'ready' && !!wallet));

// ---------- лицо не узнали — пароль не достаётся ----------
/* Говорим виртуальному ключу, что личность НЕ подтверждена: так выглядит
   чужое лицо у телефона или отказ владельца. Расшифровать нечем, и это
   должно быть видно сразу, а не через минуту ожидания. */
await page.evaluate(() => { wallet = null; sessionPassword = null; flowStage = 'lock'; renderWalletState(); });
await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
const failed = await page.evaluate(async () => {
  try { await bioWebUnlockPassword(); return 'ОТКРЫЛОСЬ'; }
  catch(e){ return 'отказ: ' + (e && e.message ? e.message.slice(0, 60) : '?'); }
});
R.ok('ЧУЖОМУ ЛИЦУ ПАРОЛЬ НЕ ДОСТАЁТСЯ', failed !== 'ОТКРЫЛОСЬ', failed);

/* И вход паролем обязан работать всегда — лицо это удобство, а не
   единственная дверь. */
await page.fill('#unlockPass', PASS);
await page.evaluate(() => doUnlock());
await page.waitForTimeout(2500);
R.ok('А ПАРОЛЕМ ВОЙТИ МОЖНО ВСЕГДА',
  await page.evaluate(() => flowStage === 'ready' && !!wallet));

// ---------- выключение ----------
await page.evaluate(async () => {
  const el = document.getElementById('bioToggle');
  el.checked = false;
  await toggleBiometrics(el);
});
R.ok('ВЫКЛЮЧИЛИ — ЗАПИСЬ СТЁРТА', (await page.evaluate(() => bioWebRecord())) === null);

// ---------- устройство без PRF ----------
/* Ключ доступа без шифрования (старый iOS). Включать по нему вход нельзя:
   пароль пришлось бы хранить открытым. Проверяем, что мы именно
   ОТКАЗЫВАЕМСЯ, а не тихо соглашаемся на видимость защиты. */
/* Chrome держит только один встроенный ключ разом — прежний убираем и
   ставим такой же, но без шифрования. */
await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
const weak = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
             hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
             automaticPresenceSimulation: true, hasPrf: false }
});
const refused = await page.evaluate(async () => {
  try { await bioWebEnable('testpassword1'); return 'ВКЛЮЧИЛОСЬ'; }
  catch(e){ return 'отказ: ' + (e && e.message ? e.message.slice(0, 70) : '?'); }
});
R.ok('БЕЗ ШИФРОВАНИЯ ВКЛЮЧЕНИЕ ЗАПРЕЩЕНО', refused !== 'ВКЛЮЧИЛОСЬ', refused);
R.ok('и человеку объяснено, почему', /iOS 18.4|шифрован/i.test(refused), refused.slice(0, 80));
R.ok('и запись при этом не появилась', (await page.evaluate(() => bioWebRecord())) === null);
await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: weak.authenticatorId });

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|NotAllowedError/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
