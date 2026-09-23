/* Поддельный узел сети для проверок.

   Настоящий узел BNB из этой машины недоступен, а проверять надо именно то,
   что приложение делает с ответами сети. Поэтому поднимаем маленький узел,
   который отвечает ровно так, как ответил бы настоящий, и подставляем его
   вместо RPC. Все ответы кодируются настоящим ABI-кодировщиком ethers —
   значит, если приложение неправильно разбирает ответ, проверка это увидит.  */
import http from 'http';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const e = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const E = e.ethers || e;

export const ADDR = {
  pay:      '0x3A3Ba9776ea9c48AE6C69Ae6153d9bBc892ed6e6',
  token:    '0x74536e79b374CCFa0123035B28f7a3b7333f323a',
  usdt:     '0xb4ac75E8CF7c768FFd9fAfeAF1bF77B48209524e',
  staking:  '0x4d863016638BE4F858175bbD7B63aD6C29F1C346',
  charges:  '0x76f28505e2122f578C4bFa7067C249034A5785Ae',
  names:    '0x718E52F81F0Ed871bF8aa834faF82D0b257aE27A'
};

const IFACE = new E.utils.Interface([
  'function currentCharge(address merchant) view returns (address token, uint256 amount, string item, uint64 expiresAt, bool active)',
  'function setCharge(address token, uint128 amount, string item, uint32 ttl)',
  'function clearCharge()',
  'function vaultOf(address) view returns (address)',
  'function feeBps() view returns (uint16)',
  'function buyerShareBps() view returns (uint16)',
  'function acceptedToken(address) view returns (bool)',
  'function previewRewards(address token, uint256 amount) view returns (uint256 merchantReward, uint256 buyerReward)',
  'function bonusOf(address) view returns (uint128 pending, uint128 claimable, uint64 lastTouch)',
  'function claimableOf(address) view returns (uint256)',
  'function rewardFor(address token, uint256 amount) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function pending(address token) view returns (uint256)',
  'function merchant() view returns (address)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function pay(address merchant, address token, uint256 amount, bytes32 invoice)',
  'function transfer(address,uint256) returns (bool)',
  'function claim(string name)',
  'function release()',
  'function addressOf(string name) view returns (address)',
  'function nameOf(address who) view returns (string)',
  'function isFree(string name) view returns (bool)',
  'function isValid(string name) view returns (bool)',
  'function priceOf(string name) view returns (uint256)',
  'function freeMinLen() view returns (uint16)',
  'function VERSION() view returns (uint16)',
  'function VESTING() view returns (uint256)',
  'function refund(bytes32 invoice, uint256 amount)',
  'function saleOf(bytes32) view returns (address merchant, uint96 amount, address buyer, uint96 refunded, address token, uint128 buyerReward, uint128 merchantReward)',
  'function referralOf(address) view returns (address referrer, uint64 until)',
  'function hasSold(address) view returns (bool)',
  'function setReferrer(address referrer)',
  'function REF_SHARE_BPS() view returns (uint16)',
  'function claimBonus()',
  'event Paid(address indexed merchant, address indexed payer, address indexed token, uint256 amountToMerchant, uint256 fee, uint256 reward, bytes32 invoice)'
]);

/* Отказ контракта словами — ровно так, как его кодирует настоящая сеть:
   Error(string) с восьмизначной меткой 0x08c379a0 впереди. */
function revertWith(msg){ return { revert: msg }; }
function revertData(msg){
  return '0x08c379a0' + E.utils.defaultAbiCoder.encode(['string'], [msg]).slice(2);
}

/* Те же правила, что в контракте имён. */
const NAME_OK = /^[a-z][a-z0-9_]{2,19}$/;

