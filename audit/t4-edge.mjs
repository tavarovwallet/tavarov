/* Проверки на неудобные случаи: подделки, просрочка, чужая сеть,
   ручные правки и попытки навредить. */
import { boot, reporter } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();

const buyer = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
const page = buyer.page;
const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, USDT: 500, TVR: 0 };
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });

const MERCH = '0x2222222222222222222222222222222222222222';
/* Приёмников больше нет: в честном коде кассы получатель и продавец —
   один адрес. Отдельная проверка подменённого кода живёт в t17. */
const VAULT = MERCH;
const ALIEN = '0x4444444444444444444444444444444444444444';
state.vaults[MERCH.toLowerCase()] = VAULT;

const scan = async (link) => {
  await page.evaluate(() => { document.getElementById('sendTo').value=''; document.getElementById('sendAmount').value=''; clearScanned(); });
  await page.evaluate(l => applyScannedPayment(l), link);
  await page.waitForTimeout(900);
  return page.evaluate(() => ({
    to: document.getElementById('sendTo').value,
    amt: document.getElementById('sendAmount').value,
    note: document.getElementById('scanIntentBox').textContent,
    cls: document.getElementById('scanIntentBox').className,
    shown: !document.getElementById('scanIntentBox').classList.contains('hidden'),
    merchant: (typeof scannedMerchant !== 'undefined' ? scannedMerchant : null)
  }));
};

// --- 1. Поддельная наклейка: касса одна, приёмник чужой ---
let r = await scan('tavarov:pay?to=' + ALIEN + '&net=bnb&m=' + MERCH + '&name=Магазин');
R.ok('подделка распознана и оплата не подставлена', r.to === '' && r.amt === '', 'to="' + r.to + '"');
R.ok('о подделке сказано красным', r.cls.includes('notice-err') && r.note.includes('неправильно'), r.note.slice(0, 80));
R.ok('после подделки касса не запомнена', !r.merchant);

// --- 2. Счёта нет ---
state.charge = null;
r = await scan('tavarov:pay?to=' + VAULT + '&net=bnb&m=' + MERCH + '&name=Магазин');
R.ok('без счёта сумма не подставляется', r.amt === '');
R.ok('сказано, что счёт не выставлен', r.note.includes('не выставлен') || r.note.includes('просрочен'), r.note.slice(0, 90));
R.ok('предупреждение жёлтое, не зелёное', r.cls.includes('notice-warn'));

// --- 3. Счёт просрочен ---
state.charge = { token: ADDR.usdt, amount: '5000000', item: 'Старый счёт',
                 expiresAt: Math.floor(Date.now()/1000) - 10 };
r = await scan('tavarov:pay?to=' + VAULT + '&net=bnb&m=' + MERCH);
R.ok('ПРОСРОЧЕННЫЙ счёт не подставляется', r.amt === '', 'в поле "' + r.amt + '"');
R.ok('о просрочке сказано', r.note.includes('просрочен'), r.note.slice(0, 80));

// --- 4. Живой счёт ---
state.charge = { token: ADDR.usdt, amount: '12500000', item: 'Обед', expiresAt: Math.floor(Date.now()/1000) + 600 };
r = await scan('tavarov:pay?to=' + VAULT + '&net=bnb&m=' + MERCH + '&name=Столовая');
R.ok('живой счёт подставился', r.amt === '12.5', r.amt);
R.ok('видно, за что платим', r.note.includes('Обед'));
R.ok('платим кассе, а не приёмнику', r.to.toLowerCase() === MERCH.toLowerCase(), r.to);

// --- 5. Второй счёт заменяет первый ---
state.charge = { token: ADDR.usdt, amount: '700000', item: 'Кофе', expiresAt: Math.floor(Date.now()/1000) + 600 };
r = await scan('tavarov:pay?to=' + VAULT + '&net=bnb&m=' + MERCH);
R.ok('при повторном скане берётся новая сумма', r.amt === '0.7', r.amt);

// --- 6. Чужая сеть в коде ---
r = await scan('tavarov:pay?to=' + VAULT + '&net=polygon&m=' + MERCH + '&amt=5&cur=USDT');
R.ok('о несовпадении сети предупреждено красным', r.cls.includes('notice-err') && r.note.includes('не дойдёт'), r.note.slice(0, 90));

// --- 7. Обычный адрес (чужой кошелёк) ---
r = await scan(ALIEN);
R.ok('голый адрес по-прежнему понимается', r.to.toLowerCase() === ALIEN.toLowerCase(), r.to);
R.ok('подсказки при этом нет', !r.shown);

