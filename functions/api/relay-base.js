/* USDC в Base без ETH на комиссию (10 ноября 2026).

   В BNB Chain газ за человека платит MegaFuel (gasless.js). В Base такого
   общего сервиса нет, зато у самого USDC есть «перевод по подписи»
   (transferWithAuthorization, EIP-3009): владелец подписывает у себя в
   кошельке «перевести столько-то тому-то», а отправить эту подпись в сеть
   может кто угодно. Отправляем мы — со своего служебного кошелька, и газ
   платит он.

   ЧТО ЗДЕСЬ МОЖНО И ЧЕГО НЕЛЬЗЯ. Сервер не может ни изменить получателя, ни
   сумму: они внутри подписи владельца, и контракт USDC проверяет её сам.
   Всё, что может сервер, — отправить ровно этот перевод или не отправить.
   Деньги людей через служебный кошелёк не проходят; на нём лежит только ETH
   на газ, и это весь возможный ущерб, если ключ однажды утечёт.

   КЛЮЧ. Переменная BASE_RELAYER_KEY в настройках Cloudflare Pages. Её
   создаёт сам GitHub Actions при выкладке (deploy.yml), один раз, и нигде
   не печатает: ни человек, ни Claude этого ключа не видели. Адрес
   служебного кошелька — GET /api/relay-base; на него кладут немного ETH.

   ГРАНИЦЫ, чтобы баланс не съели:
     — только USDC в Base и только у тех, у кого ETH на газ действительно нет;
     — от 0.10 USDC (иначе дешевле подарить, чем отправлять);
     — десять переводов в сутки с одного адреса клиента и пять с одного
       кошелька;
     — сначала пробный вызов (eth_call): перевод, который не пройдёт, мы не
       отправляем и газ за него не платим. */
import { overLimit } from './_limit.js';
import { keccak256, toHex, fromHex } from './_crypto.js';
import { getPublicKey, signAsync } from './_secp256k1.js';

const CHAIN_ID = 8453n;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org'];
const MIN_UNITS = 100000n;                        // 0.10 USDC (6 знаков)
const HAS_GAS_WEI = 20000000000000n;              // 0.00002 ETH — на свой перевод хватает

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
               'access-control-allow-headers': 'content-type' };
const reply = (o, status) => new Response(JSON.stringify(o), { status: status || 200,
  headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS) });

const enc = new TextEncoder();
const SEL = toHex(keccak256(enc.encode(
  'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'))).slice(0, 10);

/* ---------- RLP: упаковка операции перед подписью ---------- */
function bytesOfInt(n){
  n = BigInt(n);
  if (n === 0n) return new Uint8Array(0);
  let h = n.toString(16); if (h.length % 2) h = '0' + h;
  return fromHex(h);
}
function rlp(x){
  if (Array.isArray(x)){
    const body = concat(...x.map(rlp));
    return concat(rlpLen(body.length, 0xc0), body);
  }
  if (x.length === 1 && x[0] < 0x80) return x;
  return concat(rlpLen(x.length, 0x80), x);
}
function rlpLen(len, off){
  if (len < 56) return Uint8Array.of(off + len);
  const l = bytesOfInt(len);
  return concat(Uint8Array.of(off + 55 + l.length), l);
}
function concat(...a){
  const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let p = 0; for (const x of a){ out.set(x, p); p += x.length; }
  return out;
}

export function relayerAddress(keyHex){
  const pub = getPublicKey(keyHex.replace(/^0x/, ''), false);   // 65 байт, первый — 0x04
  return '0x' + toHex(keccak256(pub.slice(1))).slice(-40);
}

/* Подписать операцию типа 2 (EIP-1559) ключом служебного кошелька. */
export async function signTx(keyHex, tx){
  const fields = [bytesOfInt(CHAIN_ID), bytesOfInt(tx.nonce), bytesOfInt(tx.maxPriorityFeePerGas),
                  bytesOfInt(tx.maxFeePerGas), bytesOfInt(tx.gas), fromHex(tx.to), bytesOfInt(0), fromHex(tx.data), []];
  const hash = keccak256(concat(Uint8Array.of(2), rlp(fields)));
  const sig = await signAsync(hash, keyHex.replace(/^0x/, ''), { lowS: true });
  return toHex(concat(Uint8Array.of(2), rlp([...fields, bytesOfInt(sig.recovery), bytesOfInt(sig.r), bytesOfInt(sig.s)])));
}

