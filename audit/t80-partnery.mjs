/* Партнёрская программа: сбор событий контракта в кабинет партнёра,
   /api/v1/partners, бот (/ref, ссылка t.me/…?start=r_…), страница
   приглашения wallet.tavarov.com/ref?by=… и кабинет в NoN Wallet.

   Главное, что проверяется:
   — одна и та же доля не считается дважды, даже если журнал прочитан ещё раз;
   — курсор не пишется каждую минуту (бесплатный KV — ~1000 записей в сутки);
   — страница приглашения отправляет ровно setReferrer(пригласивший) в
     контракт оплаты — и не отправляет ничего, если закреплять нельзя. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const E = require('/home/claude/apk/www/lib/ethers.umd.min.js');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const REF = await import('/home/claude/apk/functions/api/_ref.js');
const API = await import('/home/claude/apk/functions/api/v1/[[path]].js');
const BOT = await import('/home/claude/apk/functions/api/tg/[[path]].js');
const TG = await import('/home/claude/apk/functions/api/_tg.js');

let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 220) + ']' : '')); };

const PAY = '0x1Fc681FA250A17e66B57B7150F2EeD4e71D1Ca35';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const IF = new E.utils.Interface([
  'event ReferrerSet(address indexed merchant, address indexed referrer, uint64 until)',
  'event ReferralPaid(address indexed referrer, address indexed merchant, address indexed token, uint256 amount, bytes32 invoice)',
  'function setReferrer(address)'
]);
ok('темы событий совпадают с контрактом', IF.getEventTopic('ReferrerSet') === REF.REF_TOPIC_SET && IF.getEventTopic('ReferralPaid') === REF.REF_TOPIC_PAID);

let puts = 0;
const map = new Map();
const KV = { async get(k){ const v = map.get(k); return v === undefined ? null : v; }, async put(k, v){ puts++; map.set(k, v); }, async delete(k){ map.delete(k); } };
const TOKEN = '8123456789:AAH_test_token_not_real_000000000000';
const env = { TILL: KV, V1_NO_THROTTLE: 1, TG_BOT_TOKEN: TOKEN };

const PARTNER = E.Wallet.createRandom().address, SHOP1 = E.Wallet.createRandom().address, SHOP2 = E.Wallet.createRandom().address;
let logIdx = 0;
function mk(name, args, block){
  const ev = IF.getEvent(name);
  const enc = IF.encodeEventLog(ev, args);
  return { address: PAY.toLowerCase(), topics: enc.topics, data: enc.data, blockNumber: '0x' + block.toString(16),
           transactionHash: '0x' + (++logIdx).toString(16).padStart(64, '0'), logIndex: '0x0' };
}
const until = Math.floor(Date.now() / 1000) + 365 * 86400;
const logs = [
  mk('ReferrerSet', [SHOP1, PARTNER, until], REF.REF_START + 100),
  mk('ReferrerSet', [SHOP2, PARTNER, until], REF.REF_START + 200),
  mk('ReferralPaid', [PARTNER, SHOP1, USDT, E.utils.parseUnits('0.02', 18), '0x' + 'ab'.repeat(32)], REF.REF_START + 300),
  mk('ReferralPaid', [PARTNER, SHOP1, USDT, E.utils.parseUnits('0.05', 18), '0x' + 'cd'.repeat(32)], REF.REF_START + 9000),
  mk('ReferralPaid', [PARTNER, SHOP2, USDC, E.utils.parseUnits('0.1', 18), '0x' + 'ef'.repeat(32)], REF.REF_START + 30000)
];
const calls = [];
const rpc = async (m, p) => {
  calls.push([m, p]);
  if (m !== 'eth_getLogs') throw new Error('unexpected ' + m);
  const f = p[0], lo = parseInt(f.fromBlock, 16), hi = parseInt(f.toBlock, 16);
  if (hi - lo > 5000) throw new Error('range too wide');
  const want = f.topics[0].map(x => x.toLowerCase());
  return logs.filter(l => { const b = parseInt(l.blockNumber, 16); return b >= lo && b <= hi && want.includes(l.topics[0]) && l.address === f.address.toLowerCase(); });
};
const TOKENS = { [USDT.toLowerCase()]: { sym: 'USDT', d: 18 }, [USDC.toLowerCase()]: { sym: 'USDC', d: 18 } };

/* ---------- 1. догоняющий обход ---------- */
let safe = REF.REF_START + 40000, runs = 0, last;
while (true){ last = await REF.scanReferrals(env, rpc, PAY, safe, TOKENS); runs++; if (last.behind === 0 || runs > 20) break; }
ok('журнал прочитан до конца кусками не шире 5000 блоков', last.behind === 0 && calls.every(c => parseInt(c[1][0].toBlock, 16) - parseInt(c[1][0].fromBlock, 16) <= 5000), runs + ' обходов');
const rec = JSON.parse(map.get('ref:r:' + PARTNER.toLowerCase()));
ok('у партнёра — два продавца и три начисления', rec.merchants.length === 2 && rec.pays === 3);
const view = REF.partnerView(rec, TOKENS, safe);
ok('заработано: 0.07 USDT + 0.1 USDC', view.earned.USDT === '0.07' && view.earned.USDC === '0.1', JSON.stringify(view.earned));
ok('по продавцам: первый принёс 0.07 USDT, второй 0.1 USDC, оба активны', view.merchants.find(m => m.merchant === SHOP1.toLowerCase()).earned.USDT === '0.07' && view.merchants.find(m => m.merchant === SHOP2.toLowerCase()).earned.USDC === '0.1' && view.merchants.every(m => m.active));

