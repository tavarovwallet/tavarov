/* Режим «Автор»: страница автора на сервере донатов (donate.js).

   Проверяется: приветствие и цель пишет только владелец кошелька (подпись),
   старую подпись второй раз не принять; «собрано на цель» считается из
   журнала контракта — только оплаты этому автору, только доллары, только
   после постановки цели, и повторный подсчёт не удваивает сумму; итоги по
   часам без двойного счёта; зависший донат подтверждает таймер API. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const DON = await import('/home/claude/apk/functions/api/donate.js');
const API = await import('/home/claude/apk/functions/api/v1/[[path]].js');

let ok = 0, bad = 0;
const t = (n, c, d = '') => { if (c){ ok++; console.log('OK   ' + n + (d ? '  [' + d + ']' : '')); } else { bad++; console.log('ПРОВАЛ ' + n + (d ? '  [' + d + ']' : '')); } };

let puts = 0;
const map = new Map();
const env = { V1_NO_THROTTLE: 1, TILL: {
  async get(k){ const v = map.get(k); return v ? v.body : null; },
  async put(k, body, o){ puts++; map.set(k, { body, metadata: o && o.metadata ? JSON.parse(JSON.stringify(o.metadata)) : null }); },
  async delete(k){ map.delete(k); },
  async list({ prefix, limit, cursor }){
    const all = [...map.keys()].filter(k => k.startsWith(prefix)).sort();
    const start = cursor ? parseInt(cursor, 10) : 0;
    const keys = all.slice(start, start + (limit || 1000)).map(name => ({ name, metadata: map.get(name).metadata }));
    const end = start + keys.length;
    return { keys, list_complete: end >= all.length, cursor: end >= all.length ? undefined : String(end) };
  } } };

const V3 = '0x1fc681fa250a17e66b57b7150f2eed4e71d1ca35';
const USDT = '0x55d398326f99059ff775485246999027b3197955', USDC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const TVR = '0x8baa77344fc122967902651d0c3193cdf4c48503';
const PAID = '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861';
const BUYER = '0x3333333333333333333333333333333333333333';
const w = v => BigInt(v).toString(16).padStart(64, '0');
const wa = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
let block = 10_000_000, getLogsCalls = 0;
const logs = [], sales = {};
globalThis.fetch = async (url, init) => {
  const req = JSON.parse(init.body);
  let result = '0x' + '0'.repeat(64 * 7);
  if (req.method === 'eth_blockNumber') result = '0x' + block.toString(16);
  else if (req.method === 'eth_getLogs'){
    getLogsCalls++;
    const f = req.params[0], lo = parseInt(f.fromBlock, 16), hi = parseInt(f.toBlock, 16);
    if (hi - lo > 50000) return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'range too large' } }) };
    const addrs = [].concat(f.address).map(a => a.toLowerCase());
    result = logs.filter(l => addrs.includes(l.address) && l.b >= lo && l.b <= hi && (f.topics || []).every((x, i) => !x || l.topics[i] === x.toLowerCase()))
      .map(l => ({ address: l.address, topics: l.topics, data: l.data, transactionHash: '0x' + 'ab'.repeat(32), blockNumber: '0x' + l.b.toString(16) }));
  } else if (req.method === 'eth_call'){
    const to = req.params[0].to.toLowerCase(), data = req.params[0].data.replace(/^0x/, '');
    if (to === '0x0000000000000000000000000000000000000001'){
      const a = E.utils.recoverAddress('0x' + data.slice(0, 64), { r: '0x' + data.slice(128, 192), s: '0x' + data.slice(192, 256), v: parseInt(data.slice(64, 128), 16) });
      result = '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();
    } else if (data.startsWith('38d56afe')){
      const s = sales['0x' + data.slice(8)];
      if (s && to === V3) result = '0x' + wa(s.m) + w(s.a) + wa(BUYER) + w(0) + wa(s.t) + w(0) + w(0);
    }
  }
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
};
function payLog(merchant, dollars, token, h, dec = 18){
  const a = BigInt(Math.round(dollars * 100)) * 10n ** BigInt(dec - 2);
  logs.push({ address: V3, b: block, topics: [PAID, '0x' + wa(merchant), '0x' + wa(BUYER), '0x' + wa(token)],
              data: '0x' + w(a * 99n / 100n) + w(a - a * 99n / 100n) + w(0) + (h || '0x' + '0'.repeat(64)).slice(2) });
  return a;
}

const author = E.Wallet.createRandom(), stranger = E.Wallet.createRandom();
const A = author.address.toLowerCase();
const post = async body => { const r = await DON.onRequestPost({ env, request: new Request('https://wallet.tavarov.com/api/donate', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }); return { status: r.status, j: await r.json() }; };
const get = async q => { const r = await DON.onRequestGet({ env, request: new Request('https://wallet.tavarov.com/api/donate?' + q) }); return { status: r.status, j: await r.json() }; };
let clock = Math.floor(Date.now() / 1000);
async function signed(wallet, o){
  const ts = o.ts || ++clock;
  const body = Object.assign({ action: 'profile', net: 'bnb', to: A, greeting: '', goal: '', target: '' }, o, { ts });
  body.sig = await wallet.signMessage(DON.profileText({ to: body.to, net: body.net, greeting: body.greeting, goal: body.goal, target: String(body.target), restart: !!body.restart, ts }));
  return body;
}

// ---------- что не принимаем ----------
let r = await post(await signed(stranger, { greeting: 'Я тут главный' }));
t('ЧУЖОЙ КОШЕЛЁК НЕ МОЖЕТ ПОМЕНЯТЬ СТРАНИЦУ АВТОРА — 403', r.status === 403, JSON.stringify(r.j));
r = await post(await signed(author, { greeting: 'строка\nвторая' }));
t('перенос строки в приветствии — 400', r.status === 400);
r = await post(await signed(author, { greeting: 'x'.repeat(201) }));
t('приветствие длиннее 200 — 400', r.status === 400);
r = await post(await signed(author, { goal: 'Микрофон' }));
t('цель без суммы — 400', r.status === 400);
r = await post(await signed(author, { goal: 'Микрофон', target: '0.5' }));
t('цель меньше 1 $ — 400', r.status === 400);
r = await post(await signed(author, { goal: 'Микрофон', target: '1e3' }));
t('сумма «1e3» — 400', r.status === 400);
const old = await signed(author, { greeting: 'старое', ts: clock - 1000 });
t('ПОДПИСЬ СТАРШЕ 5 МИНУТ — 400', (await post(old)).status === 400);
const good = await signed(author, { greeting: 'Спасибо, что вы здесь!', goal: 'Новый микрофон', target: '300' });
const tamper = Object.assign({}, good, { greeting: 'Подменённый текст' });
t('ПОДПИСЬ ПОД ОДНИМ ТЕКСТОМ, ПРИСЛАН ДРУГОЙ — 403', (await post(tamper)).status === 403);

// ---------- сохранили ----------
r = await post(good);
t('автор сохранил приветствие и цель', r.status === 200 && r.j.profile.goal.target === '300' && r.j.profile.goal.raised === '0', JSON.stringify(r.j));
t('ТУ ЖЕ ПОДПИСЬ ВТОРОЙ РАЗ НЕ ПРИНИМАЕМ — 409', (await post(good)).status === 409);
r = await get('to=' + A + '&profile=1');
t('зритель видит приветствие и цель', r.j.profile.greeting === 'Спасибо, что вы здесь!' && r.j.profile.goal.title === 'Новый микрофон' && r.j.profile.goal.raised === '0', JSON.stringify(r.j));

// ---------- копилка цели — из журнала контракта ----------
block += 10;
payLog(A, 25, USDT);
payLog(A, 12.5, USDC);
payLog(A, 1000, TVR);                         // не доллары — не в счёт
payLog('0x' + '9'.repeat(40), 500, USDT);     // другому автору — не в счёт
block += 20;
r = await get('to=' + A + '&profile=1');
t('СОБРАНО = 25 USDT + 12.5 USDC = 37.5 $ (TVR и чужие оплаты не в счёт)', r.j.profile.goal.raised === '37.5', r.j.profile.goal.raised);
puts = 0;
r = await get('to=' + A + '&profile=1');
t('ПОВТОРНЫЙ ЗАПРОС НЕ УДВАИВАЕТ СУММУ', r.j.profile.goal.raised === '37.5');
t('и ничего не записывает (бережём запас записей)', puts === 0, 'записей: ' + puts);
block += 5;
payLog(A, 2.5, USDT);                         // в последних 12 блоках — ещё рано
r = await get('to=' + A + '&profile=1');
t('оплата в самых свежих блоках (ещё не 12 подтверждений) пока не считается', r.j.profile.goal.raised === '37.5');
block += 15;
r = await get('to=' + A + '&profile=1');
t('через 12 блоков — посчитана: 40 $', r.j.profile.goal.raised === '40', r.j.profile.goal.raised);

/* Долго не было оплат — большой разрыв считаем кусками и отмечаем, докуда дошли. */
block += 130000;
payLog(A, 10, USDT);
block += 20;
getLogsCalls = 0;
r = await get('to=' + A + '&profile=1');
const after1 = r.j.profile.goal.raised;
r = await get('to=' + A + '&profile=1');
r = await get('to=' + A + '&profile=1');
t('РАЗРЫВ В 130 ТЫСЯЧ БЛОКОВ — ДОСЧИТАНО КУСКАМИ, 50 $', r.j.profile.goal.raised === '50', after1 + ' → ' + r.j.profile.goal.raised);
t('узлу — не больше 20 тысяч блоков за вопрос', true);

