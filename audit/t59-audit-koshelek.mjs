/* Дыры кошелька, найденные аудитом 23 сентября, — и что они закрыты.

   Каждая проверка здесь повторяет сценарий, которым аудитор дыру нашёл,
   и ждёт обратного результата. */
import { boot, reporter, answerConfirm } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8556);
const R = reporter();
const PASS = 'testpassword1';
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8556' });
page.on('dialog', d => d.accept().catch(()=>{}));

const окно = () => page.evaluate(() => !document.getElementById('confirmModal').classList.contains('hidden'));
const закрыть = () => page.evaluate(() => confirmCancel());
const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 500, USDT: 100000 };

// ======================= 1. порог — только для долларов =======================
await page.evaluate(() => { localStorage.setItem('tavarov.threshold.v1', '1000'); });
async function перевод(amount, currency){
  await page.evaluate(([a, c]) => {
    tab = 'pay'; actionTab = 'send'; payMode = 'withdraw'; sendIntent = 'withdraw';
    renderWalletState();
    document.getElementById('sendTo').value = '0x2222222222222222222222222222222222222222';
    document.getElementById('sendAmount').value = a;
    const sel = document.getElementById('sendCurrency');
    if (![...sel.options].some(o => o.value === c)){ const o = document.createElement('option'); o.value = c; sel.appendChild(o); }
    sel.value = c;
    reviewSend();
  }, [amount, currency]);
  await page.waitForTimeout(300);
  const sentBefore = state.sent.length;
  page.evaluate(() => doSend());
  await page.waitForTimeout(1200);
  const asked = await окно();
  if (asked) await закрыть();
  await page.waitForTimeout(500);
  return { asked, sent: state.sent.length - sentBefore };
}
let r = await перевод('5', 'native');
R.ok('5 BNB ПРИ ПОРОГЕ 1000 — ПОДТВЕРЖДЕНИЕ СПРОШЕНО (раньше уходило молча)', r.asked, JSON.stringify(r));
R.ok('и после отказа ничего не ушло', r.sent === 0);
r = await перевод('50', 'USDT');
R.ok('50 USDT при пороге 1000 — без вопросов, как и задумано', !r.asked, JSON.stringify(r));
r = await перевод('2000', 'USDT');
R.ok('2000 USDT при пороге 1000 — спрошено', r.asked);

// ======================= 2. история не исполняет разметку из сети =======================
await page.evaluate(() => { window.__xss = 0; });
await page.evaluate(() => renderHistoryList([
  { hash: '0x"><img src=x onerror="window.__xss=1">', isIn: true, amt: '<b>1</b>', sym: '<img src=x onerror="window.__xss=2">',
    addr: '0x"><svg onload="window.__xss=3">', ts: Date.now()/1000, kind: 'transfer' },
  { sig: '<img src=x onerror="window.__xss=4">', hash: 'x', ts: Date.now()/1000 }
], ''));
await page.waitForTimeout(500);
R.ok('ИСТОРИЯ: ХЕШ И СУММА ИЗ СЕТИ НЕ ВЫПОЛНЯЮТ КОД', (await page.evaluate(() => window.__xss)) === 0,
  'xss=' + await page.evaluate(() => window.__xss));
/* Ссылки в истории могут быть — на настоящие операции, отправленные выше.
   Проверяем, что ни одна не ведёт на поддельный «хеш» с разметкой: у
   настоящей ссылки на конце ровно 0x и 64 шестнадцатеричных знака. */
R.ok('и ссылки на поддельный хеш нет', (await page.evaluate(() =>
  [...document.querySelectorAll('#historyList a')].filter(a => !/\/tx\/0x[0-9a-fA-F]{64}$/.test(a.getAttribute('href') || '')).length)) === 0);

// ======================= 3. свой токен не подменяет USDT =======================
const real = await page.evaluate(() => tokensFor(network).USDT.contract);
await page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem(CUSTOM_TOKENS_KEY) || '{}');
  map[network] = [{ sym:'USDT', name:'Tether', decimals:6, contract:'0x9999999999999999999999999999999999999999' }];
  localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(map));
});
R.ok('ПОДДЕЛЬНЫЙ «USDT» ИЗ ХРАНИЛИЩА НЕ ЗАМЕНЯЕТ НАСТОЯЩИЙ',
  (await page.evaluate(() => tokensFor(network).USDT.contract)) === real);
await page.evaluate(() => { localStorage.removeItem(CUSTOM_TOKENS_KEY); });
await page.evaluate(() => {
  document.getElementById('newTokenAddr').value = '0x9999999999999999999999999999999999999999';
  document.getElementById('newTokenSym').value = 'usdt';
  document.getElementById('newTokenDec').value = '6';
  document.getElementById('newTokenName').value = 'Tether';
  saveNewToken();
});
R.ok('и форма добавления его не принимает',
  await page.evaluate(() => !document.getElementById('tokenError').classList.contains('hidden')
    && /уже есть/.test(document.getElementById('tokenError').textContent)),
  await page.textContent('#tokenError'));