// --- 8. Ссылку вставили руками ---
await page.evaluate(() => { clearScanned(); });
state.charge = { token: ADDR.usdt, amount: '3000000', item: 'Чай', expiresAt: Math.floor(Date.now()/1000) + 600 };
await page.fill('#sendTo', 'tavarov:pay?to=' + VAULT + '&net=bnb&m=' + MERCH + '&name=Ларёк');
await page.waitForTimeout(1200);
const pasted = await page.evaluate(() => ({ to: document.getElementById('sendTo').value, amt: document.getElementById('sendAmount').value }));
R.ok('вставленная руками ссылка разобрана', pasted.to.toLowerCase() === MERCH.toLowerCase() && pasted.amt === '3', JSON.stringify(pasted));

// --- 9. После скана адрес поправили руками ---
await page.fill('#sendTo', ALIEN);
await page.fill('#sendAmount', '1');
await page.waitForTimeout(300);
await page.evaluate(() => reviewSend());
await page.waitForTimeout(300);
const ps = await page.evaluate(() => JSON.stringify(pendingSend));
/* Раньше правка адреса после скана просто забывала продавца. Теперь дело
   выбирается заранее, и если человек выбрал «оплатить покупку», то покупка
   и есть — но у ТОГО, чей адрес сейчас в поле, а не у прежнего. Деньги в
   любом случае уходят по адресу на экране; проверяем, что от прежнего кода
   не осталось ни названия точки, ни номера счёта: приписать чужую покупку
   к своему заказу нельзя. */
const psObj = JSON.parse(ps);
R.ok('после ручной правки от прежнего кода ничего не осталось',
  psObj.to.toLowerCase() === ALIEN.toLowerCase() && !psObj.name && !psObj.invoice
  && (psObj.merchant === null || psObj.merchant.toLowerCase() === ALIEN.toLowerCase()), ps);
await page.evaluate(() => cancelSend());

// --- 10. Продавец: что нельзя выставить на наклейку ---
const seller = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });
const sp = seller.page;
const sAddr = await sp.evaluate(() => wallet.evm.address);
state.balances[sAddr.toLowerCase()] = { native: 1, USDT: 0, TVR: 0 };
await sp.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });

/* withBusy показывает отказ окошком alert — значит, ловим именно его. */
let lastAlert = '';
sp.on('dialog', async d => { lastAlert = d.message(); await d.dismiss(); });
const tryPublish = async (item, amount, cur) => {
  lastAlert = '';
  await sp.fill('#kassaItem', item);
  await sp.fill('#kassaAmount', String(amount));
  await sp.selectOption('#kassaCurrency', cur);
  await sp.evaluate(async () => { try { await publishCharge(); } catch(e){} });
  await sp.waitForTimeout(500);
  console.log('   [окно]:', JSON.stringify(lastAlert));
  return lastAlert || 'без отказа';
};
R.ok('нулевую сумму на наклейку не выставить',
  (await tryPublish('Кофе', 0, 'USDT')).includes('больше нуля'));
R.ok('монету сети на наклейку не выставить',
  (await tryPublish('Кофе', 5, 'native')).includes('токене'));
/* Поле само не даёт набрать длиннее 64 знаков — это надёжнее отказа
   после нажатия: кассир не успеет написать лишнее. */
await sp.fill('#kassaItem', 'я'.repeat(120));
R.ok('поле описания не даёт набрать длиннее 64 знаков',
  (await sp.inputValue('#kassaItem')).length === 64,
  'вышло ' + (await sp.inputValue('#kassaItem')).length);
R.ok('описание ровно в 64 знака проходит',
  (await tryPublish('я'.repeat(64), 5, 'USDT')) === 'без отказа');

// --- 11. У покупателя кассы нет ---
R.ok('покупателю касса не показывается',
  !(await page.evaluate(() => !document.getElementById('kassaGroup').classList.contains('hidden'))));
R.ok('покупателю не показан постоянный QR продавца',
  !(await page.isVisible('#permaQrBtn')));

// --- 12. Ключи не утекают ---
const store = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
const secret = await page.evaluate(() => wallet.evm.privateKey);
R.ok('приватный ключ не лежит в хранилище открытым', !store.includes(secret.slice(2)));
R.ok('seed-фраза не лежит в хранилище открытым',
  !store.includes(await page.evaluate(() => (wallet.mnemonic || '').split(' ')[0] + ' ')));
const outgoing = [];
page.on('request', q => outgoing.push(q.url() + ' ' + (q.postData() || '')));
await page.evaluate(() => refreshBalances());
await page.waitForTimeout(1500);
R.ok('ключ не уходит ни в один запрос', !outgoing.some(u => u.includes(secret.slice(2, 20))));

const clean = [...buyer.errors, ...seller.errors].filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource/i.test(e));
const good = R.done(clean);
await buyer.browser.close(); await seller.browser.close(); srv.close();
process.exit(good ? 0 : 1);
