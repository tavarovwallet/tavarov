# Tavarov Pay

A till for sellers. The seller types an amount, the app shows a payment code,
and it watches public BNB Chain nodes until the payment arrives, then says
**Paid** with the amount and a link to the transaction.

It is not a wallet: no keys, no recovery words, no wallet creation or import,
no sending, no swaps, no signing. It holds no money and asks for no secret.
The only things it stores, on the device, are the seller's public payout
address (typed in, or found by NoN name) and the local sales history.

* Application ID: `com.tavarov.pay`
* Web app: [`www/`](www) — `index.html`, `app.js`, `i18n.js` (the wallet's seven
  languages: en, ru, es, tr, pt, tg, id), the QR library and the
  Manrope font copied from the wallet. No blockchain library.
* Android: [`android/`](android) — Capacitor, like `android-app/`, using the
  same vendored Capacitor source (`../android-app/vendor`), without plugins.
* Test: [`../audit/t100-tavarov-pay.mjs`](../audit/t100-tavarov-pay.mjs)

## How a buyer pays

The code is the one the NoN Wallet till makes, so nothing on the server or
in the contracts changes.

| Buyer uses | What happens | 1% fee |
|---|---|---|
| NoN Wallet, scans the QR or opens the link | pays through the TavarovPay contract with the invoice number | yes, from the seller's side |
| Any wallet with a dApp browser or extension (MetaMask, Trust, OKX, …), via the "Payment page" QR / shared link (wallet.tavarov.com/pay.html) | approve + `pay()` through the same contract | yes |
| A wallet app that reads the "Wallet app" QR as a standard EIP-681 token transfer, or a manual transfer to the address | plain token transfer straight to the seller | no |

The till recognises all three: contract payments by `saleOf(invoice)`, plain
transfers by a token Transfer to the seller of at least the amount made after
the code was shown (each transfer counts for one sale only).

## Run in a browser

Serve `www/` with any static server and open `index.html`.

## Build for Android

Requirements: JDK 17 or 21 and the Android SDK.

```sh
sh pay-app/sync-www.sh
cd pay-app/android
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release-unsigned.apk
```

Signing is optional and works as in `android-app/` (`keystore.properties`,
never committed).