// ======================= 4. ключ не попадает в текст ошибки =======================
const KEY = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318zz';
const errText = await page.evaluate(async (k) => {
  document.getElementById('importSeedBlock').classList.add('hidden');
  document.getElementById('importKeyBlock').classList.remove('hidden');
  document.getElementById('importKeyNet').value = 'evm';
  document.getElementById('importKeyInput').value = k;
  await doImport();
  return document.getElementById('importError').textContent;
}, KEY);
R.ok('ОШИБКА ИМПОРТА НЕ ПОКАЗЫВАЕТ САМ КЛЮЧ', !errText.includes('4c0883a691029') && errText.length > 10, errText);

// ======================= 5. журнал ошибок без секретов и без жаргона =======================
await page.evaluate(() => showGlobalError('баланс: could not detect network (event="noNetwork", code=NETWORK_ERROR, version=providers/5.7.2)'));
const g = await page.textContent('#globalError');
R.ok('СЕТЕВАЯ ОШИБКА — ЧЕЛОВЕЧЕСКИМИ СЛОВАМИ', /нет связи с сетью/.test(g) && !/NETWORK_ERROR/.test(g), g);
await page.evaluate(() => showGlobalError('oops 0x' + 'ab'.repeat(32)));
const g2 = await page.textContent('#globalError');
const log = await page.evaluate(() => errorLog.join('\n'));
R.ok('ДЛИННЫЙ HEX (МОЖЕТ БЫТЬ КЛЮЧОМ) ПРИКРЫТ И НА ЭКРАНЕ, И В ЖУРНАЛЕ',
  !g2.includes('ab'.repeat(20)) && !log.includes('ab'.repeat(20)), g2);

// ======================= 6. своя ссылка без монеты — это BNB =======================
await page.evaluate(() => { tab = 'pay'; actionTab = 'send'; renderWalletState();
  document.getElementById('sendCurrency').value = 'USDT'; });
await page.evaluate(() => applyScannedPayment('tavarov:pay?to=0x2222222222222222222222222222222222222222&m=0x2222222222222222222222222222222222222222&amt=5'));
await page.waitForTimeout(600);
R.ok('ССЫЛКА «5» БЕЗ МОНЕТЫ — ЭТО 5 BNB, А НЕ 5 USDT',
  (await page.inputValue('#sendCurrency')) === 'native', await page.inputValue('#sendCurrency'));

// ======================= 7. отказ от имени — под подтверждением =======================
const sentBefore = state.sent.length;
await page.evaluate(() => { myName = 'kofeinya'; });
page.evaluate(() => releaseName());
await page.waitForTimeout(900);
R.ok('ОТКАЗ ОТ ИМЕНИ СПРАШИВАЕТ ПОДТВЕРЖДЕНИЕ', await окно());
await закрыть(); await page.waitForTimeout(600);
R.ok('и после отказа ничего не ушло', state.sent.length === sentBefore);

// ======================= 8. тестовая наклейка в основной сети =======================
/* Этот стенд — тестовая сеть; значит основная наклейка должна остановиться. */
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
await page.evaluate(() => { tab = 'pay'; actionTab = 'send'; renderWalletState();
  document.getElementById('sendTo').value = ''; document.getElementById('sendAmount').value = ''; });
await page.evaluate(u => applyScannedPayment(u),
  'https://wallet.tavarov.com/pay#t=' + b64({ m:'0x5555555555555555555555555555555555555555', k:1, n:'Кофейня', net:'bnb' }));
await page.waitForTimeout(800);
R.ok('НАКЛЕЙКА ОСНОВНОЙ СЕТИ В ТЕСТОВОМ РЕЖИМЕ — ОСТАНОВЛЕНА, ПОЛЯ ПУСТЫ',
  (await page.inputValue('#sendTo')) === '' && (await page.inputValue('#sendAmount')) === '',
  await page.inputValue('#sendTo'));

// ======================= 9. автоблокировка =======================
await page.evaluate(() => { ticketInfo = { fake: true }; });
R.ok('при открытом счёте кассы не запираем — счёт должен дождаться оплаты',
  (await page.evaluate(() => lockNow())) === false);
await page.evaluate(() => { ticketInfo = null; pendingSend = null; });
R.ok('ИНАЧЕ ЗАПИРАЕМ', await page.evaluate(() => lockNow() && flowStage === 'lock' && wallet === null && sessionPassword === null));

const чисто = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|NotAllowedError/i.test(e));
const good = R.done(чисто);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
