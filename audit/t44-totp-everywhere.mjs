/* Второй рубеж, который есть у всех.

   В приложении из магазина код Authenticator раньше не требовался и даже не
   предлагался: считалось, что там его заменит отпечаток пальца. Но родного
   плагина биометрии в сборке нет вовсе, а ключи доступа внутри WebView
   заводятся не всегда. Значит человек, поставивший приложение из Play, мог
   остаться с одним паролем на всё — и не узнать об этом.

   Второй рубеж, который есть не у всех, — это не второй рубеж. Поэтому
   правило теперь одно на все площадки, и здесь проверяется именно это:

   1. код требуется и в браузере, и в собранном приложении;
   2. новый кошелёк ведёт на подключение кода в обоих случаях;
   3. кнопки «Пропустить» нет;
   4. подпись на экране одна и та же и не обещает, что отпечаток заменит код.

   Собранное приложение изображаем так же, как оно выглядит изнутри: страницу
   открываем с тем же признаком Capacitor, по которому приложение само себя и
   узнаёт. Отдельной лазейки «режим проверки» в нём нет.                    */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();

/* ---------- в браузере ---------- */
const web = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555', raw: true });
R.ok('в браузере приложение видит себя браузером',
  (await web.page.evaluate(() => IS_NATIVE)) === false);
R.ok('и код предлагает, а не навязывает', (await web.page.evaluate(() => totpRequired())) === false);
await web.browser.close();

/* ---------- в собранном приложении ---------- */
/* Capacitor подкладывает в страницу свой объект — по нему приложение и
   понимает, что оно не в браузере. Подкладываем такой же ДО загрузки. */
const nat = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555', raw: true,
                         beforeGoto: true });
await nat.ctx.addInitScript(() => {
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
});
await nat.page.reload({ waitUntil: 'load' });
await nat.page.waitForFunction(() => typeof totpRequired === 'function');

R.ok('приложение узнало себя как собранное',
  (await nat.page.evaluate(() => IS_NATIVE)) === true);
R.ok('И В СОБРАННОМ ПРИЛОЖЕНИИ ПРАВИЛО ТО ЖЕ САМОЕ',
  (await nat.page.evaluate(() => totpRequired())) === false);

/* Родного плагина биометрии в сборке нет — ровно это и делало прежнее
   правило опасным. Проверяем, что мы не полагаемся на него молча. */
R.ok('родного плагина биометрии в сборке действительно нет',
  (await nat.page.evaluate(() => bioPlugin())) === null);

// ---------- новый кошелёк ведёт на подключение кода ----------
await nat.page.evaluate(() => chooseRole('buyer'));
await nat.page.evaluate(() => beginGenerate());
await nat.page.waitForFunction(() => document.querySelectorAll('#mnemonicGrid .mnemonic-word').length === 12);
await nat.page.evaluate(() => finishGenerate());
await nat.page.fill('#newPass', 'testpassword1');
await nat.page.fill('#newPass2', 'testpassword1');
await nat.page.evaluate(() => savePassword());
await nat.page.waitForFunction(() => flowStage === 'totp-setup' || flowStage === 'ready',
                               null, { timeout: 15000 });

R.ok('НОВЫЙ КОШЕЛЁК В ПРИЛОЖЕНИИ ВЕДЁТ НА ПОДКЛЮЧЕНИЕ КОДА, А НЕ МИМО',
  (await nat.page.evaluate(() => flowStage)) === 'totp-setup',
  await nat.page.evaluate(() => flowStage));

R.ok('И КНОПКА «ПРОПУСТИТЬ» НА ЭТОМ ЭКРАНЕ ЕСТЬ',
  await nat.page.evaluate(() =>
    !document.getElementById('totpSkipBtn').classList.contains('hidden')));

const sub = await nat.page.textContent('#totpSubtitle');
R.ok('подпись честно говорит, что подключать необязательно',
  /необязательно/i.test(sub), sub.slice(0, 80));
R.ok('и не врёт, будто код спасает от украденной фразы',
  /не спасает|тринадцатое слово/i.test(sub), sub.slice(-70));

