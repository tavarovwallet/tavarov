# Tavarov Pay

Take payments in USDT and USDC on BNB Chain, with no bank in the middle.

A seller fills in an amount and gets a payment link with a QR code. The buyer
pays, and the money goes **from their wallet straight to the seller's wallet**.
We never hold it: there is no balance on our side, no payout schedule, and no
account anyone can freeze.

The wallet is non-custodial. Keys stay on the device; we cannot reach them.

* Website: <https://tavarov.com>
* Wallet and till: <https://wallet.tavarov.com>
* Читать по-русски: [README.ru.md](README.ru.md)

---

## Where this project honestly stands

This section is first on purpose. Anyone can check all of it on bscscan in five
minutes — better to hear it from us.

* **The contracts have not been audited.** The source is public and matches the
  deployed bytecode, but "public" and "reviewed by specialists" are different
  things. Until there is an audit, keep amounts you can afford to lose.
* **There are no real merchants or buyers yet.** The only payments that have
  gone through the mainnet contract are our own test ones. Everything we say
  about speed and convenience is our expectation, not someone else's experience.
* **TVR is loyalty points, not an investment.** They have no price, they trade
  on no exchange, and we are not going to arrange one. More than half the supply
  sits on a single wallet — ours. There is nothing to spend them on yet: the
  name shop is written but deployed nowhere. We are not raising money through
  a token.
* **One wallet owns the contracts.** It can change the fee (never above 2%, that
  limit is in the code), the treasury address and the list of accepted
  currencies. It cannot touch a merchant's revenue. `renounceOwnership` has not
  been called: the rules are still moving.
* **Code comments are in Russian.** That is historical, and it cannot be fixed
  now: bscscan verification is byte-exact, so editing a comment would break the
  match between the source and the deployed bytecode.
* **We now keep one thing on a server, and it is new.** A counter sticker
  carries no amount, so when a seller names a price it is held for ten minutes
  so the buyer can see it. Stored: the seller's address, the till number, the
  amount, the currency, the item name, the time. Not stored: anything about the
  buyer. Whether an invoice was paid is still read from the chain. Until
  September 2026 the honest answer here was "nothing at all"; now it is longer,
  and pretending otherwise would be found out by the first person to read
  `functions/api/till.js`.
* **The Telegram bot keeps a little more.** If you use @tavarov_pay_bot, it
  stores your Telegram chat id, the wallet address you gave it and the invoices
  it created, so it can tell you when one is paid. Delete the chat and it has
  nothing to send to. See `functions/api/tg/`.
* **In-wallet swap charges 0.5%.** NoN Wallet swaps through the KyberSwap
  aggregator; 0.5% of the swap goes to the development wallet. The wallet
  decodes the route before signing and refuses it if the router, tokens,
  receiver, amounts or fee differ from what you were shown.

## Mainnet contracts (BNB Chain, chainId 56)

All nine are verified — source published and matched against the bytecode.
Payments go through **TavarovPay v3**; v2 and the first vault template stay
on-chain for invoices created before the switch.

| What | Address |
|---|---|
| **TavarovPay v3 — payments (current)** | `0x1Fc681FA250A17e66B57B7150F2EeD4e71D1Ca35` |
| **MerchantVault v2 — vault template (current)** | `0x4934F57e6a255f18f6c911a50136879c75bEbBFf` |
| TavarovPay v2 — payments | `0xCa4FE6e5dF7159910b2165Acfa9BB8b19810D65c` |
| TavarovToken — TVR points | `0x8Baa77344Fc122967902651D0C3193cdF4c48503` |
| FeeSplitter — treasury of v2 (v3 sends fees to the development wallet `0x73BBCD23735257660A9f6BE57d057dC4A2ABf432`) | `0x4029B2699340d0356187bd5ed51BA7b61422508A` |
| MerchantVault — vault template | `0x5046399643c387d93E1467BaD3Fd7eDF3FB459DA` |
| TavarovCharges — invoices | `0x82a9D1b0795aC44e8045dB60F30526c4230daFF9` |
| TavarovNames v2 — names | `0x45465B98a3Cc486740Be84fD3B1E21e0D3548360` |
| TavarovNames v3 — names | `0xd6E8A78634bE366bDbD041227D1E94F5b374338e` |

`TavarovNameShop.sol` in this repository is **deployed nowhere** — not on
mainnet, not on testnet. It is written and waiting.

**Partner program.** TavarovPay v3 lets a merchant name a referrer once,
before their first sale. For 12 months the referrer gets 20% of the protocol
fee from that merchant's sales, paid by the contract in the same transaction.
The merchant's revenue and the buyer's price do not change.

Build settings: Pay v3, Vault v2 and the first six use solc `0.8.20+commit.a1b79de6`, optimizer on,
200 runs, EVM `paris`. Names v3 uses solc `0.8.34+commit.80d5c536`, optimizer
**off**, EVM `cancun`.

## How it is put together

```
www/index.html      wallet and till — one app, one file
www/invoice.html    seller's cabinet: create an invoice, watch it get paid
www/pay.html        buyer's page; the invoice itself lives after the # in the URL
www/sticker.html    prints the permanent counter sticker
www/donate.html     streamer donation page; www/alert.html is the OBS alert
www/ref.html        partner invite page: pin a referrer in one transaction
functions/api/      server side: "has this been paid?", "what is the till
                    asking for right now?", the REST API (v1), the Telegram
                    bot (tg) and the partner statistics (_ref.js)
woocommerce/        the Tavarov Pay plugin for WooCommerce (GPL)
site/               the tavarov.com website
token/              contracts
i18n/               dictionaries for five languages, and the build script
audit/              checks that run in a real browser
```

**The invoice is not stored on a server.** It lives entirely inside the link,
after the `#` — which means it never even reaches the host. Whether it was paid
is read from the blockchain, not from a database of ours.

**The counter sticker is the one exception, and a small one.** The sticker
itself is an ordinary https link — that matters, because a phone camera cannot
open `ethereum:` or `tavarov:`, and a code a camera shrugs at is useless on a
counter. It carries the seller's address and till number, and no amount. The
amount is written to a ten-minute scratchpad (Cloudflare KV) by the seller's
till and read back by the buyer's page.

A write has to be signed by the seller's wallet key and is checked in
`functions/api/till.js`. Without that, anyone could set an amount against a
seller's address — it is printed on the sticker, after all — and a real
customer would honestly pay one cent for a two-hundred order. The signature
costs no gas and is not a transaction.

If the scratchpad is not configured, or is down, nothing breaks: the page falls
back to the on-chain charge (`TavarovCharges`), and failing that lets the buyer
type the amount themselves after checking it with the seller.

The app is a single HTML file with no build step. It opens from disk and works
offline wherever the network is not the point.

## Run it yourself

```bash
python3 -m http.server 8099 --directory www
# then open http://localhost:8099/index.html
```

Checks (needs Node and Playwright):

```bash
cd audit && ./runall31.sh
```

Paths inside the checks are absolute — they were written for our build machine.
To run them elsewhere, change the root in `audit/boot.mjs`.

### The counter sticker needs one binding

`functions/api/till.js` keeps the till's current amount in Cloudflare KV. Create
a KV namespace and bind it to the Pages project as `TILL` — that exact name, in
capitals. Nothing else to configure.

Without the binding the endpoint answers honestly and the rest keeps working:
the till says the amount could not be sent to the sticker, and the buyer's page
falls back to the on-chain charge, or to typing the amount by hand.

## Found a hole

Tell us before you tell the world. Details in [SECURITY.md](SECURITY.md).

## Licence

MIT — see [LICENSE](LICENSE).
