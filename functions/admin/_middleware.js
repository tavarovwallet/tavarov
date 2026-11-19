import { isOwner } from '../api/admin/stats.js';

export async function onRequest({ request, env, next }) {
  if (!await isOwner(request, env)) {
    return new Response('Access denied', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const asset = await next();
  const response = new Response(asset.body, asset);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
