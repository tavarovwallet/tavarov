/* Имена вместо адресов: занять, показать, найти чужое, заплатить по нему. */
import { boot, reporter, answerTotp } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = (require('/home/claude/apk/www/lib/ethers.umd.min.js')).ethers || require('/home/claude/apk/www/lib/ethers.umd.min.js');

const srv = await start(8555);
const R = reporter();

// ---------- продавец занимает имя ----------
const seller = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });
const sp = seller.page;
const sAddr = await sp.evaluate(() => wallet.evm.address);
state.balances[sAddr.toLowerCase()] = { native: 1, USDT: 0, TVR: 0 };
state.vaults[sAddr.toLowerCase()] = '0x8888888888888888888888888888888888888888';
state.balances['0x8888888888888888888888888888888888888888'] = { native: 0, USDT: 0, TVR: 0 };

let alert_ = '';
sp.on('dialog', async d => { alert_ = d.message(); await d.accept().catch(()=>d.dismiss()); });

await sp.evaluate(() => setTab('settings'));
await sp.waitForTimeout(1200);
R.ok('раздел «Имя в Tavarov» показан', await sp.isVisible('#myNameGroup'));
R.ok('пока имени нет — предлагают занять', await sp.isVisible('#myNameNone'));

// подсказки при наборе
const hintFor = async (v) => {
  await sp.fill('#nameInput', v);
  await sp.waitForTimeout(1400);
  return sp.evaluate(() => ({
    text: document.getElementById('nameHint').textContent,
    shown: !document.getElementById('nameHint').classList.contains('hidden'),
    canClaim: !document.getElementById('claimNameBtn').disabled
  }));
};
let h = await hintFor('ab');
R.ok('короткое имя отклонено ещё при наборе', h.shown && !h.canClaim && h.text.includes('от 3 до 20'), h.text.slice(0,60));
h = await hintFor('Кофейня');
R.ok('русские буквы отклонены с объяснением почему', h.shown && !h.canClaim && h.text.includes('воруют'), h.text.slice(0,60));
h = await hintFor('2fast');
R.ok('имя с цифры не принимается', !h.canClaim);
h = await hintFor('kofeinya');
R.ok('свободное имя разрешают занять', h.canClaim && h.text.includes('свободно'), h.text);

state.sent.length = 0;
await sp.click('#claimNameBtn');
await sp.waitForTimeout(3000);
const claimTx = state.sent.find(t => t.to && t.to.toLowerCase() === ADDR.names.toLowerCase());
R.ok('занятие имени ушло в контракт имён', !!claimTx);
if (claimTx){
  const iface = new E.utils.Interface(['function claim(string name)']);
  R.ok('в сеть ушло именно это имя', iface.parseTransaction({ data: claimTx.data }).args[0] === 'kofeinya');
}
R.ok('имя показано в настройках', (await sp.evaluate(() => document.getElementById('myNameText').textContent)) === 'kofeinya');
await sp.evaluate(() => setTab('wallet'));
await sp.waitForTimeout(600);
R.ok('имя видно на кошельке рядом с адресом',
  await sp.isVisible('#dashNameRow') && (await sp.evaluate(() => document.getElementById('dashName').textContent)) === 'kofeinya');

// продавец выставляет счёт
await sp.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
await sp.evaluate(() => refreshVault(true));
await sp.waitForTimeout(600);
await sp.fill('#kassaItem', 'Кофе латте');
await sp.fill('#kassaAmount', '3.5');
await sp.selectOption('#kassaCurrency', 'USDT');
await sp.click('#publishChargeBtn');
await sp.waitForTimeout(5000);
R.ok('счёт выставлен в сети', !!state.charge, JSON.stringify(state.charge && state.charge.item));

// ---------- покупатель платит по имени ----------
const buyer = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
const bp = buyer.page;
const bAddr = await bp.evaluate(() => wallet.evm.address);
state.balances[bAddr.toLowerCase()] = { native: 0.5, USDT: 100, TVR: 0 };
await bp.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });

const typeTo = async (v) => {
  await bp.fill('#sendTo', v);
  await bp.waitForTimeout(2000);
  return bp.evaluate(() => ({
    note: document.getElementById('scanIntentBox').textContent,
    shown: !document.getElementById('scanIntentBox').classList.contains('hidden'),
    amt: document.getElementById('sendAmount').value,
    cur: document.getElementById('sendCurrency').value,
    resolved: (typeof resolvedName !== 'undefined' && resolvedName) ? resolvedName.address : null
  }));
};

let r = await typeTo('neizvestnoe');
R.ok('несуществующее имя честно не находится', r.shown && r.note.includes('ни за кем') && !r.resolved, r.note.slice(0,60));

