/* Tavarov Pay API, версия 1.

   ЗАЧЕМ. Раньше магазину, чтобы принять оплату, нужно было самому собрать
   ссылку, самому придумать номер счёта и прислать нам адрес для вебхука —
   а мы вписывали его руками. Теперь магазин заходит в кабинет своим
   кошельком, сам берёт ключ, сам вписывает вебхук и выставляет счёт одним
   запросом.

   ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ. Денег. Деньги по-прежнему идут от покупателя
   продавцу через контракт оплаты; API только выставляет счёт и сообщает,
   что по нему заплатили. Слово «оплачено» берётся из самого контракта, на
   глубине, куда перестройка сети уже не достаёт.

   ЧТО ХРАНИТСЯ (в том же KV, что касса и донаты, ключи начинаются с v1:):
     аккаунт   — кошелёк продавца, отпечатки его ключей, адрес вебхука и
                 секрет подписи вебхука;
     ключ      — отпечаток ключа (SHA-256) → кошелёк. Сам ключ не хранится:
                 его видит только продавец, один раз, в момент выдачи;
     счёт      — то, что продавец выставил, и что про оплату сказала сеть;
                 90 дней;
     сессия    — вход в кабинет, 12 часов.
   О покупателе — только адрес кошелька, с которого заплатили. Он и так
   публичен в сети.

   ЭКОНОМИЯ ЗАПИСЕЙ. Бесплатный KV — тысяча записей в сутки на всё сразу.
   Поэтому страница оплаты берёт счёт не отсюда, а из самой ссылки (как и
   раньше), а «оплачено» таймер находит в журнале контракта, а не перебором
   счетов. Запись в хранилище — только когда что-то на самом деле
   изменилось. */

import { messageHash, recoverAddress } from '../_crypto.js';
import { promoteByHash } from '../donate.js';

const NETS = {
  bnb: {
    mode: 'live',
    rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org',
           'https://bsc-dataseed1.bnbchain.org'],
    pay: '0x1Fc681FA250A17e66B57B7150F2EeD4e71D1Ca35',
    tokens: { USDT: { a: '0x55d398326f99059fF775485246999027B3197955', d: 18 },
              USDC: { a: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', d: 18 } }
  },
  bnbTestnet: {
    mode: 'test',
    rpcs: ['https://bsc-testnet-rpc.publicnode.com', 'https://data-seed-prebsc-1-s1.bnbchain.org:8545'],
    pay: '0x3A3Ba9776ea9c48AE6C69Ae6153d9bBc892ed6e6',
    tokens: { USDT: { a: '0xb4ac75E8CF7c768FFd9fAfeAF1bF77B48209524e', d: 6 } }
  }
};
const MODE_NET = { live: 'bnb', test: 'bnbTestnet' };

const PAID_TOPIC = '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861';
const SALE_OF = '0x38d56afe';
const CONFIRMATIONS = 12;      // ~10 секунд в BNB Chain
const TX_LOOKBACK = 3000;      // где искать номер транзакции для уже оплаченного
const SCAN_BLOCKS = 400;       // окно таймера: больше пяти минут, таймер ходит раз в минуту

const INV_TTL  = 90 * 86400;
const SESS_TTL = 12 * 3600;
const LOGIN_SLACK = 300;
const MAX_BODY = 8192;
const BACKOFF = [60, 300, 900, 3600, 10800, 21600, 43200, 86400];   // восемь попыток за двое суток
const RATE_PER_MIN = 60;
const LANGS = ['ru', 'en', 'es', 'tr', 'pt'];
const OWN_HOSTS = ['wallet.tavarov.com', 'tavarov-wallet.pages.dev', 'tavarov-wallet.netlify.app'];

/* ===================== мелочи ===================== */

const sec = () => Math.floor(Date.now() / 1000);
const hex = n => '0x' + Math.max(0, n).toString(16);
const pad = a => '0x' + '0'.repeat(24) + a.toLowerCase().replace(/^0x/, '');
const word = (data, n) => '0x' + String(data).replace(/^0x/, '').slice(n * 64, (n + 1) * 64);
const addrAt = (data, n) => '0x' + word(data, n).slice(-40);
const ZERO = '0x' + '0'.repeat(40);
const okAddr = v => /^0x[0-9a-fA-F]{40}$/.test(v || '');
const okHash = v => /^0x[0-9a-f]{64}$/.test(v || '');

function json(o, status, headers){
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
              'x-content-type-options': 'nosniff' };
  return new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign(h, headers || {}) });
}
function fail(status, code, message, extra){
  return json({ error: Object.assign({ code, message }, extra || {}) }, status);
}

