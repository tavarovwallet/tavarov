/* Tavarov Pay API v1: /api/v1/*.

   Проверяется то, что ломается тихо и стоит денег:
   — можно ли войти в кабинет чужим кошельком;
   — можно ли чужим ключом увидеть чужие счета;
   — скажет ли API «оплачено» на недоплату, чужую валюту, чужого продавца,
     возврат;
   — подписан ли вебхук так, что магазин отличит нас от подделки;
   — дойдёт ли вебхук, если сайт магазина лёг, и не придёт ли он дважды;
   — не лежит ли где-нибудь сам ключ в открытом виде. */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const API = await import('/home/claude/apk/functions/api/v1/[[path]].js');

let ok = 0, bad = 0;
const t = (имя, условие, детали = '') => {
  if (условие){ ok++; console.log('OK   ' + имя + (детали ? '  [' + детали + ']' : '')); }
  else { bad++; console.log('ПРОВАЛ ' + имя + (детали ? '  [' + детали + ']' : '')); }
};

/* ---------- часы ---------- */
const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift * 1000;
const now = () => Math.floor(Date.now() / 1000);

/* ---------- хранилище ---------- */
let puts = 0;
function makeKV(){
  const map = new Map();
  return { map,
    async get(k){ const v = map.get(k); if (!v) return null; if (v.until && v.until < Date.now()){ map.delete(k); return null; } return v.body; },
    async put(k, body, o){ puts++; map.set(k, { body, until: o && o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }); },
    async delete(k){ map.delete(k); } };
}
const env = { TILL: makeKV(), V1_NO_THROTTLE: 1 };

/* ---------- сеть ---------- */
const V3 = '0x1fc681fa250a17e66b57b7150f2eed4e71d1ca35';
const TPAY = '0x3a3ba9776ea9c48ae6c69ae6153d9bbc892ed6e6';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const USDC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const PAID_TOPIC = '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861';
const w = v => BigInt(v).toString(16).padStart(64, '0');
const wa = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const sales = {};     // h -> {merchant, amount, buyer, refunded, token, hub}
const logs = [];      // события Paid
let block = 5_000_000, nodeDead = false, liar = false;
const hooks = [];     // что пришло «магазину»
let hookCode = 200, hookDown = false;

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://shop.example')){
    if (hookDown) throw new Error('магазин лежит');
    hooks.push({ url: u, headers: init.headers, body: init.body });
    return { status: hookCode, ok: hookCode < 300 };
  }
  if (nodeDead) throw new Error('узел молчит');
  const req = JSON.parse(init.body);
  let result = '0x';
  if (req.method === 'eth_blockNumber') result = '0x' + block.toString(16);
  else if (req.method === 'eth_getLogs'){
    const f = req.params[0];
    const from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
    result = logs.filter(l => l.address === f.address.toLowerCase() && l.b >= from && l.b <= to &&
      (f.topics || []).every((x, i) => !x || l.topics[i] === x.toLowerCase()))
      .map(l => ({ address: l.address, topics: l.topics, data: l.data, transactionHash: l.tx, blockNumber: '0x' + l.b.toString(16) }));
  } else if (req.method === 'eth_call'){
    const to = req.params[0].to.toLowerCase(), data = req.params[0].data.replace(/^0x/, '');
    if (to === '0x0000000000000000000000000000000000000001'){
      try{
        const addr = E.utils.recoverAddress('0x' + data.slice(0, 64), { r: '0x' + data.slice(128, 192), s: '0x' + data.slice(192, 256), v: parseInt(data.slice(64, 128), 16) });
        result = '0x' + '0'.repeat(24) + (liar && u.includes('dataseed.binance') ? '1'.repeat(40) : addr.slice(2).toLowerCase());
      } catch(e){ result = '0x' + '0'.repeat(64); }
    } else if (data.startsWith('38d56afe') && to === TPAY){
      /* контракт тестовой сети — первой версии: saleOf в нём нет */
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } }) };
    } else if (data.startsWith('38d56afe')){
      const s = sales['0x' + data.slice(8)];
      result = s && s.hub === to ? '0x' + wa(s.merchant) + w(s.amount) + wa(s.buyer) + w(s.refunded || 0) + wa(s.token) + w(0) + w(0)
                                 : '0x' + '0'.repeat(64 * 7);
    }
  }
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
};

