# solcore.js — Solana Pay without dependencies

One file, about 17 KB, no npm packages. It runs unchanged in a browser page,
in a Cloudflare Worker / Pages Function and in Node 18+. The same file is
pasted into the wallet (`www/index.html`), the payment page (`www/pay.html`)
and the server (`functions/api/_sol.js`); a check in `audit/` makes sure the
copies never drift apart.

Why not `@solana/web3.js`: a payment page opened at a shop counter over mobile
data should not download half a megabyte of library to build one transaction.

## What it does

| Function | What for |
|---|---|
| `b58enc`, `b58dec`, `isAddress` | base58 addresses |
| `isOnCurve(bytes)` | is this a real wallet (ed25519 point) and not a program-derived address — refuse to send money to an address nobody can sign for |
| `findPda`, `ata(owner, mint)` | associated token account address |
| `compile(payer, blockhash, ixs)` | legacy message with correct account ordering and merged signer/writable flags |
| `buildPayment(o)` | the merchant payment: create token accounts if missing (idempotent), `transferChecked` to the merchant **with the Solana Pay reference**, `transferChecked` of the fee to the treasury |
| `buildTransfer(o)` | a plain SOL or SPL transfer, optional reference |
| `split(units, feeBps)` | fee rounded down, the remainder to the merchant |
| `checkPayment(tx, o)` | verifies a `getTransaction(..., {encoding:'json'})` result: succeeded, right mint, the reference sits **inside the merchant's transfer instruction** (exactly one reference), enough to the merchant, and the fee is paid on every transfer in the transaction |
| `refFromInvoice(h)` | a 32-byte invoice id ↔ Solana Pay reference |
| `toUnits(amount, decimals)` | "12.5" → integer units, no floats |

## Why `checkPayment` is strict

A naive check ("the reference appears somewhere in the transaction and the
merchant received enough") lets one transaction carry many references and mark
many invoices as paid with a single payment. `checkPayment` only counts a
`transferChecked` whose account list is exactly `[source, mint, destination,
authority, reference]`, and requires the fee on all transfers of that mint in
the transaction. Address-lookup-table keys (v0 transactions) are resolved from
`meta.loadedAddresses`. Tests: `audit/t85-solana.mjs`, `audit/t86-solana-server.mjs`.

## Licence

MIT, like the rest of the repository.
