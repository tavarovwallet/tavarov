/* Запасной узел Solana для кошелька.

   Из браузера 1 октября 2026 отвечал только один публичный узел Solana
   (publicnode): узел самой Solana на запросы со страниц отвечает 403. Если
   publicnode ляжет, кошелёк останется без Solana. Поэтому запасной узел —
   мы сами: сервер спрашивает узел Solana со своей стороны.

   Пропускаем только то, что нужно кошельку, и с ограничением частоты:
   открытый посредник к узлу Solana быстро стал бы чужим бесплатным узлом. */
import { solRpc } from './_sol.js';
import { overLimit } from './_limit.js';

const ALLOWED = new Set(['getVersion', 'getSlot', 'getBalance', 'getLatestBlockhash', 'getAccountInfo',
  'getTokenAccountBalance', 'getTokenAccountsByOwner', 'getSignaturesForAddress', 'getTransaction', 'getMultipleAccounts',
  'getSignatureStatuses', 'sendTransaction', 'simulateTransaction']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
               'access-control-allow-headers': 'content-type' };
const reply = (o, status) => new Response(JSON.stringify(o), { status: status || 200,
  headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS) });

export function onRequestOptions(){ return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestPost({ request, env }){
  if (await overLimit(request, env, 'solrpc', 120, 60)) return reply({ jsonrpc: '2.0', id: null, error: { code: 429, message: 'too many requests' } }, 429);
  /* Аудит 2.10.2026: не бесплатный узел для всех. Тело — не больше 4 КБ
     (операция Solana — до 1232 байт, в base64 около 1,7 КБ), выборки —
     небольшие. Иначе чужой трафик съест лимит узла, которым сервер сам
     проверяет оплаты. */
  const raw = await request.text().catch(() => '');
  if (raw.length > 4096) return reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } }, 413);
  let q = null;
  try{ q = JSON.parse(raw); } catch(e){}
  if (!q || typeof q.method !== 'string' || !ALLOWED.has(q.method) || !Array.isArray(q.params || []))
    return reply({ jsonrpc: '2.0', id: q && q.id || null, error: { code: -32601, message: 'method not allowed' } }, 400);
  const p = q.params || [];
  if (q.method === 'getMultipleAccounts' && !(Array.isArray(p[0]) && p[0].length <= 64))
    return reply({ jsonrpc: '2.0', id: q.id || null, error: { code: -32602, message: 'at most 64 accounts' } }, 400);
  if (q.method === 'getSignaturesForAddress'){
    const o = p[1] && typeof p[1] === 'object' ? p[1] : {};
    if (!(Number(o.limit) >= 1 && Number(o.limit) <= 25))
      return reply({ jsonrpc: '2.0', id: q.id || null, error: { code: -32602, message: 'limit must be 1..25' } }, 400);
  }
  const net = 'solana';
  try{
    const result = await solRpc(net, q.method, q.params || [], env);
    return reply({ jsonrpc: '2.0', id: q.id === undefined ? 1 : q.id, result });
  } catch(e){
    return reply({ jsonrpc: '2.0', id: q.id === undefined ? 1 : q.id, error: { code: -32000, message: String(e && e.message || e).slice(0, 200) } });
  }
}