function pay(h, merchant, amount, token, opts){
  const o = opts || {};
  const hub = o.hub || V3;
  sales[h] = { merchant, amount, buyer: o.buyer || BUYER, token, hub, refunded: 0n };
  const tx = '0x' + crypto.randomBytes(32).toString('hex');
  /* Контракт второй оплаты с тем же номером не примет — событие по номеру
     в сети одно. Прошлые «попытки» теста стираем. */
  for (let i = logs.length - 1; i >= 0; i--) if (logs[i].data.endsWith(h.slice(2))) logs.splice(i, 1);
  logs.push({ address: hub, b: block - 20, tx,
    topics: [PAID_TOPIC, '0x' + wa(merchant), '0x' + wa(o.buyer || BUYER), '0x' + wa(token)],
    data: '0x' + w(amount * 99n / 100n) + w(amount / 100n) + w(0) + h.slice(2) });
  return tx;
}

/* ---------- кошельки ---------- */
const shop = E.Wallet.createRandom();
const other = E.Wallet.createRandom();
const SHOP = shop.address.toLowerCase(), OTHER = other.address.toLowerCase();
const BUYER = '0x3333333333333333333333333333333333333333';

const waits = [];
const call = async (method, path, body, auth, raw) => {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  const r = await API.handle(new Request('https://wallet.tavarov.com/api/v1' + path, {
    method, headers, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)) }), env, p => waits.push(p));
  await Promise.all(waits.splice(0));
  let j = null; try{ j = await r.json(); } catch(e){}
  return { status: r.status, j, r };
};
const signLogin = async (wallet, addr, ts) => wallet.signMessage(API.loginText(addr || wallet.address, ts === undefined ? now() : ts));
const login = async wallet => (await call('POST', '/dev/login', { address: wallet.address, ts: now(), sig: await signLogin(wallet) })).j.session;

// ---------- основа ----------
let r = await call('GET', '');
t('корень отвечает, где документация', r.status === 200 && r.j.docs === 'https://wallet.tavarov.com/dev');
r = await API.handle(new Request('https://wallet.tavarov.com/api/v1/invoices', { method: 'POST' }), {});
t('нет хранилища — 503, а не падение', r.status === 503);
t('несуществующий метод — 404 с понятной ошибкой', (await call('GET', '/nope')).j.error.code === 'not_found');

// ---------- вход в кабинет ----------
t('ВХОД: чужая подпись под своим адресом — 403',
  (await call('POST', '/dev/login', { address: shop.address, ts: now(), sig: await other.signMessage(API.loginText(shop.address, now())) })).status === 403);
t('ВХОД: подпись под другим временем — 403',
  (await call('POST', '/dev/login', { address: shop.address, ts: now(), sig: await signLogin(shop, shop.address, now() - 1) })).status === 403);
t('ВХОД: подпись старше пяти минут — 400',
  (await call('POST', '/dev/login', { address: shop.address, ts: now() - 400, sig: await signLogin(shop, shop.address, now() - 400) })).status === 400);
t('ВХОД: кривая подпись — 400', (await call('POST', '/dev/login', { address: shop.address, ts: now(), sig: '0x12' })).status === 400);
liar = true;
t('ВХОД: один узел врёт — не впускаем',
  (await call('POST', '/dev/login', { address: shop.address, ts: now(), sig: await signLogin(shop) })).status === 403);
