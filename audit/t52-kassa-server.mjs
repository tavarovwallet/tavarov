/* Черновик суммы на кассе: /api/till.

   Что здесь проверяется. Не «работает ли обычный случай» — обычный случай
   ломается редко и заметно. Проверяется то, что ломается тихо: можно ли
   выставить сумму чужой кассе, можно ли подсунуть старую сумму вместо новой,
   можно ли переклеить подпись с копеечного счёта на дорогой.

   Узла и хранилища здесь нет: оба поддельные. Настоящий ecrecover делает
   ровно то же самое — это встроенная в любую сеть операция, и проверяем мы
   не её, а свою часть: как мы складываем вопрос и как читаем ответ. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');

const { onRequestGet, onRequestPost } = await import('/home/claude/apk/functions/api/till.js');

let ok = 0, bad = 0;
const t = (имя, условие, детали = '') => {
  if (условие) { ok++; console.log('OK   ' + имя + (детали ? '  [' + детали + ']' : '')); }
  else { bad++; console.log('ПРОВАЛ ' + имя + (детали ? '  [' + детали + ']' : '')); }
};

/* ---------- поддельное хранилище ---------- */
function makeKV(){
  const map = new Map();
  return {
    map,
    async get(k){
      const v = map.get(k);
      if (!v) return null;
      if (v.until && v.until < Date.now()) { map.delete(k); return null; }
      return v.body;
    },
    async put(k, body, opts){
      map.set(k, { body, until: opts && opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 });
    },
    async delete(k){ map.delete(k); }
  };
}

/* ---------- поддельный узел ---------- */
let nodeCalls = 0, nodeDead = false;
globalThis.fetch = async (url, init) => {
  nodeCalls++;
  if (nodeDead) throw new Error('узел молчит');
  const req = JSON.parse(init.body);
  const to = (req.params[0].to || '').toLowerCase();
  const data = req.params[0].data.replace(/^0x/, '');
  let result = '0x';
  if (to === '0x0000000000000000000000000000000000000001'){
    try{
      const addr = E.utils.recoverAddress('0x' + data.slice(0, 64), {
        r: '0x' + data.slice(128, 192), s: '0x' + data.slice(192, 256),
        v: parseInt(data.slice(64, 128), 16) });
      result = '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
    } catch(e){ result = '0x' + '0'.repeat(64); }
  } else {
    result = '0x' + '0'.repeat(64 * 5);          // счёта в сети нет
  }
  return { ok: true, json: async () => ({ jsonrpc:'2.0', id:1, result }) };
};

/* ---------- то же самое, что подпишет касса ---------- */
function signedText(o){
  return ['Tavarov till', 'action: ' + o.action, 'merchant: ' + o.m.toLowerCase(),
    'till: ' + o.k, 'network: ' + o.net, 'currency: ' + (o.c || ''),
    'amount: ' + (o.a || ''), 'item: ' + (o.i || ''), 'order: ' + (o.o || ''),
    'invoice: ' + (o.h || ''), 'time: ' + o.ts].join('\n');
}

const invId = () => '0x' + [...crypto.getRandomValues(new Uint8Array(32))]
  .map(x => x.toString(16).padStart(2, '0')).join('');

