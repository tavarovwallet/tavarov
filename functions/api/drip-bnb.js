/* BNB на одну операцию для того, у кого его нет (10 ноября 2026).

   ЗАЧЕМ. Имя без комиссии и перевод USDT/USDC без BNB идут через MegaFuel
   (gasless.js). Но MegaFuel — чужой сервис: 9 ноября у него «съехал» учёт
   нашего баланса, и до ответа поддержки имена и переводы встали. Зависеть
   от одного чужого сервиса нельзя, поэтому есть второй путь, свой:
   служебный кошелёк в BNB Chain кладёт человеку ровно столько BNB, сколько
   стоит его операция, и кошелёк сразу проводит её обычным путём. MegaFuel
   по-прежнему первый; сюда приходят, только когда он отказал.

   ЧТО ЗДЕСЬ МОЖНО. Только то же, что пропускает правило MegaFuel:
     — claim(string) в контракте имён TavarovNames v3;
     — transfer(address,uint256) у встроенных USDT и USDC в BNB Chain.
   Операцию сначала проверяет сеть (eth_estimateGas): если имя занято или
   долларов не хватает, она не пройдёт — и BNB мы не даём. Сумма считается
   из оценки газа и цены газа сети, с запасом, но не больше потолка: при
   всплеске цен в сети лучше отказать, чем раздать баланс.

   КЛЮЧ. BNB_DRIP_KEY в настройках Cloudflare Pages. Его создаёт GitHub
   Actions при выкладке (deploy.yml), один раз, и нигде не печатает.
   Адрес служебного кошелька — GET /api/drip-bnb; на него кладут немного BNB.
   На нём лежит только BNB на газ: это весь возможный ущерб, если ключ
   однажды утечёт.

   ГРАНИЦЫ, чтобы баланс не съели:
     — три раза в сутки с одного адреса клиента и три на один кошелёк;
     — не больше пятидесяти в сутки на всех;
     — у кого BNB на операцию уже хватает, тому не даём. */
import { overLimit } from './_limit.js';
import { keccak256, toHex, fromHex } from './_crypto.js';
import { signAsync } from './_secp256k1.js';
import { bytesOfInt, rlp, concat, relayerAddress } from './relay-base.js';

const CHAIN_ID = 56n;
const RPCS = ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.defibit.io',
              'https://bsc-rpc.publicnode.com', 'https://1rpc.io/bnb', 'https://bsc.drpc.org'];
export const NAMES = '0xd6E8A78634bE366bDbD041227D1E94F5b374338e';
export const USDT = '0x55d398326f99059fF775485246999027B3197955';
export const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const CLAIM = '0xf3fe12c9', TRANSFER = '0xa9059cbb';
const MAX_GAS = 300000n;                          // claim — около 120 тысяч, перевод — около 50
const MAX_WEI = 60000000000000n;                  // 0.00006 BNB: потолок на одного человека
const PER_DAY_ALL = 50;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
               'access-control-allow-headers': 'content-type' };
const reply = (o, status) => new Response(JSON.stringify(o), { status: status || 200,
  headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS) });

/* Пропускаем ровно то, что пропускает правило MegaFuel. */
export function allowedOp(to, data){
  if (typeof to !== 'string' || typeof data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(data) || data.length > 1000) return false;
  const t = to.toLowerCase(), sel = data.slice(0, 10).toLowerCase();
  if (t === NAMES.toLowerCase()) return sel === CLAIM;
  if (t === USDT.toLowerCase() || t === USDC.toLowerCase()) return sel === TRANSFER && data.length === 2 + 8 + 128;
  return false;
}

