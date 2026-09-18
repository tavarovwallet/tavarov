/* Остатки прошлого состояния — самая тихая порода ошибок.

   Приложение живёт долго: человек отсканировал код, передумал, набрал
   адрес руками, сменил пароль, завёл другой кошелёк. Каждый такой шаг
   оставляет позади переменную, про которую забыли обнулить. Ничего не
   падает, ошибок в журнале нет — просто в следующий платёж уезжает чужой
   номер счёта, а на кнопке входа по лицу висит пароль от стёртого
   хранилища.

   Здесь проверяются ровно три таких остатка, каждый из которых стоит денег
   или доступа:

   1. Номер счёта и название точки от прошлого кода не должны прилипать к
      адресу, набранному руками. Номер счёта в контракте занимается ОДИН
      раз: уехавший не туда сжигает настоящий счёт продавца, и покупатель
      потом не может по нему заплатить.

   2. Запись входа по лицу обязана исчезать вместе с кошельком и
      перезапираться при смене пароля. Иначе кнопка «войти лицом» отдаёт
      пароль, которым уже ничего не открывается.

   3. Порог, ниже которого код из Authenticator не спрашивается, поднять
      молча нельзя. Иначе второй рубеж снимается в два движения: вписал
      миллион — и код больше не спросят ни разу.                            */
import { boot, reporter, unlock, answerTotp } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const PASS = 'testpassword1';

const { browser, ctx, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
page.on('dialog', d => d.accept().catch(()=>{}));

const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };
state.txStatus = '0x0';                 // сеть отвергает операции: см. раздел 1б

// ===================================================================
//  1. Номер счёта и название точки не прилипают к чужому адресу
// ===================================================================
const SHOP  = '0x2222222222222222222222222222222222222222';
const STRAY = '0x3333333333333333333333333333333333333333';

const scan = async (opts) => page.evaluate(async o => {
  const link = buildQrPayload(o);
  await applyScannedPayment(link);
  return { merchant: scannedMerchant, invoice: scannedInvoice, name: scannedName };
}, opts);

const inv1 = await page.evaluate(() => newInvoiceId());
let s = await scan({ to: SHOP, m: SHOP, cur: 'USDT', amt: '5', name: 'Кофейня', inv: inv1 });
R.ok('код магазина принят вместе с номером счёта',
  (s.merchant || '').toLowerCase() === SHOP && s.invoice === inv1, JSON.stringify(s).slice(0, 90));

/* А теперь человек передумал и набрал ДРУГОЙ адрес руками. Так бывает
   каждый день: код на витрине один, а продавец продиктовал другой адрес. */
const carried = await page.evaluate(async (addr) => {
  /* Режим НЕ переключаем: переключение само чистит разобранный код, и
     проверка тогда доказывала бы не то. Код уже поставил режим покупки —
     ровно так, как это происходит у живого человека. */
  document.getElementById('sendTo').value = addr;
  document.getElementById('sendAmount').value = '5';
  await reviewSend();
  return { invoice: pendingSend.invoice, name: pendingSend.name,
           merchant: pendingSend.merchant, shown: document.getElementById('confirmTo').textContent };
}, STRAY);

R.ok('ЧУЖОЙ НОМЕР СЧЁТА НЕ УЕЗЖАЕТ НА НАБРАННЫЙ РУКАМИ АДРЕС',
  carried.invoice === '', String(carried.invoice).slice(0, 20) || 'пусто');
R.ok('И НАЗВАНИЕ ЧУЖОЙ ТОЧКИ НЕ ПОДПИСЫВАЕТ ЧУЖОЙ АДРЕС',
  carried.name === '' && !/Кофейня/.test(carried.shown), carried.shown.slice(0, 60));
R.ok('но сам платёж идёт как покупка — за неё положен бонус',
  (carried.merchant || '').toLowerCase() === STRAY, String(carried.merchant));

/* А когда адрес в поле ТОТ ЖЕ, что в коде, номер счёта обязан доехать:
   без него магазин не узнает свой заказ. */
const kept = await page.evaluate(async (addr) => {
  document.getElementById('sendTo').value = addr;
  document.getElementById('sendAmount').value = '5';
  await reviewSend();
  return { invoice: pendingSend.invoice, name: pendingSend.name };
}, SHOP);
R.ok('а на адрес из кода номер счёта и название доезжают',
  kept.invoice === inv1 && kept.name === 'Кофейня', JSON.stringify(kept).slice(0, 70));