async function post(env, body){
  const r = await onRequestPost({ env,
    request: new Request('https://wallet.tavarov.com/api/till',
      { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
}
async function get(env, q){
  const r = await onRequestGet({ env,
    request: new Request('https://wallet.tavarov.com/api/till?' + new URLSearchParams(q)) });
  return { status: r.status, body: await r.json() };
}

async function signed(wallet, over){
  const o = Object.assign({ action:'set', m: wallet.address, k:1, net:'bnb',
    c:'USDT', a:'250.5', i:'кофе', o:'A-17', h: invId(),
    ts: Math.floor(Date.now() / 1000) }, over || {});
  o.sig = await wallet.signMessage(signedText(o));
  return o;
}

// =====================================================================
const seller = E.Wallet.createRandom();
const stranger = E.Wallet.createRandom();
const env = { TILL: makeKV() };

// ---------- обычный день ----------
{
  const body = await signed(seller);
  const r = await post(env, body);
  t('продавец выставляет сумму', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));

  const g = await get(env, { m: seller.address, k: 1, net: 'bnb' });
  t('покупатель её видит', g.body.amount === '250.5' && g.body.cur === 'USDT', JSON.stringify(g.body));
  t('и видит, за что платит', g.body.item === 'кофе');
  t('и когда её выставили', typeof g.body.setAt === 'number' && typeof g.body.now === 'number');
  t('источник назван честно', g.body.source === 'till');
}

// ---------- чужая касса ----------
{
  const o = Object.assign({ action:'set', m: seller.address, k:2, net:'bnb', c:'USDT',
    a:'0.01', i:'', o:'', h: invId(), ts: Math.floor(Date.now()/1000) });
  o.sig = await stranger.signMessage(signedText(o));   // подписал не тот, чья касса
  const r = await post(env, o);
  t('ЧУЖОЙ НЕ МОЖЕТ ВЫСТАВИТЬ СУММУ ЗА ПРОДАВЦА', r.status === 403, JSON.stringify(r.body));

  const g = await get(env, { m: seller.address, k: 2, net: 'bnb' });
  t('и касса осталась пустой', g.body.empty === true);
}

// ---------- подмена суммы под готовой подписью ----------
{
  const body = await signed(seller, { k: 3, a: '250.5' });
  body.a = '0.01';                                     // подпись прежняя, сумма другая
  const r = await post(env, body);
  t('ПОДМЕНА СУММЫ ПОД ЧУЖОЙ ПОДПИСЬЮ ОТВЕРГНУТА', r.status === 403, JSON.stringify(r.body));
}

// ---------- подпись с тестовой сети на настоящей ----------
{
  const o = { action:'set', m: seller.address, k:4, net:'bnbTestnet', c:'USDT', a:'1000',
              i:'', o:'', h: invId(), ts: Math.floor(Date.now()/1000) };
  o.sig = await seller.signMessage(signedText(o));
  o.net = 'bnb';                                       // переклеиваем на настоящую сеть
  const r = await post(env, o);
  t('ПОДПИСЬ ИЗ ТЕСТОВОЙ СЕТИ НЕ РАБОТАЕТ В НАСТОЯЩЕЙ', r.status === 403, JSON.stringify(r.body));
}

// ---------- старое время ----------
{
  const body = await signed(seller, { k: 5, ts: Math.floor(Date.now()/1000) - 3600 });
  const r = await post(env, body);
  t('ЧАСОВОЙ ДАВНОСТИ ПОДПИСЬ ОТВЕРГНУТА', r.status === 400, JSON.stringify(r.body));
}

// ---------- повтор старой суммы поверх новой ----------
{
  const now = Math.floor(Date.now() / 1000);
  const старая = await signed(seller, { k: 6, a: '10', ts: now - 30 });
  const новая  = await signed(seller, { k: 6, a: '990', ts: now });
  t('сначала старая прошла', (await post(env, старая)).status === 200);
  t('потом новая прошла',    (await post(env, новая)).status === 200);
  const r = await post(env, старая);                   // тот же подписанный текст ещё раз
  t('ПОВТОР СТАРОЙ СУММЫ ПОВЕРХ НОВОЙ ОТВЕРГНУТ', r.status === 409, JSON.stringify(r.body));
  const g = await get(env, { m: seller.address, k: 6, net: 'bnb' });
  t('на кассе осталась новая сумма', g.body.amount === '990', g.body.amount);
}

// ---------- перевод строки в названии товара ----------
{
  const body = await signed(seller, { k: 7, i: 'кофе\namount: 0.01' });
  const r = await post(env, body);
  t('ПЕРЕВОД СТРОКИ В НАЗВАНИИ ТОВАРА ОТВЕРГНУТ', r.status === 400, JSON.stringify(r.body));
}

// ---------- мусор на входе ----------
{
  t('кривой адрес отвергнут',   (await post(env, { m:'0xкриво', k:1, ts:1 })).status === 400);
  t('номер кассы 0 отвергнут',  (await post(env, { m: seller.address, k:0, ts:1 })).status === 400);
  t('номер кассы 500 отвергнут',(await post(env, { m: seller.address, k:500, ts:1 })).status === 400);
  t('отрицательная сумма отвергнута',
    (await post(env, await signed(seller, { k:8, a:'-5' }))).status === 400);
  t('нулевая сумма отвергнута',
    (await post(env, await signed(seller, { k:8, a:'0' }))).status === 400);
  t('неизвестная валюта отвергнута',
    (await post(env, await signed(seller, { k:8, c:'DOGE' }))).status === 400);
  const g = await get(env, { m: 'не-адрес', k: 1 });
  t('чтение по кривому адресу отвергнуто', g.status === 400);
}

// ---------- снять сумму ----------
{
  const body = await signed(seller, { k: 9 });
  await post(env, body);
  const clear = await signed(seller, { action:'clear', k: 9, c:'', a:'', i:'', o:'', h:'',
                                       ts: Math.floor(Date.now()/1000) + 1 });
  const r = await post(env, clear);
  t('продавец снимает сумму', r.status === 200 && r.body.cleared === true, JSON.stringify(r.body));
  const g = await get(env, { m: seller.address, k: 9, net: 'bnb' });
  t('касса снова пуста', g.body.empty === true);
}

// ---------- просроченная сумма не показывается ----------
{
  const key = 'till:bnb:' + seller.address.toLowerCase() + ':10';
  await env.TILL.put(key, JSON.stringify({ amount:'777', cur:'USDT', item:'', order:'',
    h: invId(), setAt: 1, expiresAt: Math.floor(Date.now()/1000) - 5, ts: 1 }), {});
  const g = await get(env, { m: seller.address, k: 10, net: 'bnb' });
  t('ПРОСРОЧЕННАЯ СУММА НЕ ПОКАЗЫВАЕТСЯ', g.body.empty === true, JSON.stringify(g.body));
}

// ---------- узел молчит ----------
{
  nodeDead = true;
  const r = await post(env, await signed(seller, { k: 11 }));
  t('МОЛЧАЩИЙ УЗЕЛ — ЭТО ОТКАЗ, А НЕ РАЗРЕШЕНИЕ', r.status === 503, JSON.stringify(r.body));
  const g = await get(env, { m: seller.address, k: 11, net: 'bnb', chain: '1' });
  t('а чтение при молчащем узле просто говорит «пусто»', g.body.empty === true);
  nodeDead = false;
}

// ---------- хранилище не подключено ----------
{
  const r = await post({}, await signed(seller, { k: 12 }));
  t('без подключённого хранилища сказано прямо', r.status === 503 && r.body.noStore === true);
  const g = await get({}, { m: seller.address, k: 12, net: 'bnb' });
  t('и чтение не падает, а отвечает «пусто»', g.status === 200 && g.body.empty === true);
}

// ---------- чтение не ходит к узлу без спроса ----------
{
  const before = nodeCalls;
  await get(env, { m: seller.address, k: 40, net: 'bnb' });
  t('обычное чтение УЗЕЛ НЕ ДЁРГАЕТ', nodeCalls === before, 'вызовов: ' + (nodeCalls - before));
  await get(env, { m: seller.address, k: 40, net: 'bnb', chain: '1' });
  t('а с явной просьбой — дёргает', nodeCalls > before);
}

console.log('\n--- ' + ok + ' из ' + (ok + bad) + ' ---');
process.exit(bad ? 1 : 0);
