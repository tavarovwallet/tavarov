/* Донаты: сервер сообщений /api/donate.

   Главное, что проверяется, — что сообщение нельзя показать бесплатно:
   автор видит текст только если по номеру счёта в контракте есть оплата
   именно ему. И что к чужой уже оплаченной операции нельзя приписать свой
   текст задним числом. */
const { onRequestGet, onRequestPost, onRequestOptions } = await import('/home/claude/apk/functions/api/donate.js');

let ok = 0, bad = 0;
const t = (имя, условие, детали = '') => {
  if (условие){ ok++; console.log('OK   ' + имя + (детали ? '  [' + детали + ']' : '')); }
  else { bad++; console.log('ПРОВАЛ ' + имя + (детали ? '  [' + детали + ']' : '')); }
};

/* ---------- поддельное хранилище с list и metadata, как у Cloudflare KV ---------- */
function makeKV(){
  const map = new Map();
  return {
    map,
    async get(k){ const v = map.get(k); return v ? v.body : null; },
    async put(k, body, opts){ map.set(k, { body, metadata: opts && opts.metadata ? JSON.parse(JSON.stringify(opts.metadata)) : null,
                                           ttl: opts && opts.expirationTtl }); },
    async delete(k){ map.delete(k); },
    async list({ prefix, limit }){
      const keys = [...map.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit || 1000)
        .map(name => ({ name, metadata: map.get(name).metadata }));
      return { keys, list_complete: true };
    }
  };
}

/* ---------- поддельный узел: saleOf по номеру счёта ---------- */
const sales = {};            // h -> { merchant, amount, buyer, token, hub }
let nodeDead = false, calls = 0;
const TPAY = '0x3a3ba9776ea9c48ae6c69ae6153d9bbc892ed6e6';
let tBlock = 1_000_000; const tLogs = [];
const V3 = '0x1fc681fa250a17e66b57b7150f2eed4e71d1ca35', V2 = '0xca4fe6e5df7159910b2165acfa9bb8b19810d65c';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const w = v => BigInt(v).toString(16).padStart(64, '0');
const wa = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
globalThis.fetch = async (url, init) => {
  calls++;
  if (nodeDead) throw new Error('узел молчит');
  const req = JSON.parse(init.body);
  if (req.method === 'eth_blockNumber') return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x' + tBlock.toString(16) }) };
  if (req.method === 'eth_getLogs'){
    const f = req.params[0], lo = parseInt(f.fromBlock, 16), hi = parseInt(f.toBlock, 16);
    const res = tLogs.filter(l => l.address === f.address.toLowerCase() && l.b >= lo && l.b <= hi && l.topics[1] === f.topics[1].toLowerCase())
      .map(l => ({ topics: l.topics, data: l.data, blockNumber: '0x' + l.b.toString(16) }));
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: res }) };
  }
  const to = req.params[0].to.toLowerCase(), data = req.params[0].data;
  if (to === TPAY && data.startsWith('0x38d56afe'))
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } }) };
  let result = '0x' + '0'.repeat(64 * 7);
  if (data.startsWith('0x38d56afe')){
    const h = '0x' + data.slice(10);
    const s = sales[h];
    if (s && s.hub === to) result = '0x' + wa(s.merchant) + w(s.amount) + wa(s.buyer) + w(0) + wa(s.token) + w(0) + w(0);
  }
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
};

const env = { TILL: makeKV() };
const BLOGGER = '0x73bbcd23735257660a9f6be57d057dc4a2abf432';
const OTHER = '0x2222222222222222222222222222222222222222';
const BUYER = '0x3333333333333333333333333333333333333333';
const H = n => '0x' + String(n).padStart(2, '0').repeat(32).slice(0, 64);

