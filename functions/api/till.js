/* "What is the till asking for right now?"

   WHAT THIS IS FOR. A sticker on the counter is printed once and never
   changes. It cannot carry an amount — so the amount has to reach the buyer
   some other way, in the seconds between the seller typing it and the buyer
   pointing a camera at the sticker.

   We already had one way to do that, and it still works: the TavarovCharges
   contract writes the amount onto the seller's own address for fifteen
   minutes, and the buyer's wallet reads it from the chain. Nothing is stored
   anywhere, because the chain is not ours. But it costs about a cent and a
   couple of seconds of waiting — every sale, including the ones where the
   buyer changes their mind and walks away.

   So this file adds a second, faster way: a scratchpad. The seller's till
   writes the amount here, the buyer's page reads it, and ten minutes later it
   is gone.

   AND THAT IS A CONCESSION, SO IT IS WRITTEN DOWN. Up to now the honest claim
   was that we store nothing at all: the invoice lives inside the link, and
   whether it was paid is read from the chain. That claim is now narrower, and
   the README and the privacy page say so in the same words as here:

     stored:     the seller's address, the till number, the amount, the
                 currency, the item name if any, and when it was set
     not stored: anything at all about the buyer — no address, no device,
                 no payment. The payment itself is still read from the chain.
     for:        ten minutes, then it deletes itself.

   Losing this scratchpad loses nobody's money and nobody's history. That is
   the property that made it acceptable, and if it ever stops being true, this
   design has to be reconsidered rather than extended.

   WHO MAY WRITE HERE. The seller's address is public — it is printed on the
   sticker. If anyone could set an amount against it, a bored stranger could
   set it to 0.01 and a real customer would honestly pay a hundredth of what
   they owe. So a write must be signed by the seller's own wallet key, and the
   signature is checked here (see _crypto.js). No accounts, no passwords, no
   API keys: the key that owns the money is the key that sets the price. */

import { messageHash, recoverAddress } from './_crypto.js';

const NETS = {
  bnb:        { rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org',
                       'https://bsc-dataseed1.bnbchain.org'],
                charges: '0x82a9D1b0795aC44e8045dB60F30526c4230daFF9',
                tokens: { USDT: { a:'0x55d398326f99059fF775485246999027B3197955', d:18 },
                          USDC: { a:'0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', d:18 },
                          TVR:  { a:'0x8Baa77344Fc122967902651D0C3193cdF4c48503', d:18 } } },
  bnbTestnet: { rpcs: ['https://bsc-testnet-rpc.publicnode.com'],
                charges: '0x76f28505e2122f578C4bFa7067C249034A5785Ae',
                tokens: { USDT: { a:'0xb4ac75E8CF7c768FFd9fAfeAF1bF77B48209524e', d:6  },
                          TVR:  { a:'0x74536e79b374CCFa0123035B28f7a3b7333f323a', d:18 } } }
};

const TTL        = 600;   // ten minutes, and KV deletes it for us
const CLOCK_SLACK = 120;  // how far a till's clock may be off before we refuse
const MAX_TILLS   = 99;

/* currentCharge(address) — what the seller is asking for, on the chain. */
const CURRENT_CHARGE = '0x2056f63c';

