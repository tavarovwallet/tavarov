/* Донаты: сообщения к оплатам.

   ЗАЧЕМ. Деньги доната идут через тот же контракт оплаты, что и покупка:
   зритель → блогер, 1% в казну, всё видно в сети. Но в операцию нельзя
   положить текст — а «спасибо за стрим» и ник и есть смысл доната.
   Поэтому текст лежит здесь, рядом с номером счёта операции.

   ГЛАВНОЕ ПРАВИЛО. Сообщение показывается блогеру ТОЛЬКО если по его номеру
   счёта в контракте записана настоящая оплата именно этому блогеру. Пока
   оплаты нет, сообщение лежит в «ожидании» два часа и потом исчезает само.
   Значит, написать блогеру гадость бесплатно нельзя: каждое видимое
   сообщение стоило отправителю денег, а блогеру их принесло.

   ЧТО ХРАНИТСЯ И СКОЛЬКО:
     ожидание  — ник, текст, номер счёта; 2 часа;
     донат     — то же плюс сумма, валюта и адрес плательщика из контракта;
                 180 дней. Сумма и плательщик и так публичны в блокчейне.
   Ничего о зрителе сверх того, что он сам написал, здесь нет.

   KV тот же, что у кассы (TILL); ключи начинаются с don. */

const NETS = {
  bnb:        { rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org',
                       'https://bsc-dataseed1.bnbchain.org'],
                pays: ['0x1Fc681FA250A17e66B57B7150F2EeD4e71D1Ca35',    // v3
                       '0xCa4FE6e5dF7159910b2165Acfa9BB8b19810D65c'],   // v2
                tokens: { USDT: { a:'0x55d398326f99059fF775485246999027B3197955', d:18 },
                          USDC: { a:'0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', d:18 },
                          TVR:  { a:'0x8Baa77344Fc122967902651D0C3193cdF4c48503', d:18 } } },
  bnbTestnet: { rpcs: ['https://bsc-testnet-rpc.publicnode.com'],
                pays: ['0x3A3Ba9776ea9c48AE6C69Ae6153d9bBc892ed6e6'],
                tokens: { USDT: { a:'0xb4ac75E8CF7c768FFd9fAfeAF1bF77B48209524e', d:6  },
                          TVR:  { a:'0x74536e79b374CCFa0123035B28f7a3b7333f323a', d:18 } } }
};

const PENDING_TTL = 2 * 3600;
const DONE_TTL    = 180 * 86400;
const MAX_BODY    = 2048;
const MAX_MSG     = 200;
const MAX_NICK    = 32;
const SALE_OF = '0x38d56afe';

const okAddr = v => /^0x[0-9a-fA-F]{40}$/.test(v || '');
const okHash = v => /^0x[0-9a-fA-F]{64}$/.test(v || '');
/* Тот же запрет, что у кассы: управляющие, невидимые, разворот текста. Плюс
   переносы строк — сообщение однострочное, иначе на экране стрима им можно
   нарисовать что угодно. */
const BAD_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const okText = (v, max) => typeof v === 'string' && [...v].length <= max && !BAD_CHARS.test(v);