function b64url(bytes){
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randomToken = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
const randomHex32 = () => '0x' + [...crypto.getRandomValues(new Uint8Array(32))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

async function sha256hex(text){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(secret, text){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Текст, который попадёт на страницу оплаты. Управляющие символы,
   невидимые, разворот текста и переносы строк — нет: ими на чужой странице
   рисуют то, чего продавец не писал. Проверяем по кодам, без регулярных
   выражений с экранированием — так их нельзя сломать при правке файла. */
function badChar(cp){
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 ||
         (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) ||
         (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff;
}
function cleanText(v, max){
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') return null;
  const cps = [...v];
  if (cps.length > max) return null;
  for (const ch of cps) if (badChar(ch.codePointAt(0))) return null;
  return v.trim();
}

function toUnits(amount, decimals){
  const s = String(amount).trim();
  if (!/^\d{1,12}(\.\d{1,18})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) return null;
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}
function fmtUnits(units, dec){
  const s = BigInt(units).toString().padStart(dec + 1, '0');
  const r = (s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec)).replace(/0+$/, '').replace(/\.$/, '');
  return r || '0';
}

function netConfig(net, env){
  const base = NETS[net];
  const e = env || {};
  return { net, mode: base.mode,
           rpcs: e.TAVAROV_RPC ? [e.TAVAROV_RPC] : base.rpcs,
           pay: e.TAVAROV_PAY || base.pay,
           tokens: base.tokens };
}

async function rpc(urls, method, params){
  let last = null;
  for (const url of urls){
    try{
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!r.ok){ last = 'node answered ' + r.status; continue; }
      const d = await r.json();
      if (d.error){ last = d.error.message || 'node error'; continue; }
      if (d.result !== undefined && d.result !== null) return d.result;
    } catch(e){ last = String(e && e.message || e); }
  }
  throw new Error(last || 'no node answered');
}

/* ===================== хранилище ===================== */

async function kvGet(env, key){
  const v = await env.TILL.get(key);
  if (!v) return null;
  try{ return JSON.parse(v); } catch(e){ return null; }
}
async function kvPut(env, key, obj, ttl){
  await env.TILL.put(key, JSON.stringify(obj), ttl ? { expirationTtl: ttl } : undefined);
}
const kInv  = h => 'v1:inv:' + h;
const kAcct = w => 'v1:acct:' + w.toLowerCase();
const kKey  = hash => 'v1:key:' + hash;
const kSess = hash => 'v1:sess:' + hash;
const kRecent = (w, mode) => 'v1:recent:' + w.toLowerCase() + ':' + mode;
const kOrder  = (w, mode, oh) => 'v1:ord:' + w.toLowerCase() + ':' + mode + ':' + oh;
const K_QUEUE = 'v1:q';

/* ===================== кто спрашивает ===================== */

async function byApiKey(request, env){
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(tp_(live|test)_[A-Za-z0-9_-]{43})\s*$/);
  if (!m) return null;
  const hash = await sha256hex(m[1]);
  const rec = await kvGet(env, kKey(hash));
  if (!rec || rec.mode !== m[2] || !okAddr(rec.w)) return null;
  return { w: rec.w.toLowerCase(), mode: rec.mode, net: MODE_NET[rec.mode], hash };
}

async function bySession(request, env){
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Session\s+(sess_[A-Za-z0-9_-]{43})\s*$/);
  if (!m) return null;
  const hash = await sha256hex(m[1]);
  const rec = await kvGet(env, kSess(hash));
  if (!rec || !okAddr(rec.w) || !(rec.exp > sec())) return null;
  return { w: rec.w.toLowerCase(), hash };
}

/* Текст, который продавец подписывает, чтобы войти. Слово «login» и адрес
   сайта в нём — чтобы подпись нельзя было выдать за что-то другое. Это
   подпись сообщения, а не операция: денег она не двигает. */
export function loginText(address, ts){
  return ['Tavarov Pay developer login',
          'site: wallet.tavarov.com',
          'wallet: ' + address.toLowerCase(),
          'time: ' + ts].join('\n');
}

/* Кто подписал — спрашиваем два разных узла, как и касса: один узел,
   который врёт, не должен уметь впустить чужого. */
async function recoverByQuorum(urls, hash, sig){
  const answers = [];
  for (const u of urls){
    try{ answers.push(await recoverAddress((method, params) => rpc([u], method, params), hash, sig)); } catch(e){}
    if (answers.length >= 2) break;
  }
  if (!answers.length) throw new Error('no node answered');
  if (urls.length >= 2 && answers.length < 2) throw new Error('only one node answered');
  if (answers.some(a => a !== answers[0])) return null;
  return answers[0];
}

/* ===================== счёт ===================== */

function b64urlText(s){ return b64url(new TextEncoder().encode(s)); }

function payUrl(rec, origin){
  const o = { m: rec.w, a: rec.a, c: rec.c, h: rec.h, net: rec.net, api: 1, t: rec.t };
  if (rec.o) o.o = rec.o;
  if (rec.n) o.n = rec.n;
  if (rec.i) o.i = rec.i;
  if (rec.r) o.r = rec.r;
  return origin + '/pay#p=' + b64urlText(JSON.stringify(o)) + (rec.l ? '&lang=' + rec.l : '');
}

function statusOf(rec){
  if (rec.st && rec.st !== 'pending') return rec.st;
  return sec() >= rec.t ? 'expired' : 'pending';
}

function publicInvoice(rec, origin){
  return {
    id: rec.h,
    object: 'invoice',
    status: statusOf(rec),
    livemode: rec.mode === 'live',
    network: rec.net,
    merchant: rec.w,
    amount: rec.a,
    currency: rec.c,
    order_id: rec.o || null,
    description: rec.i || null,
    shop_name: rec.n || null,
    metadata: rec.md || {},
    success_url: rec.r || null,
    payment_url: payUrl(rec, origin),
    created_at: rec.ct,
    expires_at: rec.t,
    payment: rec.pay ? {
      payer: rec.pay.payer, amount: rec.pay.amount, currency: rec.pay.cur || rec.c,
      refunded: rec.pay.refunded || '0', tx: rec.pay.tx || null, block: rec.pay.block || null,
      paid_after_expiry: !!rec.pay.late
    } : null,
    webhook: { delivered: !!(rec.wh && rec.wh.ok), attempts: (rec.wh && rec.wh.n) || 0 }
  };
}

function okReturnUrl(v){
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || v.length > 500) return null;
  let u; try{ u = new URL(v); } catch(e){ return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (!/^[a-z0-9.-]+$/i.test(u.hostname)) return null;
  if (OWN_HOSTS.includes(u.hostname.toLowerCase())) return null;
  return u.href;
}

function okWebhookUrl(v){
  if (typeof v !== 'string' || v.length > 300) return null;
  let u; try{ u = new URL(v); } catch(e){ return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes('.')) return null;
  if (/^[0-9.]+$/.test(h)) return null;                                  // голый IP — нет
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home)$/.test(h)) return null;
  if (h === 'tavarov.com' || h.endsWith('.tavarov.com') || OWN_HOSTS.includes(h)) return null;   // не на самих себя
  return u.href;
}

