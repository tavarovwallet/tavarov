/* Покупка картой через Onramper (22.10.2026).

   ЗАЧЕМ. Onramper — не один сервис, а витрина из двадцати с лишним (MoonPay,
   Transak, Banxa, Mercuryo…): для каждого покупателя он сам выбирает, кто
   работает в его стране и где дешевле. Один MoonPay половине наших людей
   просто недоступен.

   ПОЧЕМУ ЧЕРЕЗ СЕРВЕР. Адрес кошелька в окне Onramper подставляется, только
   если ссылка подписана (подпись V2, Ed25519). Закрытый ключ подписи держать в
   приложении нельзя — поэтому кошелёк присылает сюда сеть, монету и адрес, а
   мы возвращаем подписанную ссылку. Карту, сумму, паспорт видит только
   выбранный сервис; мы ничего не храним.

   Ключи задаёт ЗАДАТЬ-КЛЮЧИ-ONRAMPER.bat (секреты Cloudflare Pages):
     ONRAMPER_API_KEY     — pk_prod_… из кабинета Onramper;
     ONRAMPER_PRIVATE_KEY — закрытый ключ Ed25519 (PEM, PKCS8). Открытая
                            половина отправляется в поддержку Onramper.
   Нет ключей — 503, и кошелёк пойдёт запасным путём.

   Id монет у Onramper вида «usdt_bsc» мы не угадываем: спрашиваем их список
   (/supported) и ищем по адресу контракта и сети. Список кэшируем на 6 часов.

     GET /api/onramper?net=bnb&c=usdt&a=0x…&t=dark → { url } */

import { overLimit, tooMany } from './_limit.js';

