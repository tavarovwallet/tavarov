/* Партнёрская программа: кто кого привёл и сколько заработал.

   Правило живёт в контракте оплаты (третья версия): продавец один раз, до
   первой продажи, называет пригласившего, и год пятая часть нашей комиссии
   с его продаж уходит этому человеку — той же операцией, что и оплата. Здесь
   ничего не платится и ничего не решается: мы только читаем события
   контракта и собираем их в кабинет партнёра.

     ReferrerSet(merchant, referrer, until)          — продавец закрепил партнёра
     ReferralPaid(referrer, merchant, token, amount) — партнёру пришла доля

   Хранилище (KV, бесплатный план — около тысячи записей в сутки на всё):
     ref:r:<партнёр>  — его продавцы, заработок по монетам, последние номера событий
     ref:cur          — до какого блока журнал уже прочитан
   Писать курсор каждую минуту нельзя (1440 записей в сутки), поэтому он
   пишется, только когда нашлись события или ушёл вперёд на тысячи блоков.
   Недописанный курсор значит, что следующий обход прочтёт часть журнала ещё
   раз, — поэтому каждое событие помечается номером и второй раз не
   считается. */

export const REF_TOPIC_SET  = '0x4d99985acd4248608f910c2a6252c953f3e405cbef9fba8f7a8ab0a6831c7b19';
export const REF_TOPIC_PAID = '0x4793371113f2ab6b43b4eabcad34d3732698facf34ecb90092b804eb125bdec5';
/* С какого блока читать при первом запуске: раньше третьего контракта
   оплаты (он выпущен позже 12 сентября 2026 года), с запасом. */
export const REF_START = 122500000;
const CHUNK = 4999;          // узлы не отдают журнал шире ~5000 блоков за раз
const CHUNKS_PER_RUN = 2;
const CUR_EVERY = 2400;      // курсор без событий пишем раз в столько блоков
const SEEN_MAX = 300;
const MERCHANTS_MAX = 500;

const kRef = w => 'ref:r:' + String(w).toLowerCase();
const K_CUR = 'ref:cur';
const addrOfTopic = t => ('0x' + String(t).slice(-40)).toLowerCase();
const word = (data, n) => '0x' + String(data).replace(/^0x/, '').slice(n * 64, (n + 1) * 64);
const hex = n => '0x' + Math.max(0, n).toString(16);

async function kvGet(env, key){
  const v = await env.TILL.get(key);
  if (!v) return null;
  try{ return JSON.parse(v); } catch(e){ return null; }
}

export async function readPartner(env, w){
  return (await kvGet(env, kRef(w))) || null;
}

/* Разобрать события в записи партнёров. Возвращает, сколько новых событий
   учтено. tokens: адрес монеты -> { sym, d }. */