const json = (o, code) => new Response(JSON.stringify(o), {
  status: code || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function netConfig(net, env){
  const base = NETS[net];
  const e = env || {};
  return {
    rpcs: e.TAVAROV_RPC ? [e.TAVAROV_RPC] : base.rpcs,
    charges: e.TAVAROV_CHARGES || base.charges,
    tokens: base.tokens
  };
}

function makeRpc(urls){
  return async (method, params) => {
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
  };
}

/* ---------- what a till is allowed to say ----------
   These checks are not politeness. The signed message is built by joining
   these fields with newlines, so a field containing a newline could forge a
   different message that carries the same signature. Refusing them here is
   what keeps that message unambiguous. */
const okAddr  = v => /^0x[0-9a-fA-F]{40}$/.test(v || '');
const okAmount = v => /^\d{1,12}(\.\d{1,18})?$/.test(v || '') && parseFloat(v) > 0;
const okHash  = v => /^0x[0-9a-fA-F]{64}$/.test(v || '');
/* Не только переносы строк. Управляющие символы, «разворот текста» U+202E,
   невидимые символы нулевой ширины и разделители строк U+2028/2029
   проходили раньше как обычный текст: XSS они не дают (всё выводится
   текстом), но «‮olleh» печатается как «hello», а название товара можно
   было подменить на глаз. */
const BAD_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const okText  = v => typeof v === 'string' && v.length <= 64 && !BAD_CHARS.test(v);
const MAX_BODY = 2048;   // подписанная запись кассы — несколько сотен байт
const okTill  = v => Number.isInteger(v) && v >= 1 && v <= MAX_TILLS;

/* The exact text the seller's wallet signs. Every field that could change the
   meaning of the payment is in it, including the network — otherwise a
   signature made on the testnet, where money is free and anyone can have a
   wallet, would be a valid instruction on the real one. */
function signedText(o){
  return [
    'Tavarov till',
    'action: '   + o.action,
    'merchant: ' + o.m.toLowerCase(),
    'till: '     + o.k,
    'network: '  + o.net,
    'currency: ' + (o.c || ''),
    'amount: '   + (o.a || ''),
    'item: '     + (o.i || ''),
    'order: '    + (o.o || ''),
    'invoice: '  + (o.h || ''),
    'time: '     + o.ts
  ].join('\n');
}

const slot = (net, m, k) => 'till:' + net + ':' + m.toLowerCase() + ':' + k;

/* ---------- кто подписал: спрашиваем двух ----------
   Сама проверка подписи выполняется на узле сети (встроенная ecrecover).
   Раньше спрашивали первый ответивший узел и верили ему — а узел чужой, и
   узел, который врёт, мог бы «подтвердить» подпись, которой нет, и чужая
   цена легла бы на кассу. Теперь нужен одинаковый ответ двух разных узлов;
   разошлись — считаем, что подписи нет. Один узел допускается только там,
   где он всего один (тестовая сеть, местные проверки). */
async function recoverByQuorum(urls, hash, sig){
  const answers = [];
  for (const u of urls){
    try{ answers.push(await recoverAddress(makeRpc([u]), hash, sig)); } catch(e){}
    if (answers.length >= 2) break;
  }
  if (!answers.length) throw new Error('no node answered');
  if (urls.length >= 2 && answers.length < 2) throw new Error('only one node answered');
  if (answers.some(a => a !== answers[0])) return null;
  return answers[0];
}

/* ---------- reading ---------- */

/* The fallback: the seller may be using the on-chain charge instead of this
   scratchpad — the older way, which still works and costs gas. Asking a node
   on every poll would be wasteful, so the page only asks for this
   occasionally; see the `chain` parameter. */
async function chainCharge(cfg, merchant){
  const rpc = makeRpc(cfg.rpcs);
  const raw = await rpc('eth_call', [{ to: cfg.charges,
    data: CURRENT_CHARGE + '0'.repeat(24) + merchant.slice(2).toLowerCase() }, 'latest']);
  const d = String(raw || '').replace(/^0x/, '');
  if (d.length < 64 * 5) return null;
  const at = n => d.slice(n * 64, (n + 1) * 64);
  const active = BigInt('0x' + at(4)) !== 0n;
  if (!active) return null;

  const token = '0x' + at(0).slice(24);
  const amountUnits = BigInt('0x' + at(1));
  const expiresAt = Number(BigInt('0x' + at(3)));

  /* The item name is a string, so it sits further down the answer, and its
     length is written just before it. */
  let item = '';
  try{
    const off = Number(BigInt('0x' + at(2))) / 32;
    const len = Number(BigInt('0x' + at(off)));
    if (len > 0 && len <= 256){
      const bytes = d.slice((off + 1) * 64, (off + 1) * 64 + len * 2);
      const arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) arr[i] = parseInt(bytes.slice(i*2, i*2+2), 16);
      item = new TextDecoder().decode(arr);
    }
  } catch(e){ item = ''; }

  /* Units back into something a person reads. Done as text, never as a
     floating-point number: this is money. */
  let sym = '', dec = 18;
  for (const k of Object.keys(cfg.tokens)){
    if (cfg.tokens[k].a.toLowerCase() === token.toLowerCase()){ sym = k; dec = cfg.tokens[k].d; }
  }
  if (!sym) return null;
  const s = amountUnits.toString().padStart(dec + 1, '0');
  const amount = (s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec))
                   .replace(/\.?0+$/, '') || '0';
  if (!(parseFloat(amount) > 0)) return null;

  return { amount, cur: sym, item, order: '', h: null,
           setAt: null, expiresAt, source: 'chain' };
}