const json = (o, code) => new Response(JSON.stringify(o), {
  status: code || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function netConfig(net, env){
  const base = NETS[net];
  const e = env || {};
  return {
    rpcs: e.TAVAROV_RPC ? [e.TAVAROV_RPC] : base.rpcs,
    pays: e.TAVAROV_PAY ? [e.TAVAROV_PAY] : base.pays,
    tokens: base.tokens
  };
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

import { messageHash, recoverAddress } from './_crypto.js';
import { overLimit, tooMany } from './_limit.js';

const PAID_TOPIC = '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861';
const hexN = n => '0x' + Math.max(0, n).toString(16);
const padA = a => '0x' + '0'.repeat(24) + a.toLowerCase().replace(/^0x/, '');

/* Контракт тестовой сети — первой версии: saleOf в нём нет, он отказывает.
   Там оплату ищем в журнале: событие Paid несёт номер счёта, продавца,
   плательщика, монету и сумму. Ищем только ПОСЛЕ того, как сообщение
   легло сюда (since), — так и в журнале соблюдается главное правило:
   сначала сообщение, потом оплата. Чужой старый донат без сообщения
   этим путём не присвоить. */
async function paidFromLog(cfg, hub, h, to, since){
  const latest = parseInt(await rpc(cfg.rpcs, 'eth_blockNumber', []), 16);
  const back = Math.min(20000, Math.ceil((Math.floor(Date.now() / 1000) - since + 60) / 0.45) + 50);
  const from = Math.max(0, latest - back);
  for (let hi = latest; hi >= from; hi -= 5000){
    const lo = Math.max(from, hi - 4999);
    const logs = await rpc(cfg.rpcs, 'eth_getLogs', [{ address: hub, fromBlock: hexN(lo), toBlock: hexN(hi),
      topics: [PAID_TOPIC, padA(to)] }]);
    for (const l of (logs || [])){
      const d = String(l.data || '').replace(/^0x/, '');
      if (('0x' + d.slice(192, 256)).toLowerCase() !== h.toLowerCase()) continue;
      const amount = BigInt('0x' + d.slice(0, 64)) + BigInt('0x' + d.slice(64, 128));
      if (amount === 0n) continue;
      return { amount, buyer: '0x' + l.topics[2].slice(-40), refunded: 0n, token: '0x' + l.topics[3].slice(-40) };
    }
  }
  return null;
}

/* Оплата по номеру счёта — в любом из контрактов оплаты, но только этому
   блогеру. Чужая оплата с тем же номером не в счёт. */
async function paidSale(cfg, h, to, since){
  let silent = 0;
  for (const hub of cfg.pays){
    let raw = null;
    try{ raw = await rpc(cfg.rpcs, 'eth_call', [{ to: hub, data: SALE_OF + h.slice(2) }, 'latest']); }
    catch(e){
      if (/revert/i.test(String(e && e.message))){
        try{
          const s = await paidFromLog(cfg, hub, h, to, since || Math.floor(Date.now() / 1000));
          if (s) return s;
          continue;
        } catch(err){ silent++; continue; }
      }
      silent++; continue;
    }
    const d = String(raw || '').replace(/^0x/, '');
    if (d.length < 64 * 5) continue;
    const w = n => d.slice(n * 64, (n + 1) * 64);
    const merchant = '0x' + w(0).slice(24);
    const amount = BigInt('0x' + w(1));
    const buyer = '0x' + w(2).slice(24);
    const refunded = BigInt('0x' + w(3));
    const token = '0x' + w(4).slice(24);
    if (merchant.toLowerCase() !== to.toLowerCase() || amount === 0n) continue;
    return { amount, buyer, refunded, token };
  }
  /* «Не знаю» — не то же самое, что «не оплачено». Если хоть один контракт
     не ответил, решать нельзя: вызывающий получит ошибку. */
  if (silent) throw new Error('network is not answering');
  return null;
}

function fmtUnits(units, dec){
  const s = BigInt(units).toString().padStart(dec + 1, '0');
  return (s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec)).replace(/\.?0+$/, '') || '0';
}
function tokenOf(cfg, addr){
  for (const k of Object.keys(cfg.tokens))
    if (cfg.tokens[k].a.toLowerCase() === String(addr).toLowerCase()) return { sym: k, d: cfg.tokens[k].d };
  return null;
}

const pKey = (net, to, h) => 'donp:' + net + ':' + to.toLowerCase() + ':' + h.toLowerCase();
const hKey = h => 'donh:' + h.toLowerCase();
/* Список донатов автора — одним значением. Раньше список собирался
   перебором ключей (list), а перебор на бесплатном KV — тысяча в сутки на
   всех: пятьсот запросов с чужими адресами, и лента донатов лежит до
   полуночи. Одно чтение ключа таких ограничений почти не знает. */
const iKey = (net, to) => 'donidx:' + net + ':' + to.toLowerCase();
const INDEX_MAX = 500;
async function readIndex(env, net, to){
  const v = await env.TILL.get(iKey(net, to));
  if (!v) return [];
  try{ const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch(e){ return []; }
}
async function addToIndex(env, net, to, meta){
  const list = await readIndex(env, net, to);
  const h = String(meta.h).toLowerCase();
  if (list.some(m => String(m.h).toLowerCase() === h)) return;
  list.unshift(meta);
  const cut = Date.now() - DONE_TTL * 1000;
  await env.TILL.put(iKey(net, to), JSON.stringify(list.filter(m => m.ts >= cut).slice(0, INDEX_MAX)), { expirationTtl: DONE_TTL });
}
/* Сообщение на экран стрима — только за настоящие деньги: USDT или USDC и
   не меньше 10 центов. Иначе любой выпустит свою пустую монету, «заплатит»
   ею миллион единиц за копейки комиссии и выведет на чужой стрим что
   угодно. */
const DONATE_TOKENS = ['USDT', 'USDC'];
const MIN_CENTS = 10;

async function promote(env, cfg, net, to, entry){
  const sale = await paidSale(cfg, entry.h, to, entry.ts || Math.floor(Date.now() / 1000) - PENDING_TTL);
  if (!sale) return null;
  const tk = tokenOf(cfg, sale.token);
  if (!tk || !DONATE_TOKENS.includes(tk.sym)) return null;
  if (sale.amount / (10n ** BigInt(Math.max(0, tk.d - 2))) < BigInt(MIN_CENTS)) return null;
  const ts = Date.now();
  const meta = { h: entry.h, n: entry.n, m: entry.m, ts,
                 a: sale.amount.toString(), t: sale.token.toLowerCase(), p: sale.buyer.toLowerCase(),
                 s: tk ? tk.sym : '', d: tk ? tk.d : 18 };
  /* И под номером счёта — чтобы экран стрима находил донат одним чтением,
     без перебора списка (перебор на бесплатном тарифе — тысяча в сутки на
     всех, а экран спрашивает часто). */
  await env.TILL.put(hKey(entry.h), JSON.stringify(Object.assign({ to: to.toLowerCase(), net }, meta)), { expirationTtl: DONE_TTL });
  await addToIndex(env, net, to, meta);
  await env.TILL.delete(pKey(net, to, entry.h));
  return meta;
}
/* Подтвердить донат по номеру счёта, если он ещё ждёт. Зовут таймер API
   (раз в минуту, по журналу контракта) и страница оплаты сразу после
   «Оплачено» — чтобы донат не пропал, если автор в эти два часа не
   открывал ни приложение, ни экран OBS. */
export async function promoteByHash(env, net, to, h){
  if (!env || !env.TILL || !NETS[net] || !okAddr(to) || !okHash(h)) return null;
  if ((await env.TILL.get(hKey(h))) !== '1') return null;
  const raw = await env.TILL.get(pKey(net, to, h));
  let e = null; try{ e = raw ? JSON.parse(raw) : null; } catch(x){}
  if (!e || !okHash(e.h)) return null;
  return promote(env, netConfig(net, env), net, to, e);
}
const view = m => ({ h: m.h, nick: m.n || '', msg: m.m || '', ts: m.ts,
                     amount: fmtUnits(m.a || '0', Number(m.d) || 18), cur: m.s || '', payer: m.p || '' });

/* ===================== страница автора =====================
   Приветствие и цель сбора. Пишет их только сам автор: запрос подписан
   ключом его кошелька (подпись сообщения, денег не двигает). Проверка
   подписи — на двух разных узлах сети, как у кассы.

   Сколько собрано на цель, считаем не из наших записей, а из журнала
   контракта оплаты: все оплаты этому кошельку в долларах (USDT, USDC) с
   того блока, когда цель поставлена. Так число нельзя ни подкрутить, ни
   сбить двумя одновременными запросами: любой пересчёт из сети даёт то же
   самое. Храним только «до какого блока досчитали» и сумму на тот блок. */
const kProf = (net, to) => 'donprof:' + net + ':' + to.toLowerCase();
const MAX_GREETING = 200, MAX_GOAL_TITLE = 48;
const CONFIRM_BLOCKS = 12;
const GOAL_STEP = 20000;           // сколько блоков журнала спрашиваем за раз
const GOAL_MAX_STEPS = 6;          // и сколько раз за один запрос

export function profileText(o){
  return ['Tavarov donation page',
          'wallet: ' + String(o.to).toLowerCase(),
          'network: ' + o.net,
          'greeting: ' + (o.greeting || ''),
          'goal: ' + (o.goal || ''),
          'target: ' + (o.target || ''),
          'restart: ' + (o.restart ? 'yes' : 'no'),
          'time: ' + o.ts].join('\n');
}
const centsStr = c => { const n = Math.max(0, Math.round(Number(c) || 0)); return (n / 100).toFixed(2).replace(/\.?0+$/, ''); };
function toCents(m){
  if (m.s !== 'USDT' && m.s !== 'USDC') return null;
  const d = Number(m.d) || 18;
  try{ return Number(BigInt(m.a || '0') / (10n ** BigInt(Math.max(0, d - 2)))); } catch(e){ return null; }
}
function parseTarget(v){
  const s = String(v || '').trim().replace(',', '.');
  if (!s) return 0;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(parseFloat(s) * 100);
  return c >= 100 && c <= 100000000 ? c : null;        // от 1 $ до миллиона
}
async function readProfile(env, net, to){
  const v = await env.TILL.get(kProf(net, to));
  if (!v) return null;
  try{ return JSON.parse(v); } catch(e){ return null; }
}
async function recoverByQuorum(urls, hash, sig){
  const answers = [];
  for (const u of urls){
    try{ answers.push(await recoverAddress((m, p) => rpc([u], m, p), hash, sig)); } catch(e){}
    if (answers.length >= 2) break;
  }
  if (!answers.length) throw new Error('no node answered');
  if (urls.length >= 2 && answers.length < 2) throw new Error('only one node answered');
  if (answers.some(a => a !== answers[0])) return null;
  return answers[0];
}

async function saveProfile(env, net, b){
  const to = String(b.to || '');
  if (!okAddr(to)) return json({ error: 'bad address' }, 400);
  const greeting = b.greeting === undefined ? '' : b.greeting;
  const goal = b.goal === undefined ? '' : b.goal;
  if (!okText(greeting, MAX_GREETING)) return json({ error: 'greeting: up to 200 characters, one line' }, 400);
  if (!okText(goal, MAX_GOAL_TITLE)) return json({ error: 'goal: up to 48 characters, one line' }, 400);
  const target = parseTarget(b.target);
  if (target === null) return json({ error: 'target: a sum from 1 to 1000000 dollars' }, 400);
  if (!!goal.trim() !== target > 0) return json({ error: 'a goal needs both a title and a sum' }, 400);
  const ts = Number(b.ts);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(ts) || Math.abs(now - ts) > 300) return json({ error: 'the signature is too old, sign again' }, 400);
  if (typeof b.sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(b.sig)) return json({ error: 'bad signature format' }, 400);

  const text = profileText({ to, net, greeting, goal, target: b.target === undefined ? '' : String(b.target), restart: !!b.restart, ts });
  let signer = null;
  try{ signer = await recoverByQuorum(netConfig('bnb', env).rpcs, messageHash(text), b.sig); }
  catch(e){ return json({ error: 'could not check the signature right now, try again' }, 503); }
  if (!signer || signer !== to.toLowerCase()) return json({ error: 'this page was not signed by its owner' }, 403);

  const old = (await readProfile(env, net, to)) || {};
  /* Старую подпись второй раз не принимаем: иначе подсмотренный запрос
     можно было бы отправить снова и вернуть прежний текст. */
  if (old.u && ts <= old.u) return json({ error: 'this change is older than the saved one' }, 409);

  const p = { g: greeting.trim(), u: ts };
  if (target > 0){
    const same = old.goal && old.goal.t === goal.trim() && old.goal.c === target && !b.restart;
    if (same) p.goal = old.goal;
    else {
      const cfg = netConfig(net, env);
      let start = 0;
      try{ start = Math.max(0, parseInt(await rpc(cfg.rpcs, 'eth_blockNumber', []), 16) - CONFIRM_BLOCKS); }
      catch(e){ return json({ error: 'network is not answering, try again' }, 503); }
      p.goal = { t: goal.trim(), c: target, s: now, b: start, x: start, r: 0 };
    }
  }
  await env.TILL.put(kProf(net, to), JSON.stringify(p));
  return json({ ok: true, profile: { greeting: p.g, goal: p.goal ? { title: p.goal.t, target: centsStr(p.goal.c), raised: centsStr(p.goal.r), since: p.goal.s } : null } });
}

/* Досчитать цель по журналу контракта от последнего посчитанного блока.
   Запись — только если нашлись новые оплаты или отставание стало большим:
   бесплатный KV — тысяча записей в сутки на всё сразу. */
async function refreshGoal(env, cfg, net, to, p){
  const g = p.goal;
  const latest = parseInt(await rpc(cfg.rpcs, 'eth_blockNumber', []), 16);
  const safe = latest - CONFIRM_BLOCKS;
  const origX = g.x;
  let from = g.x + 1, added = 0, steps = 0;
  const stable = {};
  for (const k of ['USDT', 'USDC']) if (cfg.tokens[k]) stable[cfg.tokens[k].a.toLowerCase()] = cfg.tokens[k].d;
  while (from <= safe && steps < GOAL_MAX_STEPS){
    const to2 = Math.min(safe, from + GOAL_STEP - 1);
    const logs = await rpc(cfg.rpcs, 'eth_getLogs', [{ address: cfg.pays[0], fromBlock: hexN(from), toBlock: hexN(to2),
      topics: [PAID_TOPIC, padA(to)] }]);
    for (const l of (logs || [])){
      const tok = ('0x' + String(l.topics[3]).slice(-40)).toLowerCase();
      if (!(tok in stable)) continue;
      const d = String(l.data || '').replace(/^0x/, '');
      const units = BigInt('0x' + d.slice(0, 64)) + BigInt('0x' + d.slice(64, 128));
      added += Number(units / (10n ** BigInt(Math.max(0, stable[tok] - 2))));
    }
    g.x = to2; from = to2 + 1; steps++;
  }
  if (added > 0) g.r += added;
  if (added > 0 || g.x - origX >= 50000){
    const cur = await readProfile(env, net, to);
    /* Пока считали, автор мог поменять цель — тогда наш пересчёт уже ни к чему. */
    if (cur && cur.goal && cur.goal.s === g.s && cur.goal.b === g.b && (cur.goal.x || 0) < g.x){
      cur.goal.x = g.x; cur.goal.r = g.r;
      await env.TILL.put(kProf(net, to), JSON.stringify(cur));
    }
  }
}

async function onPost({ request, env }){
  if (!env || !env.TILL) return json({ error: 'storage is not configured' }, 503);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return json({ error: 'too large' }, 413);
  let text = '';
  try{ text = await request.text(); } catch(e){ return json({ error: 'bad body' }, 400); }
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
  let b; try{ b = JSON.parse(text); } catch(e){ return json({ error: 'bad json' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'bad json' }, 400);

  const net = b.net === 'bnbTestnet' ? 'bnbTestnet' : 'bnb';
  if (b.action === 'profile'){
    if (await overLimit(request, env, 'donprof', 10, 600)) return tooMany();
    return saveProfile(env, net, b);
  }
  if (await overLimit(request, env, 'donpost', 20, 600)) return tooMany();
  const to = String(b.to || ''), h = String(b.h || '');
  const nick = b.nick === undefined ? '' : b.nick, msg = b.msg === undefined ? '' : b.msg;
  if (!okAddr(to)) return json({ error: 'bad address' }, 400);
  if (!okHash(h))  return json({ error: 'bad invoice id' }, 400);
  if (!okText(nick, MAX_NICK)) return json({ error: 'bad nick' }, 400);
  if (!okText(msg, MAX_MSG))   return json({ error: 'bad message' }, 400);

  /* Один счёт — одно сообщение. Иначе к чужой оплате можно было бы
     дописать своё. */
  if (await env.TILL.get(hKey(h))) return json({ error: 'message for this invoice already exists' }, 409);

  /* И сообщение — только ДО оплаты. Номер счёта оплаченного доната виден
     всем в сети; разреши мы писать после — любой прочитал бы номер чужого
     доната без сообщения и приписал бы к нему свой текст от чужого имени.
     Наша страница всегда отправляет текст до того, как человек платит. */
  let already = null;
  try{ already = await paidSale(netConfig(net, env), h, to); }
  catch(e){ return json({ error: 'network is not answering, try again' }, 503); }
  if (already) return json({ error: 'this invoice is already paid, a message can only come before payment' }, 409);

  await env.TILL.put(hKey(h), '1', { expirationTtl: DONE_TTL });
  const entry = { h, n: nick.trim(), m: msg.trim(), ts: Math.floor(Date.now() / 1000) };
  await env.TILL.put(pKey(net, to, h), JSON.stringify(entry), { expirationTtl: PENDING_TTL, metadata: entry });
  return json({ ok: true });
}

async function onGet({ request, env }){
  if (!env || !env.TILL) return json({ error: 'storage is not configured' }, 503);
  const url = new URL(request.url);
  const net = url.searchParams.get('net') === 'bnbTestnet' ? 'bnbTestnet' : 'bnb';
  const to = url.searchParams.get('to') || '';
  if (!okAddr(to)) return json({ error: 'bad address' }, 400);
  const cfg = netConfig(net, env);

  /* Один донат по номеру счёта — так спрашивает экран стрима (alert.html):
     он сам видит оплату в сети и за текстом приходит сюда. Без перебора
     списков: одно-два чтения. */
  const one = url.searchParams.get('h');
  if (one !== null){
    if (!okHash(one)) return json({ error: 'bad invoice id' }, 400);
    const v = await env.TILL.get(hKey(one));
    if (!v) return json({ item: null });
    if (v !== '1'){
      let m = null; try{ m = JSON.parse(v); } catch(e){}
      if (!m || m.to !== to.toLowerCase() || m.net !== net) return json({ item: null });
      return json({ item: view(m) });
    }
    const raw = await env.TILL.get(pKey(net, to, one));
    let e = null; try{ e = raw ? JSON.parse(raw) : null; } catch(x){}
    if (!e || !okHash(e.h)) return json({ item: null });
    try{
      const m = await promote(env, cfg, net, to, e);
      return json(m ? { item: view(m) } : { item: null, pending: true });
    } catch(x){ return json({ item: null, pending: true }); }
  }

  /* Страница автора: приветствие и цель сбора. Её читают зрители на
     странице доната и экран OBS — часто, поэтому никаких перечислений:
     одно чтение и, если в сети появились новые оплаты, одна запись. */
  if (url.searchParams.get('profile') === '1'){
    const p = await readProfile(env, net, to);
    let goal = null;
    if (p && p.goal){
      try{ await refreshGoal(env, cfg, net, to, p); } catch(e){ /* сеть молчит — отдадим сохранённое */ }
      goal = { title: p.goal.t, target: centsStr(p.goal.c), raised: centsStr(p.goal.r), since: p.goal.s };
    }
    return json({ profile: { greeting: (p && p.g) || '', goal } });
  }

  /* Итоги для автора: суммы по часам за 30 дней. Спрашивает только
     приложение автора, поэтому здесь можно и перечислить записи. */
  if (url.searchParams.get('stats') === '1'){
    const since = Date.now() - 30 * 86400 * 1000;
    const hours = {}, seenS = new Set();
    let count = 0;
    for (const m of await readIndex(env, net, to)){
      if (!m || m.ts < since) continue;
      const hh = String(m.h).toLowerCase();
      if (seenS.has(hh)) continue;
      seenS.add(hh);
      const c = toCents(m);
      if (c === null) continue;
      const hr = Math.floor(m.ts / 3600000);
      hours[hr] = (hours[hr] || 0) + c;
      count++;
    }
    return json({ stats: { hours, count } });
  }

  /* Ожидания здесь больше не перебираем: их подтверждают таймер API (раз в
     минуту по журналу контракта), страница оплаты сразу после «Оплачено» и
     экран стрима. */
  const lim = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const items = [], seenH = new Set();
  for (const m of await readIndex(env, net, to)){
    if (items.length >= lim) break;
    if (!m) continue;
    /* Один донат могли подтвердить два запроса разом (экран стрима и
       страница оплаты) — в списке он всё равно один. */
    if (seenH.has(String(m.h).toLowerCase())) continue;
    seenH.add(String(m.h).toLowerCase());
    items.push(view(m));
  }
  return json({ items });
}

const APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];
function cors(request, res){
  const o = request.headers.get('origin');
  if (o && APP_ORIGINS.includes(o)){
    res.headers.set('access-control-allow-origin', o);
    res.headers.set('vary', 'origin');
  }
  return res;
}

export const onRequestGet  = async ctx => cors(ctx.request, await onGet(ctx));
export const onRequestPost = async ctx => cors(ctx.request, await onPost(ctx));
export const onRequestOptions = ctx => cors(ctx.request, new Response(null, { status: 204, headers: {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '600'
} }));

/* Один раз после выкладки: перенести донаты, записанные до списка одним
   значением (по ключу на донат), в списки авторов. Зовёт таймер API; после
   успеха ставит отметку и больше не перебирает ничего. */
export async function migrateDonIndex(env){
  if (!env || !env.TILL) return null;
  if (await env.TILL.get('donidx:migrated')) return null;
  const groups = {};
  let cursor, pages = 0;
  do{
    const res = await env.TILL.list({ prefix: 'don:', limit: 1000, cursor });
    for (const k of (res.keys || [])){
      const m = k.metadata; if (!m || !m.h) continue;
      const p = k.name.split(':');                     // don:net:to:rts:h
      if (p.length < 5 || !NETS[p[1]] || !okAddr(p[2])) continue;
      (groups[p[1] + ':' + p[2]] = groups[p[1] + ':' + p[2]] || []).push(m);
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor && ++pages < 20);
  let n = 0;
  for (const g of Object.keys(groups)){
    const [net, to] = g.split(':');
    const have = await readIndex(env, net, to);
    const seen = new Set(have.map(m => String(m.h).toLowerCase()));
    const all = have.concat(groups[g].filter(m => !seen.has(String(m.h).toLowerCase())));
    all.sort((a, b) => b.ts - a.ts);
    await env.TILL.put(iKey(net, to), JSON.stringify(all.slice(0, INDEX_MAX)), { expirationTtl: DONE_TTL });
    n++;
  }
  await env.TILL.put('donidx:migrated', String(Date.now()));
  return { authors: n };
}
