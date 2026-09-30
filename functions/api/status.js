/* "Has this invoice been paid?" — served from the wallet site, not from a
   separate gateway.

   WHY IT LIVES HERE. The gateway used to be its own site on Netlify and was
   never deployed: Netlify ran out of credits, and without a deployed gateway
   a payment link works nowhere except on the seller's own computer. A link
   you cannot send to a buyer is not a link.

   So the invoice pages moved to the wallet site, and this file is their only
   server-side part. Cloudflare Pages picks up the functions folder by itself:
   functions/api/status.js becomes the /api/status endpoint. Nothing to
   configure, and it ships with the same deploy script.

   There are no keys and no money here, and there cannot be: we only read the
   chain.

   THE ONE RULE OF THIS FILE. We say "paid" only when EVERYTHING matches: that
   invoice, that merchant, that currency, and an amount no smaller than the one
   billed. It used to check only the invoice id and the merchant — but the
   invoice id is known to anyone who was sent the payment link. Which meant
   anyone who saw it could pay one cent against the same id and the page would
   tell the shop "paid". */

const PAID_TOPIC =
  '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861';

/* The currency table is not decoration: without an address and a precision
   there is nothing to check the amount against. The numbers are the same as in
   the wallet (the fake dollar on testnet has six decimals, the real one on BNB
   Chain has eighteen). */
const NETS = {
  bnb:        { rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org'],
                pay: '0x1Fc681FA250A17e66B57B7150F2EeD4e71D1Ca35',
                /* The previous payment contract. When version 3 is deployed, its
                   address goes into pay and version 2 moves here: invoices paid
                   through it must still answer "paid". */
                payOld: '0xCa4FE6e5dF7159910b2165Acfa9BB8b19810D65c',
                tokens: { USDT: { a:'0x55d398326f99059fF775485246999027B3197955', d:18 },
                          USDC: { a:'0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', d:18 },
                          TVR:  { a:'0x8Baa77344Fc122967902651D0C3193cdF4c48503', d:18 } } },
  bnbTestnet: { rpcs: ['https://bsc-testnet-rpc.publicnode.com'],
                pay: '0x3A3Ba9776ea9c48AE6C69Ae6153d9bBc892ed6e6',
                payOld: null,
                tokens: { USDT: { a:'0xb4ac75E8CF7c768FFd9fAfeAF1bF77B48209524e', d:6  },
                          TVR:  { a:'0x74536e79b374CCFa0123035B28f7a3b7333f323a', d:18 } } }
};

/* Distance from the head of the chain. Telling a shop "paid" about a
   transaction in the very latest block means handing over goods, one day, for
   a payment a reorg then undid. Twelve blocks on BNB Chain is about six
   seconds — a price worth paying.

   The block window is only needed to find the transaction hash in the logs.
   The "paid" answer itself comes from contract storage, not from logs: storage
   has no depth, so a day-old invoice is found exactly like a minute-old one. */
const LOOKBACK = 3000;
const CONFIRMATIONS = 12;

/* saleOf(bytes32) — the purchase recorded under the invoice id. */
const SALE_OF_SELECTOR = '0x38d56afe';

