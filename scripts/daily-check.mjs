// Daily health check: sites, bot, partner stats, fees of the last 24 h.
// Writes a summary for GitHub Actions; exits 1 if something is broken,
// so GitHub e-mails the repository owner.
const TREASURY = '0x73bbcd23735257660a9f6be57d057dc4a2abf432';
const T = '0x' + TREASURY.slice(2).padStart(64, '0');
const SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const NETS = {
  'BNB Chain': { rpc: 'https://bsc-rpc.publicnode.com', perDay: 115200, chunk: 5000,
    tokens: { '0x55d398326f99059ff775485246999027b3197955': ['USDT', 18], '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': ['USDC', 18] } },
  'Base': { rpc: 'https://base-rpc.publicnode.com', perDay: 43200, chunk: 10000,
    tokens: { '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': ['USDC', 6], '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': ['USDT', 6] } },
  'Ethereum': { rpc: 'https://ethereum-rpc.publicnode.com', perDay: 7200, chunk: 5000,
    tokens: { '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': ['USDC', 6], '0xdac17f958d2ee523a2206206994597c13d831ec7': ['USDT', 6] } },
};
const problems = [], lines = [];
async function rpc(url, method, params){
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}
async function code(u){ try{ const r = await fetch(u, { redirect: 'follow' }); return r.status; } catch(e){ return 0; } }

lines.push('## Sites');
for (const u of ['https://tavarov.com/', 'https://wallet.tavarov.com/', 'https://creator.tavarov.com/', 'https://wallet.tavarov.com/api/tg']){
  const c = await code(u); lines.push(`- ${c === 200 ? '✅' : '❌'} ${u} (${c})`); if (c !== 200) problems.push(`${u} answered ${c}`);
}

lines.push('', '## Fees received in the last 24 hours (treasury ' + TREASURY + ')');
let bnbHead = 0;
for (const [name, n] of Object.entries(NETS)){
  try{
    const head = parseInt(await rpc(n.rpc, 'eth_blockNumber', []), 16); if (name === 'BNB Chain') bnbHead = head;
    const sum = {}; let count = 0;
    for (let from = head - n.perDay; from <= head; from += n.chunk){
      const logs = await rpc(n.rpc, 'eth_getLogs', [{ fromBlock: '0x' + from.toString(16), toBlock: '0x' + Math.min(from + n.chunk - 1, head).toString(16),
        address: Object.keys(n.tokens), topics: [SIG, null, T] }]);
      for (const l of logs){ const [sym, d] = n.tokens[l.address.toLowerCase()]; sum[sym] = (sum[sym] || 0) + Number(BigInt(l.data)) / 10 ** d; count++; }
    }
    lines.push(`- ${name}: ${count ? Object.entries(sum).map(([s, v]) => v.toFixed(4) + ' ' + s).join(', ') + ` (${count} transfers)` : 'none'}`);
  } catch(e){ lines.push(`- ${name}: could not read (${String(e.message).slice(0, 80)})`); }
}
lines.push('- Solana: not counted here (development wallet Ew2cTsGyPv7pmn6CyLzV1X1K8A6nBWvJvmkvMY1sM4KU)');

lines.push('', '## Partner statistics');
try{
  const a = await (await fetch('https://wallet.tavarov.com/api/v1/partners/' + TREASURY)).json();
  const lag = bnbHead && a.synced_to_block ? bnbHead - a.synced_to_block : null;
  lines.push(`- synced to BNB block ${a.synced_to_block}${lag !== null ? `, ${lag} blocks behind` : ''}`);
  if (lag !== null && lag > 50000) problems.push(`partner statistics are ${lag} blocks behind (cron stuck?)`);
} catch(e){ problems.push('partner API did not answer'); }

if (problems.length) lines.unshift('# ❌ Problems', ...problems.map(p => '- ' + p), '');
else lines.unshift('# ✅ All good', '');
const out = lines.join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY){ const fs = await import('node:fs'); fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n'); }
process.exit(problems.length ? 1 : 0);