async function onGet({ request, env }){
  const url = new URL(request.url);
  const m = url.searchParams.get('m') || '';
  const k = parseInt(url.searchParams.get('k') || '1', 10);
  const net = url.searchParams.get('net') === 'bnbTestnet' ? 'bnbTestnet' : 'bnb';

  if (!okAddr(m))  return json({ error: 'bad merchant address' }, 400);
  if (!okTill(k))  return json({ error: 'bad till number' }, 400);

  const cfg = netConfig(net, env);
  const now = Math.floor(Date.now() / 1000);

  if (env && env.TILL){
    let raw = null;
    try{ raw = await env.TILL.get(slot(net, m, k)); } catch(e){ raw = null; }
    if (raw){
      let v = null;
      try{ v = JSON.parse(raw); } catch(e){ v = null; }
      /* KV clears expired keys on its own, but not always to the second. We
         do not serve a stale amount just because the cleaner was slow. */
      if (v && !v.cleared && v.expiresAt > now) return json(Object.assign({}, v, { source: 'till', now }));
    }
  }

  /* Nothing on the scratchpad. Before telling the till it is empty, ask the
     chain — the seller may be on the older, on-chain way of doing this. The
     page only asks for this every so often, because it costs a node call. */
  if (url.searchParams.get('chain') === '1'){
    try{
      const ch = await chainCharge(cfg, m);
      if (ch && ch.expiresAt > now) return json(Object.assign({}, ch, { now }));
    } catch(e){ /* a silent node is not an answer; fall through to "empty" */ }
  }

  return json({ empty: true, now });
}

/* ---------- writing ---------- */

