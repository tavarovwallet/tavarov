// Telegram donation notifications: bot link -> signed save -> notify once.
import { webcrypto } from 'node:crypto';
import { hookSecret } from '../functions/api/_tg.js';
import { handle } from '../functions/api/tg/[[path]].js';
import { onRequestPost, profileText, notifyDonation } from '../functions/api/donate.js';
import { base58 } from '../www/creator/core.mjs';
let ok = 0, bad = 0; const t = (c, n) => { if (c) ok++; else { bad++; console.log('FAIL', n); } };
const m = new Map();
const env = { TG_BOT_TOKEN: '123456:test', V1_NO_THROTTLE: '1', TILL: {
  get: async k => m.has(k) ? m.get(k) : null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } } };
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.telegram.org/')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, result: {} })); }
  throw new Error('unexpected fetch ' + url);
};
const chat = 777001, code = 'Abc_def-0123456789xyzQ';
const hook = (text) => handle(new Request('https://wallet.tavarov.com/api/tg', { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': await_secret },
  body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: chat, type: 'private' }, from: { id: chat, language_code: 'ru' }, text } }) }), env, p => p);
const await_secret = await hookSecret(env);
await hook('/start dn_' + code);
t(JSON.parse(m.get('tgpend:' + code) || '{}').c === String(chat), 'bot stored pending code');
t(/Почти готово/.test(sent.at(-1)?.text || ''), 'bot replied in Russian');

// Solana wallet signs the profile with the code
const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', kp.publicKey)), to = base58(pub);
const ts = Math.floor(Date.now() / 1000);
const body = { action: 'profile', net: 'solana', to, greeting: 'hi', goal: '', target: '', restart: false, ts, telegram: code };
const sig = base58(new Uint8Array(await webcrypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(profileText(body)))));
const post = b => onRequestPost({ request: new Request('https://wallet.tavarov.com/api/donate', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://creator.tavarov.com' }, body: JSON.stringify(b) }), env });
let r = await post({ ...body, sig }); let d = await r.json();
t(r.status === 200 && d.telegram === true, 'signed save links Telegram ' + r.status + JSON.stringify(d));
t(JSON.parse(m.get('donalert:solana:' + to) || '{}').c === String(chat), 'alert key stored');

// tampered: someone else's code with a signature over a different code
r = await post({ ...body, telegram: 'Zzz_def-0123456789xyzQ', sig }); t(r.status === 403, 'code not covered by signature is refused');
// expired code
const ts2 = ts + 1, b2 = { ...body, ts: ts2, telegram: 'Exp_def-0123456789xyzQ' };
const sig2 = base58(new Uint8Array(await webcrypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(profileText(b2)))));
r = await post({ ...b2, sig: sig2 }); d = await r.json(); t(r.status === 410 && d.code === 'telegram_expired', 'unknown code -> 410');
// save without telegram keeps old signature format
t(!profileText({ ...body, telegram: '' }).includes('telegram'), 'old text unchanged without code');

// a confirmed donation is sent to the linked chat, with user text escaped
const before = sent.length;
await notifyDonation(env, 'solana', to, { a: '5000000', d: 6, s: 'USDC', n: 'Ann<b>', m: 'go <script>' });
const msg = sent.at(-1); t(sent.length === before + 1 && msg.chat_id === String(chat), 'notification sent to chat');
t(/Донат 5 USDC/.test(msg.text) && msg.text.includes('Ann&lt;b&gt;') && !msg.text.includes('<script>'), 'text formatted and escaped: ' + msg.text);
// /donoff removes it
await hook('/donoff'); t(!m.has('donalert:solana:' + to), 'donoff removes alert'); t(/отключены/.test(sent.at(-1)?.text || ''), 'donoff reply');
console.log(`donation-telegram: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
