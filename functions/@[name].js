/* Личная ссылка для оплаты: wallet.tavarov.com/@имя.

   Страница одна (u.html) — имя она читает из адреса сама. Здесь только
   отдаём её под этим адресом, без переадресации: в строке браузера
   остаётся та ссылка, которую человек прислал. Так же устроен короткий
   адрес донатов (functions/d/[[path]].js); правило в _redirects на этом
   хостинге однажды уже закончилось петлёй (см. там).

   Как это попадает сюда. Из имени файла сборка Pages делает маршрут
   «/@:name» и правило «/@*» для _routes.json — функция вызывается только на
   адресах, которые начинаются с «/@», остальной сайт её не задевает.
   Если однажды маршрут перестанет срабатывать, /@имя упадёт в кошелёк
   (index.html), и тот сам переведёт на /u?to=имя — ссылка не сломается. */
export async function onRequest({ request, env }){
  const u = new URL(request.url);
  const page = await env.ASSETS.fetch(new Request(new URL('/u', u.origin), { headers: request.headers }));
  const res = new Response(page.body, page);
  res.headers.set('cache-control', 'no-cache');
  return res;
}