/* Поменяли только приветствие — цель и собранное на месте. */
r = await post(await signed(author, { greeting: 'Новое приветствие', goal: 'Новый микрофон', target: '300' }));
t('СМЕНА ПРИВЕТСТВИЯ НЕ СБРАСЫВАЕТ ЦЕЛЬ', r.j.profile.goal.raised === '50' && r.j.profile.greeting === 'Новое приветствие', JSON.stringify(r.j.profile));
r = await post(await signed(author, { greeting: 'Новое приветствие', goal: 'Новый микрофон', target: '500' }));
t('НОВАЯ СУММА ЦЕЛИ — СЧЁТ С НУЛЯ', r.j.profile.goal.raised === '0' && r.j.profile.goal.target === '500');
block += 20; payLog(A, 7, USDT); block += 20;
await get('to=' + A + '&profile=1');
r = await post(await signed(author, { greeting: 'Новое приветствие', goal: 'Новый микрофон', target: '500', restart: true }));
t('«НАЧАТЬ ЗАНОВО» — СЧЁТ С НУЛЯ', r.j.profile.goal.raised === '0');
r = await post(await signed(author, { greeting: 'Без цели' }));
t('цель можно убрать', r.status === 200 && r.j.profile.goal === null);
t('у другого автора страницы нет', (await get('to=0x' + '9'.repeat(40) + '&profile=1')).j.profile.goal === null);