/* ---------- 2. повторное чтение не удваивает ---------- */
const before = map.get('ref:r:' + PARTNER.toLowerCase());
await KV.put('ref:cur', String(REF.REF_START));          // будто курсор не успел записаться
safe = REF.REF_START + 40000;
for (let i = 0; i < 6; i++) await REF.scanReferrals(env, rpc, PAY, safe, TOKENS);
ok('ТОТ ЖЕ ЖУРНАЛ ЕЩЁ РАЗ — ДОЛИ НЕ УДВОИЛИСЬ', JSON.parse(map.get('ref:r:' + PARTNER.toLowerCase())).pays === 3 && JSON.parse(map.get('ref:r:' + PARTNER.toLowerCase())).earned.USDT === JSON.parse(before).earned.USDT);

/* ---------- 3. обычная минута — без записи курсора ---------- */
await KV.put('ref:cur', String(safe));
let p0 = puts;
for (let i = 0; i < 20; i++){ safe += 80; await REF.scanReferrals(env, rpc, PAY, safe, TOKENS); }
ok('20 обычных минут без событий — курсор не пишется каждую минуту', puts - p0 === 0, puts - p0);
for (let i = 0; i < 20; i++){ safe += 80; await REF.scanReferrals(env, rpc, PAY, safe, TOKENS); }
ok('но через ~2400 блоков пишется (≈ раз в полчаса)', puts - p0 === 1, puts - p0);

/* ---------- 4. API ---------- */
const r = await API.handle(new Request('https://wallet.tavarov.com/api/v1/partners/' + PARTNER, { method: 'GET' }), env, () => {});
const j = await r.json();
ok('GET /api/v1/partners/<адрес> — кабинет партнёра', r.status === 200 && j.merchants.length === 2 && j.earned.USDT === '0.07' && j.share_bps === 2000 && j.period_days === 365, JSON.stringify(j).slice(0, 200));
const r2 = await API.handle(new Request('https://wallet.tavarov.com/api/v1/partners/' + E.Wallet.createRandom().address, { method: 'GET' }), env, () => {});
const j2 = await r2.json();
ok('незнакомый адрес — пустой кабинет, не ошибка', r2.status === 200 && j2.merchants.length === 0 && Object.keys(j2.earned).length === 0);
const r3 = await API.handle(new Request('https://wallet.tavarov.com/api/v1/partners/0x123', { method: 'GET' }), env, () => {});
ok('кривой адрес — 404', r3.status === 404);

/* ---------- 5. бот ---------- */
const tgSent = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/')){
    const method = u.split('/').pop();
    tgSent.push({ method, body: JSON.parse(init.body || '{}') });
    return { status: 200, ok: true, json: async () => ({ ok: true, result: true }) };
  }
  throw new Error('no net ' + u);
};
await KV.put('tg:me', JSON.stringify({ username: 'tavarov_pay_bot' }));
const SECRET = await TG.hookSecret(env);
let upd = 1;
const msg = (text, chat) => BOT.handle(new Request('https://wallet.tavarov.com/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': SECRET },
  body: JSON.stringify({ update_id: upd++, message: { message_id: 1, text, chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'A', language_code: 'ru' } } }) }), env, () => {});
