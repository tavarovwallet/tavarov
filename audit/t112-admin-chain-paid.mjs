// Сводка владельца считает оплаты через контракт (ссылки, касса, донаты),
// по одной записи на запись журнала, и не пишет повторно ту же.
import assert from 'node:assert/strict';
import { recordChainPaid } from '../functions/api/_admin-events.js';

const rows = new Map(); let writes = 0;
const db = { prepare(sql){ return { bind(...a){ return { async run(){ writes++; if (!rows.has(a[0])) rows.set(a[0], a); } }; } }; } };
const store = new Map();
globalThis.caches = { default: { async match(r){ return store.get(r.url); }, async put(r, v){ store.set(r.url, v); } } };
const env = { ADMIN_STATS: db, ADMIN_STATS_SALT: 'salt', ADMIN_STATS_START: '2026-11-16T00:00:00Z' };
const log = { topics: ['0x5862', '0x000000000000000000000000' + 'ab'.repeat(20)], transactionHash: '0xABC', logIndex: '0x2' };

await recordChainPaid(env, 'xlayer', log);
await recordChainPaid(env, 'xlayer', log);
assert.equal(writes, 1, 'second sight of the same log is skipped by the cache mark');
const [id, kind, merchant] = rows.get('paid_chain:xlayer:0xabc:2');
assert.equal(kind, 'paid_chain'); assert.match(merchant, /^[0-9a-f]{64}$/);
assert.ok(!merchant.includes('abab'), 'merchant address is stored only as HMAC');

await recordChainPaid(env, 'xlayer', { ...log, logIndex: '0x3' });
assert.equal(rows.size, 2, 'another log in the same tx counts separately');

delete globalThis.caches;
await recordChainPaid(env, 'bnb', log);
assert.equal(rows.size, 3, 'works without the cache too');
await recordChainPaid({}, 'bnb', log);   // not configured: silently nothing
console.log('t112 ok');
