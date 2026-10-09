/* Имя → адрес в Solana (8 октября 2026).

   ЗАЧЕМ. Имена живут в контракте имён в BNB Chain и указывают на EVM-адрес
   кошелька. В Ethereum и Base адрес тот же, и имя работает само. В Solana у
   того же кошелька СВОЙ адрес, и вычислить его из EVM-адреса нельзя. Поэтому
   кошелёк один раз сообщает нам связку «EVM-адрес → адрес в Solana», а мы её
   храним и отдаём тем, кто переводит по имени в Solana.

   ДОКАЗАТЕЛЬСТВО. Связку подписывают ОБА ключа одного кошелька:
     — EVM-ключ (обычная подпись сообщения) — «это мой адрес в Solana»;
     — ключ Solana (ed25519) — «и этот адрес действительно мой».
   Без первой подписи кто угодно мог бы перенаправить чужое имя на свой адрес
   в Solana. Без второй — человек мог бы по ошибке привязать чужой адрес.
   Время в сообщении не даёт повторить старую связку после смены адреса.

   ЧТО ХРАНИМ: только эти два адреса и время. Ни имени, ни устройства, ни
   операций. Потеря записи никому не стоит денег: перевод по имени в Solana
   просто скажет «у имени нет адреса в Solana», пока кошелёк не привяжет его
   снова (он делает это сам при следующем открытии).

     GET  /api/solname?evm=0x…   → { sol: "…" } или { sol: null }
     POST /api/solname  { evm, sol, ts, sigEvm, sigSol } → { ok: true } */

import { messageHash, recoverAddress } from './_crypto.js';
import { overLimit, tooMany } from './_limit.js';
import { SOL, isSolWallet } from './_sol.js';

const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.bnbchain.org'];
const CLOCK_SLACK = 600;           // подпись годится 10 минут
const MAX_BODY = 2048;
const key = evm => 'solname:' + evm.toLowerCase();
const okEvm = v => /^0x[0-9a-fA-F]{40}$/.test(v || '');

export function linkText(evm, sol, ts){
  return 'Tavarov Names: Solana address ' + sol + ' belongs to wallet ' + String(evm).toLowerCase() + ' (' + ts + ')';
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
                     'access-control-allow-origin': '*' } });

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
/* Подпись EVM проверяет узел сети (ecrecover), а узел чужой — поэтому, как в
   кассе, нужен одинаковый ответ двух разных узлов. */
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
async function edVerify(addr, sigB58, text){
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

export async function onRequestGet({ request, env }){
  if (!env || !env.TILL) return json({ error: 'storage is not configured' }, 503);
  if (await overLimit(request, env, 'solname', 120, 60)) return tooMany();
  const evm = new URL(request.url).searchParams.get('evm') || '';
  if (!okEvm(evm)) return json({ error: 'bad address' }, 400);
  let v = null;
  try{ v = JSON.parse(await env.TILL.get(key(evm)) || 'null'); } catch(e){ v = null; }
  return json({ sol: v && isSolWallet(v.sol) ? v.sol : null });
}

export async function onRequestPost({ request, env }){
  if (!env || !env.TILL) return json({ error: 'storage is not configured' }, 503);
  if (await overLimit(request, env, 'solnamepost', 10, 600)) return tooMany();
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return json({ error: 'too large' }, 413);
  let text = '';
  try{ text = await request.text(); } catch(e){ return json({ error: 'bad body' }, 400); }
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
  let b; try{ b = JSON.parse(text); } catch(e){ return json({ error: 'bad json' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'bad json' }, 400);

  const evm = String(b.evm || ''), sol = String(b.sol || ''), ts = Number(b.ts);
  if (!okEvm(evm)) return json({ error: 'bad address' }, 400);
  if (!isSolWallet(sol)) return json({ error: 'bad solana address' }, 400);
  if (!Number.isInteger(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > CLOCK_SLACK)
    return json({ error: 'stale signature, check the device clock' }, 400);
  if (typeof b.sigEvm !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(b.sigEvm)) return json({ error: 'bad signature' }, 400);

  const msg = linkText(evm, sol, ts);
  if (!(await edVerify(sol, b.sigSol, msg))) return json({ error: 'solana signature does not match' }, 403);
  let signer = null;
  try{ signer = await recoverByQuorum((env && env.TAVAROV_RPC) ? [env.TAVAROV_RPC] : RPCS, messageHash(msg), b.sigEvm); }
  catch(e){ return json({ error: 'network is not answering, try again' }, 502); }
  if (!signer || signer.toLowerCase() !== evm.toLowerCase()) return json({ error: 'wallet signature does not match' }, 403);

  /* Та же связка уже лежит — не тратим запись (их в сутки около тысячи на всех).
     Более старую подпись поверх новой не кладём. */
  let cur = null;
  try{ cur = JSON.parse(await env.TILL.get(key(evm)) || 'null'); } catch(e){ cur = null; }
  if (cur && cur.sol === sol) return json({ ok: true, same: true });
  if (cur && Number(cur.ts) > ts) return json({ error: 'a newer link exists' }, 409);
  await env.TILL.put(key(evm), JSON.stringify({ sol, ts }));
  return json({ ok: true });
}

export const onRequestOptions = () => new Response(null, { status: 204, headers: {
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' } });
