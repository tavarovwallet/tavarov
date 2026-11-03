/* Бесплатная регистрация имени: комиссию сети платим мы, через MegaFuel.

   MegaFuel — система оплаты газа за пользователей от BNB Chain (NodeReal).
   Спонсор заводит у них правило «за какие операции платить» и пополняет его
   баланс. Наше правило пропускает только одно: вызов claim(string) в
   контракте имён TavarovNames v3. Всё остальное MegaFuel отклонит сам.

   Этот файл — посредник между кошельком и MegaFuel, а не кошелёк с ключом.
   Своих денег и ключей здесь нет. Посредник нужен ради трёх вещей:
     1. страницы не всегда могут обратиться к MegaFuel напрямую (CORS);
     2. MegaFuel просит представляться (User-Agent), а браузер этот
        заголовок менять не даёт;
     3. ограничение частоты: каждая регистрация стоит нам доли цента, и
        без лимита бот, создающий кошельки пачками, съел бы баланс правила.

   Пропускаем только четыре метода, которые нужны для одной операции.
   Если правило не настроено или баланс кончился, MegaFuel ответит «не
   спонсируется», и кошелёк просто предложит обычный путь со своей
   комиссией. Ничего не ломается. */
import { overLimit } from './_limit.js';

const MEGAFUEL = 'https://bsc-megafuel.nodereal.io/';
const ALLOWED = new Set(['pm_isSponsorable', 'eth_getTransactionCount', 'eth_sendRawTransaction',
  'eth_getGaslessTransactionByHash']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
               'access-control-allow-headers': 'content-type' };
const reply = (o, status) => new Response(JSON.stringify(o), { status: status || 200,
  headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS) });

export function onRequestOptions(){ return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestPost({ request, env }){
  const raw = await request.text().catch(() => '');
  if (raw.length > 4096) return reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } }, 413);
  let q = null;
  try{ q = JSON.parse(raw); } catch(e){}
  if (!q || typeof q.method !== 'string' || !ALLOWED.has(q.method) || !Array.isArray(q.params || []))
    return reply({ jsonrpc: '2.0', id: q && q.id || null, error: { code: -32601, message: 'method not allowed' } }, 400);

  /* Проверочные запросы — щедро, отправка — скупо: одно имя на кошелёк, а
     человеку больше трёх попыток в сутки не нужно. */
  const send = q.method === 'eth_sendRawTransaction';
  if (await overLimit(request, env, send ? 'gasless-send' : 'gasless', send ? 3 : 60, send ? 86400 : 60))
    return reply({ jsonrpc: '2.0', id: q.id || null, error: { code: 429, message: 'too many requests' } }, 429);
  if (send && !(typeof (q.params || [])[0] === 'string' && /^0x[0-9a-fA-F]{2,3000}$/.test(q.params[0])))
    return reply({ jsonrpc: '2.0', id: q.id || null, error: { code: -32602, message: 'bad transaction' } }, 400);

  try{
    const r = await fetch(MEGAFUEL, { method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'NoN-Wallet/1.1 (+https://tavarov.com)' },
      body: JSON.stringify({ jsonrpc: '2.0', id: q.id === undefined ? 1 : q.id, method: q.method, params: q.params || [] }) });
    const text = await r.text();
    return new Response(text, { status: r.ok ? 200 : 502,
      headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS) });
  } catch(e){
    return reply({ jsonrpc: '2.0', id: q.id || null, error: { code: -32000, message: 'MegaFuel unreachable' } }, 502);
  }
}