liar = false;
nodeDead = true;
t('ВХОД: сеть молчит — 503, а не «входите»',
  (await call('POST', '/dev/login', { address: shop.address, ts: now(), sig: await signLogin(shop) })).status === 503);
nodeDead = false;
let S = 'Session ' + await login(shop);
t('ВХОД своей подписью — выдана сессия', /^Session sess_/.test(S));
t('без сессии кабинет закрыт — 401', (await call('GET', '/dev/account')).status === 401);
t('поддельная сессия — 401', (await call('GET', '/dev/account', undefined, 'Session sess_' + 'A'.repeat(43))).status === 401);
r = await call('GET', '/dev/account', undefined, S);
t('кабинет: ключей и вебхука ещё нет', r.status === 200 && r.j.wallet === SHOP && !r.j.keys.live && !r.j.webhook);

// ---------- ключи ----------
r = await call('POST', '/dev/keys', { mode: 'live' }, S);
const LIVE = r.j.new_key;
t('выдан боевой ключ tp_live_…', /^tp_live_[A-Za-z0-9_-]{43}$/.test(LIVE || ''), LIVE && LIVE.slice(0, 12));
t('в кабинете видны только последние 4 знака', r.j.keys.live.tail === LIVE.slice(-4));
const TEST = (await call('POST', '/dev/keys', { mode: 'test' }, S)).j.new_key;
t('выдан тестовый ключ tp_test_…', /^tp_test_/.test(TEST || ''));
const dump = [...env.TILL.map.values()].map(v => v.body).join('\n');
t('САМ КЛЮЧ НИГДЕ В ХРАНИЛИЩЕ НЕ ЛЕЖИТ', !dump.includes(LIVE) && !dump.includes(TEST) && !dump.includes(LIVE.slice(8)));
t('повторный запрос кабинета ключ не показывает', !('new_key' in (await call('GET', '/dev/account', undefined, S)).j));
r = await call('GET', '/me', undefined, 'Bearer ' + LIVE);
t('/me по боевому ключу: сеть bnb, USDT и USDC', r.j.network === 'bnb' && r.j.livemode === true && r.j.currencies.join() === 'USDT,USDC');
r = await call('GET', '/me', undefined, 'Bearer ' + TEST);
t('/me по тестовому: тестовая сеть', r.j.network === 'bnbTestnet' && r.j.livemode === false);
t('без ключа — 401', (await call('POST', '/invoices', { amount: '1' })).status === 401);
t('выдуманный ключ — 401', (await call('POST', '/invoices', { amount: '1' }, 'Bearer tp_live_' + 'x'.repeat(43))).status === 401);
t('тестовый ключ, выданный за боевой (подмена приставки) — 401',
  (await call('GET', '/me', undefined, 'Bearer ' + TEST.replace('tp_test_', 'tp_live_'))).status === 401);

