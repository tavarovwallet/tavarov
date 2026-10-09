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
  const ip = h.get('cf-connecting-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  return ipBucket(ip);
}

/* IPv6: у одного абонента обычно целая сеть /64 — миллиарды адресов. Считать
   по полному адресу значит не считать вовсе: каждый запрос с нового адреса.
   Поэтому для IPv6 счётчик ведём по первым четырём группам (аудит 7.10.2026). */
export function ipBucket(ip){
  if (!ip.includes(':')) return ip;
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (s.includes('.')) return s;                  // ::ffff:1.2.3.4 и подобные — как есть
  const [head, tail] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const full = tail !== undefined ? a.concat(Array(Math.max(0, 8 - a.length - b.length)).fill('0'), b) : a;
  return full.slice(0, 4).map(x => (x || '0').replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/* true — лимит исчерпан, запрос надо отклонить. id — свой ключ счётчика
   (например, кошелёк продавца) вместо адреса клиента. */
export async function overLimit(request, env, bucket, max, winSec, id){
  if (env && env.V1_NO_THROTTLE) return false;
  if (typeof caches === 'undefined' || !caches.default) return false;
  try{
    const origin = new URL(request.url).origin;
    const slot = Math.floor(Date.now() / 1000 / winSec);
    const key = new Request(origin + '/__limit/' + bucket + '/' + encodeURIComponent(id || clientIp(request)) + '/' + slot);
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
