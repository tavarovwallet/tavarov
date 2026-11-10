/* BNB на одну операцию (functions/api/drip-bnb.js). Без сети, подставным
   узлом BNB Chain; всё подписанное сверяем с ethers:
     — перевод служебного кошелька подписан правильно: сеть 56, отправитель —
       служебный кошелёк, получатель — человек, сумма = газ × цена − что есть;
     — пропускаем только claim в контракте имён и transfer у USDT/USDC;
     — отказы: операция не пройдёт, BNB хватает, цены в сети взлетели,
       нет ключа. */
import { createRequire } from 'module';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const require = createRequire(import.meta.url);
const E = (r => r.ethers || r)(require('../www/lib/ethers.umd.min.js'));
const drip = await import('../functions/api/drip-bnb.js');

let fails = 0;
const ok = (name, cond, detail) => { console.log((cond ? 'OK   ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); if (!cond) fails++; };

const key = E.Wallet.createRandom().privateKey;
const dripAddr = new E.Wallet(key).address;
const user = E.Wallet.createRandom().address;
const iface = new E.utils.Interface(['function claim(string)', 'function transfer(address,uint256)', 'function approve(address,uint256)']);
const claimData = iface.encodeFunctionData('claim', ['muslih']);
const sendData = iface.encodeFunctionData('transfer', ['0x2222222222222222222222222222222222222222', 1000000]);

let userBal = '0x0', estimateFails = false, gasPrice = '0x5f5e100' /* 0.1 gwei */, sent = [];
const fakeFetch = async (url, init) => {
  const q = JSON.parse(init.body);
  const res = r => ({ json: async () => ({ jsonrpc: '2.0', id: q.id, result: r }) });
  const err = m => ({ json: async () => ({ jsonrpc: '2.0', id: q.id, error: { message: m } }) });
  switch (q.method){
    case 'eth_estimateGas': return estimateFails ? err('execution reverted: taken') : res('0x1d4c0'); // 120000
    case 'eth_gasPrice': return res(gasPrice);
    case 'eth_getBalance': return res(q.params[0].toLowerCase() === user.toLowerCase() ? userBal : '0xde0b6b3a7640000');
    case 'eth_getTransactionCount': return res('0x3');
    case 'eth_sendRawTransaction': sent.push(q.params[0]); return res(E.utils.parseTransaction(q.params[0]).hash);
  }
  return err('no method');
};
const env = { BNB_DRIP_KEY: key, V1_NO_THROTTLE: '1' };
const post = async (body, e = env) => {
  const request = new Request('https://wallet.tavarov.com/api/drip-bnb', { method: 'POST', body: JSON.stringify(body) });
  const r = await drip.onRequestPost({ request, env: e }, { fetch: fakeFetch });
  return { status: r.status, j: await r.json() };
};

/* 1. Имя, BNB нет. */
let r = await post({ from: user, to: drip.NAMES, data: claimData });
ok('BNB отправлен', r.status === 200 && /^0x[0-9a-f]{64}$/.test(r.j.hash || ''), JSON.stringify(r.j));
let tx = sent[0] && E.utils.parseTransaction(sent[0]);
const gas = 120000 * 13 / 10;
if (tx){
  ok('подписал служебный кошелёк', tx.from.toLowerCase() === dripAddr.toLowerCase(), tx.from);
  ok('сеть BNB Chain (56), обычная операция', tx.chainId === 56 && !tx.type, tx.chainId + '/' + tx.type);
  ok('получатель — человек, данных нет', tx.to.toLowerCase() === user.toLowerCase() && tx.data === '0x');
  ok('сумма = газ × цена газа', tx.value.toString() === String(BigInt(gas) * 100000000n), tx.value.toString());
  ok('номер операции от узла, газ 21000', tx.nonce === 3 && tx.gasLimit.toNumber() === 21000);
  ok('хеш совпадает с ответом', tx.hash === r.j.hash);
  ok('кошельку сказаны газ и цена', r.j.gas === String(gas) && r.j.gasPrice === '100000000', r.j.gas + ' ' + r.j.gasPrice);
}

/* 2. Перевод USDT, немного BNB уже есть — доливаем разницу. */
sent = []; userBal = '0x' + (1000000000000n).toString(16);   // 0.000001 BNB
r = await post({ from: user, to: drip.USDT, data: sendData });
tx = sent[0] && E.utils.parseTransaction(sent[0]);
ok('USDT: доливаем только разницу', r.status === 200 && tx && tx.value.toString() === String(BigInt(gas) * 100000000n - 1000000000000n),
   tx && tx.value.toString());
userBal = '0x0';

/* 3. Отказы. */
sent = [];
r = await post({ from: user, to: drip.USDT, data: iface.encodeFunctionData('approve', [user, 1]) });
ok('approve — нет', r.status === 400 && sent.length === 0);
r = await post({ from: user, to: '0x1111111111111111111111111111111111111111', data: sendData });
ok('чужой контракт — нет', r.status === 400 && sent.length === 0);
estimateFails = true;
r = await post({ from: user, to: drip.NAMES, data: claimData });
ok('операция не пройдёт — BNB не даём', r.status === 400 && sent.length === 0, JSON.stringify(r.j));
estimateFails = false;
userBal = '0xde0b6b3a7640000';
r = await post({ from: user, to: drip.NAMES, data: claimData });
ok('BNB хватает — не даём', r.status === 409 && sent.length === 0);
userBal = '0x0';
gasPrice = '0x2540be400';   // 10 gwei
r = await post({ from: user, to: drip.NAMES, data: claimData });
ok('цены в сети взлетели — отказ', r.status === 503 && sent.length === 0, JSON.stringify(r.j));
gasPrice = '0x5f5e100';
r = await post({ from: dripAddr, to: drip.NAMES, data: claimData });
ok('самому себе — нет', r.status === 400 && sent.length === 0);
r = await post({ from: user, to: drip.NAMES, data: claimData }, { V1_NO_THROTTLE: '1' });
ok('без ключа — выключено', r.status === 503);
ok('GET без ключа: off', (await (await drip.onRequestGet({ env: {} })).json()).on === false);

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