async function onPost({ request, env }){
  /* Тело — не больше двух килобайт, и проверяем это ДО разбора. Иначе
     мегабайтное поле в «clear» уходило в хеширование целиком и жгло секунду
     процессора на каждый запрос — бесплатный способ положить кассы всех. */
  let body = null;
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > MAX_BODY) return json({ error: 'request too large' }, 413);
  let text = '';
  try{ text = await request.text(); } catch(e){ return json({ error: 'bad request body' }, 400); }
  if (text.length > MAX_BODY) return json({ error: 'request too large' }, 413);
  try{ body = JSON.parse(text); } catch(e){ return json({ error: 'bad request body' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'bad request body' }, 400);

  const action = body.action === 'clear' ? 'clear' : 'set';
  const net = body.net === 'bnbTestnet' ? 'bnbTestnet' : 'bnb';
  const m = String(body.m || '');
  const k = parseInt(body.k, 10);
  const ts = parseInt(body.ts, 10);

  if (!okAddr(m)) return json({ error: 'bad merchant address' }, 400);
  if (!okTill(k)) return json({ error: 'bad till number' }, 400);
  if (!Number.isFinite(ts)) return json({ error: 'bad timestamp' }, 400);

  const cfg = netConfig(net, env);
  const now = Math.floor(Date.now() / 1000);

  /* A signature is good for two minutes. Without this, one captured signed
     amount could be pushed back onto the till at any time in the future —
     the customer standing at the counter would be shown a price from a sale
     that happened last week. */
  if (Math.abs(now - ts) > CLOCK_SLACK)
    return json({ error: 'the till clock is off by more than two minutes', clock: now }, 400);

  const fields = { action, m, k, net, ts,
                   c: body.c || '', a: body.a || '', i: body.i || '',
                   o: body.o || '', h: body.h || '' };

  if (action === 'set'){
    if (!okAmount(fields.a))   return json({ error: 'bad amount' }, 400);
    if (!Object.prototype.hasOwnProperty.call(cfg.tokens, fields.c))
      return json({ error: 'unknown currency on this network' }, 400);
    if (!okHash(fields.h))     return json({ error: 'bad invoice id' }, 400);
    if (!okText(fields.i) || !okText(fields.o))
      return json({ error: 'the item or order name is too long or has a forbidden character in it' }, 400);
  } else {
    /* «Снять» не несёт ничего, кроме кассы и времени. Раньше поля здесь не
       проверялись вовсе — и в них можно было прислать что угодно. */
    if (fields.c || fields.a || fields.i || fields.o || fields.h)
      return json({ error: 'clear carries no amount, item or invoice' }, 400);
  }
  if (typeof body.sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.sig))
    return json({ error: 'bad signature format' }, 400);

  if (!env || !env.TILL)
    return json({ error: 'the till scratchpad is not connected on this deployment', noStore: true }, 503);

  /* Who signed it. A node that will not answer means we do not know — and
     not knowing is a refusal, never an acceptance. */
  let signer = null;
  try{
    signer = await recoverByQuorum(cfg.rpcs, messageHash(signedText(fields)), body.sig);
  } catch(e){
    return json({ error: 'could not check the signature right now — try again', unknown: true }, 503);
  }
  if (!signer || signer !== m.toLowerCase())
    return json({ error: 'this amount was not signed by the till it claims to come from' }, 403);

  const key = slot(net, m, k);

  /* An old signed amount must not overwrite a newer one, even inside the two
     minutes above: that is how a cleared till gets quietly refilled. */
  try{
    const prev = await env.TILL.get(key);
    if (prev){
      const p = JSON.parse(prev);
      if (p && Number(p.ts) >= ts)
        return json({ error: 'a newer amount is already on this till' }, 409);
    }
  } catch(e){ /* unreadable previous value is not a reason to refuse a new one */ }

  /* Снятие оставляет метку «очищено в такой-то момент», а не пустое место.
     С пустым местом старую подписанную сумму можно было вернуть на кассу
     повтором: сравнивать её было не с чем. Метка живёт столько же, сколько
     жила бы сумма, — дольше повтор и так не проходит по часам. */
  if (action === 'clear'){
    try{ await env.TILL.put(key, JSON.stringify({ cleared: true, ts, expiresAt: now + TTL }),
                            { expirationTtl: TTL }); } catch(e){}
    return json({ ok: true, cleared: true });
  }

  const value = { amount: fields.a, cur: fields.c, item: fields.i, order: fields.o,
                  h: fields.h, setAt: ts, expiresAt: now + TTL, ts };
  try{
    await env.TILL.put(key, JSON.stringify(value), { expirationTtl: TTL });
  } catch(e){
    return json({ error: 'could not write to the scratchpad: ' + String(e && e.message || e) }, 502);
  }
  return json({ ok: true, expiresAt: value.expiresAt, now });
}

/* The app from the store runs at https://localhost (Android) or
   capacitor://localhost (iOS), not at wallet.tavarov.com. For it this is a
   cross-origin call, and without an explicit permission the browser inside
   the app simply refused it: the till in the store app never pushed an
   amount and never read one. Only those two origins are allowed — the
   website itself is same-origin and needs nothing. */
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
