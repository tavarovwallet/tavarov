/* Telegram-бот Tavarov Pay: продавец пишет сумму — получает ссылку на
   оплату; покупатель платит — продавцу приходит «Оплачено».

   Адреса:
     POST /api/tg        — сюда Telegram присылает сообщения (вебхук).
                           Пускаем только с секретом в заголовке
                           X-Telegram-Bot-Api-Secret-Token.
     POST /api/tg/setup  — один раз после выкладки: сказать Telegram, куда
                           слать сообщения, и записать команды бота. Ничего
                           не принимает от вызывающего, адрес вебхука зашит,
                           поэтому повторный вызов безвреден.
     GET  /api/tg        — имя бота (для ссылки на сайте).
     GET  /api/tg/go     — ссылка «Оплатить» из встроенного режима
                           (@бот 25 кофе в переписке с клиентом). Подписана
                           ботом; счёт создаётся, когда её впервые открыли,
                           и дальше каждое нажатие ведёт на тот же счёт.

   Хранилище (KV TILL, бесплатный план — около тысячи записей в сутки на
   всё): tg:u:<чат> — кошелёк, название и последние счета продавца; сам
   счёт — обычная запись API v1 (v1:inv:<номер>) с полем tg. Итого две
   записи на счёт. Чтение /start, /help, /list — без записей. */
import { tgCall, tgUpload, hasBot, hookSecret, linkSig, sha256hex, langOf, txt, esc, money, appButtons, TG_HOOK_URL, walletButtons, netName, TG_NET_NAMES } from '../_tg.js';
import { SOL } from '../_sol.js';
import { qrPng } from '../_qr.js';
import { createTgInvoice, readTgInvoice, checkTgInvoice, checksumAddress, tgPayUrl, partnerInfo, TG_TTL } from '../v1/[[path]].js';
import { overLimit } from '../_limit.js';

const okAddr = v => /^0x[0-9a-fA-F]{40}$/.test(v || '');
/* Адрес кошелька Solana: base58, 32 байта, точка на кривой (у адреса
   программы ключа нет — деньги туда некому было бы забрать). */
function okSolWallet(v){
  if (!SOL.isAddress(v || '')) return false;
  try{ return SOL.isOnCurve(SOL.b58dec(v, 32)); } catch(e){ return false; }
}
const userNet = u => (u && TG_NET_NAMES[u.net]) ? u.net : 'bnb';
const kUser = chat => 'tg:u:' + chat;
const K_ME = 'tg:me';
const LIST_MAX = 50;
const ICON = 'https://wallet.tavarov.com/tg-icon.png';
const now = () => Math.floor(Date.now() / 1000);

/* Сюда деньги принимать нельзя: скомпрометированный кошелёк и адреса
   контрактов/монет (перевод на них — потеря денег или путаница). */
const BLOCKED = new Set(['0x6ae698fb6e3721577da00f725c586a75e2e2c048']);
const CONTRACTS = new Set([
  '0x1fc681fa250a17e66b57b7150f2eed4e71d1ca35',   // Tavarov Pay V3
  '0x4934f57e6a255f18f6c911a50136879c75bebbff',   // MerchantVaultV2
  '0x55d398326f99059ff775485246999027b3197955',   // USDT (BSC)
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',   // USDC (BSC)
  '0x0000000000000000000000000000000000000000'
]);

