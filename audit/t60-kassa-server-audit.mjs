/* Сервер кассы после аудита 23 сентября: каждая найденная щель — закрыта.

   Узлы и хранилище поддельные, как в t52; один из узлов умеет врать. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const { onRequestGet, onRequestPost, onRequestOptions } = await import('/home/claude/apk/functions/api/till.js');

let ok = 0, bad = 0;
const t = (имя, условие, детали = '') => {
  if (условие) { ok++; console.log('OK   ' + имя + (детали ? '  [' + детали + ']' : '')); }
  else { bad++; console.log('ПРОВАЛ ' + имя + (детали ? '  [' + детали + ']' : '')); }
};

function makeKV(){
  const map = new Map();
  return { map,
    async get(k){ const v = map.get(k); return v ? v.body : null; },
    async put(k, body){ map.set(k, { body }); },
    async delete(k){ map.delete(k); } };
}

/* Узлы: честный пересчитывает подпись; лжец отвечает «подписал продавец»
   на что угодно. Кто из узлов лжёт — задаётся перед проверкой. */
let liar = null, liarAddr = '', nodeCalls = 0;
globalThis.fetch = async (url, init) => {
  nodeCalls++;
  const req = JSON.parse(init.body);
  const data = req.params[0].data.replace(/^0x/, '');
  let result;
  if (liar && String(url).includes(liar)) {
    result = '0x' + '0'.repeat(24) + liarAddr.slice(2).toLowerCase();
  } else {
    try{
      const addr = E.utils.recoverAddress('0x' + data.slice(0, 64), {
        r: '0x' + data.slice(128, 192), s: '0x' + data.slice(192, 256), v: parseInt(data.slice(64, 128), 16) });
      result = '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
    } catch(e){ result = '0x' + '0'.repeat(64); }
  }
  return { ok: true, json: async () => ({ jsonrpc:'2.0', id:1, result }) };
};

function signedText(o){
  return ['Tavarov till', 'action: ' + o.action, 'merchant: ' + o.m.toLowerCase(),
    'till: ' + o.k, 'network: ' + o.net, 'currency: ' + (o.c || ''),
    'amount: ' + (o.a || ''), 'item: ' + (o.i || ''), 'order: ' + (o.o || ''),
    'invoice: ' + (o.h || ''), 'time: ' + o.ts].join('\n');
}
const inv = () => '0x' + [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2,'0')).join('');
async function signed(w, over){
  const o = Object.assign({ action:'set', m: w.address, k:1, net:'bnb', c:'USDT', a:'10', i:'кофе', o:'', h: inv(),
    ts: Math.floor(Date.now()/1000) }, over || {});
  o.sig = await w.signMessage(signedText(o));
  return o;
}
async function postRaw(env, text, headers){
  const r = await onRequestPost({ env, request: new Request('https://wallet.tavarov.com/api/till',
    { method:'POST', headers: Object.assign({'content-type':'application/json'}, headers || {}), body: text }) });
  let body = null; try{ body = await r.json(); } catch(e){}
  return { status: r.status, body, headers: r.headers };
}
const post = (env, o, h) => postRaw(env, JSON.stringify(o), h);
async function get(env, q, headers){
  const r = await onRequestGet({ env, request: new Request('https://wallet.tavarov.com/api/till?' + new URLSearchParams(q), { headers: headers || {} }) });
  return { status: r.status, body: await r.json(), headers: r.headers };
}

const seller = E.Wallet.createRandom();
const stranger = E.Wallet.createRandom();
const env = { TILL: makeKV() };

// ---------- 1. лживый узел ----------
liar = 'publicnode'; liarAddr = seller.address;
{
  const fake = await signed(stranger, { m: seller.address, a: '0.01' });   // подписал чужой
  const r = await post(env, fake);
  t('ОДИН ЛЖИВЫЙ УЗЕЛ НЕ МОЖЕТ «ПОДТВЕРДИТЬ» ЧУЖУЮ ПОДПИСЬ', r.status === 403, r.status + ' ' + JSON.stringify(r.body));
  const g = await get(env, { m: seller.address, k: 1, net: 'bnb' });
  t('и копеечная цена на кассу не легла', g.body.empty === true, JSON.stringify(g.body).slice(0, 80));
}
liar = null;
{
  const r = await post(env, await signed(seller));
  t('честная подпись по-прежнему проходит (два узла согласны)', r.status === 200, JSON.stringify(r.body));
}