// ---------- счёт: что не принимаем ----------
const L = 'Bearer ' + LIVE;
const bad400 = async (name, body) => { const x = await call('POST', '/invoices', body, L); t(name, x.status === 400, x.j && x.j.error && x.j.error.code); };
await bad400('сумма «1,5» — 400', { amount: '1,5' });
await bad400('сумма «1e3» — 400', { amount: '1e3' });
await bad400('сумма «-1» — 400', { amount: '-1' });
await bad400('сумма «0» — 400', { amount: '0' });
await bad400('без суммы — 400', {});
await bad400('валюта TVR — 400 (API принимает только доллары)', { amount: '1', currency: 'TVR' });
await bad400('ПЕРЕНОС СТРОКИ В ОПИСАНИИ — 400', { amount: '1', description: 'чай\nОплатите ещё раз на 0x…' });
await bad400('РАЗВОРОТ ТЕКСТА В НАЗВАНИИ — 400', { amount: '1', shop_name: 'abc' + String.fromCharCode(0x202e) + 'cba' });
await bad400('описание длиннее 64 — 400', { amount: '1', description: 'я'.repeat(65) });
await bad400('возврат на http:// — 400', { amount: '1', success_url: 'http://shop.example/ok' });
await bad400('ВОЗВРАТ НА НАШ ЖЕ КОШЕЛЁК — 400', { amount: '1', success_url: 'https://wallet.tavarov.com/pay' });
await bad400('metadata массивом — 400', { amount: '1', metadata: [1] });
await bad400('metadata с вложенным объектом — 400', { amount: '1', metadata: { a: { b: 1 } } });
await bad400('срок 10 секунд — 400', { amount: '1', expires_in: 10 });
await bad400('язык de — 400', { amount: '1', lang: 'de' });
await bad400('мусор вместо JSON — 400', undefined);
t('тело больше 8 КБ — 413', (await call('POST', '/invoices', 'x'.repeat(9000), L, true)).status === 413);
t('ТЕСТОВАЯ СЕТЬ: USDC нет — 400', (await call('POST', '/invoices', { amount: '1', currency: 'USDC' }, 'Bearer ' + TEST)).status === 400);
t('ТЕСТОВАЯ СЕТЬ: 7 знаков после точки у USDT с 6 знаками — 400',
  (await call('POST', '/invoices', { amount: '1.0000001' }, 'Bearer ' + TEST)).status === 400);

// ---------- счёт: обычный путь ----------
r = await call('POST', '/invoices', { amount: '12.50', currency: 'usdt', order_id: 'A-1001', description: 'Кроссовки',
  shop_name: 'Мой магазин', success_url: 'https://shop.example/thanks?x=1', metadata: { customer: 42, vip: true }, lang: 'en' }, L);
