/* Telegram-бот: счета в любой сети и кнопки кошельков (1 октября 2026).

   Проверяется: /network и выбор кнопкой; Base — USDC вместо USDT; для
   Solana бот просит адрес Solana и не берёт адрес программы; счёт в Solana
   с адресом Solana и в очереди таймера; под счётом — кнопки «Trust Wallet /
   MetaMask» (EVM) или «Phantom / Solflare» (Solana), ведущие на эту же
   оплату в браузере кошелька; встроенный режим помнит сеть; уведомление
   «оплачено» ведёт в обозреватель своей сети. */
const BOT = await import('/home/claude/apk/functions/api/tg/[[path]].js');
const TG = await import('/home/claude/apk/functions/api/_tg.js');
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');
let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 240) + ']' : '')); };

const map = new Map();
const KV = { async get(k){ const v = map.get(k); return v === undefined ? null : v; }, async put(k, v){ map.set(k, v); }, async delete(k){ map.delete(k); } };
const env = { TILL: KV, V1_NO_THROTTLE: 1, TG_BOT_TOKEN: '8123456789:AAH_test_token_not_real_000000000000' };
const sent = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/')){
    const method = u.split('/').pop();
    let body = {}; try{ body = JSON.parse(init.body || '{}'); } catch(e){ throw new Error('multipart not mocked'); }
    sent.push({ method, body });
    return { status: 200, ok: true, json: async () => ({ ok: true, result: true }) };
  }
  throw new Error('no net ' + u);
};
await KV.put('tg:me', JSON.stringify({ username: 'tavarov_pay_bot' }));
const SECRET = await TG.hookSecret(env);
let upd = 1;
const CHAT = 777000111;
const post = body => BOT.handle(new Request('https://wallet.tavarov.com/api/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: JSON.stringify(body) }), env, () => {});
const msg = text => post({ update_id: upd++, message: { message_id: 1, text, chat: { id: CHAT, type: 'private' }, from: { id: CHAT, first_name: 'A', language_code: 'ru' } } });
const cb = data => post({ update_id: upd++, callback_query: { id: 'q' + upd, data, from: { id: CHAT, language_code: 'ru' }, message: { chat: { id: CHAT } } } });
const last = () => sent.filter(x => x.method === 'sendMessage').slice(-1)[0] || { body: {} };
const user = () => JSON.parse(map.get('tg:u:' + CHAT));
const EVM = '0x9B68E34De911333310188C5fAcC0fe8ABc1d5dD1';
const SOLW = 'GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw';

await msg('/start'); await msg(EVM); await cb('skip');
await msg('25');
let m = last().body;
let rows = (m.reply_markup && m.reply_markup.inline_keyboard) || [];
const flat = rows.flat();
const tw = flat.find(b => /Trust/.test(b.text)), mm = flat.find(b => /MetaMask/.test(b.text));
ok('СЧЁТ В BNB: под ним кнопки Trust Wallet и MetaMask', !!tw && !!mm && /Сеть: <b>BNB Chain<\/b>/.test(m.text), JSON.stringify(rows).slice(0, 200));
ok('Trust Wallet — эта же оплата в его браузере (BNB, выбор кошелька сразу)', tw && tw.url.startsWith('https://link.trustwallet.com/open_url?coin_id=20000714&url=') && /pay%3Fp%3D/.test(tw.url) && /pick%3D1/.test(tw.url), tw && tw.url.slice(0, 140));
ok('MetaMask — та же страница без https://', mm && mm.url.startsWith('https://metamask.app.link/dapp/wallet.tavarov.com/pay?p=') && /pick=1/.test(mm.url), mm && mm.url.slice(0, 100));

await msg('/network');
m = last().body;
ok('/network — четыре сети, отмечена BNB', JSON.stringify(m.reply_markup.inline_keyboard.flat().map(b => b.text)) === '["✓ BNB Chain","Ethereum","Base","Solana"]' && /В какой сети/.test(m.text));
await cb('n:base');
ok('выбрал Base — сохранено и сказано про USDC', user().net === 'base' && /Base<\/b>/.test(last().body.text) && /только USDC/.test(last().body.text), last().body.text);
await msg('25');
let hs = user().list;
let rec = JSON.parse(map.get('v1:inv:' + hs[0]));
ok('счёт в Base — в USDC, сеть base', rec.net === 'base' && rec.c === 'USDC' && rec.a === '25', JSON.stringify({ net: rec.net, c: rec.c }));
ok('Trust Wallet для Base — coin 8453', /coin_id=8453/.test(last().body.reply_markup.inline_keyboard.flat().find(b => /Trust/.test(b.text)).url));

await cb('n:solana');
ok('Solana без адреса — бот просит адрес Solana', /адрес в Solana/.test(last().body.text) && user().step === 'sol' && user().net === 'base');
await msg('просто текст');
ok('не адрес — объяснено', /не адрес кошелька Solana/.test(last().body.text));
const pda = SOL.b58enc(await SOL.ata(SOL.b58dec(SOLW, 32), SOL.b58dec('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 32)));
await msg(pda);
ok('адрес программы (не кошелёк) — не принят', /не адрес кошелька Solana/.test(last().body.text) && !user().sw);
await msg(SOLW);
ok('АДРЕС SOLANA СОХРАНЁН, счета — в Solana', user().sw === SOLW && user().net === 'solana' && !user().step && /Solana<\/b>/.test(last().body.text), last().body.text);
await msg('10 кофе');
hs = user().list;
rec = JSON.parse(map.get('v1:inv:' + hs[0]));
ok('СЧЁТ В SOLANA: адрес Solana, USDT', rec.net === 'solana' && rec.sm === SOLW && rec.c === 'USDT' && rec.a === '10', JSON.stringify({ net: rec.net, sm: rec.sm, c: rec.c }));
const solq = JSON.parse(map.get('v1:solq') || '[]');
ok('счёт Solana — в очереди таймера (иначе «Оплачено» не придёт)', solq.some(e => e.h === rec.h));
m = last().body;
const ph = m.reply_markup.inline_keyboard.flat().find(b => /Phantom/.test(b.text)), sf = m.reply_markup.inline_keyboard.flat().find(b => /Solflare/.test(b.text));
ok('под счётом — Phantom и Solflare (браузер кошелька, ref наш)', ph && ph.url.startsWith('https://phantom.app/ul/browse/https%3A%2F%2Fwallet.tavarov.com%2Fpay%3Fp%3D') && /\?ref=https%3A%2F%2Fwallet\.tavarov\.com$/.test(ph.url) && sf && sf.url.startsWith('https://solflare.com/ul/v1/browse/'), ph && ph.url.slice(0, 120));
const page = decodeURIComponent(ph.url.split('/ul/browse/')[1].split('?ref=')[0]);
const payload = JSON.parse(Buffer.from(new URL(page).searchParams.get('p').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
ok('в ссылке — счёт Solana на адрес Solana', payload.net === 'solana' && payload.m === SOLW && payload.h === rec.h, JSON.stringify(payload).slice(0, 160));
ok('в тексте счёта — сеть Solana', /Сеть: <b>Solana<\/b>/.test(m.text));

// ---- встроенный режим ----
sent.length = 0;
await post({ update_id: upd++, inline_query: { id: 'iq1', query: '5 чай', from: { id: CHAT, language_code: 'ru' } } });
const ans = sent.find(x => x.method === 'answerInlineQuery');
const kb = ans && ans.body.results[0].reply_markup.inline_keyboard;
const go = kb && kb[0][0].url;
ok('ВСТРОЕННЫЙ РЕЖИМ: «Оплатить» + Phantom/Solflare на ту же ссылку', kb && kb[1].length === 2 && /Phantom/.test(kb[1][0].text) && kb[1][0].url.includes(encodeURIComponent(go)), kb && JSON.stringify(kb).slice(0, 160));
const gr = await BOT.handle(new Request(go), env, () => {});
const loc = gr.headers.get('location') || '';
const pl = JSON.parse(Buffer.from(decodeURIComponent(loc.split('#p=')[1].split('&')[0]).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
ok('по ссылке создан счёт в Solana на адрес Solana', gr.status === 302 && pl.net === 'solana' && pl.m === SOLW && pl.a === '5', loc.slice(0, 80));

// ---- уведомление ----
sent.length = 0;
await TG.notifyPaid(env, { tg: String(CHAT), tl: 'ru', a: '25', c: 'USDC', i: '', net: 'base', pay: { got: '24.75', tx: '0xabc' } });
ok('«Оплачено» в Base — ссылка на Basescan', /basescan\.org\/tx\/0xabc/.test(sent[0].body.text) && /сети Base/.test(sent[0].body.text), sent[0].body.text.slice(-120));
await TG.notifyPaid(env, { tg: String(CHAT), tl: 'en', a: '10', c: 'USDT', i: '', net: 'solana', pay: { tx: '5abc' } });
ok('in English, Solana — Solscan', /solscan\.io\/tx\/5abc/.test(sent[1].body.text) && /on Solana/.test(sent[1].body.text), sent[1].body.text.slice(-100));
await TG.notifyPaid(env, { tg: String(CHAT), tl: 'ru', a: '1', c: 'USDT', i: '', pay: { tx: '0xdef' } });
ok('старый счёт без сети — BscScan, как раньше', /bscscan\.com\/tx\/0xdef/.test(sent[2].body.text));

console.log('--- ' + okN + ' из ' + (okN + badN) + ' ---');
