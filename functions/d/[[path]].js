/* Короткий адрес страницы донатов: wallet.tavarov.com/d/имя.

   Страница одна (donate.html) — имя блогера она читает из адреса сама.
   Здесь только отдаём её под этим адресом. Переадресация правилом в
   _redirects на этом хостинге однажды уже закончилась петлёй (см. там),
   поэтому — функцией, без переадресации: адрес в строке браузера остаётся
   тем, что блогер написал у себя в описании. */
export async function onRequest({ request, env }){
  const u = new URL(request.url);
  const page = await env.ASSETS.fetch(new Request(new URL('/donate', u.origin), { headers: request.headers }));
  const res = new Response(page.body, page);
  res.headers.set('cache-control', 'no-cache');
  return res;
}