export async function applyRefLogs(env, logs, tokens){
  const byRef = new Map();
  for (const l of logs || []){
    const t0 = String(l.topics && l.topics[0] || '').toLowerCase();
    if (t0 !== REF_TOPIC_SET && t0 !== REF_TOPIC_PAID) continue;
    const referrer = addrOfTopic(t0 === REF_TOPIC_SET ? l.topics[2] : l.topics[1]);
    const merchant = addrOfTopic(t0 === REF_TOPIC_SET ? l.topics[1] : l.topics[2]);
    if (!byRef.has(referrer)) byRef.set(referrer, []);
    byRef.get(referrer).push({ t0, merchant, l });
  }
  let added = 0;
  for (const [referrer, evs] of byRef){
    const rec = (await readPartner(env, referrer)) || { w: referrer, merchants: [], earned: {}, pays: 0, seen: [] };
    rec.merchants = rec.merchants || []; rec.earned = rec.earned || {}; rec.seen = rec.seen || [];
    let changed = false;
    for (const { t0, merchant, l } of evs){
      const id = String(l.transactionHash || '').toLowerCase() + ':' + parseInt(l.logIndex || '0x0', 16);
      if (rec.seen.includes(id)) continue;
      rec.seen.push(id);
      const block = parseInt(l.blockNumber, 16) || 0;
      if (t0 === REF_TOPIC_SET){
        const until = Number(BigInt(word(l.data, 0)));
        const i = rec.merchants.findIndex(m => m.m === merchant);
        if (i < 0) rec.merchants.push({ m: merchant, b: block, until, earned: {} });
        else { rec.merchants[i].until = until; rec.merchants[i].b = rec.merchants[i].b || block; }
      } else {
        const token = addrOfTopic(l.topics[3]);
        const tk = tokens[token];
        const sym = tk ? tk.sym : token;
        const amt = BigInt(word(l.data, 0));
        rec.earned[sym] = (BigInt(rec.earned[sym] || '0') + amt).toString();
        rec.pays = (rec.pays || 0) + 1;
        let m = rec.merchants.find(x => x.m === merchant);
        if (!m){ m = { m: merchant, b: block, until: 0, earned: {} }; rec.merchants.push(m); }
        m.earned = m.earned || {};
        m.earned[sym] = (BigInt(m.earned[sym] || '0') + amt).toString();
        m.last = block;
      }
      changed = true; added++;
    }
    if (changed){
      rec.seen = rec.seen.slice(-SEEN_MAX);
      rec.merchants = rec.merchants.slice(-MERCHANTS_MAX);
      await env.TILL.put(kRef(referrer), JSON.stringify(rec));
    }
  }
  return added;
}

/* Один шаг чтения журнала — зовёт таймер API раз в минуту. rpc(method,
   params) — вызов узла основной сети; pay — адрес контракта оплаты;
   safe — последний блок, которому уже можно верить. */
export async function scanReferrals(env, rpc, pay, safe, tokens){
  let cur = Number(await env.TILL.get(K_CUR)) || REF_START;
  const written = cur;
  let found = 0, chunks = 0;
  while (cur < safe && chunks < CHUNKS_PER_RUN){
    const to = Math.min(cur + CHUNK, safe);
    const logs = await rpc('eth_getLogs', [{ address: pay, fromBlock: hex(cur + 1), toBlock: hex(to),
      topics: [[REF_TOPIC_SET, REF_TOPIC_PAID]] }]);
    found += await applyRefLogs(env, logs, tokens);
    cur = to; chunks++;
  }
  /* Около получаса блоков (2400 × 0,75 с) — не чаще: так в обычный день
     это ~50 записей, а не 1440. Шаг обхода (10 000) больше этого порога,
     поэтому догоняющий обход курсор всегда двигает. */
  if (cur !== written && (found > 0 || cur - written >= CUR_EVERY))
    await env.TILL.put(K_CUR, String(cur));
  return { cur, found, behind: Math.max(0, safe - cur) };
}

/* Для людей: суммы в монетах, а не в единицах контракта. */
export function partnerView(rec, tokens, cur){
  const dec = sym => { for (const a of Object.keys(tokens)) if (tokens[a].sym === sym) return tokens[a].d; return 18; };
  const fmt = (units, d) => {
    const s = BigInt(units).toString().padStart(d + 1, '0');
    return (s.slice(0, s.length - d) + '.' + s.slice(s.length - d)).replace(/0+$/, '').replace(/\.$/, '') || '0';
  };
  const earned = {};
  const r = rec || { merchants: [], earned: {}, pays: 0 };
  for (const sym of Object.keys(r.earned || {})) earned[sym] = fmt(r.earned[sym], dec(sym));
  const now = Math.floor(Date.now() / 1000);
  return {
    partner: r.w || null,
    merchants: (r.merchants || []).map(m => ({ merchant: m.m, until: m.until || null, active: !!(m.until && m.until > now),
      earned: Object.fromEntries(Object.keys(m.earned || {}).map(s => [s, fmt(m.earned[s], dec(s))])) })),
    earned, payments: r.pays || 0, synced_to_block: cur || null, share_bps: 2000, period_days: 365
  };
}
