/* Покупка картой через Transak (22.10.2026).

   ЗАЧЕМ. Transak — бесплатный для партнёра сервис покупки крипты картой,
   Apple Pay и Google Pay; минимальная комиссия у покупателя €1 (у MoonPay —
   $3,99), и работает он в других странах, чем MoonPay.

   ПОЧЕМУ ЧЕРЕЗ СЕРВЕР. С 2025 года Transak не принимает адрес кошелька в
   ссылке: окно открывается только по одноразовой сессии, которую создаёт
   сервер партнёра своим секретом (Create Widget URL API). Секрет в приложении
   держать нельзя — поэтому кошелёк присылает сюда сеть, монету и адрес, а мы
   возвращаем ссылку с сессией (живёт 5 минут, открывается один раз).

   ТРЕБОВАНИЯ TRANSAK (docs.transak.com/guides/mandatory-security-changes):
     — звать их API только с сервера, IP сервера — в их белом списке. У
       Cloudflare постоянного IP нет, поэтому адреса API можно заменить своим
       посредником с постоянным IP: TRANSAK_API_BASE и TRANSAK_GATEWAY_BASE;
     — наш адрес /api/transak отвечает только нашим страницам (CORS);
     — в каждом вызове — IP покупателя (x-user-ip) и ключ партнёра (x-api-key).

   Ключи задаёт ЗАДАТЬ-КЛЮЧИ-TRANSAK.bat (секреты Cloudflare Pages):
     TRANSAK_API_KEY, TRANSAK_API_SECRET; TRANSAK_STAGING=1 — песочница.
   Нет ключей — 503, кошелёк пойдёт следующим путём.

     GET /api/transak?net=bnb&c=usdt&a=0x…&t=dark[&app=1] → { url } */

import { overLimit, tooMany } from './_limit.js';

/* Что кошелёк умеет принять: наша сеть → сеть Transak и монеты. */
export const NETS = {
  bnb:    { tk: 'bsc',      coins: ['usdt', 'usdc', 'bnb'] },
  eth:    { tk: 'ethereum', coins: ['usdt', 'usdc', 'eth'] },
  base:   { tk: 'base',     coins: ['usdc', 'eth'] },
  solana: { tk: 'solana',   coins: ['usdt', 'usdc', 'sol'] },
};
const ORIGINS = ['https://wallet.tavarov.com', 'https://tavarov.com', 'https://localhost', 'capacitor://localhost', 'http://localhost'];
const APP_ID = 'com.tavarov.wallet';
const okAddr = (net, a) => net === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) : /^0x[0-9a-fA-F]{40}$/.test(a);

/* Ответ — только своим страницам. Без Origin (прямой заход, проверка из
   браузера) отвечаем без разрешающего заголовка: чужая страница прочитать не сможет. */
function corsFor(request){
  const o = request.headers.get('origin') || '';
  return ORIGINS.includes(o) ? { 'access-control-allow-origin': o, vary: 'Origin' } : { vary: 'Origin' };
}
const json = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, corsFor(request)) });

function bases(env){
  const stg = !!env.TRANSAK_STAGING;
  return {
    api: env.TRANSAK_API_BASE || (stg ? 'https://api-stg.transak.com' : 'https://api.transak.com'),
    gw: env.TRANSAK_GATEWAY_BASE || (stg ? 'https://api-gateway-stg.transak.com' : 'https://api-gateway.transak.com'),
  };
}

/* Токен партнёра живёт 7 дней. Просить новый на каждый запрос нельзя —
   Transak это прямо запрещает. Держим в памяти и в кэше дата-центра. */
