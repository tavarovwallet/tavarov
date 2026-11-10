/* Имя и перевод USDT без BNB на комиссию (9–10 ноября 2026).

   Победитель розыгрыша получает $1 USDT в BNB Chain, а BNB у него нет.
   Отправить доллар дальше он должен всё равно. С 10 ноября газ платит только
   наш служебный кошелёк (functions/api/drip-bnb.js): кладёт человеку BNB
   ровно на эту операцию, и кошелёк проводит её обычным путём. MegaFuel больше
   не используется: его публичное правило оплатило 8078 чужих переводов.

   Сервер здесь подменён — проверяется то, что кошелёк у него просит и что
   потом отправляет: ровно тот перевод, что был на экране подтверждения,
   подписанный самим человеком, с теми газом и ценой, под которые дан BNB.

   И граница: у кого BNB есть, тот платит сам, сервер даже не спрашивают;
   если сервер отказал — человеку говорят про нехватку BNB, как раньше. */
import { boot, reporter, answerConfirm } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const e = require('/home/claude/tavarov/www/lib/ethers.umd.min.js');
const E = e.ethers || e;

await start(8556);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', rpc: 'http://localhost:8556' });

/* Основная сеть, но узел поддельный: USDT в ней — поддельный же контракт,
   у которого поддельный узел знает остатки. Правило «только встроенные
   USDT и USDC» сверяет с MAINNET, поэтому подменяем именно там. */
const me = await page.evaluate(a => {
  MAINNET.bnb.tokens.USDT = { contract: a, decimals: 6 };
  network = 'bnb';
  return wallet.evm.address;
}, ADDR.usdt);
R.ok('кошелёк в основной сети', await page.evaluate(() => !testnetOn() && network === 'bnb'));

let megafuel = [];
await page.route('**/api/gasless', async route => { megafuel.push(1); await route.fulfill({ status: 500, body: '{}' }); });
let drips = [], dripOk = true;
await page.route('**/api/drip-bnb', async route => {
  drips.push(JSON.parse(route.request().postData() || '{}'));
  await route.fulfill({ status: dripOk ? 200 : 503, contentType: 'application/json',
    body: JSON.stringify(dripOk ? { hash: '0x' + 'cd'.repeat(32), gas: '156000', gasPrice: '100000000' } : { error: 'drip has no BNB' }) });
});

async function sendUsdt(to, amount){
  await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
  await page.waitForTimeout(300);
  await page.fill('#sendTo', to);
  await page.fill('#sendAmount', amount);
  await page.selectOption('#sendCurrency', 'USDT');
  await page.evaluate(() => reviewSend());
  await page.waitForTimeout(400);
  page.evaluate(() => doSend());
  await answerConfirm(page, 'testpassword1', 6000);
  await page.waitForFunction(() => !document.getElementById('sendResult').classList.contains('hidden'),
                             null, { timeout: 30000 }).catch(() => {});
  return page.evaluate(() => document.getElementById('sendResult').innerText);
}
const transfer = new E.utils.Interface(['function transfer(address,uint256)']);

/* ---------- 1. BNB нет, наш BNB пришёл — перевод уходит ---------- */
state.balances[me.toLowerCase()] = { native: 0, USDT: 10 };
state.sent.length = 0; drips = []; dripOk = true;
const to1 = '0x2222222222222222222222222222222222222222';
const out1 = await sendUsdt(to1, '1');
R.ok('спросили наш BNB — ровно на этот перевод', drips.length === 1 && drips[0].from.toLowerCase() === me.toLowerCase() &&
     drips[0].to.toLowerCase() === ADDR.usdt.toLowerCase() && /^0xa9059cbb/.test(drips[0].data), JSON.stringify(drips[0] || {}).slice(0, 120));
