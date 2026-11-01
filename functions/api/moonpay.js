/* Пополнение картой через MoonPay (21.10.2026).

   ЗАЧЕМ. Человек открывает кошелёк, а монет на нём нет. Купить USDT картой
   прямо на свой адрес — самый короткий путь к первой оплате.

   ПОЧЕМУ ЧЕРЕЗ СЕРВЕР. MoonPay сам подставляет адрес кошелька, только если
   ссылка подписана секретным ключом партнёра. Секрет в приложении держать
   нельзя: его вытащит любой. Поэтому приложение присылает сюда валюту и
   адрес, а мы возвращаем готовую подписанную ссылку.

   Мы НЕ видим ни карты, ни суммы, ни личных данных: оплата и проверка
   личности идут на стороне MoonPay. Ничего не храним.

   Ключи задаёт ЗАДАТЬ-КЛЮЧИ-MOONPAY.bat (секреты проекта Cloudflare Pages):
     MOONPAY_PK — публичный ключ (pk_live_…), MOONPAY_SK — секретный (sk_live_…).
     MOONPAY_SANDBOX=1 — песочница (ключи pk_test_/sk_test_).
   Пока ключей нет, отвечаем 503, и кошелёк открывает обычный сайт MoonPay,
   скопировав адрес, — без подстановки.

     GET /api/moonpay?c=usdt_bsc&a=0x…&l=ru&t=dark → { url } */

import { overLimit, tooMany } from './_limit.js';

/* Только то, что кошелёк умеет принять: монета и сеть, как в справочнике
   MoonPay (api.moonpay.com/v3/currencies). Чужую валюту не подписываем —
   иначе нашим ключом можно было бы подписать что угодно. */
export const CURRENCIES = {
  usdt_bsc: 'evm', bnb_bsc: 'evm',
  usdt: 'evm', usdc: 'evm', eth: 'evm',
  usdc_base: 'evm', eth_base: 'evm',
  usdt_sol: 'sol', usdc_sol: 'sol', sol: 'sol',
};
const LANGS = ['en', 'es', 'pt', 'tr', 'ru', 'fr', 'de', 'it', 'pl'];
const okAddr = (kind, a) => kind === 'evm' ? /^0x[0-9a-fA-F]{40}$/.test(a) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
                     'access-control-allow-origin': '*' } });

async function hmacBase64(secret, text){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

/* Ссылка без подписи: те же параметры, что уйдут в MoonPay. Отдельно — чтобы
   проверка могла сверить подпись с тем, что подписано. */
export function buildUrl(env, c, a, l, t){
  const p = new URLSearchParams();
  p.set('apiKey', env.MOONPAY_PK);
  p.set('currencyCode', c);
  p.set('walletAddress', a);
  if (LANGS.includes(l)) p.set('language', l);
  p.set('theme', t === 'light' ? 'light' : 'dark');
  p.set('colorCode', '#6A35F2');
  p.set('redirectURL', 'https://wallet.tavarov.com/');
  const host = env.MOONPAY_SANDBOX ? 'https://buy-sandbox.moonpay.com' : 'https://buy.moonpay.com';
  return host + '/?' + p.toString();
}

export async function onRequestGet({ request, env }){
  if (!env || !env.MOONPAY_PK || !env.MOONPAY_SK) return json({ error: 'card top-up is not configured' }, 503);
  if (await overLimit(request, env, 'moonpay', 30, 600)) return tooMany();
  const q = new URL(request.url).searchParams;
  const c = String(q.get('c') || '');
  const a = String(q.get('a') || '').trim();
  const kind = Object.prototype.hasOwnProperty.call(CURRENCIES, c) ? CURRENCIES[c] : null;
  if (!kind) return json({ error: 'unsupported currency' }, 400);
  if (!okAddr(kind, a)) return json({ error: 'bad wallet address for this network' }, 400);
  const url = buildUrl(env, c, a, String(q.get('l') || 'en'), String(q.get('t') || 'dark'));
  const signature = await hmacBase64(env.MOONPAY_SK, new URL(url).search);
  return json({ url: url + '&signature=' + encodeURIComponent(signature) });
}

export const onRequestOptions = () => new Response(null, { status: 204, headers: {
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' } });