function okMetadata(v){
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > 20) return null;
  const out = {};
  for (const k of keys){
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(k)) return null;
    const x = v[k];
    if (typeof x === 'string'){ if ([...x].length > 500) return null; out[k] = x; }
    else if (typeof x === 'number' && isFinite(x)) out[k] = x;
    else if (typeof x === 'boolean') out[k] = x;
    else return null;
  }
  if (JSON.stringify(out).length > 2000) return null;
  return out;
}

/* ===================== что говорит сеть ===================== */

/* Смотрим контракт на глубине 12 блоков и решаем, что со счётом. Правило то
   же, что у /api/status: «оплачено» только если совпало всё — этот счёт,
   этот продавец, эта валюта и сумма не меньше выставленной. */
async function readChain(env, rec, knownLog){
  const cfg = netConfig(rec.net, env);
  const latest = parseInt(await rpc(cfg.rpcs, 'eth_blockNumber', []), 16);
  const safe = Math.max(0, latest - CONFIRMATIONS);
  let raw = null, sale = null;
  try{
    raw = await rpc(cfg.rpcs, 'eth_call', [{ to: cfg.pay, data: SALE_OF + rec.h.slice(2) }, hex(safe)]);
  } catch(e){
    /* Контракт тестовой сети — первой версии: saleOf в нём нет, он
       отказывает. Тогда оплату ищем в его журнале — событие Paid несёт
       и номер счёта, и продавца, и сумму. Возвратов та версия не знает. */
    if (!/revert/i.test(String(e && e.message))) throw e;
    const log = knownLog || await findPaidLog(cfg, rec, safe);
    if (!log) return { st: null };
    sale = { merchant: ('0x' + log.topics[1].slice(-40)).toLowerCase(),
             amount: BigInt(word(log.data, 0)) + BigInt(word(log.data, 1)),
             buyer: ('0x' + log.topics[2].slice(-40)).toLowerCase(), refunded: 0n,
             token: ('0x' + log.topics[3].slice(-40)).toLowerCase() };
  }
  if (!sale){
    const d = String(raw || '').replace(/^0x/, '');
    if (d.length < 64 * 5) return { st: null };
    sale = { merchant: addrAt(raw, 0).toLowerCase(), amount: BigInt(word(raw, 1)),
             buyer: addrAt(raw, 2).toLowerCase(), refunded: BigInt(word(raw, 3)),
             token: addrAt(raw, 4).toLowerCase() };
  }
  if (sale.merchant === ZERO || sale.merchant !== rec.w.toLowerCase() || sale.amount === 0n) return { st: null };

  const tk = cfg.tokens[rec.c];
  const want = toUnits(rec.a, tk.d);
  let curSym = null, dec = 18;
  for (const k of Object.keys(cfg.tokens))
    if (cfg.tokens[k].a.toLowerCase() === sale.token){ curSym = k; dec = cfg.tokens[k].d; }

  let st;
  if (sale.token !== tk.a.toLowerCase()) st = 'wrong_currency';
  else if (sale.amount < want) st = 'underpaid';
  else if (sale.refunded > 0n && sale.amount - sale.refunded < want) st = 'refunded';
  else st = 'paid';

  /* Номер транзакции, найденный раньше, берём, только если это та же
     оплата: тот же плательщик, та же сумма, та же валюта. */
  const amt = fmtUnits(sale.amount, dec);
  const same = !!(rec.pay && rec.pay.payer === sale.buyer && rec.pay.amount === amt && rec.pay.cur === (curSym || sale.token));
  const pay = { payer: sale.buyer, amount: amt, cur: curSym || sale.token,
                refunded: fmtUnits(sale.refunded, dec),
                tx: (same && rec.pay.tx) || null, block: (same && rec.pay.block) || null,
                late: (same && rec.pay.late) || false };

  if (knownLog){ pay.tx = knownLog.transactionHash; pay.block = parseInt(knownLog.blockNumber, 16); }
  if (!pay.tx){
    try{
      const logs = await rpc(cfg.rpcs, 'eth_getLogs', [{ address: cfg.pay,
        fromBlock: hex(safe - TX_LOOKBACK), toBlock: hex(safe), topics: [PAID_TOPIC, pad(rec.w)] }]);
      for (const l of (logs || [])){
        if (word(l.data, 3).toLowerCase() !== rec.h) continue;
        pay.tx = l.transactionHash; pay.block = parseInt(l.blockNumber, 16); break;
      }
    } catch(e){ /* номер транзакции — для удобства; на «оплачено» не влияет */ }
  }
  if (!same && sec() > rec.t) pay.late = true;
  return { st, pay };
}

