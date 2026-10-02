/* Solana Pay: «запрос операции» (transaction request).

   Кошелёк Solana (Phantom, Solflare и другие), отсканировав код кассы
   solana:https://wallet.tavarov.com/api/solpay?..., спрашивает здесь:
     GET  — как подписать экран оплаты (название и значок);
     POST — с адресом покупателя; в ответ — готовая операция без подписи.
   Покупатель видит её в своём кошельке и подписывает сам. Ключей здесь нет
   и быть не может: сервер только собирает операцию.

   Что в операции — см. SOL.buildPayment: продавцу сумма минус 1%, кошельку
   развития 1%, с меткой счёта. Кошелёк развития берётся отсюда, а не из
   ссылки: подменить его, поправив ссылку, нельзя. */
import { SOL, SOLNETS, solRpc, isSolWallet } from './_sol.js';
import { overLimit } from './_limit.js';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
               'access-control-allow-headers': 'content-type, accept, accept-encoding' };
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200,
  headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS) });
/* Видимый текст — без управляющих и «переворачивающих» знаков. */
const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').slice(0, n);

function readQuery(url){
  const q = url.searchParams;
  const net = 'solana';
  const cfg = SOLNETS[net];
  const m = q.get('m') || '', r = q.get('r') || '', a = q.get('a') || '', c = (q.get('c') || 'USDC').toUpperCase();
  if (!isSolWallet(m)) return { error: 'bad merchant' };
  if (!SOL.isAddress(r)) return { error: 'bad reference' };
  const tk = Object.prototype.hasOwnProperty.call(cfg.tokens, c) ? cfg.tokens[c] : null;
  if (!tk) return { error: 'currency must be one of ' + Object.keys(cfg.tokens).join(', ') };
  const units = SOL.toUnits(a, tk.d);
  if (units === null || units <= 0n) return { error: 'bad amount' };
  return { net, cfg, m, r, a, c, tk, units, name: clean(q.get('n'), 48), item: clean(q.get('i'), 64) };
}

export function onRequestOptions(){ return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestGet({ request }){
  return json({ label: 'Tavarov Pay', icon: new URL(request.url).origin + '/icon-192.png' });
}

export async function onRequestPost({ request, env }){
  if (await overLimit(request, env, 'solpay', 30, 60)) return json({ error: 'too many requests' }, 429);
  const url = new URL(request.url);
  const q = readQuery(url);
  if (q.error) return json({ error: q.error }, 400);
  let body = null;
  try{ body = await request.json(); } catch(e){}
  const account = body && body.account;
  if (!SOL.isAddress(account)) return json({ error: 'account must be a Solana address' }, 400);
  if (account === q.m) return json({ error: 'cannot pay yourself' }, 400);
  try{
    const bh = await solRpc(q.net, 'getLatestBlockhash', [{ commitment: 'confirmed' }], env);
    const built = await SOL.buildPayment({ payer: account, merchant: q.m, treasury: q.cfg.treasury, mint: q.tk.mint,
      decimals: q.tk.d, units: q.units, feeBps: q.cfg.feeBps, reference: q.r, blockhash: bh.value.blockhash });
    const tx = SOL.serialize(built.message, [new Uint8Array(64)]);
    let b = ''; for (const x of tx) b += String.fromCharCode(x);
    const label = (q.name || 'Tavarov Pay') + ' — ' + q.a + ' ' + q.c + (q.item ? ' · ' + q.item : '');
    return json({ transaction: btoa(b), message: label.slice(0, 120) });
  } catch(e){
    return json({ error: 'could not build the payment: ' + String(e && e.message || e).slice(0, 120) }, 502);
  }
}