function json(o, status){
  return new Response(JSON.stringify(o), { status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
function safeEqual(a, b){
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function kvGet(env, key){
  const v = await env.TILL.get(key);
  if (!v) return null;
  try{ return JSON.parse(v); } catch(e){ return null; }
}
const kvPut = (env, key, obj) => env.TILL.put(key, JSON.stringify(obj));

/* Ограничитель по номеру чата: все запросы приходят с адресов Telegram,
   поэтому по адресу считать нельзя. Счётчик — в кэше дата-центра. */
async function chatLimited(env, chat, bucket, max, winSec){
  if (env.V1_NO_THROTTLE || typeof caches === 'undefined' || !caches.default) return false;
  try{
    const slot = Math.floor(Date.now() / 1000 / winSec);
    const key = new Request('https://wallet.tavarov.com/__tglimit/' + bucket + '/' + chat + '/' + slot);
    const hit = await caches.default.match(key);
    const n = hit ? (parseInt(await hit.text(), 10) || 0) : 0;
    if (n >= max) return true;
    await caches.default.put(key, new Response(String(n + 1), { headers: { 'cache-control': 'max-age=' + winSec } }));
  } catch(e){}
  return false;
}

/* Текст от человека — на страницу оплаты: одна строка, без управляющих и
   невидимых знаков, не длиннее max. Лишнее обрезаем, а не отказываем. */
function cleanMemo(v, max){
  let out = '';
  for (const ch of String(v || '')){
    const cp = ch.codePointAt(0);
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 ||
        (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff){
      out += ' '; continue;
    }
    out += ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return [...out].slice(0, max).join('').trim();
}

/* «25», «12.5», «12,5 USDC кофе», «USDC 12.5 кофе», «$25 кофе», «1 000».
   «1,000» — неоднозначно (тысяча или единица?), такое не угадываем, а
   переспрашиваем: ошибка здесь — счёт в тысячу раз меньше. */
const NUM = '(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d{1,9})([.,]\\d{1,6})?';
export function parseAmount(text){
  const s = String(text || '').trim();
  let m = s.match(new RegExp('^\\$?\\s*' + NUM + '\\s*(usdt|usdc|\\$)?(?:\\s+([\\s\\S]*))?$', 'i'));
  let cur = 'USDT', whole, frac, memo;
  if (m){ whole = m[1]; frac = m[2] || ''; if (m[3] && /usdc/i.test(m[3])) cur = 'USDC'; memo = m[4] || ''; }
  else {
    m = s.match(new RegExp('^(usdt|usdc)\\s*' + NUM + '(?:\\s+([\\s\\S]*))?$', 'i'));
    if (!m) return null;
    cur = m[1].toUpperCase(); whole = m[2]; frac = m[3] || ''; memo = m[4] || '';
  }
  whole = whole.replace(/[ \u00a0]/g, '');
  if (/^,\d{3}$/.test(frac)) return { ambiguous: true };
  const amt = (whole.replace(/^0+(?=\d)/, '') + frac.replace(',', '.'));
  const n = Number(amt);
  if (!isFinite(n) || whole.length > 9) return null;
  return { amount: amt, value: n, cur, memo: cleanMemo(memo, 64) };
}

const send = (env, chat, text, extra) => tgCall(env, 'sendMessage',
  Object.assign({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }, extra || {}));

/* Имя бота — для подсказок «@бот 25 кофе». Берём из того, что записала
   настройка; пока её не было — нейтральное слово. */
async function botInfo(env){ return (await kvGet(env, K_ME)) || {}; }
const fillBot = (text, me) => String(text).split('{bot}').join(me && me.username ? me.username : 'tavarov_pay_bot');

function statusLine(L, st){
  return { paid: L.stPaid, pending: L.stPending, expired: L.stExpired, underpaid: L.stUnder,
           wrong_currency: L.stCur, refunded: L.stRefunded }[st] || L.stPending;
}

function b64url(s){
  const bytes = new TextEncoder().encode(s);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s){
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
const rememberInvoice = (u, h) => { u.list = [h].concat((u.list || []).filter(x => x !== h)).slice(0, LIST_MAX); };

async function saveWallet(env, chat, u, addr, L){
  const low = addr.toLowerCase();
  if (BLOCKED.has(low)) return send(env, chat, L.walletBlocked);
  if (CONTRACTS.has(low)) return send(env, chat, L.walletContract);
  const w = checksumAddress(addr);
  const first = !(u && u.w);
  const nu = Object.assign({ list: [], ct: now() }, u || {}, { w });
  /* Первое знакомство: сразу спросим, как подписать продавца на странице
     оплаты, — иначе покупатель видит безликое «Оплата» и не понимает, кому платит. */
  if (first && !nu.n) nu.step = 'name';
  await kvPut(env, kUser(chat), nu);
  await send(env, chat, L.walletSaved(w), { reply_markup: appButtons(L, 'open') });
  if (nu.refBy && nu.refBy.toLowerCase() !== w.toLowerCase()) await refInvite(env, chat, nu.refBy, L);
  if (nu.step === 'name') return send(env, chat, L.askName, { reply_markup: { inline_keyboard: [[{ text: L.btnSkip, callback_data: 'skip' }]] } });
}

/* Продавец пришёл по ссылке партнёра. Закрепить партнёра может только он
   сам, подписью своего кошелька, — бот лишь ведёт его на страницу, где это
   делается любым кошельком. */
async function refInvite(env, chat, by, L){
  return send(env, chat, L.refInvite(by), { reply_markup: { inline_keyboard: [[{ text: L.btnRefBind, url: 'https://wallet.tavarov.com/ref?by=' + by }]] } });
}

/* Кабинет партнёра: ссылки и сколько заработано. */
async function partnerCabinet(env, chat, u, L, lang){
  if (!u || !u.w) return send(env, chat, L.needWallet, { reply_markup: appButtons(L, 'get') });
  const me = await botInfo(env);
  const bot = me && me.username ? me.username : 'tavarov_pay_bot';
  let info = null;
  try{ info = await partnerInfo(env, u.w); } catch(e){}
  const earned = info && Object.keys(info.earned).length
    ? Object.keys(info.earned).map(sym => money(info.earned[sym], lang) + ' ' + sym).join(' + ') : '0';
  const n = info ? info.merchants.length : 0;
  const page = 'https://wallet.tavarov.com/ref?by=' + u.w;
  const tg = 'https://t.me/' + bot + '?start=r_' + u.w;
  return send(env, chat, L.refCabinet(n, earned, page, tg), { reply_markup: { inline_keyboard: [
    [{ text: L.btnRefShare, url: 'https://t.me/share/url?url=' + encodeURIComponent(tg) + '&text=' + encodeURIComponent(L.refShareText) }],
    [{ text: L.btnRefAbout, url: 'https://tavarov.com/' + (lang === 'ru' ? '' : 'en/') + 'partners' }]
  ] } });
}

function invoiceKeyboard(L, rec, url){
  const share = 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(L.shareText(rec.a, rec.c, rec.i));
  return { inline_keyboard: [
    [{ text: L.btnOpen, url }],
    walletButtons(rec.net || 'bnb', url),
    [{ text: L.btnShare, url: share }],
    [{ text: L.btnCheck, callback_data: 'c:' + rec.h.slice(2, 42) }, { text: L.btnAgain, callback_data: 'r:' + rec.h.slice(2, 42) }]
  ] };
}

async function makeInvoice(env, chat, u, p, L, lang){
  if (!(p.value >= 0.1 && p.value <= 100000)) return send(env, chat, L.amountRange);
  if (await chatLimited(env, chat, 'inv', 20, 600)) return send(env, chat, L.tooMany);
  const net = userNet(u);
  if (net === 'solana' && !okSolWallet(u.sw)){
    u.step = 'sol'; await kvPut(env, kUser(chat), u);
    return send(env, chat, L.solAsk);
  }
  const made = await createTgInvoice(env, { w: u.w, a: p.amount, c: p.cur, i: p.memo, n: u.n || '', tl: lang, chat, net, sm: u.sw });
  if (!made) return send(env, chat, L.amountBad);
  const { rec, url } = made;
  rememberInvoice(u, rec.h);
  delete u.step;
  await kvPut(env, kUser(chat), u);
  const text = L.invoice(rec.a, rec.c, rec.i, Math.round(TG_TTL / 3600)) + '\n' + L.netLine(rec.net || 'bnb') +
               '\n\n<a href="' + esc(url) + '">' + esc(L.btnOpen) + '</a>';
  const kb = invoiceKeyboard(L, rec, url);
  /* Счёт — картинкой с QR-кодом: у прилавка продавец просто показывает
     экран. Не вышло с картинкой — тот же счёт текстом. */
  try{
    const png = await qrPng(url, 8, 4);
    const r = await tgUpload(env, 'sendPhoto', { chat_id: chat, caption: text + '\n\n' + L.qrCaption, parse_mode: 'HTML',
      reply_markup: kb }, 'photo', png, 'invoice-qr.png');
    if (r.ok) return r;
  } catch(e){ /* ниже — текстом */ }
  return send(env, chat, text, { reply_markup: kb });
}

async function listInvoices(env, chat, u, L, lang){
  const hs = (u && u.list || []).slice(0, 10);
  if (!hs.length) return send(env, chat, L.listEmpty);
  const rows = [];
  const t0 = now();
  for (const h of hs){
    const got = await readTgInvoice(env, h);
    if (!got) continue;
    const r = got.rec;
    const mark = { paid: '✅ ' + L.lPaid, pending: '⏳ ' + L.lPending, expired: '⌛ ' + L.lExpired, underpaid: '⚠️ ' + L.lUnder,
                   wrong_currency: '⚠️ ' + L.lCur, refunded: '↩️ ' + L.lRefunded }[got.st] || got.st;
    const left = got.st === 'pending' ? ' (' + Math.max(1, Math.ceil((r.t - t0) / 3600)) + (lang === 'ru' ? ' ч' : ' h') + ')' : '';
    rows.push('• <b>' + money(r.a, lang) + ' ' + r.c + '</b>' + (r.i ? ' — ' + esc(r.i) : '') + ' · ' + mark + left);
  }
  return send(env, chat, L.listHead + '\n\n' + (rows.join('\n') || L.listEmpty));
}

/* Сколько оплатили: сегодня (UTC), за 7 и за 30 дней — по последним счетам. */
async function stats(env, chat, u, L, lang){
  const hs = (u && u.list || []).slice(0, LIST_MAX);
  if (!hs.length) return send(env, chat, L.listEmpty);
  const t0 = now(), day0 = t0 - (t0 % 86400);
  const buckets = [[L.statsToday, day0], [L.statsWeek, t0 - 7 * 86400], [L.statsMonth, t0 - 30 * 86400]].map(([label, from]) => ({ label, from, n: 0, sum: {} }));
  let waiting = 0;
  for (const h of hs){
    const got = await readTgInvoice(env, h);
    if (!got) continue;
    const r = got.rec;
    if (got.st === 'pending'){ waiting++; continue; }
    if (got.st !== 'paid') continue;
    const at = r.wh && r.wh.at || r.ct;
    for (const b of buckets) if (at >= b.from){ b.n++; b.sum[r.c] = (b.sum[r.c] || 0) + Number(r.a); }
  }
  const fmt = sum => Object.keys(sum).map(c => money(String(Math.round(sum[c] * 100) / 100), lang) + ' ' + c).join(' + ');
  const lines = buckets.map(b => L.statsLine(b.label, b.n, fmt(b.sum)));
  return send(env, chat, L.statsHead + '\n\n' + lines.join('\n') + L.statsWaiting(waiting) + L.statsNote, { reply_markup: appButtons(L, 'open') });
}

function netKeyboard(cur){
  const b = n => ({ text: (n === cur ? '✓ ' : '') + netName(n), callback_data: 'n:' + n });
  return { inline_keyboard: [[b('bnb'), b('eth')], [b('base'), b('solana')]] };
}
async function saveSolAddress(env, chat, u, addr, L){
  if (!okSolWallet(addr)) return send(env, chat, L.solBad);
  const on = !!(u.step === 'sol' || u.net === 'solana');
  u.sw = addr;
  if (on){ u.net = 'solana'; }
  if (u.step === 'sol') delete u.step;
  await kvPut(env, kUser(chat), u);
  return send(env, chat, L.solSaved(addr, on));
}

async function onMessage(env, m){
  if (!m || !m.chat || typeof m.text !== 'string') return;
  const chat = String(m.chat.id);
  const lang = langOf(m.from && m.from.language_code);
  const L = txt(lang);
  const text = m.text.trim();
  if (m.chat.type !== 'private'){
    if (text.startsWith('/')) await send(env, chat, L.groups);
    return;
  }
  const cm = text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  const cmd = cm ? cm[1].toLowerCase() : null;
  const arg = cm ? (cm[2] || '').trim() : '';
  const u = await kvGet(env, kUser(chat));

  if (cmd === 'start'){
    /* Ссылка партнёра: t.me/бот?start=r_0x… — запоминаем, кто привёл. */
    const r = arg.match(/^r_(0x[0-9a-fA-F]{40})$/);
    if (r){
      const by = checksumAddress(r[1]);
      if (!(u && u.w && u.w.toLowerCase() === by.toLowerCase())){
        const nu = Object.assign({ list: [], ct: now() }, u || {}, { refBy: by });
        await kvPut(env, kUser(chat), nu);
        if (u && u.w){ await send(env, chat, L.helloBack(u.w), { reply_markup: appButtons(L, 'open') }); return refInvite(env, chat, by, L); }
        return send(env, chat, L.hello(m.from && m.from.first_name), { reply_markup: appButtons(L, 'get') });
      }
    }
    const a = arg.match(/0x[0-9a-fA-F]{40}/);
    if (a) return saveWallet(env, chat, u, a[0], L);
    if (arg === 'help' && u && u.w) return send(env, chat, fillBot(L.help, await botInfo(env)), { reply_markup: appButtons(L, 'get') });
    return send(env, chat, u && u.w ? L.helloBack(u.w) : L.hello(m.from && m.from.first_name), { reply_markup: appButtons(L, u && u.w ? 'open' : 'get') });
  }
  if (cmd === 'help') return send(env, chat, fillBot(L.help, await botInfo(env)), { reply_markup: appButtons(L, 'get') });
  if (cmd === 'wallet'){
    const a = arg.match(/^0x[0-9a-fA-F]{40}$/);
    if (a) return saveWallet(env, chat, u, a[0], L);
    return send(env, chat, u && u.w ? L.walletNow(u.w) : L.needWallet, u && u.w ? undefined : { reply_markup: appButtons(L, 'get') });
  }
  if (cmd === 'network' || cmd === 'net'){
    if (!u || !u.w) return send(env, chat, L.needWallet, { reply_markup: appButtons(L, 'get') });
    return send(env, chat, L.netAsk(userNet(u)), { reply_markup: netKeyboard(userNet(u)) });
  }
  if (cmd === 'solana'){
    if (!u || !u.w) return send(env, chat, L.needWallet, { reply_markup: appButtons(L, 'get') });
    if (!arg){ u.step = 'sol'; await kvPut(env, kUser(chat), u); return send(env, chat, L.solAsk); }
    return saveSolAddress(env, chat, u, arg, L);
  }
  if (cmd === 'list') return listInvoices(env, chat, u, L, lang);
  if (cmd === 'stats') return stats(env, chat, u, L, lang);
  if (cmd === 'ref' || cmd === 'partner' || cmd === 'partners') return partnerCabinet(env, chat, u, L, lang);
  if (cmd === 'name'){
    if (!u || !u.w) return send(env, chat, L.needWallet, { reply_markup: appButtons(L, 'get') });
    if (!arg) return send(env, chat, L.nameAsk);
    const n = arg === '-' ? '' : cleanMemo(arg, 48);
    if (arg !== '-' && (!n || [...arg].length > 48)) return send(env, chat, L.nameBad);
    u.n = n; delete u.step;
    await kvPut(env, kUser(chat), u);
    return send(env, chat, L.nameSaved(n));
  }
  if (cmd) return send(env, chat, L.other);

  /* Адрес кошелька — целиком или внутри короткого сообщения. */
  const addr = text.length <= 120 && text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/);
  if (addr) return saveWallet(env, chat, u, addr[0], L);
  if (/0x[0-9a-fA-F]{20,}/.test(text)) return send(env, chat, L.walletBad);
  /* Адрес Solana — когда мы его ждём или когда сообщение целиком похоже на него. */
  if (u && u.w && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return saveSolAddress(env, chat, u, text, L);
  if (u && u.w && u.step === 'sol' && !parseAmount(text)) return send(env, chat, L.solBad);

  const p = parseAmount(text);
  /* Ждём название магазина: всё, что не похоже на сумму, — это оно.
     «25» или «12,5 кофе» — это уже счёт, спрашивать название перестаём. */
  if (u && u.w && u.step === 'name' && !(p && !p.ambiguous)){
    const n = cleanMemo(text, 48);
    if (!n || [...text].length > 48) return send(env, chat, L.nameBad);
    u.n = n; delete u.step;
    await kvPut(env, kUser(chat), u);
    return send(env, chat, L.nameSaved(n) + '\n\n' + L.ready);
  }
  if (p && p.ambiguous) return send(env, chat, L.amountAmbiguous);
  if (!p) return u && u.w ? send(env, chat, L.amountBad) : send(env, chat, L.needWallet, { reply_markup: appButtons(L, 'get') });
  if (!u || !u.w) return send(env, chat, L.needWallet, { reply_markup: appButtons(L, 'get') });
  return makeInvoice(env, chat, u, p, L, lang);
}

async function onCallback(env, q){
  if (!q || !q.id) return;
  const chat = String(q.message && q.message.chat && q.message.chat.id || (q.from && q.from.id) || '');
  const lang = langOf(q.from && q.from.language_code);
  const L = txt(lang);
  const answer = t => tgCall(env, 'answerCallbackQuery', { callback_query_id: q.id, text: t });
  const data = String(q.data || '');
  const nm = data.match(/^n:(bnb|eth|base|solana)$/);
  if (nm){
    const u = await kvGet(env, kUser(chat));
    if (!u || !u.w){ await answer(''); return send(env, chat, L.needWallet, { reply_markup: appButtons(L, 'get') }); }
    if (nm[1] === 'solana' && !okSolWallet(u.sw)){
      u.step = 'sol'; await kvPut(env, kUser(chat), u);
      await answer('');
      return send(env, chat, L.solAsk);
    }
    u.net = nm[1]; await kvPut(env, kUser(chat), u);
    await answer(netName(nm[1]));
    return send(env, chat, L.netSaved(nm[1]));
  }
  if (data === 'skip'){
    const u = await kvGet(env, kUser(chat));
    if (u && u.step){ delete u.step; await kvPut(env, kUser(chat), u); }
    await answer('');
    return send(env, chat, L.skipped);
  }
  const m = data.match(/^([cr]):([0-9a-f]{40})$/);
  if (!m || !chat) return answer(L.stNotFound);
  if (await chatLimited(env, chat, 'chk', 20, 60)) return answer(L.tooMany);
  const u = await kvGet(env, kUser(chat));
  const h = (u && u.list || []).find(x => x.slice(2, 42) === m[2]);
  if (!h) return answer(L.stNotFound);
  if (m[1] === 'r'){
    const got = await readTgInvoice(env, h);
    if (!got || !u.w) return answer(L.stNotFound);
    await answer('');
    return makeInvoice(env, chat, u, { amount: got.rec.a, value: Number(got.rec.a), cur: got.rec.c, memo: got.rec.i || '' }, L, lang);
  }
  let res = null;
  try{ res = await checkTgInvoice(env, h, chat); } catch(e){ return answer(L.stNet); }
  if (!res) return answer(L.stNotFound);
  return answer(statusLine(L, res.st));
}

/* Встроенный режим: продавец в переписке с клиентом пишет «@бот 25 кофе» —
   в чат уходит счёт с кнопкой «Оплатить». Счёт в хранилище не пишем, пока
   ссылку не открыли: иначе каждая набранная буква тратила бы запись. */
async function onInline(env, q){
  if (!q || !q.id || !q.from) return;
  const lang = langOf(q.from.language_code);
  const L = txt(lang);
  const answer = (results, button) => tgCall(env, 'answerInlineQuery', Object.assign({ inline_query_id: q.id, results,
    cache_time: 0, is_personal: true }, button ? { button } : {}));
  const me = await botInfo(env);
  if (!me.inline){ try{ await kvPut(env, K_ME, Object.assign({}, me, { inline: true })); } catch(e){} }
  const u = await kvGet(env, kUser(String(q.from.id)));
  if (!u || !u.w) return answer([], { text: L.inlineNoWallet, start_parameter: 'inline' });
  const p = parseAmount(q.query);
  if (!p || p.ambiguous || !(p.value >= 0.1 && p.value <= 100000)) return answer([], { text: fillBot(L.inlineHelp, me), start_parameter: 'help' });
  const nonce = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  const net = userNet(u) === 'solana' && !okSolWallet(u.sw) ? 'bnb' : userNet(u);
  const d = b64url(JSON.stringify({ u: String(q.from.id), a: p.amount, c: p.cur, i: p.memo, t: now(), l: lang, n: nonce, k: net }));
  const go = 'https://wallet.tavarov.com/api/tg/go?d=' + d + '&s=' + await linkSig(env, d);
  return answer([{ type: 'article', id: nonce, title: L.inlineTitle(p.amount, p.cur, p.memo), description: L.inlineDesc,
    thumbnail_url: ICON, input_message_content: { message_text: L.inlineMsg(p.amount, p.cur, p.memo, u.n), parse_mode: 'HTML',
      link_preview_options: { is_disabled: true } },
    reply_markup: { inline_keyboard: [[{ text: L.btnPay(p.amount, p.cur), url: go }], walletButtons(net, go)] } }]);
}

function page(title, text, status){
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title></head><body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#222">' +
    '<h2>Tavarov Pay</h2><p>' + esc(text) + '</p></body></html>';
  return new Response(html, { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/* Первое открытие ссылки «Оплатить» из встроенного режима: проверить
   подпись, завести счёт (номер выводится из ссылки — повторное открытие
   найдёт тот же) и отправить на страницу оплаты. */
async function go(request, env){
  const q = new URL(request.url).searchParams;
  const d = q.get('d') || '', s = q.get('s') || '';
  let o = null;
  const ok = d.length < 1500 && /^[0-9a-f]{32}$/.test(s) && safeEqual(s, await linkSig(env, d));
  if (ok){ try{ o = JSON.parse(unb64url(d)); } catch(e){} }
  const L0 = txt(o && o.l);
  if (!o || !/^\d{1,16}$/.test(String(o.u)) || !Number.isInteger(o.t)) return page('Tavarov Pay', L0.goBad, 400);
  const h = '0x' + await sha256hex('tg-inline:' + s + ':' + d);
  const got = await readTgInvoice(env, h);
  if (got) return Response.redirect(tgPayUrl(got.rec), 302);
  if (await overLimit(request, env, 'tggo', 60, 600)) return page('Tavarov Pay', 'Too many requests, try again in a few minutes.', 429);
  const u = await kvGet(env, kUser(String(o.u)));
  if (!u || !u.w) return page('Tavarov Pay', L0.goNoWallet, 404);
  const net = TG_NET_NAMES[o.k] ? o.k : 'bnb';
  const made = await createTgInvoice(env, { w: u.w, a: String(o.a), c: o.c === 'USDC' ? 'USDC' : 'USDT', i: cleanMemo(o.i, 64),
    n: u.n || '', tl: o.l, chat: String(o.u), h, ct: o.t, src: 'telegram-inline', net, sm: u.sw });
  if (!made) return page('Tavarov Pay', L0.goBad, 400);
  rememberInvoice(u, h);
  try{ await kvPut(env, kUser(String(o.u)), u); } catch(e){ /* счёт уже есть — уведомление дойдёт и без списка */ }
  return Response.redirect(made.url, 302);
}

/* Команды и описание бота — на двух языках. */
async function setup(env){
  const me = await tgCall(env, 'getMe', {});
  if (!me.ok) return { ok: false, step: 'getMe', code: me.code, error: me.desc || 'token rejected' };
  const hook = await tgCall(env, 'setWebhook', { url: TG_HOOK_URL, secret_token: await hookSecret(env),
    allowed_updates: ['message', 'callback_query', 'inline_query'], max_connections: 20 });
  const cmds = {
    ru: [{ command: 'start', description: 'Начать' }, { command: 'list', description: 'Последние счета' },
         { command: 'stats', description: 'Сколько оплатили' },
         { command: 'network', description: 'Сеть счетов: BNB, Ethereum, Base, Solana' },
         { command: 'ref', description: 'Партнёрская программа: 20% нашей комиссии' },
         { command: 'wallet', description: 'Кошелёк для оплат' }, { command: 'name', description: 'Название на странице оплаты' },
         { command: 'help', description: 'Как пользоваться' }],
    en: [{ command: 'start', description: 'Start' }, { command: 'list', description: 'Recent invoices' },
         { command: 'stats', description: 'How much was paid' },
         { command: 'network', description: 'Invoice network: BNB, Ethereum, Base, Solana' },
         { command: 'ref', description: 'Partner program: 20% of our fee' },
         { command: 'wallet', description: 'Wallet for payments' }, { command: 'name', description: 'Name on the payment page' },
         { command: 'help', description: 'How it works' }]
  };
  await tgCall(env, 'setMyCommands', { commands: cmds.en });
  await tgCall(env, 'setMyCommands', { commands: cmds.ru, language_code: 'ru' });
  await tgCall(env, 'setMyShortDescription', { short_description: 'Invoices in USDT & USDC. Money goes straight to your wallet, 1% fee. tavarov.com' });
  await tgCall(env, 'setMyShortDescription', { short_description: 'Счета в USDT и USDC. Деньги сразу на ваш кошелёк, комиссия 1%. tavarov.com', language_code: 'ru' });
  await tgCall(env, 'setMyDescription', { description: 'Send an amount — get a payment link and a QR code. Your customer pays in USDT or USDC from any wallet, the money lands in your wallet right away, and I tell you "Paid". 1% fee, no subscription.' });
  await tgCall(env, 'setMyDescription', { description: 'Напишите сумму — получите ссылку и QR-код для оплаты. Покупатель платит в USDT или USDC с любого кошелька, деньги сразу приходят на ваш кошелёк, а я пишу «Оплачено». Комиссия 1%, без абонплаты.', language_code: 'ru' });
  const username = me.result && me.result.username;
  const inline = !!(me.result && me.result.supports_inline_queries);
  try{ await kvPut(env, K_ME, { username, id: me.result && me.result.id, inline }); } catch(e){}
  return { ok: hook.ok, bot: username ? '@' + username : null, link: username ? 'https://t.me/' + username : null,
           webhook: hook.ok ? 'set' : (hook.desc || 'failed'), inline };
}

export async function handle(request, env, waitUntil){
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/tg\/?/, '').split('/').filter(Boolean);
  const method = request.method;
  if (!env || !env.TILL) return json({ error: 'no storage' }, 503);

  if (!parts.length && method === 'GET'){
    const me = await kvGet(env, K_ME);
    return json({ bot: me && me.username ? '@' + me.username : null, link: me && me.username ? 'https://t.me/' + me.username : null });
  }
  if (parts[0] === 'go' && !parts[1] && method === 'GET'){
    if (!hasBot(env)) return page('Tavarov Pay', 'Not found', 404);
    try{ return await go(request, env); }
    catch(e){ console.log('tg go error', e && e.stack || e); return page('Tavarov Pay', 'Something went wrong, try again.', 500); }
  }
  if (parts[0] === 'setup' && !parts[1] && method === 'POST'){
    if (!hasBot(env)) return json({ ok: false, error: 'TG_BOT_TOKEN is not set on this deployment' }, 503);
    if (await overLimit(request, env, 'tgsetup', 5, 600)) return json({ ok: false, error: 'too many requests' }, 429);
    return json(await setup(env));
  }
  if (!parts.length && method === 'POST'){
    if (!hasBot(env)) return json({ error: 'not found' }, 404);
    const got = request.headers.get('x-telegram-bot-api-secret-token') || '';
    if (!safeEqual(got, await hookSecret(env))) return json({ error: 'not found' }, 404);
    let upd = null;
    try{
      const t = await request.text();
      if (t.length > 65536) return json({ ok: true });
      upd = JSON.parse(t);
    } catch(e){ return json({ ok: true }); }
    /* Отвечаем Telegram «200» всегда: иначе он повторит то же сообщение, и
       продавец получит второй счёт на ту же сумму. */
    try{
      if (upd.message) await onMessage(env, upd.message);
      else if (upd.callback_query) await onCallback(env, upd.callback_query);
      else if (upd.inline_query) await onInline(env, upd.inline_query);
    } catch(e){
      console.log('tg error', e && e.stack || e);
      try{
        const chat = upd.message && upd.message.chat && upd.message.chat.id;
        if (chat) await send(env, String(chat), txt(langOf(upd.message.from && upd.message.from.language_code)).off);
      } catch(e2){}
    }
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}

export const onRequest = ctx => handle(ctx.request, ctx.env, p => ctx.waitUntil(p));