/* Что «происходит в сети». Тесты меняют это на ходу. */
export const state = {
  charge: null,          // { token, amount, item, expiresAt } либо null
  vaults: {},            // адрес продавца -> адрес приёмника
  balances: {},          // адрес -> { native, USDT, TVR }
  feeBps: 100,
  names: {},             // имя -> адрес
  /* Третья версия контракта имён знает цену, вторая — нет вовсе. Отличие не
     косметическое: приложение обязано работать с обеими и не принимать
     «такой функции нет» за «имя платное». */
  namesV3: false,
  prices: {},            // длина имени -> цена в вей
  freeMinLen: 6,         // короче этого бесплатно не занять

  sent: [],              // все отправленные транзакции, в сыром виде
  calls: [],             // все eth_call, для проверки «а спросили ли»

  payVersion: 1,         // 1 — контракт без возвратов, 2 — с возвратами
  /* Покупки, записанные контрактом под номером счёта: номер -> что это было.
     Именно отсюда страница счёта узнаёт, СКОЛЬКО и ЧЕМ заплатили, а не
     только «кто-то заплатил». */
  sales: {},
  block: 5000,           // «высота» сети: история спрашивает события кусками от неё
  /* Бонус и его созревание. Начисленное лежит в pending и переходит в
     claimable долями — ровно как в настоящем контракте; приложение обязано
     объяснять это человеку числами, а не молчать. */
  bonus: { pending: 0, claimable: 0 },
  /* Разрешение на списание. Ноль значит «касса ещё не вправе брать деньги» —
     ровно то состояние, в котором настоящий контракт отвечает отказом. */
  allowance: 0,
  /* Записывается ли разрешение на самом деле. false — approve уходит в сеть,
     но не подтверждается: так выглядит перегруженный узел. Приложение обязано
     это заметить и не слать заведомо обречённую оплату. */
  approveSticks: true,
  /* Что отвечает узел на попытку посчитать газ. null — считает как обычно,
     строка — отвечает отказом контракта с этим текстом. */
  revert: null,
  /* Чем сеть отвечает на вопрос «как там операция»: 0x1 — записана, 0x0 —
     отвергнута контрактом. */
  txStatus: '0x1',
  /* Сколько раз подряд узел ответит «квитанции ещё нет». */
  receiptSilent: 0,
  vestingSeconds: 90 * 86400,
  /* Третья версия контракта оплаты: кто кого привёл и была ли продажа. */
  referral: {},          // продавец (нижний регистр) -> { referrer, until }
  sold: {},              // продавец (нижний регистр) -> true
  /* Когда развёрнута новая версия, у старой свои версия и бонусы. Ключ —
     адрес контракта в нижнем регистре; нет ключа — общие значения выше. */
  versionByHub: {},
  bonusByHub: {},
  logs: []               // события в сети: их отдаём на eth_getLogs
};

/* Собрать событие оплаты так, как его отдал бы настоящий узел.
   Кодируем настоящим ABI-кодировщиком: если приложение разберёт лог
   неправильно, проверка это увидит. */
export function paidLog({ merchant, payer, token, toMerchant, fee, reward, invoice, block = 1, address }){
  const ev = IFACE.getEvent('Paid');
  const enc = IFACE.encodeEventLog(ev, [merchant, payer, token, toMerchant, fee, reward, invoice]);
  return {
    address: address || ADDR.pay,
    topics: enc.topics,
    data: enc.data,
    blockNumber: '0x' + block.toString(16),
    transactionHash: '0x' + String(block).padStart(2, '0').repeat(32).slice(0, 64),
    logIndex: '0x0', transactionIndex: '0x0',
    blockHash: '0x' + '22'.repeat(32), removed: false
  };
}

/* Обычный перевод токена — то, из чего собирается история. Кодируем так же
   честно, как настоящий узел: тема с адресом дополнена нулями до 32 байт,
   сумма лежит в данных. Ошибись приложение хоть в одном знаке — увидим. */
export function transferLog({ token, from, to, amount, decimals = 18, block = 1, hash }){
  const pad = a => '0x' + '0'.repeat(24) + String(a).toLowerCase().replace('0x', '');
  return {
    address: token,
    topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', pad(from), pad(to)],
    data: E.utils.hexZeroPad(E.utils.parseUnits(String(amount), decimals).toHexString(), 32),
    blockNumber: '0x' + block.toString(16),
    transactionHash: hash || ('0x' + String(block).padStart(2, '0').repeat(32).slice(0, 64)),
    logIndex: '0x0', transactionIndex: '0x0',
    blockHash: '0x' + '22'.repeat(32), removed: false
  };
}

function encCall(name, values){
  const fn = IFACE.getFunction(name);
  return IFACE.encodeFunctionResult(fn, values);
}