async function rpc(method, params, fetchImpl){
  let last = null;
  for (const url of RPCS){
    try{
      const r = await (fetchImpl || fetch)(url, { method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'NoN-Wallet/1.1 (+https://tavarov.com)' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j && j.error){
        last = j.error;
        if (/revert|nonce|underpriced|already known|insufficient funds/i.test(String(j.error.message || ''))) break;
        continue;
      }
      if (!j || j.result === undefined){ last = { message: url.split('/')[2] + ': ' + JSON.stringify(j).slice(0, 80) }; continue; }
      return j.result;
    } catch(e){ last = { message: String(e && e.message || e) }; }
  }
  const err = new Error((last && last.message) || 'BNB Chain node did not answer');
  err.rpc = true; throw err;
}

/* Обычная операция BNB Chain (тип 0, EIP-155, сеть 56): перевод BNB. */
export async function signLegacy(keyHex, tx){
  const base = [bytesOfInt(tx.nonce), bytesOfInt(tx.gasPrice), bytesOfInt(tx.gas), fromHex(tx.to), bytesOfInt(tx.value), new Uint8Array(0)];
  const hash = keccak256(rlp([...base, bytesOfInt(CHAIN_ID), new Uint8Array(0), new Uint8Array(0)]));
  const sig = await signAsync(hash, keyHex.replace(/^0x/, ''), { lowS: true });
  const v = CHAIN_ID * 2n + 35n + BigInt(sig.recovery);
  return toHex(rlp([...base, bytesOfInt(v), bytesOfInt(sig.r), bytesOfInt(sig.s)]));
}

const isAddr = a => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

export function onRequestOptions(){ return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestGet({ env }){
  const key = env && env.BNB_DRIP_KEY;
  if (!key) return reply({ on: false });
  const address = relayerAddress(key);
  let balance = null, rpcError;
  try{ balance = BigInt(await rpc('eth_getBalance', [address, 'latest'])).toString(); }
  catch(e){ rpcError = String(e && e.message || e).slice(0, 120); }
  return reply({ on: true, address, balanceWei: balance, rpcError });
}

/* Тело: { from, to, data } — кто будет платить и какую операцию проведёт.
   Ответ: { hash, gas, gasPrice } — хеш нашего перевода BNB и ровно те газ и
   цена газа, под которые он рассчитан: кошелёк подписывает операцию с ними. */
export async function onRequestPost({ request, env }, deps){
  const key = env && env.BNB_DRIP_KEY;
  if (!key) return reply({ error: 'drip off' }, 503);
  const F = deps && deps.fetch;
  const raw = await request.text().catch(() => '');
  if (raw.length > 2000) return reply({ error: 'request too large' }, 413);
  let q = null; try{ q = JSON.parse(raw); } catch(e){}
  if (!q) return reply({ error: 'bad request' }, 400);
  const { from, to, data } = q;
  if (!isAddr(from) || /^0x0{40}$/.test(from)) return reply({ error: 'bad address' }, 400);
  if (!allowedOp(to, data)) return reply({ error: 'operation not covered' }, 400);
  const me = relayerAddress(key);
  if (from.toLowerCase() === me.toLowerCase()) return reply({ error: 'bad address' }, 400);

  if (await overLimit(request, env, 'drip-bnb', 3, 86400) ||
      await overLimit(request, env, 'drip-bnb-from', 3, 86400, from.toLowerCase()))
    return reply({ error: 'too many requests' }, 429);

  try{
    /* Пройдёт ли операция вообще. Имя занято, долларов не хватает — отказ
       здесь, бесплатно. */
    let gas;
    try{ gas = BigInt(await rpc('eth_estimateGas', [{ from, to, data }], F)); }
    catch(e){ return reply({ error: 'operation would fail: ' + String(e.message).slice(0, 120) }, 400); }
    if (gas > MAX_GAS) return reply({ error: 'operation too heavy' }, 400);
    gas = gas * 13n / 10n;
    let gasPrice = BigInt(await rpc('eth_gasPrice', [], F));
    if (gasPrice < 50000000n) gasPrice = 50000000n;             // 0.05 gwei — нижняя цена в BNB Chain
    const need = gas * gasPrice;
    if (need > MAX_WEI) return reply({ error: 'network fees too high right now' }, 503);

    const have = BigInt(await rpc('eth_getBalance', [from, 'pending'], F));
    if (have >= need) return reply({ error: 'has gas', gas: gas.toString(), gasPrice: gasPrice.toString() }, 409);
    const value = need - have;

    /* Общий потолок считаем только по тем, кто дошёл до отправки. */
    if (await overLimit(request, env, 'drip-bnb-all', PER_DAY_ALL, 86400, 'all'))
      return reply({ error: 'daily limit reached' }, 429);

    for (let attempt = 0; attempt < 2; attempt++){
      const nonce = BigInt(await rpc('eth_getTransactionCount', [me, 'pending'], F));
      const signed = await signLegacy(key, { nonce, gasPrice, gas: 21000n, to: from, value });
      try{
        const hash = await rpc('eth_sendRawTransaction', [signed], F);
        return reply({ hash, gas: gas.toString(), gasPrice: gasPrice.toString(), value: value.toString() });
      } catch(e){
        if (attempt === 0 && /nonce|underpriced|already known/i.test(String(e.message))) continue;
        if (/insufficient funds/i.test(String(e.message))) return reply({ error: 'drip has no BNB' }, 503);
        return reply({ error: String(e.message).slice(0, 160) }, 502);
      }
    }
    return reply({ error: 'could not send' }, 502);
  } catch(e){
    return reply({ error: String(e && e.message || e).slice(0, 160) }, 502);
  }
}