/* Поиск события оплаты по номеру счёта — для контракта без saleOf. Ищем с
   момента выставления счёта (раньше оплатить его было нельзя), кусками:
   узлы не отдают журнал за слишком широкий промежуток. */
async function findPaidLog(cfg, rec, safe){
  const back = Math.min(60000, Math.ceil((sec() - rec.ct) / 0.45) + 200);
  const from = Math.max(0, safe - back);
  for (let to = safe; to >= from; to -= 10000){
    const lo = Math.max(from, to - 9999);
    const logs = await rpc(cfg.rpcs, 'eth_getLogs', [{ address: cfg.pay, fromBlock: hex(lo), toBlock: hex(to),
      topics: [PAID_TOPIC, pad(rec.w)] }]);
    for (const l of (logs || [])) if (word(l.data, 3).toLowerCase() === rec.h) return l;
  }
  return null;
}

/* ===================== вебхук ===================== */

function paidEvent(rec, origin){
  return { id: 'evt_' + rec.h.slice(2, 34), type: 'invoice.paid', created: sec(),
           livemode: rec.mode === 'live', data: publicInvoice(rec, origin) };
}

export async function signPayload(secret, t, body){ return hmacHex(secret, t + '.' + body); }

async function sendWebhook(acct, event){
  const url = acct && acct.webhook && acct.webhook.url;
  if (!url) return { ok: false, none: true };
  const body = JSON.stringify(event);
  const t = sec();
  const sig = await signPayload(acct.webhook.secret, t, body);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  const started = Date.now();
  try{
    const r = await fetch(url, { method: 'POST', redirect: 'manual', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'user-agent': 'TavarovPay-Webhooks/1',
                 'tavarov-signature': 't=' + t + ',v1=' + sig, 'tavarov-event-id': event.id },
      body });
    return { ok: r.status >= 200 && r.status < 300, code: r.status, ms: Date.now() - started };
  } catch(e){
    return { ok: false, code: 0, ms: Date.now() - started, error: ctl.signal.aborted ? 'timeout' : 'connect' };
  } finally { clearTimeout(timer); }
}

/* Счёт оплачен — сообщаем магазину. Возвращает, когда пробовать снова (или
   ничего). Сам очередь не пишет: этим занимается тот, кто позвал. */
async function deliver(env, rec, origin){
  const acct = await kvGet(env, kAcct(rec.w));
  const res = await sendWebhook(acct, paidEvent(rec, origin));
  const wh = rec.wh || { n: 0 };
  if (res.none){ rec.wh = { none: true, n: wh.n || 0 }; return null; }
  wh.n = (wh.n || 0) + 1;
  wh.at = sec(); wh.code = res.code;
  if (res.ok){ wh.ok = true; delete wh.next; rec.wh = wh; return null; }
  if (wh.n >= BACKOFF.length){ wh.dead = true; delete wh.next; rec.wh = wh; return null; }
  wh.next = sec() + BACKOFF[wh.n - 1];
  rec.wh = wh;
  return wh.next;
}
const webhookDone = rec => !!(rec.wh && (rec.wh.ok || rec.wh.none || rec.wh.dead));

/* Обновить счёт по сети и, если он только что стал оплаченным (или вебхук
   ждёт повтора, и время пришло), сообщить магазину. */