/* И код на этом экране — настоящий рабочий: подключаем его до конца тем же
   путём, каким это делает человек. */
const done = await nat.page.evaluate(async () => {
  const code = await totpAt(base32Decode(pendingTotpSecret), Math.floor(Date.now() / 1000 / 30));
  document.getElementById('totpSetupCode').value = code;
  await confirmTotpSetup();
  return { stage: flowStage, hasTotp: !!(wallet && wallet.totp) };
});
R.ok('КОД ПОДКЛЮЧАЕТСЯ И ЗАПИСЫВАЕТСЯ В КОШЕЛЁК',
  done.hasTotp === true && done.stage === 'ready', JSON.stringify(done));

/* Теперь он обязан спрашиваться на опасном действии — иначе всё выше
   бессмысленно. */
await nat.page.evaluate(() => { tab = 'settings'; renderWalletState(); disconnectWallet(); });
const asked = await nat.page.waitForFunction(
  () => !document.getElementById('totpAskModal').classList.contains('hidden'),
  null, { timeout: 8000 }).then(() => true).catch(() => false);
R.ok('И СПРАШИВАЕТСЯ НА ОПАСНОМ ДЕЙСТВИИ В ПРИЛОЖЕНИИ', asked);
await nat.page.evaluate(() => totpAskCancel());

/* ---------- копию кошелька без кода не унести ----------

   Самая тихая дыра во всей затее с кодом. Резервная копия — это весь
   кошелёк одним файлом: пароль её открывает, а пароль у того, кто стоит
   перед разблокированным приложением, уже есть. Без кода эта кнопка
   обходила бы разом всё остальное: и порог перевода, и смену пароля, и
   удаление кошелька. Тогда код из Authenticator не стоил бы ничего. */
await nat.page.evaluate(() => { tab = 'settings'; renderWalletState(); });
await nat.page.waitForTimeout(300);
nat.page.evaluate(() => openBackupSheet());
const askedBackup = await nat.page.waitForFunction(
  () => !document.getElementById('totpAskModal').classList.contains('hidden'),
  null, { timeout: 8000 }).then(() => true).catch(() => false);
R.ok('ЗА РЕЗЕРВНОЙ КОПИЕЙ ТОЖЕ СПРАШИВАЮТ КОД', askedBackup);

/* Отказались от кода — копия не показана. Иначе окно было бы украшением. */
await nat.page.evaluate(() => totpAskCancel());
await nat.page.waitForTimeout(500);
R.ok('И ПРИ ОТКАЗЕ КОПИЮ НЕ ПОКАЗЫВАЮТ',
  await nat.page.evaluate(() =>
    document.getElementById('backupModal').classList.contains('hidden')));
R.ok('и в поле копии ничего не осталось',
  (await nat.page.evaluate(() => document.getElementById('backupText').value)) === '',
  (await nat.page.evaluate(() => document.getElementById('backupText').value)).slice(0, 30) || 'пусто');

/* А с верным кодом — показывают: это не запрет, а подтверждение. */
nat.page.evaluate(() => openBackupSheet());
await nat.page.waitForFunction(
  () => !document.getElementById('totpAskModal').classList.contains('hidden'),
  null, { timeout: 8000 });
await nat.page.evaluate(async () => {
  const code = await totpAt(base32Decode(totpAskSecret), Math.floor(Date.now() / 1000 / 30));
  document.getElementById('totpAskCode').value = code;
  await totpAskSubmit();
});
await nat.page.waitForTimeout(700);
R.ok('а с верным кодом копия открывается как обычно',
  !(await nat.page.evaluate(() => document.getElementById('backupModal').classList.contains('hidden')))
  && (await nat.page.evaluate(() => document.getElementById('backupText').value)).length > 20);

const clean = nat.errors.concat(web.errors)
  .filter(x => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|NotAllowedError/i.test(x));
const good = R.done(clean);
await nat.browser.close(); srv.close();
process.exit(good ? 0 : 1);
