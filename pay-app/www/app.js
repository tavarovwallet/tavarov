/* Tavarov Pay — a till for sellers.

   What this app does: the seller types an amount, the app shows a payment
   code, and it watches public blockchain nodes until the payment arrives.

   What this app does NOT do, on purpose, and must never start doing:
   it holds no keys, creates and imports no wallets, moves no money and
   signs nothing. There is no blockchain library here at all; every request
   to a node goes through rpc() below, which only lets read-only methods
   through. The seller's address is public information, typed in by the
   seller, and it is the only thing we store besides the sales history.

   The payment code is the same one the NoN Wallet till makes
   (buildQrPayload / buildWebInvoice in www/index.html), so every buyer who
   can pay the wallet's till can pay this one. */
'use strict';

const APP_VERSION = '0.1.0';
const SITE = 'https://wallet.tavarov.com';           // where pay.html lives
const KEY = {
  cfg:  'tavarov.pay.cfg.v1',        // { address, name, shop, nets[] }
  hist: 'tavarov.pay.history.v1',    // [ sale ]
  open: 'tavarov.pay.open.v1',       // the sale on screen, so a restart does not lose it
  lang: 'tavarov.pay.lang.v1',
  test: 'tavarov.pay.testnet.v1'     // '1' = BNB testnet; only the browser tests use it
};

/* ---------- Networks ----------
   Addresses are copied from www/index.html (MAINNET, CONTRACTS) and
   functions/api/status.js. "pay" is the TavarovPay contract: we only READ
   from it (saleOf, feeBps) and from its Paid events.
   logRpcs: nodes that answer eth_getLogs (the Binance nodes refuse it). */