async function refresh(env, rec, origin, opts){
  const o = opts || {};
  const before = JSON.stringify([rec.st || 'pending', rec.pay || null, rec.wh || null]);
  const chain = await readChain(env, rec, o.log);
  if (chain.st){ rec.st = chain.st; rec.pay = chain.pay; }
  let retryAt = null;
  if (o.noDeliver){
    /* Чтение магазином вебхук не шлёт. Иначе обработчик вебхука, который
       сам спрашивает у нас статус (так делать правильно), запускал бы
       следующий вебхук — и так по кругу. Неотправленный — в очередь,
       отправит таймер. */
    if (rec.st === 'paid' && !webhookDone(rec) && !(rec.wh && rec.wh.next)) retryAt = sec();
  }
  else if (rec.st === 'paid' && !webhookDone(rec) && (o.force || !(rec.wh && rec.wh.next > sec())))
    retryAt = await deliver(env, rec, origin);
  else if (rec.st === 'paid' && rec.wh && rec.wh.next) retryAt = rec.wh.next;
  const after = JSON.stringify([rec.st || 'pending', rec.pay || null, rec.wh || null]);
  if (after !== before) await kvPut(env, kInv(rec.h), rec, INV_TTL);
  return { retryAt };
}

async function enqueue(env, h, at){
  const q = (await kvGet(env, K_QUEUE)) || [];
  if (q.some(e => e.h === h && e.n <= at)) return;       // уже ждёт — лишняя запись ни к чему
  const rest = q.filter(e => e.h !== h);
  rest.push({ h, n: at });
  await kvPut(env, K_QUEUE, rest.slice(-500));
}

/* ===================== обработчики ===================== */

async function readBody(request){
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return { tooBig: true };
  let text = '';
  try{ text = await request.text(); } catch(e){ return { bad: true }; }
  if (text.length > MAX_BODY) return { tooBig: true };
  if (!text.trim()) return { body: {} };
  try{
    const b = JSON.parse(text);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { bad: true };
    return { body: b };
  } catch(e){ return { bad: true }; }
}

/* Грубый предохранитель от засыпания хранилища счетами: 60 в минуту на
   ключ. Считается в кэше площадки, а не в KV — счётчик в KV сам съел бы
   весь запас записей. Не точный, но и задача его — не бухгалтерия. */
async function rateLimited(origin, keyHash){
  if (typeof caches === 'undefined' || !caches.default) return false;
  try{
    const minute = Math.floor(Date.now() / 60000);
    const req = new Request(origin + '/__v1/rl/' + keyHash + '/' + minute);
    const hit = await caches.default.match(req);
    const n = hit ? parseInt(await hit.text(), 10) || 0 : 0;
    if (n >= RATE_PER_MIN) return true;
    await caches.default.put(req, new Response(String(n + 1), { headers: { 'cache-control': 'max-age=90' } }));
  } catch(e){}
  return false;
}

async function createInvoice(request, env, who, origin){
  if (await rateLimited(origin, who.hash)) return fail(429, 'rate_limited', 'Too many invoices per minute for this key.');
  const rb = await readBody(request);
  if (rb.tooBig) return fail(413, 'too_large', 'Request body is larger than 8 KB.');
  if (rb.bad) return fail(400, 'bad_json', 'Body must be a JSON object.');
  const b = rb.body;
  const cfg = netConfig(who.net, env);

  const c = String(b.currency || 'USDT').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(cfg.tokens, c))
    return fail(400, 'bad_currency', 'Currency must be one of: ' + Object.keys(cfg.tokens).join(', ') + '.');
  const units = toUnits(b.amount === undefined ? '' : String(b.amount), cfg.tokens[c].d);
  if (units === null || units <= 0n)
    return fail(400, 'bad_amount', 'amount must be a positive decimal string like "12.50", with at most ' + cfg.tokens[c].d + ' decimals.');
  const a = fmtUnits(units, cfg.tokens[c].d);

  const o = cleanText(b.order_id, 64);
  if (o === null) return fail(400, 'bad_order_id', 'order_id: up to 64 characters, one line.');
  const i = cleanText(b.description, 64);
  if (i === null) return fail(400, 'bad_description', 'description: up to 64 characters, one line.');
  const n = cleanText(b.shop_name, 48);
  if (n === null) return fail(400, 'bad_shop_name', 'shop_name: up to 48 characters, one line.');
  const r = okReturnUrl(b.success_url);
  if (r === null) return fail(400, 'bad_success_url', 'success_url must be an https:// address of your site.');
  const md = okMetadata(b.metadata);
  if (md === null) return fail(400, 'bad_metadata', 'metadata: up to 20 keys, values are strings (≤500), numbers or booleans, 2 KB in total.');
  let ttl = b.expires_in === undefined ? 3600 : Number(b.expires_in);
  if (!Number.isInteger(ttl) || ttl < 300 || ttl > 7 * 86400)
    return fail(400, 'bad_expires_in', 'expires_in: whole seconds from 300 to 604800.');
  const l = b.lang === undefined || b.lang === null || b.lang === '' ? '' : String(b.lang);
  if (l && !LANGS.includes(l)) return fail(400, 'bad_lang', 'lang: one of ' + LANGS.join(', ') + '.');

  /* Повтор того же заказа (магазин не дождался ответа и спросил ещё раз) —
     отдаём тот же счёт, а не второй. */
  let orderKey = null;
  if (o){
    orderKey = kOrder(who.w, who.mode, await sha256hex(o));
    const prevH = await env.TILL.get(orderKey);
    if (prevH && okHash(prevH)){
      const prev = await kvGet(env, kInv(prevH));
      if (prev){
        const st = statusOf(prev);
        if (st === 'paid') return fail(409, 'order_paid', 'This order_id is already paid.', { invoice: prev.h });
        if (st === 'pending'){
          if (prev.a !== a || prev.c !== c)
            return fail(409, 'order_exists', 'A pending invoice with this order_id exists with a different amount or currency.', { invoice: prev.h });
          return json(publicInvoice(prev, origin), 200, { 'tavarov-idempotent-replay': 'true' });
        }
      }
    }
  }

  const now = sec();
  const rec = { h: randomHex32(), w: who.w, mode: who.mode, net: who.net, a, c,
                o, i, n, r, md, l, ct: now, t: now + ttl, st: 'pending' };
  await kvPut(env, kInv(rec.h), rec, INV_TTL);
  if (orderKey) await env.TILL.put(orderKey, rec.h, { expirationTtl: ttl + 86400 });
  try{
    const list = (await kvGet(env, kRecent(who.w, who.mode))) || [];
    list.unshift(rec.h);
    await kvPut(env, kRecent(who.w, who.mode), list.slice(0, 50), INV_TTL);
  } catch(e){ /* список в кабинете — для удобства */ }
  return json(publicInvoice(rec, origin), 201);
}

