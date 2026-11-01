import { scanReferrals } from '../functions/api/_ref.js';
const mk = () => { const m = new Map(); return { TILL: { get: async k => m.has(k) ? m.get(k) : null, put: async (k, v) => { m.set(k, v); } }, m }; };
let ok = 0, bad = 0; const t = (c, n) => { if (c) ok++; else { bad++; console.log('FAIL', n); } };
// 1. far behind, node refuses old blocks -> jump, then reads
{ const env = mk(); env.m.set('ref:cur', '122729954'); const safe = 131044000; const calls = [];
  const rpc = async (m, p) => { const f = parseInt(p[0].fromBlock, 16); calls.push(f); if (safe - f > 800000) throw new Error('Archive requests require a personal token'); return []; };
  const r = await scanReferrals(env, rpc, '0x1', safe, {}, 'bnb');
  t(r.jumped === safe - 400000, 'jump target'); t(Number(env.m.get('ref:cur')) >= safe - 400000, 'cursor saved'); t(!!env.m.get('ref:cur:gap'), 'gap noted'); t(calls.length >= 4, 'wide+small failed, then reads'); }
// 2. near head, transient error -> no jump, throws, cursor unchanged
{ const env = mk(); env.m.set('ref:cur', '131040000'); let threw = false;
  try { await scanReferrals(env, async () => { throw new Error('timeout'); }, '0x1', 131044000, {}, 'bnb'); } catch (e) { threw = true; }
  t(threw, 'rethrow near head'); t(env.m.get('ref:cur') === '131040000', 'cursor kept'); t(!env.m.get('ref:cur:gap'), 'no gap'); }
// 3. eth keys and limits
{ const env = mk(); env.m.set('ref:eth:cur', '26140000'); const safe = 26319700;
  const rpc = async (m, p) => { const f = parseInt(p[0].fromBlock, 16); if (safe - f > 10000) throw new Error('archive'); return []; };
  const r = await scanReferrals(env, rpc, '0x1', safe, {}, 'eth'); t(r.jumped === safe - 9000, 'eth jump'); t(!!env.m.get('ref:eth:cur:gap'), 'eth gap'); }
// 4. normal path unchanged
{ const env = mk(); env.m.set('ref:cur', '131000000'); const r = await scanReferrals(env, async () => [], '0x1', 131044000, {}, 'bnb'); t(r.cur === 131000000 + 2 * 4999 && !r.jumped, 'normal'); }
// 5. wide request fails, small one works -> advances by 999 and saves
{ const env = mk(); env.m.set('ref:cur', '130680989'); const safe = 131070000;
  const rpc = async (m, p) => { const f = parseInt(p[0].fromBlock, 16), t = parseInt(p[0].toBlock, 16); if (t - f > 1000) throw new Error('node error'); return []; };
  const r = await scanReferrals(env, rpc, '0x1', safe, {}, 'bnb'); t(r.cur === 130680989 + 2 * 999, 'small chunks'); t(env.m.get('ref:cur') === String(130680989 + 2 * 999), 'saved small'); }
// 6. first chunk ok, second fails completely -> keep first, no throw
{ const env = mk(); env.m.set('ref:cur', '130680989'); let n = 0; const safe = 131070000;
  const rpc = async () => { if (++n > 1) throw new Error('down'); return []; };
  const r = await scanReferrals(env, rpc, '0x1', safe, {}, 'bnb'); t(r.cur === 130680989 + 4999, 'partial kept'); t(env.m.get('ref:cur') === String(130680989 + 4999), 'partial saved'); }
console.log(`ref-archive-jump: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
