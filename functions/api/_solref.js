/* Партнёрская программа в Solana (8 октября 2026).

   В BNB Chain, Ethereum и Base правило живёт в контракте оплаты: продавец
   один раз, до первой продажи, называет пригласившего, и год пятая часть
   нашей комиссии с его продаж уходит этому человеку той же операцией.

   В Solana своей программы у нас нет, и правило держим так:
     — связку «продавец → партнёр» подписывает ключ Solana самого продавца
       и кладёт сюда (KV); задним числом — только до первой продажи через
       кассу (проверяем по сети: не было ли у его счетов USDT/USDC
       поступлений, где есть и кошелёк развития);
     — операцию оплаты собираем мы (страница оплаты, /api/solpay) или наш
       кошелёк — и обе кладут долю партнёра прямо ему, как контракт;
     — проверка оплаты засчитывает долю партнёра как часть комиссии.
   Партнёр — тот же человек, что в других сетях: его EVM-адрес из ссылки
   приглашения. Платим на его адрес в Solana — тот, что его кошелёк
   привязал сам (см. solname.js).

   Ключи KV:
     solref:<адрес продавца в Solana>  → { r: EVM партнёра, rs: Solana партнёра, until, ts }
     solref:by:<EVM партнёра>          → [{ m, until, ts }] — для кабинета партнёра */

import { SOL, SOLNETS, solRpc, solRpcBatch } from './_sol.js';

export const SOL_REF_BPS = 2000;
export const SOL_REF_PERIOD = 365 * 86400;
const kRef = m => 'solref:' + m;
const kBy = r => 'solref:by:' + String(r).toLowerCase();
const kName = evm => 'solname:' + String(evm).toLowerCase();

async function kvJson(env, key){
  try{ return JSON.parse(await env.TILL.get(key) || 'null'); } catch(e){ return null; }
}

/* Действующая связка продавца или null. */
export async function solBinding(env, merchant){
  if (!env || !env.TILL || !SOL.isAddress(merchant || '')) return null;
  const b = await kvJson(env, kRef(merchant));
  if (!b || !SOL.isAddress(b.rs || '')) return null;
  return b;
}
export function bindingActive(b, now){
  return !!(b && b.until > (now || Math.floor(Date.now() / 1000)));
}
/* Счёт монеты партнёра — для проверки оплаты (есть он или нет, неважно). */
export async function partnerAtaFor(b, mint){
  return SOL.b58enc(await SOL.ata(SOL.b58dec(b.rs, 32), SOL.b58dec(mint, 32)));
}
/* Для сборки операции: партнёр, если связка действует и его счёт монеты
   уже заведён. Нет счёта — вся комиссия уходит кошельку развития: заводить
   счёт партнёру за деньги покупателя мы не станем. */
export async function partnerForPayment(env, merchant, mint){
  const b = await solBinding(env, merchant);
  if (!bindingActive(b)) return null;
  const pAta = await partnerAtaFor(b, mint);
  try{
    const acc = await solRpc('solana', 'getAccountInfo', [pAta, { encoding: 'base64', commitment: 'confirmed' }], env);
    if (!acc || !acc.value) return null;
  } catch(e){ return null; }
  return { partner: b.rs, partnerAta: pAta, partnerEvm: b.r, until: b.until };
}

/* Была ли у продавца продажа через кассу в Solana: поступление USDT/USDC
   на его счёт, где в той же операции есть счёт кошелька развития. */
export async function soldViaKassa(env, merchant){
  const cfg = SOLNETS.solana;
  const owner = SOL.b58dec(merchant, 32), treasury = SOL.b58dec(cfg.treasury, 32);
  for (const k of Object.keys(cfg.tokens)){
    const mint = SOL.b58dec(cfg.tokens[k].mint, 32);
    const mAta = SOL.b58enc(await SOL.ata(owner, mint));
    const tAta = SOL.b58enc(await SOL.ata(treasury, mint));
    const sigs = await solRpc('solana', 'getSignaturesForAddress', [mAta, { limit: 100 }], env);
    if (!sigs || !sigs.length) continue;
    const txs = await solRpcBatch('solana', sigs.filter(s => !s.err).slice(0, 100).map(s =>
      ['getTransaction', [s.signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]]), env);
    for (const tx of txs){
      if (!tx || !tx.transaction || !tx.transaction.message) continue;
      const keys = (tx.transaction.message.accountKeys || []).map(x => typeof x === 'string' ? x : x && x.pubkey);
      if (keys.includes(tAta) && keys.includes(mAta)) return true;
    }
  }
  return false;
}

export function bindText(m, r, ts){
  return 'Tavarov Partners: Solana merchant ' + m + ' names partner ' + String(r).toLowerCase() + ' (' + ts + ')';
}

export async function edVerify(addr, sigB58, text){
  if (typeof sigB58 !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sigB58)) return false;
  let sig; try{ sig = SOL.b58dec(sigB58, 64); } catch(e){ return false; }
  if (sig.length !== 64) return false;
  const raw = SOL.b58dec(addr, 32), data = new TextEncoder().encode(text);
  try{
    const k = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, k, sig, data);
  } catch(e){
    const alg = { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' };
    const k = await crypto.subtle.importKey('raw', raw, alg, false, ['verify']);
    return crypto.subtle.verify(alg, k, sig, data);
  }
}

/* Закрепить партнёра. Возвращает { ok } или { error, status }. */
export async function bindPartner(env, b){
  const m = String(b.m || ''), r = String(b.r || ''), ts = Number(b.ts);
  if (!SOL.isAddress(m)) return { error: 'bad merchant', status: 400 };
  if (!/^0x[0-9a-fA-F]{40}$/.test(r)) return { error: 'bad partner', status: 400 };
  if (!Number.isInteger(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 600)
    return { error: 'stale signature, check the device clock', status: 400 };
  if (!(await edVerify(m, b.sig, bindText(m, r, ts)))) return { error: 'signature does not match', status: 403 };
  if (await env.TILL.get(kRef(m))) return { error: 'referrer already set', status: 409 };
  const link = await kvJson(env, kName(r));
  const rs = link && link.sol;
  if (!SOL.isAddress(rs || '')) return { error: 'partner has no Solana address yet', status: 409 };
  if (rs === m) return { error: 'cannot refer yourself', status: 400 };
  let sold;
  try{ sold = await soldViaKassa(env, m); } catch(e){ return { error: 'network is not answering, try again', status: 502 }; }
  if (sold) return { error: 'already selling', status: 409 };
  const now = Math.floor(Date.now() / 1000);
  const rec = { r: r.toLowerCase(), rs, until: now + SOL_REF_PERIOD, ts: now };
  await env.TILL.put(kRef(m), JSON.stringify(rec));
  try{
    const list = (await kvJson(env, kBy(r))) || [];
    list.push({ m, until: rec.until, ts: now });
    await env.TILL.put(kBy(r), JSON.stringify(list.slice(-500)));
  } catch(e){ /* кабинет партнёра — для удобства, связка уже записана */ }
  return { ok: true, until: rec.until, partner: rs };
}

export async function partnerSolMerchants(env, r){
  const now = Math.floor(Date.now() / 1000);
  return ((await kvJson(env, kBy(r))) || []).map(x => ({ merchant: x.m, network: 'solana', network_name: 'Solana',
    until: x.until, active: x.until > now, earned: {} }));
}