async function getInvoice(env, who, id, origin, waitUntil){
  if (!okHash(id)) return fail(404, 'not_found', 'No such invoice.');
  const rec = await kvGet(env, kInv(id));
  if (!rec || rec.w !== who.w || rec.mode !== who.mode) return fail(404, 'not_found', 'No such invoice.');
  try{
    const { retryAt } = await refresh(env, rec, origin, { noDeliver: true });
    if (retryAt) waitUntil(enqueue(env, rec.h, retryAt));
  } catch(e){
    return json(Object.assign(publicInvoice(rec, origin), { stale: true }), 200);
  }
  return json(publicInvoice(rec, origin));
}

/* Страница оплаты зовёт это сразу после «Оплачено» — чтобы магазин узнал
   через секунды, а не через минуту. Без ключа: ответ — только статус, а
   решает всё равно сеть. */
async function checkInvoice(env, id, origin, waitUntil){
  if (!okHash(id)) return fail(404, 'not_found', 'No such invoice.');
  const rec = await kvGet(env, kInv(id));
  if (!rec) return fail(404, 'not_found', 'No such invoice.');
  try{
    const { retryAt } = await refresh(env, rec, origin);
    if (retryAt) waitUntil(enqueue(env, rec.h, retryAt));
  } catch(e){ return fail(503, 'network', 'The network is not answering, try again.'); }
  return json({ id: rec.h, status: statusOf(rec) });
}

/* Таймер. Воркер tavarov-api-cron зовёт это раз в минуту. Смотрит журнал
   контракта за последние минуты и повторяет вебхуки, которые не дошли. */
async function runCron(env, origin){
  if (typeof caches !== 'undefined' && caches.default && !env.V1_NO_THROTTLE){
    try{
      const req = new Request(origin + '/__v1/cron-lock');
      if (await caches.default.match(req)) return json({ skipped: true });
      await caches.default.put(req, new Response('1', { headers: { 'cache-control': 'max-age=25' } }));
    } catch(e){}
  }
  const out = { scanned: {}, delivered: 0, retried: 0 };
  const now = sec();
  let q = (await kvGet(env, K_QUEUE)) || [];
  const qBefore = JSON.stringify(q);
  const push = (h, at) => { q = q.filter(e => e.h !== h); if (at) q.push({ h, n: at }); };

  for (const net of Object.keys(NETS)){
    try{
      const cfg = netConfig(net, env);
      const latest = parseInt(await rpc(cfg.rpcs, 'eth_blockNumber', []), 16);
      const safe = Math.max(0, latest - CONFIRMATIONS);
      const logs = await rpc(cfg.rpcs, 'eth_getLogs', [{ address: cfg.pay,
        fromBlock: hex(safe - SCAN_BLOCKS), toBlock: hex(safe), topics: [PAID_TOPIC] }]);
      out.scanned[net] = (logs || []).length;
      const seen = new Set();
      for (const l of (logs || [])){
        const h = word(l.data, 3).toLowerCase();
        if (seen.has(h)) continue;
        seen.add(h);
        /* Донат, который ещё ждёт подтверждения, — подтверждаем здесь же:
           иначе, не открой автор приложение или экран OBS за два часа,
           сообщение зрителя пропало бы. */
        try{
          if ((await env.TILL.get('donh:' + h)) === '1'){
            if (await promoteByHash(env, net, '0x' + String(l.topics[1]).slice(-40), h)) out.donations = (out.donations || 0) + 1;
          }
        } catch(e){}
        const rec = await kvGet(env, kInv(h));
        if (!rec || rec.net !== net) continue;
        if (rec.st === 'paid' && webhookDone(rec)) continue;
        if (rec.wh && rec.wh.next > now) continue;
        const had = !!(rec.wh && rec.wh.ok);
        const { retryAt } = await refresh(env, rec, origin, { log: l });
        if (!had && rec.wh && rec.wh.ok) out.delivered++;
        push(h, retryAt);
      }
    } catch(e){ out.scanned[net] = 'error'; }
  }

  const due = q.filter(e => e.n <= now).slice(0, 10);
  for (const e of due){
    try{
      const rec = await kvGet(env, kInv(e.h));
      if (!rec || webhookDone(rec)){ push(e.h, null); continue; }
      const { retryAt } = await refresh(env, rec, origin, { force: true });
      out.retried++;
      push(e.h, retryAt);
    } catch(err){ /* сеть молчит — попробуем в следующую минуту */ }
  }
  if (JSON.stringify(q) !== qBefore) await kvPut(env, K_QUEUE, q.slice(-500));
  return json(out);
}

