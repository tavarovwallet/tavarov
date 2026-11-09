/* Перевод USDT без BNB на комиссию (9 ноября 2026).

   Победитель розыгрыша получает $1 USDT в BNB Chain, а BNB у него нет.
   Отправить доллар дальше он должен всё равно: комиссию платим мы через
   MegaFuel. Сам MegaFuel здесь подменён — проверяется то, что кошелёк ему
   шлёт: подписанная человеком операция, нулевая цена газа, основная сеть,
   ровно тот перевод, что был на экране подтверждения.

   И граница: у кого BNB есть, тот платит сам, MegaFuel даже не спрашивают;
   если MegaFuel отказал — человеку говорят про нехватку BNB, как раньше. */
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

let calls = [], sponsor = true;
await page.route('**/api/gasless', async route => {
  const q = JSON.parse(route.request().postData() || '{}');
  calls.push(q);
  let result = null;
  if (q.method === 'pm_isSponsorable') result = sponsor;
  else if (q.method === 'eth_getTransactionCount') result = '0x5';
  else if (q.method === 'eth_sendRawTransaction') result = E.utils.parseTransaction(q.params[0]).hash;
  await route.fulfill({ status: 200, contentType: 'application/json',
                        body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) });
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

/* ---------- 1. BNB нет, MegaFuel согласен ---------- */
state.balances[me.toLowerCase()] = { native: 0, USDT: 10 };
state.sent.length = 0; calls = []; sponsor = true;
const to1 = '0x2222222222222222222222222222222222222222';
const out1 = await sendUsdt(to1, '1');
const raw = calls.find(c => c.method === 'eth_sendRawTransaction');
R.ok('MegaFuel спросили, можно ли', calls.some(c => c.method === 'pm_isSponsorable'), calls.map(c => c.method).join(','));
R.ok('операция ушла через MegaFuel', !!raw);
if (raw){
  const tx = E.utils.parseTransaction(raw.params[0]);
  const d = new E.utils.Interface(['function transfer(address,uint256)']).decodeFunctionData('transfer', tx.data);
  R.ok('подписал сам человек', tx.from.toLowerCase() === me.toLowerCase(), tx.from);
  R.ok('цена газа — ноль', tx.gasPrice.isZero(), tx.gasPrice.toString());
  R.ok('основная сеть BNB (56)', tx.chainId === 56, String(tx.chainId));
  R.ok('в контракт USDT', tx.to.toLowerCase() === ADDR.usdt.toLowerCase(), tx.to);
  R.ok('ровно тот получатель', d[0].toLowerCase() === to1, d[0]);
  R.ok('ровно та сумма (1 USDT)', d[1].toString() === '1000000', d[1].toString());
  R.ok('номер операции от MegaFuel', tx.nonce === 5, String(tx.nonce));
  R.ok('денег в операции нет', tx.value.isZero());
}
R.ok('обычным путём ничего не уходило', state.sent.length === 0, String(state.sent.length));
R.ok('человек видит, что перевод отправлен', !/не хватает/i.test(out1) && /bscscan/i.test(out1), out1.slice(0, 120));

/* ---------- 2. BNB нет, MegaFuel отказал ---------- */
state.sent.length = 0; calls = []; sponsor = false;
const out2 = await sendUsdt('0x3333333333333333333333333333333333333333', '1');
R.ok('без согласия MegaFuel ничего не подписано', !calls.some(c => c.method === 'eth_sendRawTransaction'));
R.ok('и говорим про нехватку BNB, как раньше', /BNB/.test(out2) && /не хватает|нужно|нет/i.test(out2), out2.slice(0, 160));
R.ok('и обычным путём тоже ничего', state.sent.length === 0);

/* ---------- 3. BNB есть — платит сам ---------- */
state.balances[me.toLowerCase()] = { native: 1, USDT: 10 };
state.sent.length = 0; calls = []; sponsor = true;
await sendUsdt('0x4444444444444444444444444444444444444444', '2');
R.ok('MegaFuel не спрашивали вовсе', calls.length === 0, calls.map(c => c.method).join(','));
R.ok('перевод ушёл обычным путём', state.sent.length === 1 && state.sent[0].to.toLowerCase() === ADDR.usdt.toLowerCase());

/* ---------- 4. Монета, добавленная вручную, — без нас ---------- */
const okFake = await page.evaluate(() => gaslessTokenOk('bnb', 'USDT', { contract: '0x1111111111111111111111111111111111111111' }));
const okEth = await page.evaluate(() => gaslessTokenOk('eth', 'USDT', NETWORKS.eth.tokens.USDT));
const okReal = await page.evaluate(() => gaslessTokenOk('bnb', 'USDC', MAINNET.bnb.tokens.USDC));
R.ok('поддельный «USDT» правило не пропускает', okFake === false);
R.ok('другие сети — нет', okEth === false);
R.ok('настоящий USDC в BNB — да', okReal === true);

/* ---------- 5. Имя без комиссии работает как прежде ---------- */
calls = []; sponsor = true;
const h = await page.evaluate(() => claimNameGasless('testname1'));
const rawName = calls.find(c => c.method === 'eth_sendRawTransaction');
R.ok('имя: операция ушла', !!h && !!rawName);
if (rawName){
  const tx = E.utils.parseTransaction(rawName.params[0]);
  const d = new E.utils.Interface(['function claim(string)']).decodeFunctionData('claim', tx.data);
  R.ok('имя: в контракт имён', tx.to.toLowerCase() === (await page.evaluate(() => CONTRACTS.bnbMainnet.names)).toLowerCase());
  R.ok('имя: claim(testname1), газ ноль, сеть 56', d[0] === 'testname1' && tx.gasPrice.isZero() && tx.chainId === 56);
}

await browser.close();
const pass = R.done(errors.filter(x => !/requestfailed|ERR_|Failed to load resource|net::/.test(x)));
process.exit(pass ? 0 : 1);