const lastTg = () => tgSent[tgSent.length - 1];
const NEW = 555000111;
await msg('/start r_' + PARTNER.toLowerCase(), NEW);
ok('БОТ: пришёл по ссылке партнёра — запомнили, кто привёл', JSON.parse(map.get('tg:u:' + NEW)).refBy === PARTNER);
const shopW = E.Wallet.createRandom().address;
await msg(shopW, NEW);
const inv = tgSent.find(x => x.body.text && /Вас пригласил партнёр/.test(x.body.text));
ok('после кошелька — предложение закрепить партнёра с кнопкой на страницу приглашения', inv && inv.body.reply_markup.inline_keyboard[0][0].url === 'https://wallet.tavarov.com/ref?by=' + PARTNER);
await msg('/start r_' + shopW, 555000222);
const SELF = 555000333;
await msg(PARTNER, SELF);
tgSent.length = 0;
await msg('/start r_' + PARTNER, SELF);
ok('партнёр по своей же ссылке — себя не закрепляет', !JSON.parse(map.get('tg:u:' + SELF)).refBy && !tgSent.some(x => /Вас пригласил/.test(x.body.text || '')));
await msg('/ref', SELF);
const cab = lastTg().body.text;
ok('/ref — кабинет: 2 продавца, 0,07 USDT + 0,1 USDC, обе ссылки', /Вы привели: <b>2<\/b>/.test(cab) && /0,07 USDT/.test(cab) && /0,1 USDC/.test(cab) && cab.includes('https://t.me/tavarov_pay_bot?start=r_' + PARTNER) && cab.includes('https://wallet.tavarov.com/ref?by=' + PARTNER), cab.slice(0, 300));
ok('/ref — кнопки «поделиться» и «как это работает»', lastTg().body.reply_markup.inline_keyboard[0][0].url.startsWith('https://t.me/share/url?url=') && lastTg().body.reply_markup.inline_keyboard[1][0].url === 'https://tavarov.com/partners');
await msg('/ref', 555000999);
ok('/ref без кошелька — просит кошелёк', /адрес кошелька/.test(lastTg().body.text));