const t1 = state.sent[0];
R.ok('перевод ушёл обычным путём, один', state.sent.length === 1 && t1.to.toLowerCase() === ADDR.usdt.toLowerCase(), String(state.sent.length));
if (t1){
  const d = transfer.decodeFunctionData('transfer', t1.data);
  R.ok('ровно тот получатель и сумма (1 USDT)', d[0].toLowerCase() === to1 && d[1].toString() === '1000000');
  R.ok('газ и цена газа — те, под которые дан BNB', t1.gasLimit === '156000' && t1.gasPrice === '100000000', t1.gasLimit + ' ' + t1.gasPrice);
  R.ok('подписал сам человек', String(t1.from).toLowerCase() === me.toLowerCase());
  R.ok('денег BNB в операции нет', t1.value === '0');
}
const html1 = await page.evaluate(() => document.getElementById('sendResult').innerHTML);
R.ok('человек видит, что перевод отправлен', !/не хватает/i.test(out1) && /href="https:\/\/bscscan\.com\/tx\//.test(html1), out1.slice(0, 120));
R.ok('и никакой сырой разметки в тексте', !/target=|<a |href=/.test(out1), out1.slice(-80));
R.ok('у сервера просили BNB ровно на тот перевод, что ушёл', drips[0] && drips[0].data === (t1 && t1.data));

/* ---------- 2. BNB нет, сервер отказал ---------- */
state.sent.length = 0; drips = []; dripOk = false;
const out2 = await sendUsdt('0x3333333333333333333333333333333333333333', '1');
R.ok('сервер спросили', drips.length === 1);
R.ok('и говорим про нехватку BNB, как раньше', /BNB/.test(out2) && /не хватает|нужно|нет/i.test(out2), out2.slice(0, 160));
R.ok('и ничего не отправлено', state.sent.length === 0);
dripOk = true;

/* ---------- 3. BNB есть — платит сам ---------- */
state.balances[me.toLowerCase()] = { native: 1, USDT: 10 };
state.sent.length = 0; drips = [];
await sendUsdt('0x4444444444444444444444444444444444444444', '2');
R.ok('наш сервер не спрашивали вовсе', drips.length === 0);
R.ok('перевод ушёл обычным путём', state.sent.length === 1 && state.sent[0].to.toLowerCase() === ADDR.usdt.toLowerCase());

/* ---------- 4. Монета, добавленная вручную, — без нас ---------- */
const okFake = await page.evaluate(() => gaslessTokenOk('bnb', 'USDT', { contract: '0x1111111111111111111111111111111111111111' }));
const okEth = await page.evaluate(() => gaslessTokenOk('eth', 'USDT', NETWORKS.eth.tokens.USDT));
const okReal = await page.evaluate(() => gaslessTokenOk('bnb', 'USDC', MAINNET.bnb.tokens.USDC));
R.ok('поддельный «USDT» правило не пропускает', okFake === false);
R.ok('другие сети — нет', okEth === false);
R.ok('настоящий USDC в BNB — да', okReal === true);

/* ---------- 5. Имя через наш BNB ---------- */
state.balances[me.toLowerCase()] = { native: 0, USDT: 0 };
state.sent.length = 0; drips = [];
const h = await page.evaluate(() => claimNameGasless('testname1'));
const c = state.sent[0];
R.ok('имя: операция ушла', !!h && !!c && drips.length === 1, String(h));
if (c){
  const d = new E.utils.Interface(['function claim(string)']).decodeFunctionData('claim', c.data);
  R.ok('имя: в контракт имён', c.to.toLowerCase() === (await page.evaluate(() => CONTRACTS.bnbMainnet.names)).toLowerCase());
  R.ok('имя: claim(testname1), газ и цена наши, подписал сам', d[0] === 'testname1' && c.gasLimit === '156000' &&
       c.gasPrice === '100000000' && String(c.from).toLowerCase() === me.toLowerCase());
}

R.ok('MegaFuel больше не спрашивают ни разу', megafuel.length === 0, String(megafuel.length));

await browser.close();
const pass = R.done(errors.filter(x => !/requestfailed|ERR_|Failed to load resource|net::/.test(x)));
process.exit(pass ? 0 : 1);
