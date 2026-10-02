/* Проверки: «сырой» ответ getTransaction (encoding: 'json') из старых
   заготовок в виде jsonParsed. Метка счёта (вторая запись accountKeys)
   ставится в перевод продавцу — первый перевод, как собирает наш сервер.
   opts.refIn = 'none' — метка есть в операции, но не в переводе (атака
   «одна операция — много счетов»). */
const { SOL } = await import('/home/claude/apk/functions/api/_sol.js');
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SRC = 'So11111111111111111111111111111111111111112';
export function toRaw(tx, opts){
  if (!tx || !tx.transaction || !tx.transaction.message) return tx;
  const m = tx.transaction.message;
  if (!m.instructions || !m.instructions.some(i => i.parsed)) return tx;
  const keys = [];
  const idx = k => { let i = keys.indexOf(k); if (i < 0){ keys.push(k); i = keys.length - 1; } return i; };
  const ak = (m.accountKeys || []).map(k => typeof k === 'string' ? k : k.pubkey);
  ak.forEach(idx);
  const ref = ak[1];
  const extraRefs = (opts && opts.extraRefs) || [];
  let first = true;
  const ixs = m.instructions.map(ix => {
    const i = ix.parsed.info;
    const amt = BigInt(i.tokenAmount.amount);
    const data = new Uint8Array(10); data[0] = 12; let v = amt; for (let k = 1; k <= 8; k++){ data[k] = Number(v & 255n); v >>= 8n; } data[9] = 6;
    const acc = [idx(SRC), idx(i.mint), idx(i.destination), idx(i.authority)];
    if (first && !(opts && opts.refIn === 'none')){ acc.push(idx(ref)); for (const r of extraRefs) acc.push(idx(r)); }
    first = false;
    return { programIdIndex: idx(TOKEN), accounts: acc, data: SOL.b58enc(data) };
  });
  return { meta: Object.assign({}, tx.meta, { innerInstructions: [] }), transaction: { message: { accountKeys: keys, instructions: ixs } } };
}
