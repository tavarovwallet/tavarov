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
  name shop is written but deployed nowhere.
* **One wallet owns the contracts.** It can change the fee (never above 2%, that
  limit is in the code), the treasury address and the list of accepted
  currencies. It cannot touch a merchant's revenue. `renounceOwnership` has not
  been called: the rules are still moving.
* **Code comments are in Russian.** That is historical, and it cannot be fixed
  now: bscscan verification is byte-exact, so editing a comment would break the
  match between the source and the deployed bytecode.

## Mainnet contracts (BNB Chain, chainId 56)

All seven are verified — source published and matched against the bytecode.

| What | Address |
|---|---|
| TavarovPay v2 — payments | `0xCa4FE6e5dF7159910b2165Acfa9BB8b19810D65c` |
| TavarovToken — TVR points | `0x8Baa77344Fc122967902651D0C3193cdF4c48503` |
| FeeSplitter — treasury | `0x4029B2699340d0356187bd5ed51BA7b61422508A` |
| MerchantVault — vault template | `0x5046399643c387d93E1467BaD3Fd7eDF3FB459DA` |
| TavarovCharges — invoices | `0x82a9D1b0795aC44e8045dB60F30526c4230daFF9` |
| TavarovNames v2 — names | `0x45465B98a3Cc486740Be84fD3B1E21e0D3548360` |
| TavarovNames v3 — names | `0xd6E8A78634bE366bDbD041227D1E94F5b374338e` |

`TavarovNameShop.sol` in this repository is **deployed nowhere** — not on
mainnet, not on testnet. It is written and waiting.

Build settings: the first six use solc `0.8.20+commit.a1b79de6`, optimizer on,
200 runs, EVM `paris`. Names v3 uses solc `0.8.34+commit.80d5c536`, optimizer
**off**, EVM `cancun`.

## How it is put together

```
www/index.html      wallet and till — one app, one file
www/invoice.html    seller's cabinet: create an invoice, watch it get paid
www/pay.html        buyer's page; the invoice itself lives after the # in the URL
functions/api/      the only server-side part: "has this invoice been paid?"
site/               the tavarov.com website
token/              contracts
i18n/               dictionaries for five languages, and the build script
audit/              checks that run in a real browser
```

**The invoice is not stored on a server.** It lives entirely inside the link,
after the `#` — which means it never even reaches the host. Whether it was paid
is read from the blockchain, not from our database: there is no database.

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

## Found a hole

Tell us before you tell the world. Details in [SECURITY.md](SECURITY.md).

## Licence

MIT — see [LICENSE](LICENSE).