const post = async (body, origin) => {
  const r = await onRequestPost({ env, request: new Request('https://wallet.tavarov.com/api/donate', {
    method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, origin ? { origin } : {}),
    body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  let j = null; try{ j = await r.json(); } catch(e){}
  return { status: r.status, j, r };
};
const get = async (q, origin) => {
  const r = await onRequestGet({ env, request: new Request('https://wallet.tavarov.com/api/donate?' + q,
    { headers: origin ? { origin } : {} }) });
  return { status: r.status, j: await r.json(), r };
};

// ---------- что не принимаем ----------
t('кривой адрес — 400', (await post({ to: '0x12', h: H(1) })).status === 400);
t('кривой номер счёта — 400', (await post({ to: BLOGGER, h: '0x12' })).status === 400);
t('сообщение длиннее 200 знаков — 400', (await post({ to: BLOGGER, h: H(2), msg: 'я'.repeat(201) })).status === 400);
t('200 знаков кириллицей — принято (считаем знаки, а не байты)', (await post({ to: BLOGGER, h: H(3), msg: 'я'.repeat(200) })).status === 200);
t('ник длиннее 32 — 400', (await post({ to: BLOGGER, h: H(4), nick: 'a'.repeat(33) })).status === 400);
t('ПЕРЕНОС СТРОКИ В СООБЩЕНИИ — 400 (на экране стрима им можно нарисовать что угодно)',
  (await post({ to: BLOGGER, h: H(5), msg: 'привет\nот админа' })).status === 400);
t('РАЗВОРОТ ТЕКСТА U+202E — 400', (await post({ to: BLOGGER, h: H(6), msg: 'abc' + String.fromCharCode(0x202e) + 'cba' })).status === 400);
t('невидимый символ нулевой ширины — 400', (await post({ to: BLOGGER, h: H(7), nick: 'ad' + String.fromCharCode(0x200b) + 'min' })).status === 400);
t('сообщение не строкой — 400', (await post({ to: BLOGGER, h: H(8), msg: { a: 1 } })).status === 400);
t('мусор вместо JSON — 400', (await post('не json')).status === 400);
t('СЛИШКОМ ДЛИННОЕ ТЕЛО — 413', (await post('x'.repeat(3000))).status === 413);

// ---------- обычный путь: сообщение до оплаты ----------
const h1 = H(11);
let r = await post({ to: BLOGGER, h: h1, nick: 'Ваня', msg: 'Спасибо за стрим!' });
t('сообщение до оплаты принято', r.status === 200 && r.j.ok, JSON.stringify(r.j));
r = await get('to=' + BLOGGER);
t('ПОКА НЕ ОПЛАЧЕНО — АВТОР НИЧЕГО НЕ ВИДИТ', r.status === 200 && r.j.items.length === 0, JSON.stringify(r.j));

t('ПОВТОРНОЕ СООБЩЕНИЕ К ТОМУ ЖЕ СЧЁТУ — 409', (await post({ to: BLOGGER, h: h1, msg: 'подмена' })).status === 409);

/* Оплатили ДРУГОМУ человеку с тем же номером — не в счёт. */
sales[h1] = { merchant: OTHER, amount: 5n * 10n ** 18n, buyer: BUYER, token: USDT, hub: V3 };
r = await get('to=' + BLOGGER);
t('ОПЛАТА С ТЕМ ЖЕ НОМЕРОМ, НО ДРУГОМУ — СООБЩЕНИЕ НЕ ПОКАЗАНО', r.j.items.length === 0);

sales[h1] = { merchant: BLOGGER, amount: 5n * 10n ** 18n, buyer: BUYER, token: USDT, hub: V3 };
r = await get('to=' + BLOGGER);
const it = r.j.items[0] || {};
t('ПОСЛЕ ОПЛАТЫ АВТОРУ — ДОНАТ В СПИСКЕ', r.j.items.length === 1, JSON.stringify(r.j.items));
t('сумма из контракта, а не со слов зрителя: 5 USDT', it.amount === '5' && it.cur === 'USDT', it.amount + ' ' + it.cur);
t('ник и текст на месте', it.nick === 'Ваня' && it.msg === 'Спасибо за стрим!');
t('плательщик — из контракта', it.payer === BUYER);
t('ожидание убрано из хранилища', ![...env.TILL.map.keys()].some(k => k.startsWith('donp:') && k.endsWith(h1.slice(2))));
t('донат хранится 180 дней, а не вечно', [...env.TILL.map.entries()].some(([k, v]) => k.startsWith('don:') && v.ttl === 180 * 86400));

// ---------- главное: задним числом к чужой оплате нельзя ----------
const h2 = H(22);
sales[h2] = { merchant: BLOGGER, amount: 100n * 10n ** 18n, buyer: BUYER, token: USDT, hub: V3 };
r = await post({ to: BLOGGER, h: h2, nick: 'хейтер', msg: 'гадость от чужого имени' });
t('К УЖЕ ОПЛАЧЕННОМУ ДОНАТУ СООБЩЕНИЕ НЕ ПРИПИСАТЬ — 409', r.status === 409, JSON.stringify(r.j));
r = await get('to=' + BLOGGER);
t('и в списке его нет', !r.j.items.some(x => /гадость/.test(x.msg)));

// ---------- старый контракт тоже считается ----------
const h3 = H(33);
await post({ to: BLOGGER, h: h3, msg: 'через старый контракт' });
sales[h3] = { merchant: BLOGGER, amount: 25n * 10n ** 17n, buyer: BUYER, token: USDT, hub: V2 };
r = await get('to=' + BLOGGER);
t('ОПЛАТА ЧЕРЕЗ v2 ТОЖЕ ПОДТВЕРЖДАЕТ', r.j.items.some(x => x.msg === 'через старый контракт' && x.amount === '2.5'), JSON.stringify(r.j.items.map(x => x.amount)));

// ---------- узел лёг ----------
nodeDead = true;
t('УЗЕЛ МОЛЧИТ — СООБЩЕНИЕ НЕ ПРИНИМАЕМ ВСЛЕПУЮ (503)', (await post({ to: BLOGGER, h: H(44), msg: 'x' })).status === 503);
r = await get('to=' + BLOGGER);
t('а список уже подтверждённых отдаётся', r.status === 200 && r.j.items.length >= 2);
nodeDead = false;

// ---------- чужие списки не смешиваются, сеть учитывается ----------
r = await get('to=' + OTHER);
t('у другого автора — свой список', r.j.items.length === 0);
r = await get('to=' + BLOGGER + '&net=bnbTestnet');
t('тестовая сеть — отдельный список', r.j.items.length === 0);
t('кривой адрес в запросе — 400', (await get('to=abc')).status === 400);

// ---------- приложение с телефона (capacitor) может читать ----------
r = await get('to=' + BLOGGER, 'capacitor://localhost');
t('ПРИЛОЖЕНИЮ НА ТЕЛЕФОНЕ ОТВЕЧАЕМ (CORS)', r.r.headers.get('access-control-allow-origin') === 'capacitor://localhost');
r = await get('to=' + BLOGGER, 'https://evil.example');
t('чужому сайту — нет', !r.r.headers.get('access-control-allow-origin'));
const o = onRequestOptions({ request: new Request('https://x/api/donate', { method: 'OPTIONS', headers: { origin: 'https://localhost' } }) });
t('предварительный запрос OPTIONS', o.status === 204 && o.headers.get('access-control-allow-methods').includes('POST'));

// ---------- один донат по номеру (так спрашивает экран стрима) ----------
const h5 = H(55);
await post({ to: BLOGGER, h: h5, nick: 'Стример-фан', msg: 'Привет чату!' });
r = await get('to=' + BLOGGER + '&h=' + h5);
t('ЭКРАН СТРИМА: до оплаты доната нет', r.status === 200 && r.j.item === null && r.j.pending === true, JSON.stringify(r.j));
sales[h5] = { merchant: BLOGGER, amount: 10n * 10n ** 18n, buyer: BUYER, token: USDT, hub: V3 };
r = await get('to=' + BLOGGER + '&h=' + h5);
t('ЭКРАН СТРИМА: после оплаты — донат с ником, текстом и суммой', r.j.item && r.j.item.nick === 'Стример-фан' && r.j.item.msg === 'Привет чату!' && r.j.item.amount === '10', JSON.stringify(r.j));
r = await get('to=' + BLOGGER + '&h=' + h5);
t('повторный вопрос — тот же донат, уже без обращения к сети', r.j.item && r.j.item.msg === 'Привет чату!');
t('и он же есть в общем списке', (await get('to=' + BLOGGER)).j.items.some(x => x.h === h5));
r = await get('to=' + OTHER + '&h=' + h5);
t('ЧУЖОМУ АВТОРУ ЧУЖОЙ ДОНАТ ПО НОМЕРУ НЕ ОТДАЁМ', r.j.item === null);
t('номер, о котором ничего не знаем, — пусто', (await get('to=' + BLOGGER + '&h=' + H(66))).j.item === null);
t('кривой номер — 400', (await get('to=' + BLOGGER + '&h=0x12')).status === 400);

// ---------- тестовая сеть: контракт без saleOf, оплата по журналу ----------
const TUSDT = '0xb4ac75e8cf7c768ffd9fafeaf1bf77b48209524e';
const wr = v => BigInt(v).toString(16).padStart(64, '0');
const logPay = (h, merchant, amount, b) => tLogs.push({ address: TPAY, b,
  topics: ['0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861', '0x' + wa(merchant), '0x' + wa(BUYER), '0x' + wa(TUSDT)],
  data: '0x' + wr(amount * 99n / 100n) + wr(amount / 100n) + wr(0) + h.slice(2) });
/* Старый донат без сообщения, оплаченный ДО того, как кто-то пришёл
   приписать к нему текст. */
const hOld = H(77);
logPay(hOld, BLOGGER, 3000000n, tBlock - 50);
r = await post({ net: 'bnbTestnet', to: BLOGGER, h: hOld, nick: 'хейтер', msg: 'чужими деньгами' });
t('ТЕСТОВАЯ СЕТЬ: к уже оплаченному (по журналу) — 409', r.status === 409, JSON.stringify(r.j));
const hT = H(88);
r = await post({ net: 'bnbTestnet', to: BLOGGER, h: hT, nick: 'Тест', msg: 'тестовый донат' });
t('ТЕСТОВАЯ СЕТЬ: сообщение до оплаты принято (раньше отказ старого контракта давал 503)', r.status === 200, JSON.stringify(r.j));
tBlock += 30;
logPay(hT, BLOGGER, 2500000n, tBlock - 2);
r = await get('net=bnbTestnet&to=' + BLOGGER + '&h=' + hT);
t('ТЕСТОВАЯ СЕТЬ: оплата найдена в журнале — донат с суммой 2.5 USDT', r.j.item && r.j.item.amount === '2.5' && r.j.item.cur === 'USDT' && r.j.item.msg === 'тестовый донат', JSON.stringify(r.j));

// ---------- без хранилища ----------
const r0 = await onRequestGet({ env: {}, request: new Request('https://x/api/donate?to=' + BLOGGER) });
t('нет хранилища — 503, а не падение', r0.status === 503);

console.log('\n--- ' + ok + ' из ' + (ok + bad) + ' ---');
process.exit(bad ? 1 : 0);