/* ===================== кабинет ===================== */

async function login(request, env){
  const rb = await readBody(request);
  if (rb.tooBig || rb.bad) return fail(400, 'bad_json', 'Body must be a JSON object.');
  const { address, ts, sig } = rb.body;
  if (!okAddr(address)) return fail(400, 'bad_address', 'Bad wallet address.');
  if (!Number.isInteger(ts) || Math.abs(sec() - ts) > LOGIN_SLACK)
    return fail(400, 'bad_time', 'The signature is too old or the clock is off. Sign again.');
  if (typeof sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return fail(400, 'bad_signature', 'Bad signature format.');
  let signer = null;
  try{
    signer = await recoverByQuorum(netConfig('bnb', env).rpcs, messageHash(loginText(address, ts)), sig);
  } catch(e){ return fail(503, 'network', 'Could not check the signature right now, try again.'); }
  if (!signer || signer !== address.toLowerCase()) return fail(403, 'wrong_signer', 'This login was not signed by that wallet.');
  const token = 'sess_' + randomToken(32);
  await kvPut(env, kSess(await sha256hex(token)), { w: signer, exp: sec() + SESS_TTL }, SESS_TTL);
  return json({ session: token, wallet: signer, expires_at: sec() + SESS_TTL });
}

function accountView(acct, w){
  const a = acct || {};
  const k = m => a.keys && a.keys[m] ? { tail: a.keys[m].tail, created_at: a.keys[m].ct } : null;
  return { wallet: w, keys: { live: k('live'), test: k('test') },
           webhook: a.webhook ? { url: a.webhook.url, secret: a.webhook.secret } : null };
}

async function devRoute(parts, request, env, origin, waitUntil){
  const method = request.method;
  if (parts[0] === 'login' && method === 'POST') return login(request, env);

  const who = await bySession(request, env);
  if (!who) return fail(401, 'no_session', 'Sign in again.');
  const acct = (await kvGet(env, kAcct(who.w))) || { w: who.w, ct: sec(), keys: {} };
  acct.keys = acct.keys || {};

  if (parts[0] === 'logout' && method === 'POST'){
    await env.TILL.delete(kSess(who.hash));
    return json({ ok: true });
  }
  if (parts[0] === 'account' && method === 'GET') return json(accountView(acct, who.w));

  if (parts[0] === 'keys' && method === 'POST'){
    const rb = await readBody(request);
    if (rb.tooBig || rb.bad) return fail(400, 'bad_json', 'Body must be a JSON object.');
    const mode = rb.body.mode;
    if (mode !== 'live' && mode !== 'test') return fail(400, 'bad_mode', 'mode: live or test.');
    const old = acct.keys[mode];
    if (parts[1] === 'revoke'){
      if (old) await env.TILL.delete(kKey(old.hash));
      delete acct.keys[mode];
      await kvPut(env, kAcct(who.w), acct);
      return json(accountView(acct, who.w));
    }
    const key = 'tp_' + mode + '_' + randomToken(32);
    const hash = await sha256hex(key);
    await kvPut(env, kKey(hash), { w: who.w, mode, ct: sec() });
    if (old) await env.TILL.delete(kKey(old.hash));
    acct.keys[mode] = { hash, tail: key.slice(-4), ct: sec() };
    await kvPut(env, kAcct(who.w), acct);
    return json(Object.assign(accountView(acct, who.w), { new_key: key }));
  }

  if (parts[0] === 'webhook' && parts[1] === 'test' && method === 'POST'){
    if (!acct.webhook) return fail(400, 'no_webhook', 'Set a webhook URL first.');
    const res = await sendWebhook(acct, { id: 'evt_test_' + randomToken(9), type: 'ping', created: sec(),
      livemode: false, data: { message: 'Tavarov Pay webhook test. If you see this, your endpoint works.' } });
    return json({ ok: !!res.ok, status_code: res.code || 0, ms: res.ms || 0, error: res.error || null });
  }

  if (parts[0] === 'webhook' && method === 'POST'){
    const rb = await readBody(request);
    if (rb.tooBig || rb.bad) return fail(400, 'bad_json', 'Body must be a JSON object.');
    const b = rb.body;
    if (b.url === null || b.url === ''){ acct.webhook = null; }
    else {
      const url = okWebhookUrl(b.url);
      if (!url) return fail(400, 'bad_url', 'Webhook URL must be https:// on your own domain (no IP addresses, no localhost).');
      const secret = (acct.webhook && acct.webhook.secret && !b.rotate_secret) ? acct.webhook.secret : 'whsec_' + randomToken(32);
      acct.webhook = { url, secret, ct: sec() };
    }
    await kvPut(env, kAcct(who.w), acct);
    return json(accountView(acct, who.w));
  }

  if (parts[0] === 'invoices' && !parts[1] && method === 'GET'){
    const mode = new URL(request.url).searchParams.get('mode') === 'test' ? 'test' : 'live';
    const list = (await kvGet(env, kRecent(who.w, mode))) || [];
    const items = [];
    for (const h of list.slice(0, 30)){
      const rec = await kvGet(env, kInv(h));
      if (rec && rec.w === who.w) items.push(publicInvoice(rec, origin));
    }
    return json({ items });
  }

  if (parts[0] === 'invoices' && okHash(parts[1]) && parts[2] === 'resend' && method === 'POST'){
    const rec = await kvGet(env, kInv(parts[1]));
    if (!rec || rec.w !== who.w) return fail(404, 'not_found', 'No such invoice.');
    try{ await readChain(env, rec).then(ch => { if (ch.st){ rec.st = ch.st; rec.pay = ch.pay; } }); }
    catch(e){ return fail(503, 'network', 'The network is not answering, try again.'); }
    if (rec.st !== 'paid') return fail(409, 'not_paid', 'Only a paid invoice can be re-sent.');
    rec.wh = { n: 0 };
    const retryAt = await deliver(env, rec, origin);
    await kvPut(env, kInv(rec.h), rec, INV_TTL);
    if (retryAt) waitUntil(enqueue(env, rec.h, retryAt));
    return json(publicInvoice(rec, origin));
  }

  return fail(404, 'not_found', 'No such method.');
}

/* ===================== вход ===================== */

export async function handle(request, env, waitUntil){
  const wait = waitUntil || (() => {});
  const url = new URL(request.url);
  /* Ссылки на оплату и документацию — всегда на основной адрес, даже если
     спросили через запасной (tavarov-wallet.pages.dev): туда ходит таймер. */
  const origin = OWN_HOSTS.includes(url.hostname) ? 'https://wallet.tavarov.com' : url.origin;
  const parts = url.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean);
  const method = request.method;

  if (!parts.length && method === 'GET')
    return json({ name: 'Tavarov Pay API', version: 1, docs: origin + '/dev' });
  if (!env || !env.TILL) return fail(503, 'no_storage', 'Storage is not configured on this deployment.');

  try{
    if (parts[0] === 'cron' && (method === 'GET' || method === 'POST')) return await runCron(env, origin);
    if (parts[0] === 'dev') return await devRoute(parts.slice(1), request, env, origin, wait);
    if (parts[0] === 'invoices' && okHash(parts[1]) && parts[2] === 'check' && method === 'POST')
      return await checkInvoice(env, parts[1], origin, wait);

    if (parts[0] === 'invoices' || parts[0] === 'me'){
      const who = await byApiKey(request, env);
      if (!who) return fail(401, 'bad_key', 'Missing or wrong API key. Send it as: Authorization: Bearer tp_live_…');
      if (parts[0] === 'me' && method === 'GET')
        return json({ merchant: who.w, livemode: who.mode === 'live', network: who.net,
                      currencies: Object.keys(NETS[who.net].tokens) });
      if (parts[0] === 'invoices' && !parts[1] && method === 'POST') return await createInvoice(request, env, who, origin);
      if (parts[0] === 'invoices' && parts[1] && !parts[2] && method === 'GET')
        return await getInvoice(env, who, String(parts[1]).toLowerCase(), origin, wait);
    }
    return fail(404, 'not_found', 'No such method. See ' + origin + '/dev');
  } catch(e){
    console.log('v1 error', parts.join('/'), e && e.stack || e);
    return fail(500, 'internal', 'Something went wrong on our side. Try again.');
  }
}

export const onRequest = ctx => handle(ctx.request, ctx.env, p => ctx.waitUntil(p));