/* ---------- 6. страница приглашения ---------- */
const WWW = '/home/claude/apk/www', PORT = 8872;
const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(WWW, rel);
  if (!fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const W = '0x' + '3'.repeat(40);                 // кошелёк продавца в «кошельке»
const chain = { referrer: null, sold: false, names: { kofeinya: PARTNER } };
async function openRef(q, opts){
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: (opts && opts.locale) || 'ru-RU' });
  await ctx.route(/bsc-dataseed|bnbchain\.org|publicnode\.com/, async route => {
    const b = JSON.parse(route.request().postData());
    let result = '0x';
    if (b.method === 'eth_call'){
      const d = b.params[0].data;
      if (d.startsWith('0xde6c736d')) result = '0x' + (chain.referrer ? chain.referrer.slice(2).toLowerCase().padStart(64, '0') : '0'.repeat(64)) + (chain.referrer ? until.toString(16) : '0').padStart(64, '0');
      else if (d.startsWith('0xed14f20a')) result = '0x' + (chain.sold ? '1' : '0').padStart(64, '0');
      else if (d.startsWith('0xccf1454a')){
        const name = new E.utils.AbiCoder().decode(['string'], '0x' + d.slice(10))[0];
        result = '0x' + (chain.names[name] || '0x' + '0'.repeat(40)).slice(2).toLowerCase().padStart(64, '0');
      }
    } else if (b.method === 'eth_getTransactionReceipt'){
      chain.referrer = PARTNER;
      result = { blockNumber: '0x10', status: '0x1' };
    }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) });
  });
  if (!(opts && opts.noWallet)){
    await ctx.addInitScript(W0 => {
      window.__txs = [];
      window.ethereum = { request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts') return [W0];
        if (method === 'eth_chainId') return '0x38';
        if (method === 'eth_sendTransaction'){ window.__txs.push(params[0]); return '0x' + 'aa'.repeat(32); }
        throw new Error('unknown ' + method);
      } };
    }, (opts && opts.as) || W);
  }
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:' + PORT + '/ref' + q);
  await page.waitForTimeout(600);
  return { ctx, page, errs };
}
{
  const { ctx, page, errs } = await openRef('?by=' + PARTNER);
  const body = await page.evaluate(() => document.body.innerText);
  ok('СТРАНИЦА ПРИГЛАШЕНИЯ: адрес партнёра целиком и правила', body.includes(PARTNER) && /пятая часть НАШЕЙ комиссии/.test(body) && /до первой продажи/.test(body));
  ok('кнопка NoN Wallet ведёт в кошелёк с ?ref=', (await page.getAttribute('#toApp', 'href')) === 'https://wallet.tavarov.com/?ref=' + PARTNER);
  await page.click('#connectBtn');
  await page.waitForFunction(() => !document.getElementById('bindBox').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
  await page.click('#bindBtn');
  await page.waitForFunction(() => /Готово/.test(document.getElementById('stateText').textContent), null, { timeout: 15000 }).catch(() => {});
  const txs = await page.evaluate(() => window.__txs);
  const tx = txs[0] || {};
  ok('ОТПРАВЛЕНО РОВНО setReferrer(партнёр) В КОНТРАКТ ОПЛАТЫ', txs.length === 1 && tx.to === PAY && tx.from === W && tx.data === IF.encodeFunctionData('setReferrer', [PARTNER]).toLowerCase() || (tx.data || '').toLowerCase() === IF.encodeFunctionData('setReferrer', [PARTNER]).toLowerCase(), JSON.stringify(tx));
  ok('после подтверждения — «Готово, закреплён до …»', /Готово! Партнёр закреплён до/.test(await page.textContent('#stateText')));
  ok('без ошибок на странице', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
for (const [label, setup, re] of [
  ['уже закреплён другой партнёр', () => { chain.referrer = '0x' + '9'.repeat(40); chain.sold = false; }, /уже закреплён партнёр/],
  ['уже были продажи', () => { chain.referrer = null; chain.sold = true; }, /уже были продажи/],
]){
  setup();
  const { ctx, page } = await openRef('?by=' + PARTNER);
  await page.click('#connectBtn');
  await page.waitForTimeout(1200);
  ok('НЕЛЬЗЯ ЗАКРЕПИТЬ (' + label + ') — объясняем, кнопки нет, ничего не отправлено', re.test(await page.textContent('#stateText')) && await page.evaluate(() => document.getElementById('bindBox').classList.contains('hidden') && window.__txs.length === 0), await page.textContent('#stateText'));
  await ctx.close();
}
chain.referrer = null; chain.sold = false;
{
  const { ctx, page } = await openRef('?by=' + PARTNER, { as: PARTNER });
  await page.click('#connectBtn');
  await page.waitForTimeout(800);
  ok('свой же адрес — «пригласить самого себя нельзя»', /самого себя/.test(await page.textContent('#stateText')) && await page.evaluate(() => window.__txs.length === 0));
  await ctx.close();
}
{
  const { ctx, page } = await openRef('?by=kofeinya');
  ok('ИМЯ ВМЕСТО АДРЕСА — раскрывается в адрес и показывается целиком', (await page.textContent('#by')) === PARTNER.toLowerCase() || (await page.textContent('#by')).toLowerCase() === PARTNER.toLowerCase(), await page.textContent('#by'));
  await ctx.close();
}
{
  const { ctx, page } = await openRef('?by=nosuchname');
  ok('несуществующее имя — «такого имени нет», без кнопок', await page.evaluate(() => !document.getElementById('bad').hidden && document.getElementById('main').classList.contains('hidden')) && /имени нет/.test(await page.textContent('#bad')));
  await ctx.close();
}
{
  const { ctx, page } = await openRef('?by=0x1234');
  ok('кривая ссылка — «ссылка неверная»', /неверная/.test(await page.textContent('#bad')));
  await ctx.close();
}
{
  const { ctx, page } = await openRef('?by=' + PARTNER, { noWallet: true });
  const links = await page.$$eval('#links a', a => a.map(x => x.href));
  ok('НЕТ КОШЕЛЬКА В БРАУЗЕРЕ — ссылки открыть страницу в MetaMask, Trust, OKX (с тем же партнёром)', links.length === 3 && links.every(h => h.includes(PARTNER) || decodeURIComponent(decodeURIComponent(h)).includes(PARTNER)), links.join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await openRef('?by=' + PARTNER, { locale: 'en-US' });
  ok('по-английски', /You were invited/.test(await page.textContent('h1')));
  await ctx.close();
}
await browser.close(); srv.close();
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