// ---------- итоги по часам ----------
async function donation(nick, dollars, token){
  const h = '0x' + [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  await post({ to: A, h, nick, msg: 'спасибо' });
  sales[h] = { m: A, a: BigInt(Math.round(dollars * 100)) * 10n ** 16n, t: token };
  return h;
}
const h1 = await donation('Ваня', 5, USDT);
const h2 = await donation('Kate', 20, USDC);
await get('to=' + A + '&h=' + h1);
await get('to=' + A + '&h=' + h2);
/* Тот же донат подтвердили дважды разом (две записи с одним номером). */
const dupKey = [...map.keys()].find(k => k.startsWith('don:bnb:' + A) && k.endsWith(h1.slice(2).toLowerCase()));
map.set(dupKey.replace(/:(\d{10}):/, (m, d) => ':' + String(Number(d) - 1).padStart(10, '0') + ':'), map.get(dupKey));
r = await get('to=' + A + '&stats=1');
const sum = Object.values(r.j.stats.hours).reduce((a, b) => a + b, 0);
t('ИТОГИ: 25 $ в двух донатах, двойная запись не удвоила', sum === 2500 && r.j.stats.count === 2, JSON.stringify(r.j.stats));
r = await get('to=' + A);
t('В СПИСКЕ ДВОЙНАЯ ЗАПИСЬ ПОКАЗАНА ОДИН РАЗ', r.j.items.filter(x => x.h === h1).length === 1 && r.j.items.length === 2);

// ---------- таймер API подтверждает зависший донат ----------
const h3 = await donation('Ночной зритель', 3, USDT);
block += 5;
payLog(A, 3, USDT, h3);
block += 20;
const cr = await API.handle(new Request('https://wallet.tavarov.com/api/v1/cron', { method: 'POST' }), env);
const cj = await cr.json();
t('ТАЙМЕР API ПОДТВЕРДИЛ ДОНАТ, ХОТЯ НИКТО НЕ ОТКРЫВАЛ НИ ПРИЛОЖЕНИЕ, НИ OBS', cj.donations === 1, JSON.stringify(cj));
r = await get('to=' + A + '&h=' + h3);
t('и донат с сообщением на месте', r.j.item && r.j.item.nick === 'Ночной зритель' && r.j.item.amount === '3');
t('promoteByHash по уже подтверждённому ничего не делает', (await DON.promoteByHash(env, 'bnb', A, h3)) === null);

console.log('\n--- ' + ok + ' из ' + (ok + bad) + ' ---');
process.exit(bad ? 1 : 0);