/* Второй код без номера счёта обязан стереть номер от первого. */
const inv2 = await page.evaluate(() => newInvoiceId());
await scan({ to: SHOP, m: SHOP, cur: 'USDT', amt: '5', name: 'Кофейня', inv: inv2 });
s = await page.evaluate(async (addr) => {
  /* Обычный код без кассы: такой платёж идёт простым переводом. */
  await applyScannedPayment('ethereum:' + addr + '@97?value=1e18');
  return { merchant: scannedMerchant, invoice: scannedInvoice };
}, STRAY);
R.ok('ПРОСТОЙ КОД СТИРАЕТ НОМЕР СЧЁТА ОТ ПРЕДЫДУЩЕГО',
  s.invoice === '' && s.merchant === null, JSON.stringify(s));

// ===================================================================
//  1б. Откат операции обязан читаться на любом языке
// ===================================================================
/* Сеть отвергла операцию — квитанция есть, а состояние в ней нулевое.
   Приложение помечало этот случай ТЕКСТОМ ошибки и искало в нём русское
   слово. У турка и испанца текст другой, слово не находилось, и откат
   читался как «отправлено, сеть пока молчит»: человек уходил, считая, что
   заплатил. Поэтому проверяем на языке, где русских слов нет вовсе. */
for (const lang of ['ru', 'tr']){
  const out = await page.evaluate(async (code) => {
    const was = lang;
    try{
      lang = code;
      const t0 = Date.now();
      try{
        await waitTx('0x' + 'ab'.repeat(32), 20);
        return { verdict: 'ЖДАЛИ ДО КОНЦА', seconds: Math.round((Date.now() - t0) / 1000) };
      } catch(e){
        return { verdict: 'отказ', message: String(e && e.message || e),
                 seconds: Math.round((Date.now() - t0) / 1000) };
      }
    } finally { lang = was; }
  }, lang);
  R.ok('ОТКАТ ОПЕРАЦИИ ВИДЕН СРАЗУ, ЯЗЫК ' + lang.toUpperCase(),
    out.verdict === 'отказ' && out.seconds < 10, JSON.stringify(out));
}

// ===================================================================
//  2. Запись входа по лицу не переживает кошелёк
// ===================================================================
/* Ключ доступа поднимаем настоящий — виртуальный ключ Chrome с PRF, тот же
   механизм, что в телефоне. Лицо эмулируется, остальное настоящее. */
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
             hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
             automaticPresenceSimulation: true, hasPrf: true }
});

await page.evaluate(async () => { await bioDetect(); renderBioUi(); });
await page.evaluate(async (p) => { await bioWebEnable(p); }, PASS);
R.ok('вход по лицу включён и запись появилась',
  !!(await page.evaluate(() => bioWebRecord())));

// ---------- смена пароля ----------
const NEWPASS = 'testpassword2';
await page.evaluate(async (args) => {
  tab = 'settings'; renderWalletState();
  openPasswordSheet();
  document.getElementById('oldPass').value = args[0];
  document.getElementById('chgPass1').value = args[1];
  document.getElementById('chgPass2').value = args[1];
  doChangePassword();
}, [PASS, NEWPASS]);
await answerTotp(page, 12000);
await page.waitForTimeout(1500);

const afterChange = await page.evaluate(async () => {
  try{ return { pass: await bioWebUnlockPassword(), rec: !!bioWebRecord() }; }
  catch(e){ return { err: e.message, rec: !!bioWebRecord() }; }
});
R.ok('ПОСЛЕ СМЕНЫ ПАРОЛЯ ЛИЦО ОТДАЁТ НОВЫЙ ПАРОЛЬ, А НЕ СТАРЫЙ',
  afterChange.pass === NEWPASS, afterChange.pass === PASS ? 'отдало СТАРЫЙ' : String(afterChange.pass || afterChange.err));

/* И этим паролем кошелёк действительно открывается — иначе «новый» пароль
   в записи ничего не стоит. */
await page.evaluate(() => { wallet = null; sessionPassword = null; flowStage = 'lock'; renderWalletState(); });
await page.waitForTimeout(400);
await page.evaluate(() => bioUnlock());
await page.waitForTimeout(2500);
R.ok('и кошелёк открывается лицом после смены пароля',
  await page.evaluate(() => flowStage === 'ready' && !!wallet));

