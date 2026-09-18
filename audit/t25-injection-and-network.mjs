/* Две дыры, найденные сторонним разбором. Обе про чужие данные, которым
   поверили на слово.

   ПЕРВАЯ. Название и обозначение добавленного токена подставлялись в
   разметку как есть. Строка приезжает извне — её пишет человек по подсказке
   мошенника, она приходит в резервной копии, она переживает перезапуск в
   памяти устройства. Стань такая строка разметкой — чужой код выполнится на
   той же странице, где в памяти лежит закрытый ключ РАЗБЛОКИРОВАННОГО
   кошелька. Дороже ошибки в кошельке не бывает.

   ВТОРАЯ. Код оплаты из другой сети приложение принимало. Адреса в основной
   и тестовой сети выглядят одинаково и очень часто принадлежат одному
   человеку — ключ-то один. Значит тестовый код, отсканированный в основной
   сети, уводит НАСТОЯЩИЕ деньги на адрес, где их ждали понарошку.
   Предупреждения тут мало: предупреждения пролистывают. Нужен стоп.

   Здесь проверяется, что обе закрыты — и, отдельной проверкой, что стоп по
   сети не мешает своим же кодам работать. Первая попытка починки как раз
   этим и кончилась: касса перестала принимать собственные счета. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });

const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, USDT: 50, TVR: 0 };

/* Окна alert в стенде некому закрывать — закрываем сами, иначе проверка
   повиснет на первом же предупреждении. */
const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });

// ================= ЧУЖИЕ ДАННЫЕ В РАЗМЕТКЕ =================

const PAYLOAD = '<img src=x onerror="window.__pwned=1">';

/* Запись могла приехать резервной копией или из старой сборки — то есть
   мимо формы добавления и мимо любых её проверок. */
const poisoned = await page.evaluate(([net, payload]) => {
  localStorage.setItem('tavarov.tokens.v1', JSON.stringify({ [net]: [
    { sym: payload, name: payload, decimals: 18, contract: '0x1111111111111111111111111111111111111111' },
    { sym: 'EVIL',  name: payload, decimals: 18, contract: '0x2222222222222222222222222222222222222222' }
  ]}));
  return customTokens(net).map(t => t.sym);
}, [await page.evaluate(() => network), PAYLOAD]);

R.ok('ЗАПИСЬ С РАЗМЕТКОЙ В ОБОЗНАЧЕНИИ ОТБРАСЫВАЕТСЯ ПРИ ЧТЕНИИ',
  !poisoned.includes(PAYLOAD), JSON.stringify(poisoned));
R.ok('а годная запись остаётся', poisoned.includes('EVIL'), JSON.stringify(poisoned));

await page.evaluate(() => { tab = 'wallet'; renderWalletState(); refreshBalances(); });
await page.waitForTimeout(2500);

const listState = await page.evaluate(() => ({
  imgs: document.querySelectorAll('#tokenList img').length,
  pwned: !!window.__pwned,
  text: document.getElementById('tokenList').innerText,
  html: document.getElementById('tokenList').innerHTML
}));
R.ok('ЧУЖАЯ РАЗМЕТКА НЕ СТАЛА РАЗМЕТКОЙ В СПИСКЕ МОНЕТ', listState.imgs === 0, 'картинок ' + listState.imgs);
R.ok('И ЧУЖОЙ КОД НЕ ВЫПОЛНИЛСЯ', listState.pwned === false);
R.ok('название показано текстом, как его и написали',
  listState.text.indexOf('<img') >= 0 && listState.html.indexOf('&lt;img') >= 0,
  listState.text.replace(/\n/g, ' | ').slice(0, 90));

await page.evaluate(() => openTokensSheet());
await page.waitForTimeout(700);
const sheet = await page.evaluate(() => ({
  imgs: document.querySelectorAll('#tokensList img').length,
  pwned: !!window.__pwned
}));
R.ok('и в шторке «Другие валюты» тоже не стала', sheet.imgs === 0 && !sheet.pwned, 'картинок ' + sheet.imgs);
await page.evaluate(() => document.getElementById('tokensModal').classList.add('hidden'));

/* Форма добавления — вторая дверь к тому же списку. Она обязана быть заперта
   так же, а не «почти так же». */