const hex = n => '0x' + Math.max(0, n).toString(16);
const pad = a => '0x' + '0'.repeat(24) + a.toLowerCase().replace(/^0x/, '');
const word = (data, n) => '0x' + data.replace(/^0x/, '').slice(n * 64, (n + 1) * 64);
const addrAt = (data, n) => '0x' + word(data, n).slice(-40);
const json = (o, code) => new Response(JSON.stringify(o), {
  status: code || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

/* The amount in the link is "12.5", while the chain holds a whole number of
   the smallest units. We convert it as a string, with no floating point: there
   0.1 + 0.2 is not 0.3, and this is money. */
function toUnits(amount, decimals){
  const s = String(amount).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    /* The currency has fewer decimals than the amount does: we must not drop
       the extra digits — the amount would come out smaller than billed and an
       honest payment would be counted as short. Such an invoice simply does not
       happen, but saying so is more honest than rounding. */
    if (/[1-9]/.test(frac.slice(decimals))) return null;
  }
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

/* Ask every known node in turn: one node refusing must not turn into "not
   paid" for someone who has just paid. */
async function rpc(urls, method, params){
  let last = null;
  for (const url of urls){
    try{
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!r.ok){ last = 'node answered ' + r.status; continue; }
      const d = await r.json();
      if (d.error){ last = d.error.message || 'node error'; continue; }
      if (d.result !== undefined && d.result !== null) return d.result;
    } catch(e){ last = String(e && e.message || e); }
  }
  throw new Error(last || 'no node answered');
}

/* Transfer(address,address,uint256) — an ordinary token transfer. */
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/* How far back to look for a direct transfer. A BNB Chain block is about every
   0.75 seconds, so 4000 blocks is roughly an hour. Asking for more is not an
   option: nodes refuse to return logs over a wide range, and instead of an
   answer we would get an error. An hour is enough for a till, where an invoice
   lives for minutes, not days. */
const TRANSFER_LOOKBACK = 4000;
const BLOCK_SECONDS = 0.75;

/* Look for a transfer of the same token to the same merchant. Returns the whole
   answer, or null when nothing fits. */
async function findDirectTransfer(cfg, merchant, want, since, safeBlock){
  /* A payment for this invoice cannot predate the invoice itself. If the
     creation time was not passed (an older link), scan the whole window. */
  let from = Math.max(0, safeBlock - TRANSFER_LOOKBACK);
  if (since > 0){
    const ago = Math.floor(Date.now() / 1000) - since;
    if (ago >= 0){
      const blocks = Math.ceil(ago / BLOCK_SECONDS) + 20;   // slack for uneven block times
      from = Math.max(from, safeBlock - Math.min(blocks, TRANSFER_LOOKBACK));
    }
  }

  let logs;
  try{
    logs = await rpc(cfg.rpcs, 'eth_getLogs', [{
      address: want.token, fromBlock: hex(from), toBlock: hex(safeBlock),
      topics: [TRANSFER_TOPIC, null, pad(merchant)]
    }]);
  } catch(e){ return null; }        // logs refused — stay silent rather than lie

  const candidates = [];
  for (const l of (logs || [])){
    let value;
    try{ value = BigInt(word(l.data, 0)); } catch(e){ continue; }
    if (value < want.units) continue;               // underpaid is not paid
    candidates.push({ tx: l.transactionHash, block: parseInt(l.blockNumber, 16),
                      payer: ('0x' + l.topics[1].slice(-40)).toLowerCase(), value });
  }
  candidates.sort((a, b) => b.block - a.block);     // newest first

  /* Filter out payments made THROUGH our contract. You would think the sender
     gives them away — it does not: the contract moves the money not from
     itself but from the buyer, so the token log shows the buyer's wallet as
     the sender, exactly like an ordinary transfer. Confirmed on a live payment
     on 17 September: 0.198 to the merchant and 0.002 to the treasury, both
     "from the buyer".

     The only way to tell them apart is the transaction itself: a contract
     payment carries logs from our payment contract. If they are there, that
     transfer already belongs to some invoice and must not close another one. */
  /* Оба наших контракта: и нынешний, и прежний. Перевод через прежний тоже
     уже принадлежит какому-то счёту и закрывать чужой счёт не должен. */
  const ours = [cfg.pay, cfg.payOld].filter(Boolean).map(a => a.toLowerCase());
  for (const c of candidates.slice(0, 3)){
    let viaContract = false;
    try{
      const rec = await rpc(cfg.rpcs, 'eth_getTransactionReceipt', [c.tx]);
      viaContract = !!(rec && (rec.logs || []).some(
        l => ours.includes((l.address || '').toLowerCase())));
    } catch(e){
      /* Could not ask — stay silent. Saying "paid" without checking means
         handing over goods, one day, for someone else's payment. */
      continue;
    }
    if (viaContract) continue;
    return { paid: true, tx: c.tx, block: c.block, payer: c.payer,
             token: want.token, amount: c.value.toString(), fee: '0',
             source: 'transfer', direct: true };
  }
  return null;
}

/* Overriding the node and the contract address is for local testing only. On
   Cloudflare these variables do not exist and the real values are used. Without
   that option this file could not be tested end to end: the real network is out
   of reach from a test machine, and untested code here costs money. */
function netConfig(net, env){
  const base = NETS[net];
  const e = env || {};
  return {
    rpcs: e.TAVAROV_RPC ? [e.TAVAROV_RPC] : base.rpcs,
    pay:  e.TAVAROV_PAY || base.pay,
    payOld: e.TAVAROV_PAY_OLD || (e.TAVAROV_PAY ? null : base.payOld),
    tokens: base.tokens
  };
}

export async function onRequestGet({ request, env }){
  const url = new URL(request.url);
  const h = (url.searchParams.get('h') || '').toLowerCase();
  const m = url.searchParams.get('m') || '';
  const net = url.searchParams.get('net') === 'bnbTestnet' ? 'bnbTestnet' : 'bnb';
  const wantAmount = url.searchParams.get('a') || '';
  const wantCur = (url.searchParams.get('c') || '').toUpperCase();

  if (!/^0x[0-9a-f]{64}$/.test(h))    return json({ error: 'bad invoice id' }, 400);
  if (!/^0x[0-9a-fA-F]{40}$/.test(m)) return json({ error: 'bad merchant address' }, 400);

  const cfg = netConfig(net, env);
  if (!cfg.pay) return json({ error: 'payment contract is not configured', paid: false }, 503);

  /* What was to be paid, and how much. Without this there is nothing to check
     against, and we have no right to say "paid": see the rule at the top.

     The rule used to be enforced only when the caller volunteered the amount.
     A caller that left it out got "paid" for one wei — which is exactly the
     hole the rule exists to close. Both our pages always send it; anyone who
     does not is told so, not told "paid". (Audit, 23 September.) */
  if (!wantAmount || !wantCur)
    return json({ error: 'amount (a) and currency (c) are required', paid: false }, 400);
  let want = null;
  {
    const tk = Object.prototype.hasOwnProperty.call(cfg.tokens, wantCur) ? cfg.tokens[wantCur] : null;
    if (!tk) return json({ paid: false, unknown: true,
      error: 'currency ' + (wantCur || '—') + ' is unknown on this network, nothing to check the amount against' });
    const units = toUnits(wantAmount, tk.d);
    if (units === null || units <= 0n) return json({ error: 'bad invoice amount' }, 400);
    want = { token: tk.a.toLowerCase(), units };
  }

  try{
    const latest = parseInt(await rpc(cfg.rpcs, 'eth_blockNumber', []), 16);
    const safe = Math.max(0, latest - CONFIRMATIONS);

    /* Contract storage, at a depth a reorg can no longer reach. Everything
       needed is there: who was paid, how much before the fee, in what, and how
       much has already been refunded. */
    /* Both payment contracts are asked, the current one first. The invoice
       counts where it was recorded FOR THIS MERCHANT: the same id taken by
       someone else in the other contract must not hide it. */
    let sale = null, saleHub = cfg.pay;
    for (const hub of [cfg.pay, cfg.payOld].filter(Boolean)){
      let one = null;
      try{
        const raw = await rpc(cfg.rpcs, 'eth_call',
          [{ to: hub, data: SALE_OF_SELECTOR + h.slice(2) }, hex(safe)]);
        if (raw && raw.length >= 2 + 64 * 7){
          one = { merchant: addrAt(raw, 0), amount: BigInt(word(raw, 1)),
                  buyer: addrAt(raw, 2), refunded: BigInt(word(raw, 3)),
                  token: addrAt(raw, 4) };
        }
      } catch(e){ one = null; }     // the old contract cannot do this
      if (!one) continue;
      if (!sale){ sale = one; saleHub = hub; }
      if (one.merchant.toLowerCase() === m.toLowerCase()){ sale = one; saleHub = hub; break; }
    }

    /* The invoice is not in contract storage, so it was not paid through the
       contract. But it could have been paid by a direct transfer, from the
       second QR code — the one the wallet itself reads. Look for such a
       transfer before saying "not paid".

       WHAT THIS CHECK CANNOT DO, and it must be said. A transfer carries no
       invoice id — there is nowhere in it to put one. So if one merchant has
       two invoices for the same amount outstanding, a single transfer closes
       both. At a till, where an invoice lives for minutes, that is rare; for
       two identical invoices in a row it is not. Said plainly: the answer is
       marked source:"transfer", and the page tells the seller the money came
       as a direct transfer rather than through the contract. */
    const noSale = !sale || sale.merchant === '0x' + '0'.repeat(40)
                         || sale.merchant.toLowerCase() !== m.toLowerCase();
    /* A direct transfer is looked for only when the caller says WHEN the
       invoice was made. Without that the window is a whole hour, and any
       payment of that size to this merchant in the last hour — someone
       else's — would close this invoice. Such an answer is also marked
       uncertain: a transfer carries no invoice id, so the page must not
       paint it the same green as a contract payment. */
    const since = parseInt(url.searchParams.get('s') || '0', 10);
    if (noSale && want && since > 0){
      const direct = await findDirectTransfer(cfg, m, want, since, safe);
      if (direct) return json(Object.assign(direct, { uncertain: true }));
    }

    if (sale){
      if (sale.merchant === '0x' + '0'.repeat(40)) return json({ paid: false });
      /* Someone else's invoice with the same id is not our payment. */
      if (sale.merchant.toLowerCase() !== m.toLowerCase()) return json({ paid: false });
      if (want){
        if (sale.token.toLowerCase() !== want.token)
          return json({ paid: false, wrongToken: true, token: sale.token,
            error: 'paid in the wrong currency' });
        if (sale.amount < want.units)
          return json({ paid: false, underpaid: true,
            amount: sale.amount.toString(), expected: want.units.toString(),
            error: 'paid less than billed' });
      }
      /* The money was refunded — there is nothing to hand the goods over for. */
      if (want && sale.refunded > 0n && sale.amount - sale.refunded < want.units)
        return json({ paid: false, refunded: sale.refunded.toString(),
          error: 'the payment was refunded to the buyer' });

      /* The transaction hash, for the record: look for it in recent blocks. Not
         finding it is no tragedy — it does not affect the "paid" answer. */
      let tx = null, block = null;
      try{
        const logs = await rpc(cfg.rpcs, 'eth_getLogs', [{
          address: saleHub, fromBlock: hex(Math.max(0, safe - LOOKBACK)), toBlock: hex(safe),
          topics: [PAID_TOPIC, pad(m)]
        }]);
        for (const l of (logs || [])){
          if (word(l.data, 3).toLowerCase() !== h) continue;
          tx = l.transactionHash; block = parseInt(l.blockNumber, 16); break;
        }
      } catch(e){ /* logs are optional */ }

      return json({ paid: true, tx, block, payer: sale.buyer, token: sale.token,
        amount: sale.amount.toString(), refunded: sale.refunded.toString(), source: 'sale' });
    }

    /* Fallback: the first version of the contract does not remember purchases,
       so the logs are all there is. They only reach back a few thousand blocks,
       which means a day-old invoice will not be found through them — and the
       answer says so honestly. */
    const to = safe;
    const from = Math.max(0, to - LOOKBACK);
    const logs = await rpc(cfg.rpcs, 'eth_getLogs', [{
      address: cfg.pay, fromBlock: hex(from), toBlock: hex(to), topics: [PAID_TOPIC, pad(m)]
    }]);

    for (const l of (logs || [])){
      if (word(l.data, 3).toLowerCase() !== h) continue;
      const toMerchant = BigInt(word(l.data, 0));
      const fee = BigInt(word(l.data, 1));
      const token = '0x' + l.topics[3].slice(-40);
      if (want){
        if (token.toLowerCase() !== want.token)
          return json({ paid: false, wrongToken: true, token, error: 'paid in the wrong currency' });
        if (toMerchant + fee < want.units)
          return json({ paid: false, underpaid: true,
            amount: (toMerchant + fee).toString(), expected: want.units.toString(),
            error: 'paid less than billed' });
      }
      return json({
        paid: true,
        tx: l.transactionHash,
        block: parseInt(l.blockNumber, 16),
        payer: '0x' + l.topics[2].slice(-40),
        token,
        amount: (toMerchant + fee).toString(),
        fee: fee.toString(),
        source: 'logs'
      });
    }

    return json({ paid: false, shallow: true });
  } catch(e){
    /* A silent node is NOT "not paid". Saying that to someone who has just paid
       means sending them to pay a second time. */
    return json({ error: String(e && e.message || e), paid: false, unknown: true }, 502);
  }
}