function handleCall(to, data){
  const sel = data.slice(0, 10);
  let fn = null;
  for (const f of Object.values(IFACE.functions)){
    if (IFACE.getSighash(f) === sel) { fn = f; break; }
  }
  if (!fn) return '0x';
  const args = IFACE.decodeFunctionData(fn, data);
  state.calls.push({ to: to.toLowerCase(), name: fn.name, args: args.map(String) });

  switch (fn.name){
    case 'currentCharge': {
      const c = state.charge;
      const now = Math.floor(Date.now()/1000);
      if (!c) return encCall('currentCharge', ['0x0000000000000000000000000000000000000000', 0, '', 0, false]);
      return encCall('currentCharge', [c.token, c.amount, c.item, c.expiresAt, c.amount > 0 && now < c.expiresAt]);
    }
    case 'vaultOf':
      return encCall('vaultOf', [state.vaults[args[0].toLowerCase()] || '0x0000000000000000000000000000000000000000']);
    case 'feeBps':        return encCall('feeBps', [state.feeBps]);
    case 'isValid':       return encCall('isValid', [NAME_OK.test(args[0])]);
    case 'isFree':        return encCall('isFree', [NAME_OK.test(args[0]) && !state.names[args[0]]]);
    case 'addressOf':     return encCall('addressOf', [state.names[args[0]] || '0x0000000000000000000000000000000000000000']);
    /* Цена имени. Третья версия контракта её знает, вторая — нет вовсе, и
       тогда узел отвечает пустотой: приложение обязано понять это как
       «имя бесплатное», а не как поломку. Короткое имя без цены — отказ,
       и это другой ответ, не ноль. */
    case 'priceOf': {
      if (!state.namesV3) return '0x';
      const len = String(args[0]).length;
      const p = state.prices[len] || 0;
      if (len < state.freeMinLen && !p) return revertWith('Names: short names are not for sale yet');
      return encCall('priceOf', [p]);
    }
    case 'freeMinLen':
      if (!state.namesV3) return '0x';
      return encCall('freeMinLen', [state.freeMinLen]);
    case 'nameOf': {
      const who = args[0].toLowerCase();
      const found = Object.keys(state.names).find(n => state.names[n].toLowerCase() === who);
      return encCall('nameOf', [found || '']);
    }
    case 'saleOf': {
      /* Первая версия контракта покупок не помнит: у неё такой функции
         нет, и узел отвечает пустотой. Проверка запасного пути на этом и
         держится. */
      if (state.payVersion < 2) return '0x';
      const z = '0x0000000000000000000000000000000000000000';
      const sale = state.sales[String(args[0]).toLowerCase()];
      if (!sale) return encCall('saleOf', [z, 0, z, 0, z, 0, 0]);
      return encCall('saleOf', [sale.merchant, sale.amount, sale.buyer || z,
                                sale.refunded || 0, sale.token, 0, 0]);
    }
    case 'VERSION': {
      /* У первой версии контракта такой функции нет вовсе, и узел отвечает
         пустотой. Приложение по этому и понимает, что возвратов там нет. */
      const v = state.versionByHub[to.toLowerCase()] !== undefined ? state.versionByHub[to.toLowerCase()] : state.payVersion;
      return v >= 2 ? encCall('VERSION', [v]) : '0x';
    }
    case 'referralOf': {
      const v = state.versionByHub[to.toLowerCase()] !== undefined ? state.versionByHub[to.toLowerCase()] : state.payVersion;
      if (v < 3) return '0x';
      const r = state.referral[args[0].toLowerCase()];
      return encCall('referralOf', [r ? r.referrer : '0x0000000000000000000000000000000000000000', r ? r.until : 0]);
    }
    case 'hasSold':       return encCall('hasSold', [!!state.sold[args[0].toLowerCase()]]);
    case 'REF_SHARE_BPS': return encCall('REF_SHARE_BPS', [2000]);
    case 'buyerShareBps': return encCall('buyerShareBps', [6000]);
    case 'acceptedToken': return encCall('acceptedToken', [args[0].toLowerCase() === ADDR.usdt.toLowerCase()]);
    case 'previewRewards':return encCall('previewRewards', [E.BigNumber.from(args[1]).mul(6).div(10), E.BigNumber.from(args[1]).mul(4).div(10)]);
    case 'bonusOf': {
      const b = state.bonusByHub[to.toLowerCase()] || state.bonus;
      return encCall('bonusOf', [E.utils.parseUnits(String(b.pending), 18), E.utils.parseUnits(String(b.claimable), 18), 0]);
    }
    case 'claimableOf': {
      const b = state.bonusByHub[to.toLowerCase()] || state.bonus;
      return encCall('claimableOf', [E.utils.parseUnits(String(b.claimable), 18)]);
    }
    case 'VESTING':       return encCall('VESTING', [state.vestingSeconds]);
    case 'rewardFor':     return encCall('rewardFor', [0]);
    case 'allowance':     return encCall('allowance', [state.allowance]);
    case 'pending':       return encCall('pending', [0]);
    case 'merchant':      return encCall('merchant', ['0x0000000000000000000000000000000000000000']);
    case 'balanceOf': {
      const who = args[0].toLowerCase();
      const b = state.balances[who] || {};
      const key = to.toLowerCase() === ADDR.usdt.toLowerCase() ? 'USDT'
                : to.toLowerCase() === ADDR.token.toLowerCase() ? 'TVR' : 'other';
      const units = key === 'USDT' ? 6 : 18;
      return encCall('balanceOf', [E.utils.parseUnits(String(b[key] || 0), units)]);
    }
    default: return '0x';
  }
}