const formSays = await page.evaluate(payload => {
  tab = 'settings'; renderWalletState(); openTokensSheet();
  document.getElementById('newTokenAddr').value = '0x3333333333333333333333333333333333333333';
  document.getElementById('newTokenSym').value  = payload;
  document.getElementById('newTokenDec').value  = '18';
  document.getElementById('newTokenName').value = 'x';
  saveNewToken();
  const err = document.getElementById('tokenError');
  return { shown: !err.classList.contains('hidden'),
           stored: (customTokens(network) || []).map(t => t.sym) };
}, PAYLOAD).catch(() => null);
if (formSays){
  R.ok('ФОРМА НЕ ПРИНИМАЕТ РАЗМЕТКУ В ОБОЗНАЧЕНИИ',
    formSays.shown && !formSays.stored.includes(PAYLOAD), JSON.stringify(formSays));
}
await page.evaluate(() => { try{ localStorage.removeItem('tavarov.tokens.v1'); } catch(e){} });

// ================= КОД ИЗ ДРУГОЙ СЕТИ =================

const SHOP = '0x2222222222222222222222222222222222222222';
const scan = async (link) => {
  await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.getElementById('sendTo').value = '';
    document.getElementById('sendAmount').value = '';
  });
  await page.evaluate(s => applyScannedPayment(s), link);
  await page.waitForTimeout(1400);
  return page.evaluate(() => ({
    to: document.getElementById('sendTo').value,
    amt: document.getElementById('sendAmount').value,
    box: document.getElementById('scanIntentBox').textContent,
    red: document.getElementById('scanIntentBox').className.indexOf('notice-err') >= 0,
    chain: scannedChainId
  }));
};

/* Свой код в своей сети обязан работать по-прежнему. Это и есть та проверка,
   на которой первая попытка починки посыпалась. */
const own = await page.evaluate(shop => buildQrPayload({
  to: shop, m: shop, cur: 'USDT', amt: '3', item: 'Кофе', name: 'Кофейня' }), SHOP);
let r = await scan(own);
R.ok('СВОЙ КОД В СВОЕЙ СЕТИ ПО-ПРЕЖНЕМУ РАБОТАЕТ', r.to.toLowerCase() === SHOP.toLowerCase(), r.to || r.box.slice(0, 70));
R.ok('и сеть кода запомнена', r.chain === 97, String(r.chain));

/* Основная сеть, chainId 56, а мы в тестовой. Тот же адрес, те же 5 монет. */
r = await scan('ethereum:' + SHOP + '@56?value=5000000000000000000');
R.ok('КОД ИЗ ОСНОВНОЙ СЕТИ В ТЕСТОВОЙ ОСТАНОВЛЕН', r.to === '' && r.amt === '', 'адрес: ' + r.to + ', сумма: ' + r.amt);
R.ok('и сказано красным, а не мягким предупреждением',
  r.red && /другой сети/.test(r.box), r.box.slice(0, 80));
R.ok('и сеть кода не запомнена', r.chain === null, String(r.chain));

/* Обратный, самый опасный случай: тестовый код при настоящих деньгах. */
await page.evaluate(() => {
  try{ localStorage.setItem(TESTNET_KEY, '0'); } catch(e){}
  NETWORKS = MAINNET; network = 'bnb';
});
r = await scan('ethereum:' + SHOP + '@97?value=5000000000000000000');
R.ok('ТЕСТОВЫЙ КОД В ОСНОВНОЙ СЕТИ ОСТАНОВЛЕН — НАСТОЯЩИЕ ДЕНЬГИ НЕ УЙДУТ',
  r.to === '' && r.amt === '', 'адрес: ' + r.to + ', сумма: ' + r.amt);
R.ok('и об этом сказано красным', r.red && /другой сети/.test(r.box), r.box.slice(0, 80));

const mainOwn = await page.evaluate(shop => buildQrPayload({
  to: shop, m: shop, cur: 'USDT', amt: '3', name: 'Кофейня' }), SHOP);
r = await scan(mainOwn);
R.ok('а свой код основной сети в основной сети работает',
  r.to.toLowerCase() === SHOP.toLowerCase() && r.chain === 56, r.to + ' / ' + r.chain);

/* Сеть переключили уже ПОСЛЕ сканирования: на экране остались чужие адрес и
   сумма. Вторая проверка стоит у самой двери. */
await page.evaluate(() => { NETWORKS = TESTNET; network = 'bnb'; });
dialogs.length = 0;
await page.evaluate(() => reviewSend());
await page.waitForTimeout(700);
const after = await page.evaluate(() => ({
  pending: !!pendingSend,
  confirmShown: !document.getElementById('sendConfirm').classList.contains('hidden')
}));
R.ok('СМЕНА СЕТИ ПОСЛЕ СКАНИРОВАНИЯ ОСТАНАВЛИВАЕТ ОПЛАТУ',
  !after.pending && !after.confirmShown, JSON.stringify(after));
R.ok('и человеку сказано, почему',
  dialogs.some(m => /отсканируйте его заново|другой сети/i.test(m)), dialogs.join(' | ').slice(0, 90));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
