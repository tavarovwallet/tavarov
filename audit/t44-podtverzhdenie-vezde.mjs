/* Подтверждение спрашивается ВЕЗДЕ, где опасно.

   Раньше здесь проверялось, что код Authenticator спрашивается у тех, кто
   его подключил. Формулировка была с изъяном, и изъян стоил защиты: у
   того, кто код не завёл, не спрашивалось ничего и никогда. Защита,
   которая есть не у всех, — это не защита.

   Теперь подтверждение есть у всех: лицо, а где лица нет — пароль от
   кошелька. Здесь проверяется именно это: на каждом опасном действии
   окно всплывает, отказ действие отменяет, а само действие без
   подтверждения не происходит.

   Опасные действия, за которыми следим: резервная копия (она содержит
   кошелёк целиком), смена пароля, отключение кошелька, поднятие порога и
   перевод выше порога. */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const PASS = 'testpassword1';

const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
page.on('dialog', d => d.accept().catch(()=>{}));

const окно = () => page.evaluate(() =>
  !document.getElementById('confirmModal').classList.contains('hidden'));
const закрыть = () => page.evaluate(() => confirmCancel());
const ответить = async () => {
  await page.waitForFunction(
    () => !document.getElementById('confirmPassField').classList.contains('hidden'),
    null, { timeout: 10000 });
  await page.fill('#confirmPass', PASS);
  await page.evaluate(() => confirmSubmit());
  await page.waitForFunction(
    () => document.getElementById('confirmModal').classList.contains('hidden'),
    null, { timeout: 10000 });
};

/* На стенде ключей доступа нет — значит путь пароля, тот же, что у
   человека за обычным настольным браузером. */
R.ok('на этом устройстве лица нет — подтверждаем паролем',
  await page.evaluate(() => !(bioInfo.available && bioInfo.enabled)));

// ======================= резервная копия =======================
page.evaluate(() => { tab = 'settings'; renderWalletState(); openBackupSheet(); });
await page.waitForTimeout(900);
R.ok('ЗА РЕЗЕРВНОЙ КОПИЕЙ СПРАШИВАЮТ ПОДТВЕРЖДЕНИЕ', await окно());
await закрыть();
await page.waitForTimeout(400);
R.ok('при отказе копию не показывают',
  await page.evaluate(() => document.getElementById('backupModal').classList.contains('hidden')));
R.ok('и в поле копии ничего не осталось',
  (await page.evaluate(() => document.getElementById('backupText').value)) === '');

page.evaluate(() => openBackupSheet());
await page.waitForTimeout(700);
await ответить();
await page.waitForTimeout(500);
R.ok('а с подтверждением копия открывается',
  await page.evaluate(() => !document.getElementById('backupModal').classList.contains('hidden'))
  && (await page.evaluate(() => document.getElementById('backupText').value)).length > 50);
await page.evaluate(() => closeBackupSheet());

// ======================= порог =======================
const порог = () => page.evaluate(() => confirmThreshold());
const ставить = v => page.evaluate(x => {
  tab = 'settings'; renderWalletState();
  const el = document.getElementById('confirmThreshold');
  el.value = String(x);
  return saveThreshold(el);
}, v);

/* Порог по умолчанию — ноль: спрашивать при любой оплате. Поднимаем его,
   отказываемся, потом ставим заведомо меньшее, чем поднимали. */
const было = await порог();
ставить(было + 500);
await page.waitForTimeout(800);
R.ok('ЗА ПОДНЯТИЕ ПОРОГА СПРАШИВАЮТ ПОДТВЕРЖДЕНИЕ', await окно());
await закрыть();
await page.waitForTimeout(400);
R.ok('отказ оставляет прежний порог', (await порог()) === было, String(await порог()));

/* Сначала поднимем по-настоящему, с подтверждением, — иначе «снижать»
   будет неоткуда: по умолчанию порог и так ноль. */
ставить(1000);
await page.waitForTimeout(700);
await ответить();
await page.waitForTimeout(400);
R.ok('с подтверждением порог поднимается', (await порог()) === 1000, String(await порог()));

ставить(50);
await page.waitForTimeout(900);
R.ok('ЗА СНИЖЕНИЕ ПОРОГА НЕ СПРАШИВАЮТ — ЭТО УСИЛЕНИЕ',
  !(await окно()) && (await порог()) === 50, String(await порог()));

// ======================= смена пароля =======================
page.evaluate(() => { tab = 'settings'; renderWalletState(); openPasswordSheet(); });
await page.waitForTimeout(500);
await page.fill('#oldPass', PASS);
await page.fill('#chgPass1', 'testpassword3');
await page.fill('#chgPass2', 'testpassword3');
page.evaluate(() => doChangePassword());
await page.waitForTimeout(1200);
R.ok('ЗА СМЕНУ ПАРОЛЯ СПРАШИВАЮТ ПОДТВЕРЖДЕНИЕ', await окно());
await закрыть();
await page.waitForTimeout(600);
R.ok('ОТКАЗ — ПАРОЛЬ НЕ СМЕНИЛСЯ',
  await page.evaluate(async () => {
    try{ await decryptVault(localStorage.getItem(VAULT_KEY), 'testpassword1'); return true; }
    catch(e){ return false; }
  }));

// ======================= отключение кошелька =======================
page.evaluate(() => { tab = 'settings'; renderWalletState(); disconnectWallet(); });
await page.waitForTimeout(900);
R.ok('ЗА ОТКЛЮЧЕНИЕ КОШЕЛЬКА СПРАШИВАЮТ ПОДТВЕРЖДЕНИЕ', await окно());
await закрыть();
await page.waitForTimeout(600);
R.ok('ОТКАЗ — КОШЕЛЁК НА МЕСТЕ', await page.evaluate(() => vaultExists() && !!wallet));

// ======================= перевод выше порога =======================
/* Главное, ради чего всё это: тот, кто ничего не подключал, тоже защищён. */
await page.evaluate(() => { try{ localStorage.setItem('tavarov.threshold.v1', '10'); }catch(e){} });
await page.evaluate(() => {
  tab = 'pay'; actionTab = 'send'; payMode = 'withdraw'; sendIntent = 'withdraw';
  renderWalletState();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  document.getElementById('sendTo').value = '0x2222222222222222222222222222222222222222';
  document.getElementById('sendAmount').value = '500';
});
await page.evaluate(() => reviewSend());
await page.waitForTimeout(500);
page.evaluate(() => doSend());
await page.waitForTimeout(1200);
R.ok('ЗА КРУПНЫЙ ПЕРЕВОД СПРАШИВАЮТ ПОДТВЕРЖДЕНИЕ — ДАЖЕ У ТОГО, КТО НИЧЕГО НЕ ПОДКЛЮЧАЛ',
  await окно());
await закрыть();
await page.waitForTimeout(600);
R.ok('и при отказе перевод не уходит',
  await page.evaluate(() => !document.getElementById('sendResult').classList.contains('hidden')));

const чисто = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|NotAllowedError/i.test(e));
const good = R.done(чисто);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