// ---------- кошелёк стёрли ----------
await page.evaluate(() => { tab = 'settings'; renderWalletState(); disconnectWallet(); });
await answerTotp(page, 12000);
await page.waitForTimeout(1200);
R.ok('КОШЕЛЁК СТЁРЛИ — ЗАПИСЬ ВХОДА ПО ЛИЦУ ТОЖЕ СТЁРТА',
  (await page.evaluate(() => bioWebRecord())) === null,
  JSON.stringify(await page.evaluate(() => bioWebRecord())));
R.ok('и хранилища кошелька больше нет',
  (await page.evaluate(() => vaultExists())) === false);

// ===================================================================
//  3. Порог подтверждения нельзя поднять молча
// ===================================================================
await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
await browser.close();

const two = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
two.page.on('dialog', d => d.accept().catch(()=>{}));

const setThreshold = async (v) => two.page.evaluate(async (x) => {
  tab = 'settings'; renderWalletState();
  const el = document.getElementById('totpThreshold');
  el.value = String(x);
  const p = saveThreshold(el);
  return typeof p === 'object' && p !== null;      // обещание, а не мгновенный ответ
}, v);

/* Код стал делом добровольным, и это меняет смысл проверки. Пока его не
   подключили, спрашивать нечего: порог управляет тем, когда спрашивать код,
   а кода нет вовсе. Сначала убеждаемся, что в этом случае окно не всплывает
   на пустом месте, — а потом подключаем код и проверяем главное. */
await setThreshold(500);
const askedNoTotp = await answerTotp(two.page, 2500);
R.ok('БЕЗ ПОДКЛЮЧЁННОГО КОДА ОКНО НЕ ВСПЛЫВАЕТ НА ПУСТОМ МЕСТЕ', askedNoTotp === false,
  'порог ' + await two.page.evaluate(() => totpThreshold()));

await two.page.evaluate(async () => {
  wallet.totp = await totpSecretFor(wallet);
  await persistVault(wallet, sessionPassword);
});
R.ok('код подключён — дальше он обязан спрашиваться',
  await two.page.evaluate(() => !!(wallet && wallet.totp)));

await setThreshold(1000);
const asked = await answerTotp(two.page, 6000);
await two.page.waitForTimeout(400);
R.ok('ПОДНЯТЬ ПОРОГ БЕЗ КОДА НЕЛЬЗЯ — КОД СПРОСИЛИ', asked,
  'порог теперь ' + await two.page.evaluate(() => totpThreshold()));
R.ok('и после кода порог действительно поднялся',
  (await two.page.evaluate(() => totpThreshold())) === 1000,
  String(await two.page.evaluate(() => totpThreshold())));

/* Отказ от кода обязан ВЕРНУТЬ прежнее значение, а не оставить новое. */
await setThreshold(999999);
await two.page.waitForFunction(
  () => !document.getElementById('totpAskModal').classList.contains('hidden'),
  null, { timeout: 8000 });
await two.page.evaluate(() => totpAskCancel());
await two.page.waitForTimeout(400);
R.ok('ОТКАЗ ОТ КОДА ОСТАВЛЯЕТ ПРЕЖНИЙ ПОРОГ',
  (await two.page.evaluate(() => totpThreshold())) === 1000,
  String(await two.page.evaluate(() => totpThreshold())));
R.ok('и в поле видно прежнее значение, а не набранное',
  (await two.page.evaluate(() => document.getElementById('totpThreshold').value)) === '1000',
  await two.page.evaluate(() => document.getElementById('totpThreshold').value));

/* А снижение порога — усиление защиты, и спрашивать за него нечего. */
await setThreshold(10);
await two.page.waitForTimeout(600);
R.ok('СНИЗИТЬ ПОРОГ МОЖНО БЕЗ КОДА — ЭТО УСИЛЕНИЕ, А НЕ ОСЛАБЛЕНИЕ',
  (await two.page.evaluate(() => totpThreshold())) === 10
  && await two.page.evaluate(() => document.getElementById('totpAskModal').classList.contains('hidden')),
  String(await two.page.evaluate(() => totpThreshold())));

const all = errors.concat(two.errors);
const clean = all.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|NotAllowedError/i.test(e));
const good = R.done(clean);
await two.browser.close(); srv.close();
process.exit(good ? 0 : 1);