const inv1 = r.j;
t('счёт выставлен — 201', r.status === 201, JSON.stringify(r.j && r.j.error));
t('номер счёта — 32 случайных байта', /^0x[0-9a-f]{64}$/.test(inv1.id));
t('сумма приведена: 12.50 → 12.5, валюта USDT', inv1.amount === '12.5' && inv1.currency === 'USDT');
t('статус pending, боевой режим, продавец — его кошелёк', inv1.status === 'pending' && inv1.livemode && inv1.merchant === SHOP);
const hashPart = inv1.payment_url.split('#p=')[1].split('&')[0];
const payload = JSON.parse(Buffer.from(hashPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
t('ССЫЛКА НА ОПЛАТУ САМОДОСТАТОЧНА: весь счёт внутри, хранилище странице не нужно',
  payload.m === SHOP && payload.a === '12.5' && payload.c === 'USDT' && payload.h === inv1.id && payload.net === 'bnb' && payload.api === 1);
t('в ссылке заказ, товар, магазин, возврат и срок', payload.o === 'A-1001' && payload.i === 'Кроссовки' && payload.n === 'Мой магазин' &&
  payload.r === 'https://shop.example/thanks?x=1' && payload.t === inv1.expires_at);
t('ссылка ведёт на /pay и несёт язык', inv1.payment_url.startsWith('https://wallet.tavarov.com/pay#p=') && inv1.payment_url.endsWith('&lang=en'));
t('срок по умолчанию — час', inv1.expires_at - inv1.created_at === 3600);
t('metadata вернулась как есть', inv1.metadata.customer === 42 && inv1.metadata.vip === true);

r = await call('POST', '/invoices', { amount: '12.5', order_id: 'A-1001' }, L);
t('ПОВТОР ТОГО ЖЕ ЗАКАЗА — тот же счёт, а не второй', r.status === 200 && r.j.id === inv1.id && r.r.headers.get('tavarov-idempotent-replay') === 'true');
r = await call('POST', '/invoices', { amount: '13', order_id: 'A-1001' }, L);
t('тот же заказ с другой суммой — 409', r.status === 409 && r.j.error.code === 'order_exists');

r = await call('GET', '/invoices/' + inv1.id, undefined, L);
t('чтение своего счёта', r.status === 200 && r.j.status === 'pending');
t('ЧУЖОЙ ТЕСТОВЫЙ КЛЮЧ ТОГО ЖЕ ПРОДАВЦА боевой счёт не видит — 404', (await call('GET', '/invoices/' + inv1.id, undefined, 'Bearer ' + TEST)).status === 404);
let S2 = 'Session ' + await login(other);
const OTHER_LIVE = (await call('POST', '/dev/keys', { mode: 'live' }, S2)).j.new_key;
t('ЧУЖОЙ ПРОДАВЕЦ СЧЁТ НЕ ВИДИТ — 404', (await call('GET', '/invoices/' + inv1.id, undefined, 'Bearer ' + OTHER_LIVE)).status === 404);
puts = 0;
await call('GET', '/invoices/' + inv1.id, undefined, L);
await call('GET', '/invoices/' + inv1.id, undefined, L);
t('ЧТЕНИЕ БЕЗ ПЕРЕМЕН НИЧЕГО НЕ ЗАПИСЫВАЕТ (бережём запас записей)', puts === 0, 'записей: ' + puts);

// ---------- вебхук ----------
t('вебхук на http:// — 400', (await call('POST', '/dev/webhook', { url: 'http://shop.example/hook' }, S)).status === 400);
t('вебхук на голый IP — 400', (await call('POST', '/dev/webhook', { url: 'https://10.0.0.1/hook' }, S)).status === 400);
t('вебхук на localhost — 400', (await call('POST', '/dev/webhook', { url: 'https://localhost/hook' }, S)).status === 400);
t('вебхук на нас же — 400', (await call('POST', '/dev/webhook', { url: 'https://wallet.tavarov.com/api/v1/cron' }, S)).status === 400);
r = await call('POST', '/dev/webhook', { url: 'https://shop.example/hook' }, S);
const SECRET = r.j.webhook && r.j.webhook.secret;
t('вебхук записан, выдан секрет whsec_', r.status === 200 && /^whsec_/.test(SECRET || ''));
r = await call('POST', '/dev/webhook', { url: 'https://shop.example/hook2' }, S);
t('смена адреса секрет не меняет', r.j.webhook.secret === SECRET);
r = await call('POST', '/dev/webhook', { url: 'https://shop.example/hook', rotate_secret: true }, S);
t('секрет меняется только по просьбе', r.j.webhook.secret !== SECRET);
const SEC = r.j.webhook.secret;
r = await call('POST', '/dev/webhook/test', {}, S);
const ping = hooks.pop();
t('проверочный вебхук дошёл', r.j.ok === true && r.j.status_code === 200 && JSON.parse(ping.body).type === 'ping');

const verify = (h, secret) => {
  const m = String(h.headers['tavarov-signature']).match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m) return false;
  const exp = crypto.createHmac('sha256', secret).update(m[1] + '.' + h.body).digest('hex');
  return exp === m[2];
};
t('подпись проверочного вебхука сходится по секрету (HMAC-SHA256)', verify(ping, SEC));
t('старым секретом подпись НЕ сходится', !verify(ping, SECRET));

// ---------- сеть: что НЕ оплата ----------
pay(inv1.id, OTHER, 125n * 10n ** 17n, USDT);
r = await call('GET', '/invoices/' + inv1.id, undefined, L);
t('ОПЛАТА С ТЕМ ЖЕ НОМЕРОМ ДРУГОМУ ПРОДАВЦУ — не оплачено', r.j.status === 'pending' && !hooks.length);
pay(inv1.id, SHOP, 12n * 10n ** 18n, USDT);
r = await call('GET', '/invoices/' + inv1.id, undefined, L);
t('НЕДОПЛАТА 12 из 12.5 — underpaid, вебхука нет', r.j.status === 'underpaid' && r.j.payment.amount === '12' && !hooks.length, r.j.status);
pay(inv1.id, SHOP, 125n * 10n ** 17n, USDC);
r = await call('GET', '/invoices/' + inv1.id, undefined, L);
t('ЧУЖАЯ ВАЛЮТА (USDC вместо USDT) — wrong_currency, вебхука нет', r.j.status === 'wrong_currency' && !hooks.length);
pay(inv1.id, SHOP, 125n * 10n ** 17n, USDT, { hub: TPAY });
r = await call('GET', '/invoices/' + inv1.id, undefined, L);
t('оплата в другом контракте (тестовой сети) боевой счёт не закрывает', r.j.status !== 'paid' || false);

// ---------- оплачено ----------
const tx1 = pay(inv1.id, SHOP, 125n * 10n ** 17n, USDT);
block += 5;
r = await call('GET', '/invoices/' + inv1.id, undefined, L);
t('ОПЛАЧЕНО: статус paid', r.j.status === 'paid', r.j.status);
t('ЧТЕНИЕ СТАТУСА МАГАЗИНОМ ВЕБХУК НЕ ШЛЁТ (иначе обработчик вебхука, спросив статус, запустил бы следующий)', hooks.length === 0);
t('но ставит счёт в очередь таймеру', JSON.parse(await env.TILL.get('v1:q')).some(e => e.h === inv1.id));
puts = 0;
await call('GET', '/invoices/' + inv1.id, undefined, L);
t('повторное чтение очередь заново не пишет', puts === 0, 'записей: ' + puts);
await call('POST', '/cron', {});
t('номер транзакции и плательщик — из сети', r.j.payment.tx === tx1 && r.j.payment.payer === BUYER && r.j.payment.amount === '12.5', JSON.stringify(r.j.payment) + ' ' + tx1);
const hook = hooks.shift();
t('ВЕБХУК invoice.paid ДОШЁЛ', hook && JSON.parse(hook.body).type === 'invoice.paid');
t('вебхук подписан текущим секретом', hook && verify(hook, SEC));
const ev = JSON.parse(hook.body);
t('в вебхуке заказ, сумма, metadata и livemode', ev.data.order_id === 'A-1001' && ev.data.amount === '12.5' && ev.data.metadata.customer === 42 && ev.livemode === true);
t('у события постоянный id (магазин отсеет повтор)', /^evt_[0-9a-f]{32}$/.test(ev.id) && hook.headers['tavarov-event-id'] === ev.id);
r = await call('GET', '/invoices/' + inv1.id, undefined, L);
t('повторное чтение второй вебхук НЕ шлёт', !hooks.length && r.j.webhook.delivered === true);
r = await call('POST', '/invoices', { amount: '12.5', order_id: 'A-1001' }, L);
t('оплаченный заказ повторно не выставить — 409 order_paid', r.status === 409 && r.j.error.code === 'order_paid');

sales[inv1.id].refunded = 125n * 10n ** 17n;
r = await call('GET', '/invoices/' + inv1.id, undefined, L);
t('ВОЗВРАТ ПОКУПАТЕЛЮ — статус refunded', r.j.status === 'refunded' && r.j.payment.refunded === '12.5');

// ---------- таймер находит оплату сам ----------
const inv2 = (await call('POST', '/invoices', { amount: '3', order_id: 'B-7' }, L)).j;
pay(inv2.id, SHOP, 3n * 10n ** 18n, USDT);
block += 5;
r = await call('POST', '/cron', {});
t('ТАЙМЕР САМ НАШЁЛ ОПЛАТУ В ЖУРНАЛЕ И ПОСЛАЛ ВЕБХУК', r.j.delivered === 1 && hooks.length === 1 && JSON.parse(hooks[0].body).data.id === inv2.id, JSON.stringify(r.j));
hooks.length = 0;
r = await call('POST', '/cron', {});
t('второй проход таймера второй вебхук не шлёт', r.j.delivered === 0 && !hooks.length);

// ---------- магазин лёг: повторы ----------
const inv3 = (await call('POST', '/invoices', { amount: '5' }, L)).j;
hookCode = 500;
pay(inv3.id, SHOP, 5n * 10n ** 18n, USDT);
block += 5;
r = await call('POST', '/invoices/' + inv3.id + '/check', {});
t('проверка со страницы оплаты — только статус, без подробностей', r.status === 200 && r.j.status === 'paid' && !('payment' in r.j) && !('merchant' in r.j));
t('магазин ответил 500 — попытка записана', hooks.length === 1);
let q = JSON.parse(await env.TILL.get('v1:q'));
t('и счёт встал в очередь повторов', q.some(e => e.h === inv3.id));
hooks.length = 0;
hookCode = 200;
await call('POST', '/cron', {});
t('до срока повтор не шлём', hooks.length === 0);
shift += 70;
block += 100;
r = await call('POST', '/cron', {});
t('ПОВТОР ЧЕРЕЗ МИНУТУ — ДОШЁЛ, и ровно один раз', hooks.length === 1 && r.j.retried + r.j.delivered === 1, JSON.stringify(r.j));
q = JSON.parse(await env.TILL.get('v1:q') || '[]');
t('очередь очищена', !q.some(e => e.h === inv3.id));
hooks.length = 0;

const inv4 = (await call('POST', '/invoices', { amount: '1' }, L)).j;
hookDown = true;
pay(inv4.id, SHOP, 10n ** 18n, USDT);
block += 5;
await call('POST', '/cron', {});
for (let i = 0; i < 9; i++){ shift += 90000; block += 50; await call('POST', '/cron', {}); }
const rec4 = JSON.parse(await env.TILL.get('v1:inv:' + inv4.id));
t('МАГАЗИН ЛЕЖИТ ДВОЕ СУТОК — восемь попыток и стоп, без бесконечного цикла', rec4.wh.n === 8 && rec4.wh.dead === true, JSON.stringify(rec4.wh));
hookDown = false;
/* прошло девять суток — сессии кабинета давно погасли, входим заново */
S = 'Session ' + await login(shop);
S2 = 'Session ' + await login(other);
r = await call('POST', '/dev/invoices/' + inv4.id + '/resend', {}, S);
t('из кабинета можно отправить заново', r.status === 200 && hooks.length === 1 && r.j.webhook.delivered);
hooks.length = 0;
const inv5 = (await call('POST', '/invoices', { amount: '1' }, L)).j;
t('неоплаченный заново не отправить — 409', (await call('POST', '/dev/invoices/' + inv5.id + '/resend', {}, S)).status === 409);
t('чужой счёт из своего кабинета — 404', (await call('POST', '/dev/invoices/' + inv5.id + '/resend', {}, S2)).status === 404);

// ---------- срок ----------
const inv6 = (await call('POST', '/invoices', { amount: '2', expires_in: 300 }, L)).j;
shift += 400;
r = await call('GET', '/invoices/' + inv6.id, undefined, L);
t('просроченный неоплаченный — expired', r.j.status === 'expired');
pay(inv6.id, SHOP, 2n * 10n ** 18n, USDT);
block += 5;
r = await call('GET', '/invoices/' + inv6.id, undefined, L);
t('заплатили после срока — paid, с пометкой paid_after_expiry', r.j.status === 'paid' && r.j.payment.paid_after_expiry === true);
hooks.length = 0;

// ---------- сеть молчит ----------
const inv7 = (await call('POST', '/invoices', { amount: '2' }, L)).j;
nodeDead = true;
r = await call('GET', '/invoices/' + inv7.id, undefined, L);
t('СЕТЬ МОЛЧИТ — отдаём сохранённое с пометкой stale, «оплачено» не выдумываем', r.status === 200 && r.j.stale === true && r.j.status === 'pending');
t('проверка со страницы при молчащей сети — 503', (await call('POST', '/invoices/' + inv7.id + '/check', {})).status === 503);
r = await call('POST', '/cron', {});
t('таймер при молчащей сети не падает', r.status === 200 && r.j.scanned.bnb === 'error');
nodeDead = false;

// ---------- тестовая сеть ----------
const T = 'Bearer ' + TEST;
const tinv = (await call('POST', '/invoices', { amount: '1.5' }, T)).j;
t('тестовый счёт — сеть bnbTestnet, livemode false', tinv.network === 'bnbTestnet' && tinv.livemode === false);
t('боевой ключ тестовый счёт не видит', (await call('GET', '/invoices/' + tinv.id, undefined, L)).status === 404);
pay(tinv.id, SHOP, 1500000n, '0xb4ac75e8cf7c768ffd9fafeaf1bf77b48209524e', { hub: TPAY });
block += 5;
r = await call('GET', '/invoices/' + tinv.id, undefined, T);
t('ТЕСТОВАЯ СЕТЬ (контракт без saleOf): оплата найдена по журналу — paid', r.j.status === 'paid' && r.j.payment.amount === '1.5' && !r.j.stale, JSON.stringify(r.j.payment));
const tinv2 = (await call('POST', '/invoices', { amount: '2' }, T)).j;
pay(tinv2.id, SHOP, 1500000n, '0xb4ac75e8cf7c768ffd9fafeaf1bf77b48209524e', { hub: TPAY });
block += 5;
r = await call('GET', '/invoices/' + tinv2.id, undefined, T);
t('тестовая сеть: недоплата по журналу — underpaid', r.j.status === 'underpaid', r.j.status);
const tinv3 = (await call('POST', '/invoices', { amount: '1' }, T)).j;
r = await call('GET', '/invoices/' + tinv3.id, undefined, T);
t('тестовая сеть: оплаты в журнале нет — pending, без stale', r.j.status === 'pending' && !r.j.stale);
hooks.length = 0;

// ---------- кабинет: список, ключи ----------
r = await call('GET', '/dev/invoices?mode=live', undefined, S);
t('кабинет: список боевых счетов', r.status === 200 && r.j.items.some(x => x.id === inv1.id) && !r.j.items.some(x => x.id === tinv.id));
r = await call('GET', '/dev/invoices?mode=test', undefined, S);
t('кабинет: тестовые — отдельно', r.j.items.length === 3 && r.j.items.every(x => x.livemode === false) && r.j.items.some(x => x.id === tinv.id));
t('чужой кабинет моих счетов не показывает', !(await call('GET', '/dev/invoices?mode=live', undefined, S2)).j.items.some(x => x.id === inv1.id));

const NEW = (await call('POST', '/dev/keys', { mode: 'live' }, S)).j.new_key;
t('НОВЫЙ КЛЮЧ ВЫДАН — СТАРЫЙ БОЛЬШЕ НЕ РАБОТАЕТ', (await call('GET', '/me', undefined, L)).status === 401 && (await call('GET', '/me', undefined, 'Bearer ' + NEW)).status === 200);
t('новым ключом старые счета видны', (await call('GET', '/invoices/' + inv1.id, undefined, 'Bearer ' + NEW)).status === 200);
await call('POST', '/dev/keys/revoke', { mode: 'test' }, S);
t('отозванный тестовый ключ — 401', (await call('GET', '/me', undefined, T)).status === 401);
await call('POST', '/dev/logout', {}, S);
t('после выхода сессия не работает', (await call('GET', '/dev/account', undefined, S)).status === 401);
shift += 13 * 3600;
t('сессия сама гаснет через 12 часов', (await call('GET', '/dev/account', undefined, S2)).status === 401);

Date.now = realNow;
console.log('\n--- ' + ok + ' из ' + (ok + bad) + ' ---');
process.exit(bad ? 1 : 0);