let tokenMem = null;
const TOKEN_KEY = 'https://transak.token.cache/v1';
async function partnerToken(env, f, force){
  const now = Math.floor(Date.now() / 1000);
  if (!force && tokenMem && tokenMem.exp - 3600 > now) return tokenMem.token;
  const cache = (typeof caches !== 'undefined' && caches.default) || null;
  if (!force && cache){
    try{
      const hit = await cache.match(TOKEN_KEY);
      if (hit){ const v = await hit.json(); if (v && v.exp - 3600 > now){ tokenMem = v; return v.token; } }
    } catch(e){}
  }
  const r = await f(bases(env).api + '/partners/api/v2/refresh-token', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.TRANSAK_API_KEY, 'api-secret': env.TRANSAK_API_SECRET },
    body: JSON.stringify({ apiKey: env.TRANSAK_API_KEY }) });
  const j = await r.json().catch(() => null);
  const token = j && j.data && j.data.accessToken, exp = j && j.data && Number(j.data.expiresAt);
  if (!r.ok || !token) throw new Error('transak token ' + r.status);
  tokenMem = { token, exp: exp || now + 6 * 86400 };
  if (cache){
    try{ await cache.put(TOKEN_KEY, new Response(JSON.stringify(tokenMem), { headers: { 'cache-control': 'max-age=' + Math.max(60, tokenMem.exp - now - 3600) } })); } catch(e){}
  }
  return token;
}

export function widgetParams(env, q, app){
  const net = NETS[q.net];
  const p = {
    apiKey: env.TRANSAK_API_KEY,
    referrerDomain: app ? APP_ID : 'wallet.tavarov.com',
    productsAvailed: 'BUY',
    network: net.tk,
    cryptoCurrencyCode: q.c.toUpperCase(),
    walletAddress: q.a,
    disableWalletAddressForm: true,
    colorMode: q.t === 'light' ? 'LIGHT' : 'DARK',
    themeColor: '6A35F2',
    hideMenu: true,
  };
  if (!app) p.redirectURL = 'https://wallet.tavarov.com/';
  return p;
}

export async function onRequestGet({ request, env, fetchImpl }){
  const f = fetchImpl || fetch;
  const origin = request.headers.get('origin');
  if (origin && !ORIGINS.includes(origin)) return json(request, { error: 'forbidden origin' }, 403);
  if (!env || !env.TRANSAK_API_KEY || !env.TRANSAK_API_SECRET) return json(request, { error: 'card top-up is not configured' }, 503);
  if (await overLimit(request, env, 'transak', 30, 600)) return tooMany();
  const s = new URL(request.url).searchParams;
  const q = { net: String(s.get('net') || ''), c: String(s.get('c') || '').toLowerCase(), a: String(s.get('a') || '').trim(), t: String(s.get('t') || '') };
  if (!NETS[q.net] || !NETS[q.net].coins.includes(q.c)) return json(request, { error: 'unsupported coin' }, 400);
  if (!okAddr(q.net, q.a)) return json(request, { error: 'bad wallet address for this network' }, 400);
  const userIp = request.headers.get('cf-connecting-ip') || '';
  if (!userIp) return json(request, { error: 'no client ip' }, 400);
  const body = JSON.stringify({ widgetParams: widgetParams(env, q, s.get('app') === '1') });
  const session = async token => f(bases(env).gw + '/api/v2/auth/session', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'access-token': token, 'x-api-key': env.TRANSAK_API_KEY, 'x-user-ip': userIp },
    body });
  try{
    let r = await session(await partnerToken(env, f, false));
    if (r.status === 401) r = await session(await partnerToken(env, f, true));   // токен отозван — один раз берём новый
    const j = await r.json().catch(() => null);
    const url = j && j.data && j.data.widgetUrl;
    if (!r.ok || typeof url !== 'string' || !/^https:\/\/global(-stg)?\.transak\.com\/?\?/.test(url)) return json(request, { error: 'transak refused', status: r.status }, 502);
    return json(request, { url });
  } catch(e){
    return json(request, { error: 'transak is unavailable' }, 502);
  }
}

export const onRequestOptions = ({ request }) => new Response(null, { status: 204, headers: Object.assign({
  'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' }, corsFor(request)) });