r = await typeTo('kofeinya');
console.log('по имени:', JSON.stringify(r));
R.ok('ИМЯ НАЙДЕНО', (r.resolved || '').toLowerCase() === sAddr.toLowerCase(), r.resolved || '—');
R.ok('показан и адрес, а не только имя', r.note.includes(sAddr.slice(0,6)), r.note.slice(0,80));
R.ok('СУММА СО СЧЁТА ПОДСТАВИЛАСЬ', r.amt === '3.5', 'в поле "' + r.amt + '"');
R.ok('видно, за что платим', r.note.includes('Кофе латте'), r.note.slice(0,90));

// @ и заглавные — та же запись
r = await typeTo('@KOFEINYA');
R.ok('«@KOFEINYA» — то же самое имя', (r.resolved || '').toLowerCase() === sAddr.toLowerCase());

await bp.fill('#sendTo', 'kofeinya');
await bp.waitForTimeout(2000);
await bp.evaluate(() => reviewSend());
await bp.waitForTimeout(600);
const conf = await bp.evaluate(() => ({
  to: document.getElementById('confirmTo').textContent,
  ps: JSON.parse(JSON.stringify(pendingSend))
}));
R.ok('в подтверждении и имя, и полный адрес', conf.to.includes('kofeinya') && conf.to.includes(sAddr), conf.to);
R.ok('платить будем на адрес, а не на строку с именем', conf.ps.to.toLowerCase() === sAddr.toLowerCase());

state.sent.length = 0;
bp.evaluate(() => doSend());
await answerTotp(bp);
await bp.waitForTimeout(12000);
const iPay = new E.utils.Interface(['function pay(address merchant, address token, uint256 amount, bytes32 invoice)']);
const payTx = state.sent.find(t => t.data.startsWith(iPay.getSighash('pay')));
/* Перевод по имени — это перевод, а не покупка.

   Раньше он шёл через кассу, если у получателя был заведён «приёмник». Но
   имя себе заводит и обычный человек, и брать с подарка другу один процент
   было бы воровством. Покупка теперь опознаётся одним честным признаком:
   платёж собран по коду продавца. Набрали имя руками — деньги идут целиком,
   без комиссии и без бонусов. */
const iErc = new E.utils.Interface(['function transfer(address to, uint256 value) returns (bool)']);
const plainTx = state.sent.find(t => t.data.startsWith(iErc.getSighash('transfer')));
R.ok('ПЕРЕВОД ПО ИМЕНИ ИДЁТ БЕЗ КОМИССИИ, обычным переводом', !payTx && !!plainTx,
  await bp.evaluate(() => document.getElementById('sendResult').textContent));
if (plainTx){
  const p = iErc.parseTransaction({ data: plainTx.data });
  R.ok('деньги ушли владельцу имени', p.args[0].toLowerCase() === sAddr.toLowerCase(), p.args[0]);
  R.ok('сумма верна', p.args[1].toString() === '3500000', p.args[1].toString());
}

// ---------- имя переехало между подтверждением и отправкой ----------
state.charge = null;
await bp.fill('#sendTo', 'kofeinya');
await bp.waitForTimeout(2000);
await bp.fill('#sendAmount', '1');
await bp.evaluate(() => reviewSend());
await bp.waitForTimeout(400);
state.names['kofeinya'] = '0x9999999999999999999999999999999999999999';   // имя увели
state.sent.length = 0;
bp.evaluate(() => doSend());
await answerTotp(bp);
await bp.waitForTimeout(4000);
const res = await bp.evaluate(() => document.getElementById('sendResult').textContent);
R.ok('переезд имени между проверкой и отправкой ловится, деньги не уходят',
  res.includes('перешло на другой кошелёк') && state.sent.length === 0, res.slice(0, 90));
state.names['kofeinya'] = sAddr;

// ---------- перевод человеку без приёмника идёт без комиссии ----------
const FRIEND = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
state.names['drug'] = FRIEND;
await bp.evaluate(() => { cancelSend(); document.getElementById('sendResult').classList.add('hidden'); });
await bp.fill('#sendTo', 'drug');
await bp.waitForTimeout(2000);
await bp.fill('#sendAmount', '2');
await bp.evaluate(() => reviewSend());
await bp.waitForTimeout(400);
state.sent.length = 0;
bp.evaluate(() => doSend());
await answerTotp(bp);
await bp.waitForTimeout(10000);
const payToFriend = state.sent.find(t => t.data.startsWith(iPay.getSighash('pay')));
const transferIface = new E.utils.Interface(['function transfer(address,uint256) returns (bool)']);
const plain = state.sent.find(t => t.data.startsWith(transferIface.getSighash('transfer')));
R.ok('ДРУГУ ПЕРЕВОД БЕЗ КОМИССИИ: контракт оплаты не задействован', !payToFriend,
  payToFriend ? 'ушло через pay()' : '');
R.ok('другу ушёл обычный перевод токена', !!plain,
  await bp.evaluate(() => document.getElementById('sendResult').textContent));

const clean = [...seller.errors, ...buyer.errors].filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await seller.browser.close(); await buyer.browser.close(); srv.close();
process.exit(good ? 0 : 1);
