/* Партнёр продавца в Solana (8.10.2026) — подробности в _solref.js.
     GET  /api/solref?m=<продавец в Solana>[&mint=<монета>]
          → { referrer, partner, until, active, partnerAta }   (partnerAta — только если счёт монеты партнёра заведён)
     POST /api/solref  { m, r, ts, sig } → { ok, until } */
import { overLimit, tooMany } from './_limit.js';
import { SOL } from './_sol.js';
import { solBinding, bindingActive, partnerForPayment, bindPartner } from './_solref.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
                     'access-control-allow-origin': '*' } });

export async function onRequestGet({ request, env }){
  if (!env || !env.TILL) return json({ error: 'storage is not configured' }, 503);
  if (await overLimit(request, env, 'solref', 120, 60)) return tooMany();
  const q = new URL(request.url).searchParams;
  const m = q.get('m') || '', mint = q.get('mint') || '';
  if (!SOL.isAddress(m)) return json({ error: 'bad merchant' }, 400);
  const b = await solBinding(env, m);
  if (!b) return json({ referrer: null, partner: null, until: null, active: false, partnerAta: null });
  let partnerAta = null;
  if (mint && SOL.isAddress(mint)){
    const p = await partnerForPayment(env, m, mint);
    partnerAta = p ? p.partnerAta : null;
  }
  return json({ referrer: b.r, partner: b.rs, until: b.until, active: bindingActive(b), partnerAta });
}

export async function onRequestPost({ request, env }){
  if (!env || !env.TILL) return json({ error: 'storage is not configured' }, 503);
  if (await overLimit(request, env, 'solrefpost', 10, 600)) return tooMany();
  const text = await request.text().catch(() => '');
  if (text.length > 2048) return json({ error: 'too large' }, 413);
  let b; try{ b = JSON.parse(text); } catch(e){ return json({ error: 'bad json' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'bad json' }, 400);
  const r = await bindPartner(env, b);
  if (r.error) return json({ error: r.error }, r.status || 400);
  return json(r);
}

export const onRequestOptions = () => new Response(null, { status: 204, headers: {
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' } });