async function rpc(method, params, fetchImpl){
  let last = null;
  for (const url of RPCS){
    try{
      const r = await (fetchImpl || fetch)(url, { method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'NoN-Wallet/1.1 (+https://tavarov.com)' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j && j.error){ last = j.error; if (method === 'eth_call' || method === 'eth_sendRawTransaction' || method === 'eth_estimateGas') break; continue; }
      /* Ответ без result — не ответ узла (заглушка, ограничитель): к следующему. */
      if (!j || j.result === undefined){ last = { message: url.split('/')[2] + ': ' + JSON.stringify(j).slice(0, 80) }; continue; }
      return j.result;
    } catch(e){ last = { message: String(e && e.message || e) }; }
  }
  const err = new Error((last && last.message) || 'Base node did not answer');
  err.rpc = true; throw err;
}

const isAddr = a => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const word = h => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uint = n => BigInt(n).toString(16).padStart(64, '0');

export function onRequestOptions(){ return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestGet({ env }){
  const key = env && env.BASE_RELAYER_KEY;
  if (!key) return reply({ on: false });
  const address = relayerAddress(key);
  let balance = null, rpcError;
  try{ balance = (BigInt(await rpc('eth_getBalance', [address, 'latest'])) ).toString(); }
  catch(e){ rpcError = String(e && e.message || e).slice(0, 120); }
  return reply({ on: true, address, balanceWei: balance, rpcError });
}

export async function onRequestPost({ request, env }, deps){
  const key = env && env.BASE_RELAYER_KEY;
  if (!key) return reply({ error: 'relay off' }, 503);
  const F = deps && deps.fetch;
  const raw = await request.text().catch(() => '');
  if (raw.length > 2000) return reply({ error: 'request too large' }, 413);
  let q = null; try{ q = JSON.parse(raw); } catch(e){}
  if (!q) return reply({ error: 'bad request' }, 400);

  const { from, to } = q;
  let value, validAfter, validBefore;
  try{ value = BigInt(q.value); validAfter = BigInt(q.validAfter || 0); validBefore = BigInt(q.validBefore); }
  catch(e){ return reply({ error: 'bad numbers' }, 400); }
  const sig = fromHex(q.signature);
  if (!isAddr(from) || !isAddr(to) || from.toLowerCase() === to.toLowerCase() || /^0x0{40}$/.test(to))
    return reply({ error: 'bad address' }, 400);
  if (!/^0x[0-9a-fA-F]{64}$/.test(q.nonce || '') || !sig || sig.length !== 65) return reply({ error: 'bad signature' }, 400);
  if (value < MIN_UNITS) return reply({ error: 'amount below 0.10 USDC' }, 400);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (validBefore <= now + 30n || validBefore > now + 7200n) return reply({ error: 'bad validity window' }, 400);

  if (await overLimit(request, env, 'relay-base', 10, 86400) ||
      await overLimit(request, env, 'relay-base-from', 5, 86400, from.toLowerCase()))
    return reply({ error: 'too many requests' }, 429);

  try{
    /* У кого ETH есть, тот платит сам: служебный кошелёк — для тех, кому нечем. */
    const eth = BigInt(await rpc('eth_getBalance', [from, 'latest'], F));
    if (eth >= HAS_GAS_WEI) return reply({ error: 'has gas' }, 409);

    let v = sig[64]; if (v < 27) v += 27;
    const data = SEL + word(from) + word(to) + uint(value) + uint(validAfter) + uint(validBefore) +
                 word(q.nonce) + uint(v) + toHex(sig.slice(0, 32)).slice(2) + toHex(sig.slice(32, 64)).slice(2);
    const me = relayerAddress(key);

    /* Пробный вызов: неверная подпись, нехватка USDC, повтор — всё это
       отказ здесь, бесплатно, а не в сети за наш газ. */
    try{ await rpc('eth_call', [{ from: me, to: USDC, data }, 'latest'], F); }
    catch(e){ return reply({ error: 'transfer would fail: ' + String(e.message).slice(0, 120) }, 400); }

    let gas = 90000n;
    try{ gas = BigInt(await rpc('eth_estimateGas', [{ from: me, to: USDC, data }], F)) * 13n / 10n; } catch(e){}
    const [block, prioHex] = await Promise.all([
      rpc('eth_getBlockByNumber', ['latest', false], F),
      rpc('eth_maxPriorityFeePerGas', [], F).catch(() => '0xf4240')]);
    const base = BigInt(block && block.baseFeePerGas || '0x0');
    const prio = BigInt(prioHex) > 0n ? BigInt(prioHex) : 1000000n;
    const maxFee = base * 2n + prio;

    for (let attempt = 0; attempt < 2; attempt++){
      const nonce = BigInt(await rpc('eth_getTransactionCount', [me, 'pending'], F));
      const signed = await signTx(key, { nonce, maxPriorityFeePerGas: prio, maxFeePerGas: maxFee, gas, to: USDC, data });
      try{
        const hash = await rpc('eth_sendRawTransaction', [signed], F);
        return reply({ hash });
      } catch(e){
        if (attempt === 0 && /nonce|underpriced|already known/i.test(String(e.message))) continue;
        if (/insufficient funds/i.test(String(e.message))) return reply({ error: 'relay has no ETH' }, 503);
        return reply({ error: String(e.message).slice(0, 160) }, 502);
      }
    }
    return reply({ error: 'could not send' }, 502);
  } catch(e){
    return reply({ error: String(e && e.message || e).slice(0, 160) }, 502);
  }
}