/* Что кошелёк умеет принять: сеть → монета → адрес контракта ('' — монета сети). */
export const COINS = {
  bnb:    { usdt: '0x55d398326f99059ff775485246999027b3197955', usdc: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', bnb: '' },
  eth:    { usdt: '0xdac17f958d2ee523a2206206994597c13d831ec7', usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', eth: '' },
  base:   { usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', eth: '' },
  solana: { usdt: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', sol: '' },
};
/* Как Onramper может называть наши сети. */
const NET_NAMES = { bnb: ['bsc', 'bnb_chain', 'bnbchain', 'binance-smart-chain', 'bep20', 'bnb'], eth: ['ethereum', 'erc20'], base: ['base'], solana: ['solana', 'sol'] };
const okAddr = (net, a) => net === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) : /^0x[0-9a-fA-F]{40}$/.test(a);
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });

/* id монет Onramper для наших сетей: { 'bnb:usdt': 'usdt_bsc', … }. */
export function pickIds(list){
  const out = {};
  for (const net of Object.keys(COINS)){
    for (const [sym, addr] of Object.entries(COINS[net])){
      const hit = (list || []).find(c => {
        if (!c || typeof c.id !== 'string') return false;
        const n = String(c.network || '').toLowerCase();
        if (!NET_NAMES[net].includes(n)) return false;
        const a = String(c.address || '');
        if (addr) return net === 'solana' ? a === addr : a.toLowerCase() === addr;
        /* монета сети: без адреса (или нулевой) и с тем же символом */
        return String(c.code || '').toLowerCase() === sym && (!a || /^0x0{40}$/i.test(a) || a === '11111111111111111111111111111111');
      });
      if (hit) out[net + ':' + sym] = hit.id;
    }
  }
  return out;
}
let idsCache = null, idsAt = 0;
async function onramperIds(env, fetchImpl){
  if (idsCache && Date.now() - idsAt < 6 * 3600e3) return idsCache;
  const api = env.ONRAMPER_STAGING ? 'https://api-stg.onramper.com' : 'https://api.onramper.com';
  const r = await (fetchImpl || fetch)(api + '/supported?type=buy&skipCountryCheck=true', { headers: { Authorization: env.ONRAMPER_API_KEY, accept: 'application/json' } });
  if (!r.ok) throw new Error('onramper /supported ' + r.status);
  const j = await r.json();
  const ids = pickIds(j && j.message && j.message.crypto);
  if (Object.keys(ids).length){ idsCache = ids; idsAt = Date.now(); }
  return ids;
}

function pemToDer(pem){
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
async function ed25519Sign(pem, text){
  const der = pemToDer(pem), data = new TextEncoder().encode(text);
  let key;
  try{ key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']); }
  catch(e){ key = await crypto.subtle.importKey('pkcs8', der, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }, false, ['sign']); }
  const sig = new Uint8Array(await crypto.subtle.sign(key.algorithm.name === 'Ed25519' ? 'Ed25519' : { name: 'NODE-ED25519' }, key, data));
  let bin = ''; for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

/* Подпись V2 (docs.onramper.com/docs/widget-sign-a-url-v2): восемь строк через \n,
   в шестой — подписываемые поля, закодированные и отсортированные. */
export function canonical(fields, timestamp, nonce){
  const q = new URLSearchParams(fields); q.sort();
  return ['ONRAMPER-SIG-V2', timestamp, nonce, 'GET', '/', q.toString(), '', EMPTY_SHA256].join('\n');
}
export async function signedUrl(env, fields, display, now = new Date()){
  const timestamp = now.toISOString();
  const nonce = crypto.randomUUID();
  const expiry = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const sig = await ed25519Sign(env.ONRAMPER_PRIVATE_KEY, canonical(fields, timestamp, nonce));
  const u = new URL('https://buy.onramper.com');
  for (const [k, v] of Object.entries(fields)) u.searchParams.set(k, v);
  for (const [k, v] of Object.entries(display || {})) u.searchParams.set(k, v);
  u.searchParams.set('sigV2', 'v2:' + sig);
  u.searchParams.set('sigV2Timestamp', timestamp);
  u.searchParams.set('sigV2Nonce', nonce);
  u.searchParams.set('sigV2Expiry', expiry);
  u.searchParams.set('sigV2Fields', Object.keys(fields).sort().join(','));
  return u.toString();
}

export async function onRequestGet({ request, env, fetchImpl }){
  if (!env || !env.ONRAMPER_API_KEY || !env.ONRAMPER_PRIVATE_KEY) return json({ error: 'card top-up is not configured' }, 503);
  if (await overLimit(request, env, 'onramper', 30, 600)) return tooMany();
  const q = new URL(request.url).searchParams;
  const net = String(q.get('net') || ''), c = String(q.get('c') || '').toLowerCase(), a = String(q.get('a') || '').trim();
  if (!COINS[net] || !Object.prototype.hasOwnProperty.call(COINS[net], c)) return json({ error: 'unsupported coin' }, 400);
  if (!okAddr(net, a)) return json({ error: 'bad wallet address for this network' }, 400);
  let ids;
  try{ ids = await onramperIds(env, fetchImpl); }
  catch(e){ return json({ error: 'onramper is unavailable' }, 502); }
  const mine = Object.keys(COINS[net]).filter(s => ids[net + ':' + s]);
  if (!ids[net + ':' + c]) return json({ error: 'onramper does not sell this coin' }, 404);
  const fields = {
    apiKey: env.ONRAMPER_API_KEY,
    defaultCrypto: ids[net + ':' + c],
    onlyCryptos: mine.map(s => ids[net + ':' + s]).join(','),
    wallets: mine.map(s => ids[net + ':' + s] + ':' + a).join(','),
    redirectAtCheckout: 'false',
  };
  /* Оформление подписывать не нужно. */
  const display = { themeName: q.get('t') === 'light' ? 'light' : 'dark', primaryColor: '6A35F2' };
  return json({ url: await signedUrl(env, fields, display) });
}

export const onRequestOptions = () => new Response(null, { status: 204, headers: {
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' } });
