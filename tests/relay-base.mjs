/* USDC в Base без ETH: служебный кошелёк отправляет перевод по подписи
   владельца (functions/api/relay-base.js). Проверяем без сети, подставным
   узлом Base, и сверяем всё, что подписано, с ethers — независимой
   реализацией:
     — адрес служебного кошелька из ключа считается так же, как в ethers;
     — операция служебного кошелька подписана правильно (ethers её разбирает
       и узнаёт отправителя), сеть 8453, адресат — контракт USDC, денег 0;
     — внутри — ровно перевод владельца: от кого, кому, сколько, и подпись
       владельца сходится;
     — отказы: у владельца есть ETH, сумма меньше 0.10, перевод не пройдёт,
       ключа нет. */
import { createRequire } from 'module';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const require = createRequire(import.meta.url);
const E = (r => r.ethers || r)(require('../www/lib/ethers.umd.min.js'));
const relay = await import('../functions/api/relay-base.js');

let fails = 0;
const ok = (name, cond, detail) => { console.log((cond ? 'OK   ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); if (!cond) fails++; };

const relayKey = E.Wallet.createRandom().privateKey;
const relayAddr = new E.Wallet(relayKey).address;
ok('адрес служебного кошелька как в ethers', relay.relayerAddress(relayKey).toLowerCase() === relayAddr.toLowerCase());

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const owner = E.Wallet.createRandom();
const to = '0x2222222222222222222222222222222222222222';
const now = Math.floor(Date.now() / 1000);
const msg = { from: owner.address, to, value: '1000000', validAfter: 0, validBefore: now + 3600,
              nonce: E.utils.hexlify(E.utils.randomBytes(32)) };
const domain = { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC };
const types = { TransferWithAuthorization: [ { name:'from', type:'address' }, { name:'to', type:'address' },
  { name:'value', type:'uint256' }, { name:'validAfter', type:'uint256' }, { name:'validBefore', type:'uint256' },
  { name:'nonce', type:'bytes32' } ] };
const signature = await owner._signTypedData(domain, types, msg);

/* Подставной узел Base. */
let ownerEth = '0x0', callFails = false, sent = [];
const fakeFetch = async (url, init) => {
  const q = JSON.parse(init.body);
  const res = r => ({ json: async () => ({ jsonrpc: '2.0', id: q.id, result: r }) });
  const err = m => ({ json: async () => ({ jsonrpc: '2.0', id: q.id, error: { message: m } }) });
  switch (q.method){
    case 'eth_getBalance': return res(q.params[0].toLowerCase() === owner.address.toLowerCase() ? ownerEth : '0x1');
    case 'eth_call': return callFails ? err('execution reverted: FiatTokenV2: invalid signature') : res('0x');
    case 'eth_estimateGas': return res('0x15f90');
    case 'eth_getBlockByNumber': return res({ baseFeePerGas: '0x5f5e100' });
    case 'eth_maxPriorityFeePerGas': return res('0xf4240');
    case 'eth_getTransactionCount': return res('0x7');
    case 'eth_sendRawTransaction': sent.push(q.params[0]); return res(E.utils.parseTransaction(q.params[0]).hash);
  }
  return err('no method');
};
const env = { BASE_RELAYER_KEY: relayKey, V1_NO_THROTTLE: '1' };
const post = async (body, e = env) => {
  const request = new Request('https://wallet.tavarov.com/api/relay-base', { method: 'POST', body: JSON.stringify(body) });
  const r = await relay.onRequestPost({ request, env: e }, { fetch: fakeFetch });
  return { status: r.status, j: await r.json() };
};

/* 1. Всё как надо. */
let r = await post(Object.assign({}, msg, { signature }));
ok('перевод отправлен', r.status === 200 && /^0x[0-9a-f]{64}$/.test(r.j.hash || ''), JSON.stringify(r.j));
const tx = sent[0] && E.utils.parseTransaction(sent[0]);
if (tx){
  ok('подписал служебный кошелёк', tx.from.toLowerCase() === relayAddr.toLowerCase(), tx.from);
  ok('сеть Base (8453), тип 2', tx.chainId === 8453 && tx.type === 2);
  ok('адресат — контракт USDC, денег ноль', tx.to.toLowerCase() === USDC.toLowerCase() && tx.value.isZero());
  ok('номер операции от узла', tx.nonce === 7);
  ok('хеш совпадает с ответом', tx.hash === r.j.hash);
  const iface = new E.utils.Interface(['function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)']);
  const d = iface.decodeFunctionData('transferWithAuthorization', tx.data);
  ok('от кого / кому / сколько — как подписал владелец',
     d[0] === owner.address && d[1].toLowerCase() === to && d[2].toString() === '1000000');
  const back = E.utils.verifyTypedData(domain, types,
    { from: d[0], to: d[1], value: d[2].toString(), validAfter: d[3].toNumber(), validBefore: d[4].toNumber(), nonce: d[5] },
    E.utils.joinSignature({ v: d[6], r: d[7], s: d[8] }));
  ok('подпись владельца сходится', back === owner.address, back);
}

/* 2. Отказы. */
sent = [];
ownerEth = '0x2386f26fc10000';   // 0.01 ETH
r = await post(Object.assign({}, msg, { signature }));
ok('у кого есть ETH — платит сам', r.status === 409 && sent.length === 0, JSON.stringify(r.j));
ownerEth = '0x0';
r = await post(Object.assign({}, msg, { value: '50000', signature }));
ok('меньше 0.10 USDC — нет', r.status === 400 && sent.length === 0);
callFails = true;
r = await post(Object.assign({}, msg, { signature }));
ok('перевод не пройдёт — газ не тратим', r.status === 400 && sent.length === 0, JSON.stringify(r.j));
callFails = false;
r = await post(Object.assign({}, msg, { to: owner.address, signature }));
ok('себе — нет', r.status === 400);
r = await post(Object.assign({}, msg, { signature }), { V1_NO_THROTTLE: '1' });
ok('без ключа — выключено', r.status === 503);
const g = await relay.onRequestGet({ env: {} });
ok('GET без ключа: off', (await g.json()).on === false);

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
