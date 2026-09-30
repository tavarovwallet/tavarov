=== Tavarov Pay ===
Contributors: tavarov
Tags: crypto, usdt, usdc, cryptocurrency, payment gateway
Requires at least: 6.2
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Accept USDT and USDC on BNB Chain. Customers pay from any wallet, the money goes straight to your own wallet. No custodian, 1% fee.

== Description ==

Tavarov Pay adds a "USDT or USDC" payment method to WooCommerce checkout.

At checkout the customer is sent to a Tavarov Pay payment page with a QR code and "pay with wallet" buttons. They pay from any wallet — MetaMask, Trust Wallet, OKX, NoN Wallet and others. The payment goes through a small public contract on BNB Chain: **99% lands in your wallet in the same transaction, 1% is the Tavarov Pay fee.** Nobody holds your money, there are no payouts to wait for and no chargebacks.

Your order is marked paid automatically:

* by a signed webhook, within seconds of the payment;
* when the customer returns to the "order received" page;
* by background re-checks, even if neither of the above happened.

In every case the plugin asks the Tavarov Pay API itself before marking an order paid, so a forged webhook cannot complete an order.

**Features**

* USDT or USDC on BNB Chain (BEP-20).
* Classic checkout and the Checkout block.
* High-Performance Order Storage (HPOS) compatible.
* Underpaid or wrong-currency payments put the order on hold with a note instead of completing it.
* Test mode: a `tp_test_` key uses test dollars on the BNB test network.
* "Check Tavarov Pay payment" action on the order screen.

**Requirements**

* Store currency: US dollar (USD). Prices are charged 1:1 in USD stablecoins.
* A wallet on BNB Chain that will receive the money (any EVM wallet).
* A free API key from the developer cabinet: https://wallet.tavarov.com/dev

The payment contracts are open source and verified on BscScan: https://bscscan.com/address/0x1Fc681FA250A17e66B57B7150F2EeD4e71D1Ca35#code

== External services ==

This plugin relies on the **Tavarov Pay API** (https://wallet.tavarov.com/api/v1), operated by Tavarov, to create payment pages and to check whether they were paid. Without it the payment method does not work.

What is sent, and when:

* **When a customer places an order with this method:** order amount, currency (USDT/USDC), an order reference (order ID plus a short hash of your site address), the text "Order #N", your site title, the invoice lifetime, the customer's language, the "order received" page address, the WooCommerce order ID and your site's host name. Your API key is sent in the Authorization header. **No customer name, email, address or phone number is sent.**
* **When checking a payment** (webhook, return page, background check, or the "Check payment" order action): the invoice ID and your API key.
* The customer's browser opens the payment page at https://wallet.tavarov.com/pay, which reads the BNB Chain network through public RPC nodes to show the payment status.

Tavarov Pay terms of use: https://tavarov.com/terms.html
Tavarov Pay privacy policy: https://tavarov.com/privacy.html

Payments themselves happen on BNB Chain between the customer's wallet and the Tavarov Pay contract; they are public, like every blockchain transaction.

== Installation ==

1. Install and activate the plugin (WooCommerce must be active).
2. Open https://wallet.tavarov.com/dev and sign in with the wallet that should receive the money. Signing in is a free message signature, it does not move any funds.
3. Create a key (start with a `tp_test_` key to try it on the test network) and paste it into WooCommerce → Settings → Payments → Tavarov Pay.
4. In the cabinet, set the webhook URL shown on the plugin's settings page and paste the `whsec_…` secret into the plugin settings.
5. Enable the method. Place a test order, pay it with test dollars (the cabinet has a "get 100 test USDT" button), then switch to a `tp_live_` key.

== Frequently Asked Questions ==

= Who holds the money? =

Nobody. Each payment is one transaction through the Tavarov Pay contract: 99% to your wallet, 1% fee. There is no balance with us and nothing to withdraw.

= My store is not in USD. =

Tavarov Pay charges in US dollar stablecoins, so the method is offered only when the store currency is USD. Developers can extend the list with the `tavarov_pay_supported_currencies` filter if their prices are already in dollars.

= What if the customer pays less? =

The order is put on hold with a note, and it is not marked paid. The same happens if they pay in the other stablecoin.

= Refunds? =

Refunds are sent from your wallet (the NoN Wallet app has a refund button for payments made through the contract). WooCommerce refunds through this plugin are not supported yet.

= Is there a token I need to buy? =

No. Payments are in USDT and USDC only.

== Changelog ==

= 1.0.0 =
* First release: invoices, signed webhooks, return-page and background checks, Checkout block, HPOS.
