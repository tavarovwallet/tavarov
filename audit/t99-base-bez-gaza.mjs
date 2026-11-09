/* USDC в Base без ETH (10 ноября 2026): кошелёк подписывает «перевод по
   подписи» и отдаёт его нашему серверу (relay-base.js). Узел Base и сервер
   здесь подменены; проверяется, что именно подписал кошелёк: владелец,
   получатель и сумма с экрана подтверждения, сеть Base, срок — час.
   И граница: у кого ETH есть, тот платит сам; сервер отказал — человек
   видит обычное «не хватает ETH». */
import { boot, reporter, answerConfirm } from './boot.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = (r => r.ethers || r)(require('/home/claude/tavarov/www/lib/ethers.umd.min.js'));

const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer' });
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const me = await page.evaluate(() => { MAINNET.base.rpc = 'http://base.mock/'; MAINNET.base.rpcs = ['http://base.mock/']; network = 'base'; return wallet.evm.address; });

let eth = '0x0', relayCalls = [], relayOk = true, sentNormal = [];
const abiStr = s => E.utils.defaultAbiCoder.encode(['string'], [s]);
await page.route('http://base.mock/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  const one = q => {
    const res = r => ({ jsonrpc: '2.0', id: q.id, result: r });
    switch (q.method){
      case 'eth_chainId': return res('0x2105');
      case 'net_version': return res('8453');
      case 'eth_blockNumber': return res('0x10');
      case 'eth_getBalance': return res(eth);
      case 'eth_gasPrice': return res('0x989680');
      case 'eth_estimateGas': return res('0x15f90');
      case 'eth_getTransactionCount': return res('0x0');
      case 'eth_call': {
        const sel = (q.params[0].data || '').slice(0, 10);
        if (sel === '0x06fdde03') return res(abiStr('USD Coin'));
        if (sel === '0x54fd4d50') return res(abiStr('2'));
        if (sel === '0x70a08231') return res(E.utils.defaultAbiCoder.encode(['uint256'], [10000000]));
        return res('0x');
      }
      case 'eth_sendRawTransaction': { const t = E.utils.parseTransaction(q.params[0]); sentNormal.push(t); return res(t.hash); }
      case 'eth_getTransactionReceipt': return res(null);
    }
    return { jsonrpc: '2.0', id: q.id, error: { code: -32601, message: 'no ' + q.method } };
  };
  const out = Array.isArray(body) ? body.map(one) : one(body);
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
});
await page.route('**/api/relay-base', async route => {
  const q = JSON.parse(route.request().postData() || '{}');
  relayCalls.push(q);
  await route.fulfill({ status: relayOk ? 200 : 503, contentType: 'application/json',
    body: JSON.stringify(relayOk ? { hash: '0x' + 'ab'.repeat(32) } : { error: 'relay has no ETH' }) });
});

async function sendUsdc(to, amount){
  await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
  await page.waitForTimeout(300);
  await page.fill('#sendTo', to);
  await page.fill('#sendAmount', amount);
  await page.selectOption('#sendCurrency', 'USDC');
  await page.evaluate(() => reviewSend());
  await page.waitForTimeout(400);
  page.evaluate(() => doSend());
  await answerConfirm(page, 'testpassword1', 6000);
  await page.waitForFunction(() => !document.getElementById('sendResult').classList.contains('hidden'), null, { timeout: 30000 }).catch(() => {});
  return page.evaluate(() => document.getElementById('sendResult').innerText);
}

/* 1. ETH нет, сервер согласен. */
const to1 = '0x2222222222222222222222222222222222222222';
const out1 = await sendUsdc(to1, '1.5');
const q = relayCalls[0];
R.ok('подпись ушла на наш сервер', !!q, String(relayCalls.length));
if (q){
  const domain = { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC };
  const types = { TransferWithAuthorization: [ { name:'from', type:'address' }, { name:'to', type:'address' },
    { name:'value', type:'uint256' }, { name:'validAfter', type:'uint256' }, { name:'validBefore', type:'uint256' }, { name:'nonce', type:'bytes32' } ] };
  const who = E.utils.verifyTypedData(domain, types, { from: q.from, to: q.to, value: q.value, validAfter: q.validAfter, validBefore: q.validBefore, nonce: q.nonce }, q.signature);
  R.ok('подписал владелец кошелька, сеть Base, контракт USDC', who.toLowerCase() === me.toLowerCase(), who);
  R.ok('получатель с экрана', q.to.toLowerCase() === to1);
  R.ok('сумма с экрана (1.5 USDC = 1500000)', q.value === '1500000', q.value);
  const left = q.validBefore - Math.floor(Date.now() / 1000);
  R.ok('подпись живёт около часа', left > 3000 && left <= 3600, String(left));
  R.ok('номер подписи случайный, 32 байта', /^0x[0-9a-f]{64}$/.test(q.nonce));
}
R.ok('обычным путём ничего не ушло', sentNormal.length === 0);
const html1 = await page.evaluate(() => document.getElementById('sendResult').innerHTML);
R.ok('человек видит «отправлено»', /href="https:\/\/basescan\.org\/tx\//.test(html1) && !/не хватает/i.test(out1), out1.slice(0, 100));
R.ok('и никакой сырой разметки в тексте', !/target=|<a |href=/.test(out1), out1.slice(-80));

/* 2. Сервер отказал. */
relayCalls = []; relayOk = false;
const out2 = await sendUsdc('0x3333333333333333333333333333333333333333', '1');
R.ok('сервер отказал — говорим про нехватку ETH', /ETH/.test(out2) && /не хватает/i.test(out2), out2.slice(0, 120));
R.ok('и ничего не отправлено обычным путём', sentNormal.length === 0);

/* 3. ETH есть — платит сам. */
relayCalls = []; relayOk = true; eth = '0xde0b6b3a7640000';
await sendUsdc('0x4444444444444444444444444444444444444444', '1');
R.ok('к серверу не обращались', relayCalls.length === 0);
R.ok('перевод ушёл обычным путём', sentNormal.length === 1 && sentNormal[0].to.toLowerCase() === USDC.toLowerCase());

R.ok('поддельный USDC — нет', await page.evaluate(() => relayBaseOk('base', 'USDC', { contract: '0x1111111111111111111111111111111111111111' })) === false);
R.ok('USDT и другие сети — нет', await page.evaluate(() => !relayBaseOk('base', 'USDT', MAINNET.base.tokens.USDC) && !relayBaseOk('bnb', 'USDC', MAINNET.bnb.tokens.USDC)));

await browser.close();
const pass = R.done(errors.filter(x => !/requestfailed|ERR_|Failed to load resource|net::/.test(x)));
process.exit(pass ? 0 : 1);
