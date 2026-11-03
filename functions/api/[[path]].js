/* Unknown address under /api/, or a method an endpoint does not have.

   Without this file such a request fell through to the static site, and the
   answer was the wallet's index.html with status 200. A shop developer who
   mistyped an endpoint got a web page instead of an error, and a missing
   file looked like a working one: exactly how tavarov.com/tavarov.apk
   served the home page for two days in November 2026.

   Existing endpoints are more specific routes and keep answering as before;
   this one only catches what nothing else handles. */
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*'
};

export function onRequest({ request }){
  const path = new URL(request.url).pathname;
  return new Response(JSON.stringify({ error: 'not found', path, method: request.method }), { status: 404, headers: HEADERS });
}
