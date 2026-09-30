/* Грубый ограничитель частоты по адресу клиента.

   ЗАЧЕМ. Бесплатный KV — около тысячи записей в сутки НА ВСЁ. Без
   ограничителя любой может за пару минут сжечь эту тысячу пустыми
   запросами, и до полуночи по UTC у всех перестанут работать касса,
   донаты, вход в кабинет и вебхуки.

   КАК. Счётчик лежит в кэше дата-центра Cloudflare (caches.default): он
   бесплатный и не тратит KV. Счётчик не атомарный и у каждого дата-центра
   свой — это первая линия, а не броня. Вторая линия — правило ограничения
   частоты в панели Cloudflare (Security → WAF → Rate limiting rules).

   Где кэша нет (проверки на машине, в Node) — ограничителя тоже нет. */

export function clientIp(request){
  const h = request.headers;
  return h.get('cf-connecting-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

/* true — лимит исчерпан, запрос надо отклонить. */
export async function overLimit(request, env, bucket, max, winSec){
  if (env && env.V1_NO_THROTTLE) return false;
  if (typeof caches === 'undefined' || !caches.default) return false;
  try{
    const origin = new URL(request.url).origin;
    const slot = Math.floor(Date.now() / 1000 / winSec);
    const key = new Request(origin + '/__limit/' + bucket + '/' + encodeURIComponent(clientIp(request)) + '/' + slot);
    const hit = await caches.default.match(key);
    const n = hit ? (parseInt(await hit.text(), 10) || 0) : 0;
    if (n >= max) return true;
    await caches.default.put(key, new Response(String(n + 1), { headers: { 'cache-control': 'max-age=' + winSec } }));
  } catch(e){ /* кэш недоступен — не мешаем честным */ }
  return false;
}

export const tooMany = () => new Response(JSON.stringify({ error: 'too many requests, try again in a few minutes' }), {
  status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '120' }
});
