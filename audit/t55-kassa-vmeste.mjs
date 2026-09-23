/* Касса и сервер должны понимать друг друга дословно.

   Подписывается ТЕКСТ. Кошелёк складывает его у себя, сервер складывает
   заново у себя и проверяет подпись — если два этих текста разойдутся хоть
   на пробел, подпись не сойдётся никогда. Снаружи это выглядит не как
   ошибка в коде, а как «наклейка почему-то не работает»: касса говорит, что
   отправила сумму, покупатель у прилавка её не видит, и оба правы.

   Держать одинаковыми два куска кода в двух разных файлах человеческой
   дисциплиной нельзя. Поэтому текст кассы берётся прямо из index.html —
   не переписанный сюда, а вырезанный из живого файла, — и проверяется
   настоящим /api/till. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');

const { onRequestGet, onRequestPost } = await import('/home/claude/apk/functions/api/till.js');

let ok = 0, bad = 0;
const t = (имя, условие, детали = '') => {
  if (условие) { ok++; console.log('OK   ' + имя + (детали ? '  [' + детали + ']' : '')); }
  else { bad++; console.log('ПРОВАЛ ' + имя + (детали ? '  [' + детали + ']' : '')); }
};

// ---------- достаём функцию кассы из живого файла ----------
const app = fs.readFileSync('/home/claude/apk/www/index.html', 'utf8');
const m = app.match(/function tillSignedText\(o\)\{[\s\S]*?\n\}/);
t('в кошельке нашлась функция подписи суммы', !!m);
if (!m){ console.log('\n--- ' + ok + ' из ' + (ok + bad) + ' ---'); process.exit(1); }
const tillSignedText = new Function('return (' + m[0].replace(/^function/, 'function') + ')')();

// ---------- поддельные хранилище и узел ----------
const map = new Map();
const env = { TILL: {
  async get(k){ const v = map.get(k); return v === undefined ? null : v; },
  async put(k, v){ map.set(k, v); },
  async delete(k){ map.delete(k); }
} };

globalThis.fetch = async (url, init) => {
  const req = JSON.parse(init.body);
  const d = req.params[0].data.replace(/^0x/, '');
  let result = '0x' + '0'.repeat(64);
  if ((req.params[0].to || '').toLowerCase() === '0x0000000000000000000000000000000000000001'){
    try{
      const addr = E.utils.recoverAddress('0x' + d.slice(0, 64), {
        r:'0x' + d.slice(128, 192), s:'0x' + d.slice(192, 256),
        v: parseInt(d.slice(64, 128), 16) });
      result = '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
    } catch(e){}
  }
  return { ok: true, json: async () => ({ jsonrpc:'2.0', id:1, result }) };
};

const post = async body => {
  const r = await onRequestPost({ env, request: new Request('https://wallet.tavarov.com/api/till',
    { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
};
const get = async q => {
  const r = await onRequestGet({ env,
    request: new Request('https://wallet.tavarov.com/api/till?' + new URLSearchParams(q)) });
  return await r.json();
};

const invId = () => '0x' + [...crypto.getRandomValues(new Uint8Array(32))]
  .map(x => x.toString(16).padStart(2, '0')).join('');

// =====================================================================
const seller = E.Wallet.createRandom();

/* Ровно то, что делает касса в кошельке: те же поля, тот же порядок. */
async function каксКассы(over){
  const fields = Object.assign({
    action:'set', m: seller.address, k: 1, net:'bnb',
    c:'USDT', a:'250.5', i:'Латте', o:'', h: invId(),
    ts: Math.floor(Date.now() / 1000)
  }, over || {});
  const sig = await seller.signMessage(tillSignedText(fields));
  return Object.assign({}, fields, { sig });
}

{
  const r = await post(await каксКассы());
  t('ПОДПИСЬ КОШЕЛЬКА СХОДИТСЯ НА СЕРВЕРЕ', r.status === 200 && r.body.ok === true,
    JSON.stringify(r.body));
  const g = await get({ m: seller.address, k: 1, net: 'bnb' });
  t('и сумма легла на кассу', g.amount === '250.5' && g.cur === 'USDT', JSON.stringify(g));
  t('вместе с названием товара', g.item === 'Латте');
}

/* Кириллица в названии — обычное дело у нас, и ровно на ней ломаются
   подписи: длину сообщения EIP-191 считает в БАЙТАХ, а не в буквах. */
{
  const r = await post(await каксКассы({ k: 2, i: 'Кофе с молоком и корицей ☕' }));
  t('КИРИЛЛИЦА И ЗНАЧКИ В НАЗВАНИИ НЕ ЛОМАЮТ ПОДПИСЬ', r.status === 200, JSON.stringify(r.body));
  const g = await get({ m: seller.address, k: 2, net: 'bnb' });
  t('и доезжают до покупателя целыми', g.item === 'Кофе с молоком и корицей ☕', g.item);
}

/* Снятие суммы — тот же текст, другое действие. */
{
  const clear = await каксКассы({ action:'clear', k: 1, c:'', a:'', i:'', o:'', h:'',
                                  ts: Math.floor(Date.now() / 1000) + 2 });
  const r = await post(clear);
  t('и СНЯТЬ сумму касса тоже умеет', r.status === 200 && r.body.cleared === true, JSON.stringify(r.body));
  const g = await get({ m: seller.address, k: 1, net: 'bnb' });
  t('касса опустела', g.empty === true);
}

/* Тестовая сеть — отдельная полка: сумма из неё не должна оказаться на
   настоящей наклейке. */
{
  await post(await каксКассы({ k: 7, net:'bnbTestnet', a:'1' }));
  const нет = await get({ m: seller.address, k: 7, net: 'bnb' });
  t('СУММА ИЗ ТЕСТОВОЙ СЕТИ НЕ ВИДНА В НАСТОЯЩЕЙ', нет.empty === true, JSON.stringify(нет));
  const есть = await get({ m: seller.address, k: 7, net: 'bnbTestnet' });
  t('а в своей — видна', есть.amount === '1');
}

/* Мелочи, на которых легко разойтись: номер кассы как строка, лишние
   пробелы, дробная сумма без нуля. */
{
  const r = await post(await каксКассы({ k: 3, a: '0.01' }));
  t('копеечная сумма проходит', r.status === 200, JSON.stringify(r.body));
  const g = await get({ m: seller.address, k: 3, net: 'bnb' });
  t('и не округляется по дороге', g.amount === '0.01', g.amount);
}
{
  const r = await post(await каксКассы({ k: 9, a: '1000000.123456789012345678' }));
  t('ВОСЕМНАДЦАТЬ ЗНАКОВ ПОСЛЕ ТОЧКИ ПЕРЕЖИВАЮТ ДОРОГУ', r.status === 200, JSON.stringify(r.body));
  const g = await get({ m: seller.address, k: 9, net: 'bnb' });
  t('целиком, до последней цифры', g.amount === '1000000.123456789012345678', g.amount);
}

/* И главное про номер кассы: две кассы одного продавца не должны мешать
   друг другу. */
{
  await post(await каксКассы({ k: 4, a: '100' }));
  await post(await каксКассы({ k: 5, a: '200' }));
  const a = await get({ m: seller.address, k: 4, net: 'bnb' });
  const b = await get({ m: seller.address, k: 5, net: 'bnb' });
  t('ДВЕ КАССЫ НЕ ПУТАЮТСЯ МЕЖДУ СОБОЙ', a.amount === '100' && b.amount === '200',
    a.amount + ' и ' + b.amount);
}

console.log('\n--- ' + ok + ' из ' + (ok + bad) + ' ---');
process.exit(bad ? 1 : 0);