export function start(port = 8555){
  const srv = http.createServer((req, res) => {
    /* Страница живёт на другом порту, значит браузер сначала спросит
       разрешение отдельным запросом OPTIONS. Не ответить на него —
       и все обращения к сети молча не состоятся. */
    if (req.method === 'OPTIONS'){
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': '*',
        'access-control-max-age': '86400'
      });
      res.end();
      return;
    }
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      let reqs;
      try { reqs = JSON.parse(body); } catch(e){ res.end('{}'); return; }
      const one = (r) => {
        const id = r.id, m = r.method, p = r.params || [];
        const wrap = (result) => ({ jsonrpc:'2.0', id, result });
        switch (m){
          case 'eth_chainId':   return wrap('0x61');
          case 'net_version':   return wrap('97');
          case 'eth_blockNumber': return wrap('0x' + state.block.toString(16));
          case 'eth_getBalance': {
            const b = state.balances[String(p[0]).toLowerCase()] || {};
            const hex = E.utils.parseEther(String(b.native || 0)).toHexString();
            return wrap(hex === '0x00' ? '0x0' : hex.replace(/^0x0+(?=.)/, '0x'));
          }
          case 'eth_call': {
            const out = handleCall(p[0].to, p[0].data);
            /* Контракт умеет отвечать не только данными, но и отказом со
               словами. Настоящий узел кладёт эти слова в error.data, и
               приложение их оттуда читает — значит поддельный обязан тоже. */
            if (out && out.revert)
              return { jsonrpc:'2.0', id, error:{ code:3, message:'execution reverted: '+out.revert,
                                                  data: revertData(out.revert) } };
            return wrap(out);
          }
          case 'eth_getLogs': {
            const f = p[0] || {};
            const want = (f.topics || []).filter(x => x !== null && x !== undefined);
            /* Адрес может прийти списком: история спрашивает события сразу по
               всем валютам одним запросом — иначе на каждую монету уходит своя
               пара запросов, и узел отвечает отказом «слишком часто». */
            const want1 = f.address === undefined || f.address === null ? null
              : (Array.isArray(f.address) ? f.address : [f.address]).map(x => String(x).toLowerCase());
            /* Границы блоков соблюдаем по-настоящему. Иначе проверка истории
               ничего не стоит: приложение спрашивает события кусками, а
               поддельный узел на каждый кусок отдавал бы всё подряд — и три
               одинаковых строки в списке мы бы приняли за исправную работу. */
            const num = v => v === undefined || v === null || v === 'latest' || v === 'pending'
              ? null : parseInt(String(v), 16);
            const lo = num(f.fromBlock), hi = num(f.toBlock);
            const out = state.logs.filter(l => {
              const b = parseInt(String(l.blockNumber), 16);
              if (lo !== null && b < lo) return false;
              if (hi !== null && b > hi) return false;
              if (want1 && want1.indexOf(String(l.address).toLowerCase()) < 0) return false;
              return (f.topics || []).every((t, i) => t === null || t === undefined ||
                (l.topics[i] && String(t).toLowerCase() === String(l.topics[i]).toLowerCase()));
            });
            void want;
            return wrap(out);
          }
          case 'eth_getCode':   return wrap('0x60006000');
          case 'eth_gasPrice':  return wrap('0x12a05f200');
          case 'eth_estimateGas':
            if (state.revert) return { jsonrpc:'2.0', id, error:{ code:3,
              message:'execution reverted: ' + state.revert } };
            return wrap('0x1e8480');
          case 'eth_getTransactionCount': return wrap('0x0');
          case 'eth_sendRawTransaction': {
            const tx = E.utils.parseTransaction(p[0]);
            /* Запоминаем и то, как посчитан газ: на этом 7 сентября сломалась
               оплата в основной сети, и проверять это надо машиной. */
            state.sent.push({ to: tx.to, data: tx.data, value: tx.value.toString(), hash: tx.hash,
                              type: tx.type,
                              gasPrice: tx.gasPrice ? tx.gasPrice.toString() : null,
                              maxFeePerGas: tx.maxFeePerGas ? tx.maxFeePerGas.toString() : null,
                              maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? tx.maxPriorityFeePerGas.toString() : null });
            /* Разрешение на списание настоящий токен записывает сразу же.
               Не повторить это здесь — значит проверять несуществующий мир:
               приложение теперь перечитывает разрешение после approve, и
               поддельный узел обязан отвечать так же, как настоящий. */
            if (state.approveSticks && tx.data && tx.data.slice(0, 10) === IFACE.getSighash('approve')){
              try{
                const a2 = IFACE.decodeFunctionData('approve', tx.data);
                state.allowance = a2[1].toString();
              } catch(e){}
            }

            if (tx.data && tx.data.slice(0, 10) === IFACE.getSighash('setReferrer')){
              const a = IFACE.decodeFunctionData('setReferrer', tx.data);
              state.referral[String(tx.from).toLowerCase()] =
                { referrer: a[0], until: Math.floor(Date.now() / 1000) + 365 * 86400 };
            }
            /* Настоящий контракт счетов сразу меняет своё состояние —
               повторяем это, иначе проверки видят несуществующий мир. */
            if (tx.to && tx.to.toLowerCase() === ADDR.names.toLowerCase()){
              const sel = tx.data.slice(0, 10);
              if (sel === IFACE.getSighash('claim')){
                const a = IFACE.decodeFunctionData('claim', tx.data);
                state.names[a[0]] = tx.from;
              } else if (sel === IFACE.getSighash('release')){
                const who = String(tx.from).toLowerCase();
                Object.keys(state.names).forEach(n => { if (state.names[n].toLowerCase() === who) delete state.names[n]; });
              }
            }
            if (tx.to && tx.to.toLowerCase() === ADDR.charges.toLowerCase()){
              const sel = tx.data.slice(0, 10);
              if (sel === IFACE.getSighash('setCharge')){
                const a = IFACE.decodeFunctionData('setCharge', tx.data);
                state.charge = { token:a[0], amount:a[1], item:a[2],
                                 expiresAt: Math.floor(Date.now()/1000) + Number(a[3]) };
              } else if (sel === IFACE.getSighash('clearCharge')){
                state.charge = null;
              }
            }
            /* Возвращаем настоящий хеш присланной транзакции: ethers его
               проверяет и на подделку отвечает отказом. */
            return wrap(tx.hash);
          }
          case 'eth_getTransactionReceipt':
            /* Узел бывает занят, и квитанция приходит не сразу. Пока счётчик
               не отработал, отвечаем пустотой — ровно как настоящая сеть,
               которая ещё не записала операцию. Это не выдумка ради проверки:
               именно так 15 сентября выглядел перевод TVR, который дошёл, а
               приложение осталось с надписью «сеть не подтвердила». */
            if (state.receiptSilent > 0){ state.receiptSilent--; return wrap(null); }
            /* Операция записана, но контракт её отверг. Сеть отвечает ровно
               так: квитанция есть, а состояние в ней нулевое. Отличить это
               от «ещё не подтверждено» приложение обязано само. */
            return wrap({ transactionHash: p[0], status: state.txStatus, blockNumber: '0x1', logs: [],
                          gasUsed:'0x5208', cumulativeGasUsed:'0x5208', contractAddress:null,
                          from:'0x'+'00'.repeat(20), to:'0x'+'00'.repeat(20), transactionIndex:'0x0',
                          blockHash:'0x'+'22'.repeat(32), logsBloom:'0x'+'00'.repeat(256), type:'0x0', confirmations:1 });
          case 'eth_getBlockByNumber':
            return wrap({ number:'0x1', hash:'0x'+'22'.repeat(32), parentHash:'0x'+'00'.repeat(32),
                          timestamp:'0x'+Math.floor(Date.now()/1000).toString(16), transactions:[],
                          gasLimit:'0x1c9c380', gasUsed:'0x0', miner:'0x'+'00'.repeat(20), difficulty:'0x0',
                          extraData:'0x', baseFeePerGas:null });
          default: return { jsonrpc:'2.0', id, error:{ code:-32601, message:'нет метода '+m } };
        }
      };
      const out = Array.isArray(reqs) ? reqs.map(one) : one(reqs);
      res.writeHead(200, { 'content-type':'application/json', 'access-control-allow-origin':'*' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise(r => srv.listen(port, () => r(srv)));
}