// ---------- 2. размер тела ----------
{
  const big = await signed(seller, { action:'clear', c:'', a:'', i:'', o:'', h:'' });
  big.i = 'x'.repeat(1024 * 1024);
  const before = nodeCalls;
  const t0 = Date.now();
  const r = await post(env, big);
  t('МЕГАБАЙТ В ЗАПРОСЕ — ОТКАЗ ДО ВСЯКОГО СЧЁТА', r.status === 413 && nodeCalls === before && Date.now() - t0 < 200,
    r.status + ', ' + (Date.now() - t0) + ' мс, к узлу ' + (nodeCalls - before));
}

// ---------- 3. «снять» без лишних полей ----------
{
  const o = await signed(seller, { action:'clear', c:'', a:'', i:'мусор', o:'', h:'' });
  const r = await post(env, o);
  t('«СНЯТЬ» С ЛИШНИМИ ПОЛЯМИ — ОТКАЗ', r.status === 400, r.status + ' ' + JSON.stringify(r.body));
}

// ---------- 4. опасные символы ----------
for (const [что, s] of [['разворот текста U+202E', '‮olleh'], ['нулевой байт', 'a\u0000b'],
                        ['разделитель строк U+2028', 'a b'], ['невидимый пробел', 'a​b']]){
  const r = await post(env, await signed(seller, { i: s }));
  t('НАЗВАНИЕ С ЗАПРЕЩЁННЫМ СИМВОЛОМ НЕ ПРИНЯТО: ' + что, r.status === 400, r.status);
}

// ---------- 5. повтор старой подписи после «снять» ----------
{
  const env2 = { TILL: makeKV() };
  const now = Math.floor(Date.now()/1000);
  const setOld = await signed(seller, { ts: now - 5 });
  t('сумма выставлена', (await post(env2, setOld)).status === 200);
  const clr = await signed(seller, { action:'clear', c:'', a:'', i:'', o:'', h:'', ts: now - 3 });
  t('и снята', (await post(env2, clr)).status === 200);
  const g = await get(env2, { m: seller.address, k: 1, net: 'bnb' });
  t('после снятия касса пуста', g.body.empty === true, JSON.stringify(g.body).slice(0, 60));
  const again = await post(env2, setOld);
  t('ПОВТОР СТАРОЙ ПОДПИСАННОЙ СУММЫ ПОСЛЕ СНЯТИЯ — ОТКАЗ', again.status === 409, again.status + ' ' + JSON.stringify(again.body));
}

// ---------- 6. подпись кривого вида ----------
{
  const o = await signed(seller);
  o.sig = '0x1234';
  const r = await post(env, o);
  t('кривая подпись отбита до обращения к узлам', r.status === 400, r.status);
}

// ---------- 7. приложение из магазина ----------
{
  const g = await get(env, { m: seller.address, k: 1, net: 'bnb' }, { origin: 'https://localhost' });
  t('ПРИЛОЖЕНИЮ ИЗ МАГАЗИНА РАЗРЕШЁН ДОСТУП (https://localhost)', g.headers.get('access-control-allow-origin') === 'https://localhost');
  const evil = await get(env, { m: seller.address, k: 1, net: 'bnb' }, { origin: 'https://evil.example' });
  t('а чужому сайту — нет', evil.headers.get('access-control-allow-origin') === null);
  const pre = await onRequestOptions({ request: new Request('https://wallet.tavarov.com/api/till', { method:'OPTIONS', headers: { origin: 'capacitor://localhost' } }) });
  t('предварительный запрос для iOS тоже отвечен', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'capacitor://localhost');
}

console.log('\n--- ' + ok + ' из ' + (ok + bad) + ' ---');
process.exit(bad ? 1 : 0);