const NETS = {
  bnb: { code:'bnb', key:'bnb', name:'BNB Chain', chainId:56, blockSec:0.75,
    rpcs:['https://bsc-dataseed.binance.org','https://bsc-dataseed1.bnbchain.org','https://bsc-dataseed2.bnbchain.org','https://bsc-rpc.publicnode.com'],
    logRpcs:['https://bsc-rpc.publicnode.com','https://bsc-dataseed.binance.org'],
    explorer:'https://bscscan.com',
    pay:'0x1Fc681FA250A17e66B57B7150F2EeD4e71D1Ca35',
    tokens:{ USDT:{ a:'0x55d398326f99059fF775485246999027B3197955', d:18 },
             USDC:{ a:'0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', d:18 } } },
  eth: { code:'eth', key:'eth', name:'Ethereum', chainId:1, blockSec:12,
    rpcs:['https://ethereum-rpc.publicnode.com','https://eth.drpc.org'],
    logRpcs:['https://ethereum-rpc.publicnode.com','https://eth.drpc.org'],
    explorer:'https://etherscan.io',
    pay:'0x5046399643c387d93e1467bad3fd7edf3fb459da',
    tokens:{ USDT:{ a:'0xdAC17F958D2ee523a2206206994597C13D831ec7', d:6 },
             USDC:{ a:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', d:6 } } },
  base: { code:'base', key:'base', name:'Base', chainId:8453, blockSec:2,
    rpcs:['https://base-rpc.publicnode.com','https://mainnet.base.org'],
    logRpcs:['https://base-rpc.publicnode.com','https://mainnet.base.org'],
    explorer:'https://basescan.org',
    pay:'0x5046399643c387d93e1467bad3fd7edf3fb459da',
    tokens:{ USDC:{ a:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', d:6 } } }
};
/* BNB testnet, as in the wallet's TESTNET + CONTRACTS.bnbTestnet. The wallet
   writes the network key "bnb" into tv_net and the chain id 97 into the code;
   the payment page gets "bnbTestnet". We do exactly the same. */
const TESTNET = {
  bnb: { code:'bnbTestnet', key:'bnb', name:'BNB testnet', chainId:97, blockSec:3,
    rpcs:['https://bsc-testnet-rpc.publicnode.com','https://data-seed-prebsc-1-s1.bnbchain.org:8545'],
    logRpcs:['https://bsc-testnet-rpc.publicnode.com'],
    explorer:'https://testnet.bscscan.com',
    pay:'0x3A3Ba9776ea9c48AE6C69Ae6153d9bBc892ed6e6',
    tokens:{ USDT:{ a:'0xb4ac75E8CF7c768FFd9fAfeAF1bF77B48209524e', d:6 } } }
};
/* NoN names live on BNB Chain only (TavarovNames). Read-only: addressOf(name). */
const NAMES_CONTRACT = { main:'0xd6E8A78634bE366bDbD041227D1E94F5b374338e', test:'0x718E52F81F0Ed871bF8aa834faF82D0b257aE27A' };
const NAME_RE = /^[a-z][a-z0-9_]{2,19}$/;           // the contract's own rule

function testnet(){ return store.get(KEY.test) === '1'; }
function netTable(){ return testnet() ? TESTNET : NETS; }
function netOf(k){ return netTable()[k] || null; }

/* Function selectors and event topics, worked out once with keccak256 and
   checked against ethers in the browser test. */
const SEL = { addressOf:'0xccf1454a', saleOf:'0x38d56afe', balanceOf:'0x70a08231', feeBps:'0x24a9d853' };
const TOPIC = {
  Paid:     '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861',
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
};
const ZERO = '0x0000000000000000000000000000000000000000';

/* ---------- Storage (never throws) ---------- */
const store = {
  get(k){ try{ return localStorage.getItem(k); } catch(e){ return null; } },
  set(k, v){ try{ localStorage.setItem(k, v); } catch(e){} },
  del(k){ try{ localStorage.removeItem(k); } catch(e){} },
  json(k, dflt){ try{ const v = JSON.parse(localStorage.getItem(k)); return v === null ? dflt : v; } catch(e){ return dflt; } }
};

/* ---------- Languages ---------- */
const DICT = {
  en: {
    setupTitle:'Accept payments in USDT and USDC',
    setupSub:'Tavarov Pay shows your customer a payment code and tells you when the payment has arrived. It never holds money and never asks for a password or keys.',
    destLabel:'Where should payments arrive?', destPh:'NoN name or 0x… address',
    destNote:'Your NoN name (for example, kofeinya) or the 0x… address of the wallet you receive money in, on BNB Chain.',
    check:'Check', checking:'Checking…',
    destFound:'Payments will arrive at this address:', viaName:'Found by the name',
    openExplorer:'Check it in the block explorer',
    destContract:'This address is a smart contract, not an ordinary wallet. Make sure it can receive USDT and USDC before you use it.',
    shopLabel:'Shop name (optional, the customer sees it)', shopPh:'Corner Coffee',
    destConfirm:'I checked: this is my address and the money will reach me.',
    save:'Save and start',
    setupPrivacy:'This is stored only on this device. Nothing is sent to us.',
    errEmpty:'Type a NoN name or a 0x… address.',
    errFormat:'This is neither a NoN name nor a 0x… address. A name is 3–20 Latin letters, digits or _ and starts with a letter; an address is 0x and 40 characters.',
    errChecksum:'This address has a typo: its capital letters do not match. Copy it again from your wallet.',
    errNoName:'Nobody has the name “%s”. Check the spelling.',
    errNet:'Could not reach the network: %s. Check the internet connection and try again.',
    errZero:'This address cannot receive money.',
    nameMoved:'Your name “%n” now points to a different address (%a). Payments still go to the saved address %s. If this is not what you expect, check it in Settings.',
    itemPh:'What for (optional)', charge:'Show payment code',
    onNet:'on %s',
    qrApp:'Wallet app', qrWeb:'Payment page',
    hintApp:'Scan with NoN Wallet, or with the scanner of another wallet app that understands payment codes.',
    manual:'No scanner? Transfer exactly %a on %n to this address (no fee, and the amount must arrive in full):',
    hintWeb:'Scan with the phone camera: a payment page opens in the browser, and the customer picks a wallet there.',
    waiting:'Waiting for payment', showLink:'Show the payment link', share:'Share link', cancel:'Cancel',
    cancelAsk:'Stop waiting for this payment? If the customer pays later, it will not be shown here.',
    feeNote:'Paid with NoN Wallet or on the payment page: 1% service fee, taken from the amount you receive. Paid by a plain transfer from another wallet app: no fee.',
    shareText:'Payment: %s',
    waitNet:'No answer from the network yet. Still watching…',
    burned:'This payment code has been used by someone else. Cancel it and make a new one.',
    paid:'Paid', received:'You received', fee:'Service fee', how:'How it was paid', item:'What for', when:'Time',
    viaContract:'NoN Wallet or payment page', viaTransfer:'Plain transfer', noFee:'none',
    viewTx:'View transaction', viewAddr:'View your address in the block explorer', newSale:'New sale',
    today:'Today', history:'Today’s sales', settings:'Settings', back:'Back to the till',
    totalLabel:'Taken today', totalNote:'%n sales · you received %r after fees',
    noSales:'No sales yet today.', sale1:'sale', from:'from',
    destLabelShort:'Payments arrive at', shopLabelShort:'Shop name', change:'Change address',
    networks:'Networks', netAlways:'always on',
    netsNote:'Turn on Ethereum or Base only if your address is your own wallet that works on those networks too. An exchange deposit address usually works on one network only, and money sent on another network can be lost.',
    netIsContract:'On %s this address is a smart contract, so it may belong to someone else there. Not turned on.',
    about:'About',
    aboutText:'Tavarov Pay is a till: it makes payment codes and watches public blockchain nodes for the payment. It cannot move, hold or spend money, and it has no account. Your settings and the sales history stay on this device.',
    version:'Version %s', testnetOn:'TEST NETWORK — not real money'
  },
  ru: {
    setupTitle:'Принимайте оплату в USDT и USDC',
    setupSub:'Tavarov Pay показывает покупателю код для оплаты и сообщает, когда деньги пришли. Он не хранит деньги и никогда не спрашивает пароль или ключи.',
    destLabel:'Куда приходят деньги?', destPh:'Имя NoN или адрес 0x…',
    destNote:'Ваше имя NoN (например, kofeinya) или адрес 0x… кошелька, на который вы получаете деньги в сети BNB Chain.',
    check:'Проверить', checking:'Проверяем…',
    destFound:'Деньги будут приходить на этот адрес:', viaName:'Найден по имени',
    openExplorer:'Проверить в обозревателе блоков',
    destContract:'Этот адрес — смарт-контракт, а не обычный кошелёк. Убедитесь, что он может принимать USDT и USDC.',
    shopLabel:'Название точки (необязательно, его видит покупатель)', shopPh:'Кофейня на углу',
    destConfirm:'Я проверил: это мой адрес, и деньги дойдут до меня.',
    save:'Сохранить и начать',
    setupPrivacy:'Это хранится только на этом устройстве. Нам ничего не передаётся.',
    errEmpty:'Впишите имя NoN или адрес 0x….',
    errFormat:'Это не имя NoN и не адрес 0x…. Имя — от 3 до 20 латинских букв, цифр или _, начинается с буквы; адрес — 0x и 40 знаков.',
    errChecksum:'В адресе опечатка: заглавные буквы не сходятся. Скопируйте его из кошелька заново.',
    errNoName:'Имя «%s» никому не принадлежит. Проверьте написание.',
    errNet:'Сеть не ответила: %s. Проверьте интернет и попробуйте ещё раз.',
    errZero:'На этот адрес деньги принять нельзя.',
    nameMoved:'Ваше имя «%n» теперь ведёт на другой адрес (%a). Оплата по-прежнему приходит на сохранённый адрес %s. Если вы этого не ждали, проверьте настройки.',
    itemPh:'За что (необязательно)', charge:'Показать код для оплаты',
    onNet:'в сети %s',
    qrApp:'Приложение', qrWeb:'Страница оплаты',
    hintApp:'Наведите NoN Wallet или сканер другого приложения-кошелька, которое понимает коды оплаты.',
    manual:'Нет сканера? Переведите ровно %a в сети %n на этот адрес (без комиссии; сумма должна дойти целиком):',
    hintWeb:'Наведите камеру телефона: в браузере откроется страница оплаты, там покупатель выберет кошелёк.',
    waiting:'Ждём оплату', showLink:'Показать ссылку на оплату', share:'Поделиться ссылкой', cancel:'Отменить',
    cancelAsk:'Перестать ждать эту оплату? Если покупатель заплатит позже, здесь это не появится.',
    feeNote:'Оплата из NoN Wallet или на странице оплаты: комиссия 1%, она вычитается из суммы, которую вы получаете. Обычный перевод из другого приложения: без комиссии.',
    shareText:'Оплата: %s',
    waitNet:'Сеть пока не отвечает. Продолжаем следить…',
    burned:'Этим кодом оплаты уже воспользовался кто-то другой. Отмените его и покажите новый.',
    paid:'Оплачено', received:'Вы получили', fee:'Комиссия', how:'Как оплатили', item:'За что', when:'Время',
    viaContract:'NoN Wallet или страница оплаты', viaTransfer:'Обычный перевод', noFee:'нет',
    viewTx:'Посмотреть операцию', viewAddr:'Посмотреть ваш адрес в обозревателе', newSale:'Новая продажа',
    today:'Сегодня', history:'Продажи за сегодня', settings:'Настройки', back:'Вернуться к кассе',
    totalLabel:'Выручка за сегодня', totalNote:'Продаж: %n · вы получили %r за вычетом комиссии',
    noSales:'Сегодня продаж ещё не было.', sale1:'продажа', from:'от',
    destLabelShort:'Деньги приходят на', shopLabelShort:'Название точки', change:'Сменить адрес',
    networks:'Сети', netAlways:'включена всегда',
    netsNote:'Включайте Ethereum или Base, только если ваш адрес — ваш собственный кошелёк, который работает и в этих сетях. Адрес для пополнения на бирже обычно работает только в одной сети, и деньги, пришедшие в другой, можно потерять.',
    netIsContract:'В сети %s этот адрес — смарт-контракт, там он может принадлежать кому-то другому. Не включено.',
    about:'О приложении',
    aboutText:'Tavarov Pay — это касса: она показывает коды для оплаты и следит за оплатой через открытые узлы блокчейна. Она не может переводить, хранить или тратить деньги, и учётной записи в ней нет. Настройки и история продаж остаются на этом устройстве.',
    version:'Версия %s', testnetOn:'ТЕСТОВАЯ СЕТЬ — деньги ненастоящие'
  }
};
let LANG = DICT[store.get(KEY.lang)] ? store.get(KEY.lang) : 'en';
function t(k){ return (DICT[LANG] && DICT[LANG][k]) || DICT.en[k] || k; }
function fill(s, map){ return String(s).replace(/%([a-z])/g, (m, c) => (c in map ? map[c] : m)); }
function applyLang(code){
  if (!DICT[code]) code = 'en';
  LANG = code;
  store.set(KEY.lang, code);
  document.documentElement.lang = code;
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-ph]').forEach(el => { el.placeholder = t(el.dataset.tPh); });
  document.querySelectorAll('[data-t-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.tAria)); });
  document.querySelectorAll('#langSwitch button').forEach(b => b.classList.toggle('on', b.dataset.lang === code));
  rerender();
}

/* ---------- Small helpers ---------- */
const $ = id => document.getElementById(id);
function show(el, on){ (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !on); }
function shortAddr(a){ return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }
function errText(e){ return String((e && e.message) || e || '').slice(0, 140); }

/* "12.5" -> whole units as a BigInt, without floating point. */
function toUnits(amount, decimals){
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  if (f.length > decimals) return null;
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}
function fromUnits(units, decimals, maxFrac = 6){
  const neg = units < 0n; if (neg) units = -units;
  const base = 10n ** BigInt(decimals);
  const w = units / base;
  let f = (units % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  return (neg ? '-' : '') + w.toString() + (f ? '.' + f : '');
}
function fmtAmount(s){
  /* "1234.5" -> "1,234.50" / "1 234,50". Money on a till always has two places. */
  const n = Number(s);
  if (!isFinite(n)) return String(s);
  const frac = (String(s).split('.')[1] || '').length;
  return n.toLocaleString(LANG === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: Math.max(2, Math.min(frac, 6)), maximumFractionDigits: 6 });
}
function hex(n){ return '0x' + Number(n).toString(16); }
function word(data, i){ return '0x' + String(data).replace(/^0x/, '').slice(i * 64, i * 64 + 64); }
function wordAddr(data, i){ return '0x' + String(data).replace(/^0x/, '').slice(i * 64 + 24, i * 64 + 64); }
function pad32(addr){ return '0x' + '0'.repeat(24) + addr.toLowerCase().replace(/^0x/, ''); }
function b64url(str){
  const bytes = new TextEncoder().encode(str);
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function newInvoiceId(){
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return '0x' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ---------- keccak256, only for the address checksum ----------
   A mistyped address means money lost for good, and EIP-55 capital letters
   are the one thing that catches a typo. This is the plain Keccak-f[1600]
   permutation (Ethereum's variant, padding 0x01), checked against ethers in
   the browser test. */
const KRC = ['0x1','0x8082','0x800000000000808a','0x8000000080008000','0x808b','0x80000001','0x8000000080008081','0x8000000000008009',
  '0x8a','0x88','0x80008009','0x8000000a','0x8000808b','0x800000000000008b','0x8000000000008089','0x8000000000008003',
  '0x8000000000008002','0x8000000000000080','0x800a','0x800000008000000a','0x8000000080008081','0x8000000000008080','0x80000001','0x8000000080008008'].map(BigInt);
const KROT = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const M64 = (1n << 64n) - 1n;
function rotl(x, n){ n = BigInt(n); return n ? ((x << n) | (x >> (64n - n))) & M64 : x; }
function keccakF(s){
  for (let r = 0; r < 24; r++){
    const C = [0,1,2,3,4].map(x => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++){
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
      B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], KROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
      s[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & M64) & B[(x + 2) % 5 + 5 * y]);
    s[0] ^= KRC[r];
  }
}
function keccak256Hex(bytes){
  const rate = 136, s = new Array(25).fill(0n);
  const padLen = rate - (bytes.length % rate);
  const m = new Uint8Array(bytes.length + padLen);
  m.set(bytes); m[bytes.length] ^= 0x01; m[m.length - 1] ^= 0x80;
  for (let off = 0; off < m.length; off += rate){
    for (let i = 0; i < rate / 8; i++){
      let v = 0n;
      for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(m[off + i * 8 + b]);
      s[i] ^= v;
    }
    keccakF(s);
  }
  let out = '';
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out += Number((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return out;
}
function toChecksum(addr){
  const a = addr.toLowerCase().replace(/^0x/, '');
  const h = keccak256Hex(new TextEncoder().encode(a));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
  return out;
}
/* null = not an address; false = an address with a typo; string = checksummed. */
function checkAddress(v){
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return null;
  const sum = toChecksum(v);
  const body = v.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (mixed && sum !== v) return false;
  return sum;
}

/* ---------- Reading the chain ----------
   The only door to the network. Anything that is not a plain read is
   refused here, so no later change can quietly turn this till into
   something that moves money. */
const READ_ONLY = new Set(['eth_blockNumber', 'eth_call', 'eth_getLogs', 'eth_getCode', 'eth_getTransactionReceipt']);
let rpcSeq = 0;
async function rpc(net, method, params, forLogs){
  if (!READ_ONLY.has(method)) throw new Error('not a read: ' + method);
  const list = (forLogs && net.logRpcs && net.logRpcs.length) ? net.logRpcs : net.rpcs;
  let last = null;
  for (const url of list){
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 10000);
    try{
      const r = await fetch(url, { method:'POST', headers:{ 'content-type':'application/json' }, cache:'no-store',
        body: JSON.stringify({ jsonrpc:'2.0', id: ++rpcSeq, method, params }), signal: ctl ? ctl.signal : undefined });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || 'node error');
      return d.result;
    } catch(e){ last = e; }
    finally{ clearTimeout(timer); }
  }
  throw last || new Error('no node answered');
}
const ethCall = (net, to, data) => rpc(net, 'eth_call', [{ to, data }, 'latest']);
async function blockNumber(net){ return parseInt(await rpc(net, 'eth_blockNumber', []), 16); }

/* addressOf(string): selector, offset 0x20, length, bytes padded to 32. */
async function resolveName(name){
  const net = testnet() ? TESTNET.bnb : NETS.bnb;
  const contract = testnet() ? NAMES_CONTRACT.test : NAMES_CONTRACT.main;
  const bytes = new TextEncoder().encode(name);
  let body = (32).toString(16).padStart(64, '0') + bytes.length.toString(16).padStart(64, '0');
  body += [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').padEnd(64, '0');
  const res = await ethCall(net, contract, SEL.addressOf + body);
  const a = wordAddr(res, 0);
  return /^0x[0-9a-f]{40}$/.test(a) && a !== ZERO ? toChecksum(a) : null;
}
async function isContract(net, addr){
  const code = await rpc(net, 'eth_getCode', [addr, 'latest']);
  /* 0xef0100… is an ordinary wallet with an EIP-7702 delegation, not a contract. */
  return !!code && code !== '0x' && !/^0xef0100/i.test(code);
}
async function tokenBalance(net, token, who){
  return BigInt(await ethCall(net, token, SEL.balanceOf + pad32(who).slice(2)));
}

/* ---------- Settings ---------- */
let cfg = store.json(KEY.cfg, null);
function saveCfg(){ store.set(KEY.cfg, JSON.stringify(cfg)); }
function enabledNets(){
  const tbl = netTable();
  const want = (cfg && Array.isArray(cfg.nets) ? cfg.nets : ['bnb']).filter(k => tbl[k]);
  if (!want.includes('bnb') && tbl.bnb) want.unshift('bnb');
  return want;
}

/* ---------- The payment code ----------
   Exactly what the NoN Wallet till puts into its QR (buildQrPayload in
   www/index.html): an EIP-681 token transfer to the seller, plus our own
   tv_* fields. NoN Wallet reads tv_m/tv_inv and pays through the payment
   contract; other wallet apps ignore tv_* and make a plain transfer. */
function buildAppCode(o){
  const net = netOf(o.net), tk = net.tokens[o.cur];
  const extras = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') extras.push(k + '=' + encodeURIComponent(v)); };
  add('tv_m', o.to); add('tv_item', o.item); add('tv_name', o.shop); add('tv_inv', o.id); add('tv_net', net.key);
  return 'ethereum:' + tk.a + '@' + net.chainId + '/transfer?address=' + o.to +
         '&uint256=' + toUnits(o.amount, tk.d).toString() + (extras.length ? '&' + extras.join('&') : '');
}
/* The payment page link (buildWebInvoice in www/index.html), opened by any
   phone camera. t is when the page stops offering the payment; we renew it
   while the till keeps waiting. */
function buildWebLink(o){
  const net = netOf(o.net);
  const inv = { m: o.to, a: String(o.amount), c: o.cur, o: o.order, n: o.shop || '', i: o.item || '',
                net: net.code, t: Math.floor(Date.now() / 1000) + 900, h: o.id };
  return SITE + '/pay.html#p=' + b64url(JSON.stringify(inv));
}

/* ---------- History ---------- */
function history(){ const h = store.json(KEY.hist, []); return Array.isArray(h) ? h : []; }
function addHistory(rec){
  const h = history();
  if (h.some(x => x.id === rec.id)) return;
  h.unshift(rec);
  store.set(KEY.hist, JSON.stringify(h.slice(0, 2000)));
}
function usedTx(){ return new Set(history().map(x => (x.tx || '').toLowerCase()).filter(Boolean)); }
function isToday(ts){ const d = new Date(ts), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }

/* ---------- Screens ---------- */
const SCREENS = ['scrSetup', 'scrTill', 'scrWait', 'scrPaid', 'scrHistory', 'scrSettings'];
let screen = null;
function go(id){
  screen = id;
  SCREENS.forEach(s => show(s, s === id));
  const ready = !!cfg && id !== 'scrSetup';
  show('navHistory', ready); show('navSettings', ready);
  rerender();
  window.scrollTo(0, 0);
}
function rerender(){
  if (screen === 'scrTill') renderTill();
  else if (screen === 'scrWait') renderWait();
  else if (screen === 'scrPaid') renderPaid();
  else if (screen === 'scrHistory') renderHistory();
  else if (screen === 'scrSettings') renderSettings();
  else if (screen === 'scrSetup' && found) renderFound();
}

/* ===== 1. Setup ===== */
let found = null;          // { address, name, contract }
function setupError(msg){ $('destErr').textContent = msg; show('destErr', !!msg); }
async function checkDest(){
  const raw = $('destIn').value.trim();
  found = null; show('destOk', false); setupError('');
  if (!raw){ setupError(t('errEmpty')); return; }
  const btn = $('destCheck');
  btn.disabled = true; btn.textContent = t('checking');
  try{
    let address = null, name = null;
    const asAddr = checkAddress(raw);
    if (asAddr === false){ setupError(t('errChecksum')); return; }
    if (asAddr){ address = asAddr; }
    else {
      const n = raw.toLowerCase().replace(/^@+/, '');
      if (!NAME_RE.test(n)){ setupError(t('errFormat')); return; }
      try{ address = await resolveName(n); }
      catch(e){ setupError(fill(t('errNet'), { s: errText(e) })); return; }
      if (!address){ setupError(fill(t('errNoName'), { s: n })); return; }
      name = n;
    }
    if (address.toLowerCase() === ZERO){ setupError(t('errZero')); return; }
    let contract = false;
    try{ contract = await isContract(netOf('bnb'), address); } catch(e){ /* the warning is a courtesy; no answer is not a reason to stop */ }
    found = { address, name, contract };
    renderFound();
  } finally {
    btn.disabled = false; btn.textContent = t('check');
  }
}
function renderFound(){
  if (!found) return;
  const box = $('destAddr');
  box.textContent = '';
  if (found.name){
    const b = document.createElement('b'); b.textContent = found.name; box.appendChild(b);
    box.appendChild(document.createTextNode(' → '));
  }
  box.appendChild(document.createTextNode(found.address));
  $('destExplorer').href = netOf('bnb').explorer + '/address/' + found.address;
  show('destContract', found.contract);
  $('destConfirm').checked = false;
  $('destSave').disabled = true;
  show('destOk', true);
}
function saveDest(){
  if (!found || !$('destConfirm').checked) return;
  const prevNets = cfg && cfg.address && cfg.address.toLowerCase() === found.address.toLowerCase() ? cfg.nets : ['bnb'];
  cfg = { address: found.address, name: found.name || '', shop: $('shopIn').value.trim().slice(0, 40), nets: prevNets || ['bnb'] };
  saveCfg();
  found = null;
  $('destIn').value = '';
  go('scrTill');
}

/* ===== 2. Till ===== */
let amountStr = '';
let tillCur = 'USDT';
let tillNet = 'bnb';
function curList(){ const n = netOf(tillNet); return n ? Object.keys(n.tokens) : []; }
function amountValid(){ return /^\d{1,7}(\.\d{1,2})?$/.test(amountStr) && Number(amountStr) > 0; }
function keyPress(k){
  if (k === 'back') amountStr = amountStr.slice(0, -1);
  else if (k === '.' || k === ','){ if (!amountStr.includes('.')) amountStr = (amountStr || '0') + '.'; }
  else if (/^\d$/.test(k)){
    if (amountStr === '0') amountStr = '';
    const [w, f] = amountStr.split('.');
    if (f !== undefined && f.length >= 2) return;
    if (f === undefined && w.length >= 7) return;
    amountStr += k;
  }
  renderTill();
}
function renderTill(){
  if (!enabledNets().includes(tillNet)) tillNet = 'bnb';
  if (!curList().includes(tillCur)) tillCur = curList()[0];
  const a = $('amountShow');
  a.firstChild.nodeValue = amountStr || '0';
  a.classList.toggle('empty', !amountStr);
  $('amountCur').textContent = tillCur;
  $('tillMeta').textContent = (cfg.shop ? cfg.shop + ' · ' : '') + fill(t('onNet'), { s: netOf(tillNet).name }) +
                              (testnet() ? ' · ' + t('testnetOn') : '');
  const seg = $('curSeg'); seg.textContent = '';
  curList().forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'seg' + (c === tillCur ? ' active' : ''); b.textContent = c; b.dataset.cur = c;
    b.onclick = () => { tillCur = c; renderTill(); };
    seg.appendChild(b);
  });
  const nets = enabledNets(), ns = $('netSeg'); ns.textContent = '';
  show(ns, nets.length > 1);
  nets.forEach(k => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'seg' + (k === tillNet ? ' active' : ''); b.textContent = netOf(k).name; b.dataset.net = k;
    b.onclick = () => { tillNet = k; renderTill(); };
    ns.appendChild(b);
  });
  $('charge').disabled = !amountValid();
}

/* ===== 3. Waiting ===== */
let sale = null;               // the sale on screen
let pollTimer = null, polling = false, qrMode = 'app', webTimer = null;
let audioCtx = null, wakeLock = null;
let soundCount = 0;            // read by the browser test: did the till make its sound?

async function startSale(){
  if (!amountValid()) return;
  /* Sound needs a tap to be allowed; this tap is the one. */
  try{ if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch(e){}
  const tk = netOf(tillNet).tokens[tillCur];
  sale = { id: newInvoiceId(), net: tillNet, cur: tillCur, amount: amountStr.replace(/\.$/, ''),
           units: toUnits(amountStr.replace(/\.$/, ''), tk.d).toString(), token: tk.a,
           to: cfg.address, shop: cfg.shop || '', item: $('itemIn').value.trim().slice(0, 60),
           order: 'T-' + Date.now().toString(36).toUpperCase(), createdAt: Date.now(),
           startBlock: null, baseline: null, testnet: testnet() };
  store.set(KEY.open, JSON.stringify(sale));
  qrMode = 'app';
  go('scrWait');
  beginWatching();
}
async function beginWatching(){
  const net = netOf(sale.net);
  const mine = sale;
  try{
    if (mine.startBlock === null){
      const [b, bal] = await Promise.all([blockNumber(net), tokenBalance(net, mine.token, mine.to).catch(() => null)]);
      if (sale !== mine) return;
      mine.startBlock = b; mine.baseline = bal === null ? null : bal.toString();
      store.set(KEY.open, JSON.stringify(mine));
    }
  } catch(e){ waitError(t('waitNet')); }
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, 5000);
  setTimeout(poll, 1200);
  try{ if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch(e){}
}
function waitError(msg){ $('waitErr').textContent = msg || ''; show('waitErr', !!msg); }
function renderWait(){
  if (!sale) return;
  $('waitAmount').innerHTML = '';
  $('waitAmount').appendChild(document.createTextNode(fmtAmount(sale.amount)));
  const c = document.createElement('span'); c.className = 'cur'; c.textContent = sale.cur; $('waitAmount').appendChild(c);
  $('waitMeta').textContent = [sale.shop, sale.item, fill(t('onNet'), { s: netOf(sale.net).name })].filter(Boolean).join(' · ');
  document.querySelectorAll('#qrSeg .seg').forEach(b => b.classList.toggle('active', b.dataset.q === qrMode));
  const app = buildAppCode(sale), web = buildWebLink(sale);
  $('payLink').textContent = app;
  $('webLink').textContent = web;
  $('qrHint').textContent = t(qrMode === 'app' ? 'hintApp' : 'hintWeb');
  $('manualLine').textContent = fill(t('manual'), { a: fmtAmount(sale.amount) + ' ' + sale.cur, n: netOf(sale.net).name });
  $('manualAddr').textContent = sale.to;
  drawQr($('qr'), qrMode === 'app' ? app : web);
  clearInterval(webTimer);
  /* The payment page stops taking a payment 15 minutes after t. While the
     till still waits, keep the link on screen fresh. */
  if (qrMode === 'web') webTimer = setInterval(() => { if (screen === 'scrWait' && qrMode === 'web') renderWait(); }, 10 * 60 * 1000);
}
function drawQr(holder, text){
  holder.textContent = '';
  holder.dataset.text = text;
  const levels = (typeof QRCode !== 'undefined' && QRCode.CorrectLevel) ? [QRCode.CorrectLevel.M, QRCode.CorrectLevel.L] : [];
  for (const lvl of levels){
    try{
      new QRCode(holder, { text, width: 472, height: 472, colorDark:'#1C1330', colorLight:'#ffffff', correctLevel: lvl });
      if (holder.children.length) return true;
    } catch(e){ holder.textContent = ''; }
  }
  holder.textContent = text;
  return false;
}

/* One look at the chain. Three ways the money can arrive:
   1. Through the payment contract (NoN Wallet, or any wallet on the payment
      page). The contract records the sale under our invoice number:
      saleOf(invoice) tells us who was paid, in what and how much. That is
      storage, not a log, so it cannot be missed. The Paid event gives the
      transaction and the exact split.
   2. A plain token transfer from any wallet app that read the code as an
      ordinary EIP-681 transfer. It carries no invoice number, so we take the
      first transfer to the seller of at least the amount, made after this
      code was shown, that is not a contract payment and not already counted
      for an earlier sale.
   3. If the node refuses event searches, the balance growing by at least the
      amount since the code was shown. */
async function poll(){
  const mine = sale;
  if (!mine || polling || screen !== 'scrWait') return;
  polling = true;
  try{
    const res = await checkPaid(mine);
    if (sale !== mine) return;
    waitError(res && res.burned ? t('burned') : '');
    if (res && res.paid) markPaid(mine, res);
  } catch(e){
    if (sale === mine) waitError(t('waitNet'));
  } finally { polling = false; }
}
async function checkPaid(s){
  const net = netOf(s.net);
  const want = BigInt(s.units);
  const latest = await blockNumber(net);
  if (s.startBlock === null){
    s.startBlock = Math.max(0, latest - Math.ceil((Date.now() - s.createdAt) / 1000 / net.blockSec) - 20);
    store.set(KEY.open, JSON.stringify(s));
  }

  // 1. through the contract
  let burned = false;
  try{
    const r = await ethCall(net, net.pay, SEL.saleOf + s.id.slice(2));
    const merchant = wordAddr(r, 0), amount = BigInt(word(r, 1)), token = wordAddr(r, 4);
    if (merchant !== ZERO){
      if (merchant === s.to.toLowerCase() && token === s.token.toLowerCase() && amount >= want){
        let tx = null, toMerchant = null, fee = null, from = wordAddr(r, 2);
        try{
          const logs = await rpc(net, 'eth_getLogs', [{ address: net.pay, fromBlock: hex(Math.max(0, s.startBlock - 5)), toBlock: 'latest',
                                                       topics: [TOPIC.Paid, pad32(s.to)] }], true);
          const l = (logs || []).find(x => word(x.data, 3).toLowerCase() === s.id.toLowerCase());
          if (l){ tx = l.transactionHash; toMerchant = BigInt(word(l.data, 0)); fee = BigInt(word(l.data, 1)); }
        } catch(e){}
        if (toMerchant === null){
          let bps = 100n;
          try{ bps = BigInt(await ethCall(net, net.pay, SEL.feeBps)); } catch(e){}
          fee = amount * bps / 10000n; toMerchant = amount - fee;
        }
        return { paid: true, via: 'contract', gross: amount, received: toMerchant, fee, tx, from };
      }
      burned = true;      // someone used this invoice number for another payment
    }
  } catch(e){ /* older contract or no answer: the other two checks still run */ }

  // 2. a plain transfer
  const used = usedTx();
  try{
    const logs = await rpc(net, 'eth_getLogs', [{ address: s.token, fromBlock: hex(s.startBlock + 1), toBlock: hex(latest),
                                                 topics: [TOPIC.Transfer, null, pad32(s.to)] }], true);
    const cands = (logs || []).map(l => ({ tx: l.transactionHash, value: BigInt(word(l.data, 0)), from: '0x' + String(l.topics[1] || '').slice(-40),
                                           block: parseInt(l.blockNumber, 16) }))
      .filter(c => c.value >= want && !used.has(String(c.tx).toLowerCase()))
      .sort((a, b) => a.block - b.block);
    for (const c of cands.slice(0, 5)){
      let viaContract = true;
      try{
        const rec = await rpc(net, 'eth_getTransactionReceipt', [c.tx]);
        viaContract = !!(rec && (rec.logs || []).some(l => String(l.address).toLowerCase() === net.pay.toLowerCase()));
      } catch(e){ continue; }        // could not check: do not guess
      if (viaContract) continue;     // a contract payment for some other invoice
      return { paid: true, via: 'transfer', gross: c.value, received: c.value, fee: 0n, tx: c.tx, from: c.from };
    }
    return { paid: false, burned };
  } catch(e){
    // 3. the node does not search events: watch the balance instead
    if (s.baseline === null) return { paid: false, burned };
    const now = await tokenBalance(net, s.token, s.to);
    const grew = now - BigInt(s.baseline);
    if (grew >= want) return { paid: true, via: 'transfer', gross: grew, received: grew, fee: 0n, tx: null, from: null };
    return { paid: false, burned };
  }
}
function markPaid(s, res){
  clearInterval(pollTimer); clearInterval(webTimer);
  const d = netOf(s.net).tokens[s.cur].d;
  const rec = { id: s.id, at: Date.now(), net: s.net, cur: s.cur, amount: s.amount, item: s.item,
                received: fromUnits(res.received, d), fee: fromUnits(res.fee, d), via: res.via,
                tx: res.tx, from: res.from, to: s.to, testnet: !!s.testnet };
  addHistory(rec);
  store.del(KEY.open);
  sale = null;
  lastPaid = rec;
  chime();
  try{ if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch(e){}
  go('scrPaid');
}
function cancelSale(){
  if (!sale) return;
  if (!confirm(t('cancelAsk'))) return;
  clearInterval(pollTimer); clearInterval(webTimer);
  sale = null; store.del(KEY.open);
  try{ if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch(e){}
  go('scrTill');
}
async function shareLink(){
  if (!sale) return;
  const url = buildWebLink(sale);
  const text = fill(t('shareText'), { s: fmtAmount(sale.amount) + ' ' + sale.cur }) + (sale.shop ? ' — ' + sale.shop : '');
  if (navigator.share){ try{ await navigator.share({ title: 'Tavarov Pay', text, url }); return; } catch(e){ if (e && e.name === 'AbortError') return; } }
  try{ await navigator.clipboard.writeText(url); } catch(e){}
  const b = $('shareLink'), was = b.textContent; b.textContent = '✓'; setTimeout(() => { b.textContent = was; }, 1500);
}
/* A short two-note chime: Paid. Made on the fly, no sound files. */
function chime(){
  soundCount++;
  try{ if (navigator.vibrate) navigator.vibrate([90, 60, 90]); } catch(e){}
  try{
    const ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx = ctx;
    const t0 = ctx.currentTime + 0.02;
    [[880, 0], [1318.5, 0.14]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.45);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 0.5);
    });
  } catch(e){}
}

/* ===== 4. Paid ===== */
let lastPaid = null;
function amountNode(el, amount, cur){
  el.textContent = '';
  el.appendChild(document.createTextNode(fmtAmount(amount)));
  const c = document.createElement('span'); c.className = 'cur'; c.textContent = cur; el.appendChild(c);
}
function txUrl(rec){
  const net = (rec.testnet ? TESTNET : NETS)[rec.net] || NETS.bnb;
  return rec.tx ? net.explorer + '/tx/' + rec.tx : net.explorer + '/address/' + rec.to;
}
function renderPaid(){
  const r = lastPaid; if (!r) return;
  amountNode($('paidAmount'), r.amount, r.cur);
  $('paidReceived').textContent = fmtAmount(r.received) + ' ' + r.cur;
  $('paidFee').textContent = Number(r.fee) > 0 ? fmtAmount(r.fee) + ' ' + r.cur : t('noFee');
  $('paidHow').textContent = t(r.via === 'contract' ? 'viaContract' : 'viaTransfer') + (r.from ? ' · ' + t('from') + ' ' + shortAddr(r.from) : '');
  $('paidItem').textContent = r.item || ''; show('paidItemRow', !!r.item);
  $('paidTime').textContent = new Date(r.at).toLocaleTimeString(LANG === 'ru' ? 'ru-RU' : 'en-US', { hour:'2-digit', minute:'2-digit' });
  $('paidTx').href = txUrl(r);
  $('paidTx').textContent = t(r.tx ? 'viewTx' : 'viewAddr');
}

/* ===== 5. History ===== */
function renderHistory(){
  const today = history().filter(r => isToday(r.at) && !!r.testnet === testnet());
  const tot = $('histTotal'); tot.textContent = '';
  const byCur = {}, recv = {};
  today.forEach(r => {
    const d = 18;   // sums in 18 places; enough for any of our coins
    byCur[r.cur] = (byCur[r.cur] || 0n) + (toUnits(r.amount, d) || 0n);
    recv[r.cur] = (recv[r.cur] || 0n) + (toUnits(r.received, d) || 0n);
  });
  const lab = document.createElement('div'); lab.className = 'total-label'; lab.textContent = t('totalLabel'); tot.appendChild(lab);
  const curs = Object.keys(byCur).length ? Object.keys(byCur) : [tillCur];
  curs.forEach(c => {
    const s = document.createElement('div'); s.className = 'total-sum';
    amountNode(s, fromUnits(byCur[c] || 0n, 18, 6), c);
    tot.appendChild(s);
  });
  const note = document.createElement('div'); note.className = 'total-note';
  note.textContent = fill(t('totalNote'), { n: String(today.length),
    r: Object.keys(recv).map(c => fmtAmount(fromUnits(recv[c], 18, 6)) + ' ' + c).join(', ') || '0' });
  tot.appendChild(note);

  const list = $('histList'); list.textContent = '';
  if (!today.length){ const e = document.createElement('div'); e.className = 'empty'; e.textContent = t('noSales'); list.appendChild(e); return; }
  today.forEach(r => {
    const row = document.createElement('a');
    row.className = 'row'; row.href = txUrl(r); row.target = '_blank'; row.rel = 'noopener';
    row.style.color = 'inherit'; row.style.textDecoration = 'none';
    const main = document.createElement('div'); main.className = 'row-main';
    const ti = document.createElement('div'); ti.className = 'row-title';
    ti.textContent = new Date(r.at).toLocaleTimeString(LANG === 'ru' ? 'ru-RU' : 'en-US', { hour:'2-digit', minute:'2-digit' }) + (r.item ? ' · ' + r.item : '');
    const sub = document.createElement('div'); sub.className = 'row-sub';
    sub.textContent = t(r.via === 'contract' ? 'viaContract' : 'viaTransfer') + ' · ' + t('received').toLowerCase() + ' ' + fmtAmount(r.received) + ' ' + r.cur;
    main.appendChild(ti); main.appendChild(sub);
    const amt = document.createElement('div'); amt.className = 'row-amt'; amt.textContent = '+' + fmtAmount(r.amount) + ' ' + r.cur;
    row.appendChild(main); row.appendChild(amt);
    list.appendChild(row);
  });
}

/* ===== 6. Settings ===== */
function renderSettings(){
  if (!cfg) return;
  const a = $('setAddr'); a.textContent = '';
  if (cfg.name){ const b = document.createElement('b'); b.textContent = cfg.name; a.appendChild(b); a.appendChild(document.createTextNode(' → ')); }
  a.appendChild(document.createTextNode(cfg.address));
  if (document.activeElement !== $('setShop')) $('setShop').value = cfg.shop || '';
  const box = $('setNets'); box.textContent = '';
  Object.keys(netTable()).forEach(k => {
    const row = document.createElement('div'); row.className = 'netrow';
    const name = document.createElement('div');
    name.innerHTML = '';
    const nm = document.createElement('div'); nm.className = 'row-title'; nm.textContent = netTable()[k].name;
    const sm = document.createElement('div'); sm.className = 'small'; sm.textContent = Object.keys(netTable()[k].tokens).join(' · ') + (k === 'bnb' ? ' · ' + t('netAlways') : '');
    name.appendChild(nm); name.appendChild(sm);
    const lab = document.createElement('label'); lab.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = enabledNets().includes(k); cb.disabled = k === 'bnb'; cb.dataset.net = k;
    cb.onchange = () => toggleNet(k, cb);
    lab.appendChild(cb);
    row.appendChild(name); row.appendChild(lab);
    box.appendChild(row);
  });
  show('netsNote', Object.keys(netTable()).length > 1);
  $('versionLine').textContent = fill(t('version'), { s: APP_VERSION }) + (testnet() ? ' · ' + t('testnetOn') : '');
}
async function toggleNet(k, cb){
  const on = cb.checked;
  if (on){
    /* The same 0x address on another network is the same wallet only if it
       is an ordinary key-held wallet. A contract there may be someone else's. */
    cb.disabled = true;
    try{
      if (await isContract(netOf(k), cfg.address)){ cb.checked = false; alert(fill(t('netIsContract'), { s: netOf(k).name })); return; }
    } catch(e){ cb.checked = false; alert(fill(t('errNet'), { s: errText(e) })); return; }
    finally { cb.disabled = false; }
  }
  const nets = enabledNets().filter(x => x !== k);
  if (on) nets.push(k);
  cfg.nets = nets; saveCfg();
}

/* A NoN name can change hands. The till keeps paying to the address the
   seller confirmed; if the name now points elsewhere, we say so. */
async function recheckName(){
  if (!cfg || !cfg.name) return;
  try{
    const now = await resolveName(cfg.name);
    const moved = !!now && now.toLowerCase() !== cfg.address.toLowerCase();
    $('nameMoved').textContent = moved ? fill(t('nameMoved'), { n: cfg.name, a: shortAddr(now), s: shortAddr(cfg.address) }) : '';
    show('nameMoved', moved);
  } catch(e){}
}

/* Android back button (MainActivity asks this). true = handled here. */
window.payGoBack = function(){
  if (screen === 'scrHistory' || screen === 'scrSettings'){ go('scrTill'); return true; }
  if (screen === 'scrPaid'){ go('scrTill'); return true; }
  if (screen === 'scrSetup' && cfg){ go('scrSettings'); return true; }
  return false;
};

/* ---------- Wiring ---------- */
document.querySelectorAll('#langSwitch button').forEach(b => { b.onclick = () => applyLang(b.dataset.lang); });
$('destCheck').onclick = checkDest;
$('destIn').addEventListener('keydown', e => { if (e.key === 'Enter') checkDest(); });
$('destIn').addEventListener('input', () => { if (found){ found = null; show('destOk', false); } });
$('destConfirm').onchange = () => { $('destSave').disabled = !$('destConfirm').checked; };
$('destSave').onclick = saveDest;
document.querySelectorAll('#keypad .key').forEach(b => { b.onclick = () => keyPress(b.dataset.k); });
document.addEventListener('keydown', e => {
  if (screen !== 'scrTill' || e.target.tagName === 'INPUT') return;
  if (/^[0-9.,]$/.test(e.key)) keyPress(e.key);
  else if (e.key === 'Backspace') keyPress('back');
  else if (e.key === 'Enter' && amountValid()) startSale();
});
$('charge').onclick = startSale;
document.querySelectorAll('#qrSeg .seg').forEach(b => { b.onclick = () => { qrMode = b.dataset.q; renderWait(); }; });
$('cancelSale').onclick = cancelSale;
$('shareLink').onclick = shareLink;
$('newSale').onclick = () => { amountStr = ''; $('itemIn').value = ''; go('scrTill'); };
$('navHistory').onclick = () => { if (screen !== 'scrWait') go('scrHistory'); };
$('navSettings').onclick = () => { if (screen !== 'scrWait') go('scrSettings'); };
$('histBack').onclick = () => go('scrTill');
$('setBack').onclick = () => go('scrTill');
$('setChange').onclick = () => { $('shopIn').value = cfg ? cfg.shop || '' : ''; go('scrSetup'); };
$('setShop').addEventListener('input', () => { cfg.shop = $('setShop').value.trim().slice(0, 40); saveCfg(); });

/* ---------- Start ---------- */
(function start(){
  applyLang(LANG);
  const open = store.json(KEY.open, null);
  if (!cfg || !checkAddress(cfg.address || '')){ cfg = null; go('scrSetup'); return; }
  if (open && open.id && open.to === cfg.address && netOf(open.net) && !!open.testnet === testnet()){
    sale = open; go('scrWait'); beginWatching();
  } else {
    store.del(KEY.open);
    go('scrTill');
  }
  recheckName();
})();
