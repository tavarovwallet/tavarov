/* ===================== Solana: оплата одной операцией =====================
   Общий код для кошелька (www/index.html), страницы оплаты (www/pay.html)
   и сервера (functions/api/solpay.js). Держится в одном файле и вставляется
   в три места как есть — проверка t85 следит, чтобы копии не разошлись.

   Зачем свой, а не библиотека Solana. Нужны четыре вещи: адрес счёта монеты
   (PDA), сборка операции, разбор адреса base58 и проверка «точка ли это на
   кривой». Библиотека для этого — полмегабайта на страницу, которую
   открывают у прилавка по мобильному интернету.

   КАК УСТРОЕНА ОПЛАТА. Контракта (программы) у нас в Solana нет и не нужно:
   одна операция Solana может содержать несколько переводов, и проходят они
   только все вместе. Поэтому в операции:
     1) завести счёт монеты продавцу, если его ещё нет (createIdempotent —
        если есть, ничего не делает и ничего не стоит);
     2) то же для кошелька развития;
     3) продавцу — сумма минус 1%, с меткой счёта (reference): по этой
        метке сервер находит именно эту оплату, как в стандарте Solana Pay;
     4) кошельку развития — 1%.
   Переводы — transferChecked: в нём указаны монета и число знаков, и сеть
   сама отклонит операцию, если кто-то подменит монету.                    */
const SOL = (() => {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58enc(bytes){
    let num = 0n;
    for (const b of bytes) num = num * 256n + BigInt(b);
    let out = '';
    while (num > 0n){ out = B58[Number(num % 58n)] + out; num /= 58n; }
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out = '1' + out;
    return out;
  }
  function b58dec(str, len){
    if (typeof str !== 'string' || !str) throw new Error('bad base58');
    let num = 0n;
    for (const ch of str){ const i = B58.indexOf(ch); if (i < 0) throw new Error('bad base58'); num = num * 58n + BigInt(i); }
    const bytes = [];
    while (num > 0n){ bytes.unshift(Number(num & 255n)); num >>= 8n; }
    for (const ch of str){ if (ch === '1') bytes.unshift(0); else break; }
    if (len !== undefined){
      if (bytes.length > len) throw new Error('bad length');
      while (bytes.length < len) bytes.unshift(0);
    }
    return new Uint8Array(bytes);
  }
  /* Адрес Solana — 32 байта. Пустая строка, лишние буквы, 31 байт — нет. */
  function isAddress(s){
    if (typeof s !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
    try{ return b58dec(s).length === 32; } catch(e){ return false; }
  }
  const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of a){ o.set(x, p); p += x.length; } return o; };
  const u8 = n => new Uint8Array([n]);
  function u64(v){ const b = new Uint8Array(8); let x = BigInt(v); for (let i = 0; i < 8; i++){ b[i] = Number(x & 255n); x >>= 8n; } return b; }
  function cu16(n){ const o = []; for (;;){ let e = n & 0x7f; n >>= 7; if (n){ o.push(e | 0x80); } else { o.push(e); break; } } return new Uint8Array(o); }
  async function sha256(bytes){ return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  /* ---------- Точка ли на кривой ed25519 ----------
     Адрес счёта монеты (PDA) обязан НЕ лежать на кривой: у такой точки нет
     закрытого ключа, и деньгами на ней распоряжается только программа. Чтобы
     найти правильный адрес, перебираем «bump» от 255 вниз, пока хеш не
     окажется вне кривой. Проверка — распаковка точки: y из байт, x² из
     уравнения кривой; если x² не квадрат по модулю p — точки нет. */
  const P = 2n ** 255n - 19n;
  const D = (-121665n * modInv(121666n)) % P;
  function mod(a){ const r = a % P; return r >= 0n ? r : r + P; }
  function pow(b, e){ let r = 1n; b = mod(b); while (e > 0n){ if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; }
  function modInv(a){ return pow(a, P - 2n); }
  function isOnCurve(bytes){
    let y = 0n;
    for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
    if (y >= P) return false;
    const y2 = y * y % P;
    const u = mod(y2 - 1n), v = mod(D * y2 + 1n);
    const x2 = u * modInv(v) % P;
    if (x2 === 0n) return true;
    return pow(x2, (P - 1n) / 2n) === 1n;      // критерий Эйлера: квадрат ли
  }
  async function findPda(seeds, programId){
    for (let bump = 255; bump >= 0; bump--){
      const h = await sha256(cat(...seeds, u8(bump), programId, new TextEncoder().encode('ProgramDerivedAddress')));
      if (!isOnCurve(h)) return h;
    }
    throw new Error('no PDA');
  }

  const SYSTEM = new Uint8Array(32);
  const COMPUTE = b58dec('ComputeBudget111111111111111111111111111111', 32);
  const TOKEN = b58dec('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 32);
  const ATA_PROGRAM = b58dec('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 32);
  /* Счёт монеты для владельца — тот самый, который заводят все кошельки. */
  function ata(owner, mint){ return findPda([owner, TOKEN, mint], ATA_PROGRAM); }

  /* ---------- Сборка операции (legacy) ----------
     Порядок адресов задан сетью: сначала подписывающие с записью (плательщик
     комиссии — самым первым), потом подписывающие без записи, потом
     остальные с записью, потом остальные только для чтения. */
  function compile(payer, blockhash, ixs){
    const keys = [];
    const find = k => keys.findIndex(x => eq(x.k, k));
    const add = (k, s, w) => { const i = find(k); if (i < 0) keys.push({ k, s, w }); else { keys[i].s = keys[i].s || s; keys[i].w = keys[i].w || w; } };
    add(payer, true, true);
    for (const ix of ixs){ for (const a of ix.keys) add(a.k, a.s, a.w); add(ix.program, false, false); }
    const rank = x => eq(x.k, payer) ? -1 : (x.s && x.w) ? 0 : x.s ? 1 : x.w ? 2 : 3;
    const sorted = keys.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(o => o.x);
    const idx = k => sorted.findIndex(x => eq(x.k, k));
    const nSig = sorted.filter(x => x.s).length;
    const nRoSig = sorted.filter(x => x.s && !x.w).length;
    const nRo = sorted.filter(x => !x.s && !x.w).length;
    const parts = [u8(nSig), u8(nRoSig), u8(nRo), cu16(sorted.length), ...sorted.map(x => x.k), blockhash, cu16(ixs.length)];
    for (const ix of ixs){
      parts.push(u8(idx(ix.program)), cu16(ix.keys.length), new Uint8Array(ix.keys.map(a => idx(a.k))), cu16(ix.data.length), ix.data);
    }
    return { message: cat(...parts), signers: nSig };
  }

  const createAtaIx = (payer, ataAddr, owner, mint) => ({ program: ATA_PROGRAM, data: u8(1), keys: [
    { k: payer, s: true, w: true }, { k: ataAddr, s: false, w: true }, { k: owner, s: false, w: false },
    { k: mint, s: false, w: false }, { k: SYSTEM, s: false, w: false }, { k: TOKEN, s: false, w: false } ] });
  const transferCheckedIx = (src, mint, dst, owner, amount, decimals, extra) => ({ program: TOKEN,
    data: cat(u8(12), u64(amount), u8(decimals)),
    keys: [ { k: src, s: false, w: true }, { k: mint, s: false, w: false }, { k: dst, s: false, w: true },
            { k: owner, s: true, w: false }, ...(extra || []).map(k => ({ k, s: false, w: false })) ] });

  /* Небольшая «надбавка за скорость»: без неё в часы нагрузки операция
     может не попасть в блок вовсе. 50 000 микролампортов за единицу при
     пределе 80 000 единиц — это 4 000 лампортов, сотые доли цента. */
  const u32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const budgetIxs = () => [
    { program: COMPUTE, data: cat(u8(2), u32(80000)), keys: [] },
    { program: COMPUTE, data: cat(u8(3), u64(50000)), keys: [] } ];

  /* Сколько уходит продавцу и сколько — комиссия. Комиссия округляется вниз:
     лишняя доля цента остаётся продавцу, а не нам. */
  function split(units, feeBps){
    const fee = BigInt(units) * BigInt(feeBps) / 10000n;
    return { fee, toMerchant: BigInt(units) - fee };
  }

  /* Операция оплаты. Все адреса — строками base58, сумма — в мельчайших
     долях монеты (BigInt или строка). Возвращает неподписанное сообщение. */
  async function buildPayment(o){
    for (const k of ['payer', 'merchant', 'treasury', 'mint', 'reference', 'blockhash'])
      if (!isAddress(o[k])) throw new Error('bad ' + k);
    if (o.merchant === o.payer) throw new Error('cannot pay yourself');
    const payer = b58dec(o.payer, 32), merchant = b58dec(o.merchant, 32), treasury = b58dec(o.treasury, 32);
    const mint = b58dec(o.mint, 32), ref = b58dec(o.reference, 32), bh = b58dec(o.blockhash, 32);
    const { fee, toMerchant } = split(o.units, o.feeBps === undefined ? 100 : o.feeBps);
    if (toMerchant <= 0n) throw new Error('bad amount');
    const [src, dstM, dstT] = await Promise.all([ata(payer, mint), ata(merchant, mint), ata(treasury, mint)]);
    const ixs = [ ...budgetIxs(), createAtaIx(payer, dstM, merchant, mint) ];
    if (fee > 0n && !eq(treasury, merchant)) ixs.push(createAtaIx(payer, dstT, treasury, mint));
    ixs.push(transferCheckedIx(src, mint, dstM, payer, toMerchant, o.decimals, [ref]));
    if (fee > 0n) ixs.push(transferCheckedIx(src, mint, dstT, payer, fee, o.decimals));
    const { message } = compile(payer, bh, ixs);
    return { message, fee, toMerchant, ata: { src: b58enc(src), merchant: b58enc(dstM), treasury: b58enc(dstT) } };
  }

  /* Обычный перевод: SOL — системной программой, монета — transferChecked
     в счёт монеты получателя (заводим его, если нет: иначе перевод на
     новый кошелёк просто отклоняется). */
  async function buildTransfer(o){
    for (const k of ['payer', 'to', 'blockhash']) if (!isAddress(o[k])) throw new Error('bad ' + k);
    const payer = b58dec(o.payer, 32), to = b58dec(o.to, 32), bh = b58dec(o.blockhash, 32);
    const units = BigInt(o.units);
    if (units <= 0n) throw new Error('bad amount');
    const extra = o.reference && isAddress(o.reference) ? [b58dec(o.reference, 32)] : [];
    let ixs;
    if (!o.mint){
      ixs = [ { program: SYSTEM, data: cat(u32(2), u64(units)),
                keys: [ { k: payer, s: true, w: true }, { k: to, s: false, w: true }, ...extra.map(k => ({ k, s: false, w: false })) ] } ];
    } else {
      const mint = b58dec(o.mint, 32);
      const [src, dst] = await Promise.all([ata(payer, mint), ata(to, mint)]);
      ixs = [ createAtaIx(payer, dst, to, mint), transferCheckedIx(src, mint, dst, payer, units, o.decimals, extra) ];
    }
    return { message: compile(payer, bh, [...budgetIxs(), ...ixs]).message };
  }

  /* Операция целиком: число подписей, подписи, сообщение. Пустая подпись —
     нули: так операцию отдают кошельку на подпись (Solana Pay). */
  function serialize(message, signatures){
    return cat(cu16(signatures.length), ...signatures, message);
  }

  /* ---------- Найдена ли оплата ----------
     По метке счёта сеть отдаёт номера операций; каждую разбираем и верим
     только тому, что совпало ВСЁ: успешна, монета та, продавцу пришло не
     меньше положенного, кошельку развития — не меньше 1%, и метка стоит
     В САМОМ ПЕРЕВОДЕ продавцу (как в стандарте Solana Pay), а не где-то в
     операции. Иначе одна операция с десятком чужих меток «оплатила» бы
     десяток счетов (аудит 2 октября 2026). Поэтому разбор — по «сырому»
     ответу узла (encoding: 'json'): в jsonParsed лишние адреса перевода,
     в том числе метка, теряются. Адреса из таблиц (v0) — в loadedAddresses. */
  function checkPayment(tx, o){
    if (!tx || !tx.meta || tx.meta.err) return { ok: false, why: 'failed' };
    const msg = tx.transaction && tx.transaction.message;
    if (!msg) return { ok: false, why: 'no message' };
    const la = tx.meta.loadedAddresses || {};
    const keys = [...(msg.accountKeys || []), ...(la.writable || []), ...(la.readonly || [])].map(k => typeof k === 'string' ? k : k && k.pubkey);
    const tokenProg = b58enc(TOKEN);
    const bps = o.feeBps === undefined ? 100 : o.feeBps;
    const want = split(o.units, bps);
    let toM = 0n, toMAll = 0n, nM = 0, toT = 0n, toAll = 0n, nAll = 0, payer = null;
    const ixs = [...(msg.instructions || [])];
    for (const inner of (tx.meta.innerInstructions || [])) ixs.push(...(inner.instructions || []));
    for (const ix of ixs){
      if (!ix || typeof ix.programIdIndex !== 'number' || keys[ix.programIdIndex] !== tokenProg) continue;
      let d; try{ d = b58dec(String(ix.data || '')); } catch(e){ continue; }
      if (d.length !== 10 || d[0] !== 12) continue;                 // transferChecked
      const acc = (ix.accounts || []).map(i => keys[i]);
      if (acc.length < 4 || acc[1] !== o.mint) continue;
      let amt = 0n; for (let i = 8; i >= 1; i--) amt = (amt << 8n) | BigInt(d[i]);
      if (acc[2] !== o.treasuryAta){ toAll += amt; nAll++; }
      if (acc[2] === o.merchantAta){
        toMAll += amt; nM++;
        /* Ровно одна метка и это наша: с несколькими метками в одном
           переводе одна оплата закрыла бы несколько счетов. */
        if (acc.length === 5 && acc[4] === o.reference){ toM += amt; payer = payer || acc[3]; }
      } else if (acc[2] === o.treasuryAta) toT += amt;
    }
    if (toM === 0n) return { ok: false, why: toMAll > 0n ? 'no reference' : 'not to merchant' };
    if (toM < want.toMerchant) return { ok: false, why: 'underpaid', got: toM.toString() };
    if (toT < want.fee) return { ok: false, why: 'no fee', got: toM.toString() };
    /* Несколько переводов в одной операции (тому же или другим продавцам) —
       1% нужен со всех: один перевод в казну на всех не в счёт. */
    if (bps > 0 && toT * BigInt(10000 - bps) + BigInt(nAll) * 10000n < toAll * BigInt(bps)) return { ok: false, why: 'no fee', got: toM.toString() };
    return { ok: true, payer, toMerchant: toM.toString(), fee: toT.toString(), toMerchantAll: toMAll.toString(), transfers: nM,
             toAll: toAll.toString(), transfersAll: nAll };
  }

  /* Номер счёта (0x + 64 знака) и метка Solana Pay — одно и то же число:
     метка — это те же 32 байта в base58. Сервер, страница и кошелёк
     получают её из номера счёта одинаково и не могут разойтись. */
  function refFromInvoice(h){
    if (!/^0x[0-9a-fA-F]{64}$/.test(h || '')) throw new Error('bad invoice');
    const b = new Uint8Array(32);
    for (let i = 0; i < 32; i++) b[i] = parseInt(h.slice(2 + i * 2, 4 + i * 2), 16);
    return b58enc(b);
  }
  /* Сумма «12.5» → мельчайшие доли, строкой, без дробных чисел. */
  function toUnits(amount, decimals){
    const s = String(amount).trim();
    if (!/^\d{1,12}(\.\d+)?$/.test(s)) return null;
    const [w, f = ''] = s.split('.');
    if (f.length > decimals && /[1-9]/.test(f.slice(decimals))) return null;
    return BigInt(w + f.padEnd(decimals, '0').slice(0, decimals));
  }

  return { b58enc, b58dec, isAddress, isOnCurve, findPda, ata, compile, buildPayment, buildTransfer, serialize, split, checkPayment,
           refFromInvoice, toUnits,
           TOKEN, ATA_PROGRAM, SYSTEM };
})();
