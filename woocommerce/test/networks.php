<?php
/* Сети в плагине (2 октября 2026): BNB Chain, Ethereum, Base, Solana;
   X Layer — с 20 ноября 2026 (1.2.0).
   php test/networks.php — без сервера: проверяет, что уходит в API и что
   принимается из ответа. */
namespace Automattic\WooCommerce\Blocks\Payments\Integrations { abstract class AbstractPaymentMethodType { protected $name; protected $settings = array(); public function get_setting( $k, $d = '' ) { return $this->settings[ $k ] ?? $d; } } }
namespace {
require __DIR__ . '/wp-stubs.php';
function wp_register_script( ...$a ) { return true; }
$ok = 0; $bad = 0;
function check( $name, $cond, $info = '' ) { global $ok, $bad; if ( $cond ) { $ok++; echo "OK   $name\n"; } else { $bad++; echo "FAIL $name  [$info]\n"; } }
$LIVE = 'tp_live_' . str_repeat( 'A', 43 ); $TEST = 'tp_test_' . str_repeat( 'A', 43 );
$SOL = 'GdegE4nrvYZFqdm63wWTQaZwVsfuDkEUPgtMKYdnVpFw';
require __DIR__ . '/../tavarov-pay/tavarov-pay.php';
tavarov_pay_init();
function gw( $opts ) { $GLOBALS['__options']['woocommerce_tavarov_pay_settings'] = $opts; $g = new Tavarov_Pay_Gateway(); WC()->pg->list['tavarov_pay'] = $g; return $g; }
function call( $obj, $m, ...$a ) { $r = new ReflectionMethod( $obj, $m ); $r->setAccessible( true ); return $r->invoke( $obj, ...$a ); }
$o = new WC_Order( 7, '19.99' );

$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE ) );
check( 'по умолчанию BNB Chain, USDT', call( $g, 'payment_route' ) === array( 'bnb', 'USDT' ) );
$b = call( $g, 'invoice_request', $o, '19.99', 'USDT', 0, 'bnb' );
check( 'BNB: поле network не отправляется (как в 1.0.0)', ! isset( $b['network'] ) && ! isset( $b['solana_address'] ) );

$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE, 'network' => 'base', 'currency' => 'USDT' ) );
check( 'Base: всегда USDC (USDT там нет)', call( $g, 'payment_route' ) === array( 'base', 'USDC' ) );
$b = call( $g, 'invoice_request', $o, '19.99', 'USDC', 0, 'base' );
check( 'Base: в запросе network=base', 'base' === ( $b['network'] ?? '' ) );

$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE, 'network' => 'ethereum', 'currency' => 'USDC' ) );
check( 'Ethereum: USDC как выбрано', call( $g, 'payment_route' ) === array( 'ethereum', 'USDC' ) );

$g = gw( array( 'enabled' => 'yes', 'api_key' => $TEST, 'network' => 'solana', 'solana_address' => $SOL ) );
check( 'тестовый ключ — всегда тестовая сеть BNB', call( $g, 'payment_route' ) === array( 'bnb', 'USDT' ) );

$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE, 'network' => 'solana', 'solana_address' => $SOL ) );
$b = call( $g, 'invoice_request', $o, '19.99', 'USDT', 0, 'solana' );
check( 'Solana: network и адрес Solana уходят в API', 'solana' === ( $b['network'] ?? '' ) && $SOL === ( $b['solana_address'] ?? '' ) );
$inv = array( 'id' => 'inv_' . str_repeat( 'a', 24 ), 'payment_url' => 'https://wallet.tavarov.com/pay#p=x', 'amount' => '19.99', 'currency' => 'USDT', 'network' => 'solana' );
$idok = Tavarov_Pay_API::id_looks_valid( $inv['id'] );
if ( ! $idok ) { $inv['id'] = '0x' . str_repeat( 'ab', 32 ); }
check( 'ответ API в той же сети — принят', true === call( $g, 'invoice_is_sane', $inv, '19.99', 'USDT', 'solana' ) );
$inv2 = $inv; $inv2['network'] = 'bnb';
check( 'ответ API в другой сети — не принят', false === call( $g, 'invoice_is_sane', $inv2, '19.99', 'USDT', 'solana' ) );
$inv3 = $inv; unset( $inv3['network'] );
check( 'ответ без сети при заказе в Solana — не принят', false === call( $g, 'invoice_is_sane', $inv3, '19.99', 'USDT', 'solana' ) );
$inv4 = $inv; $inv4['network'] = 'eth';
check( 'Ethereum: API пишет eth — принят', true === call( $g, 'invoice_is_sane', $inv4, '19.99', 'USDT', 'ethereum' ) );

/* X Layer (1.2.0): USDT остаётся USDT (там USDT0), в запросе network=xlayer,
   API отвечает network "xlayer", ссылка на транзакцию — в обозреватель OKX. */
$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE, 'network' => 'xlayer', 'currency' => 'USDT' ) );
check( 'X Layer: USDT как выбрано (USDT0 есть)', call( $g, 'payment_route' ) === array( 'xlayer', 'USDT' ) );
$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE, 'network' => 'xlayer', 'currency' => 'USDC' ) );
check( 'X Layer: USDC как выбрано', call( $g, 'payment_route' ) === array( 'xlayer', 'USDC' ) );
$b = call( $g, 'invoice_request', $o, '19.99', 'USDC', 0, 'xlayer' );
check( 'X Layer: в запросе network=xlayer, без solana_address', 'xlayer' === ( $b['network'] ?? '' ) && ! isset( $b['solana_address'] ) );
$inv5 = $inv; $inv5['network'] = 'xlayer';
check( 'X Layer: ответ API в сети xlayer — принят', true === call( $g, 'invoice_is_sane', $inv5, '19.99', 'USDT', 'xlayer' ) );
$inv6 = $inv; $inv6['network'] = 'bnb';
check( 'X Layer: ответ API в BNB — не принят', false === call( $g, 'invoice_is_sane', $inv6, '19.99', 'USDT', 'xlayer' ) );
$inv7 = $inv; unset( $inv7['network'] );
check( 'X Layer: ответ без сети — не принят', false === call( $g, 'invoice_is_sane', $inv7, '19.99', 'USDT', 'xlayer' ) );
$TX = '0x' . str_repeat( 'Ab', 32 );
check( 'X Layer: ссылка на транзакцию — обозреватель OKX', 'https://web3.okx.com/explorer/x-layer/tx/' . strtolower( $TX ) === Tavarov_Pay_Gateway::explorer_link( 'xlayer', $TX, false ) );
check( 'X Layer: не транзакция — без ссылки', '' === Tavarov_Pay_Gateway::explorer_link( 'xlayer', 'abc', false ) );
check( 'Base по-прежнему BaseScan, BNB — BscScan', 'https://basescan.org/tx/' . strtolower( $TX ) === Tavarov_Pay_Gateway::explorer_link( 'base', $TX, false ) && 'https://bscscan.com/tx/' . strtolower( $TX ) === Tavarov_Pay_Gateway::explorer_link( 'bnb', $TX, false ) );
$g = gw( array( 'enabled' => 'yes', 'api_key' => $TEST, 'network' => 'xlayer' ) );
check( 'X Layer и тестовый ключ — тестовая сеть BNB', call( $g, 'payment_route' ) === array( 'bnb', 'USDT' ) );
/* Оплата по счёту X Layer: заказ закрывается только по ответу API о ТОМ ЖЕ
   счёте, сумме и валюте; в заметке — ссылка в обозреватель X Layer. */
$IDX = '0x' . str_repeat( 'cd', 32 );
$ox = new WC_Order( 8, '19.99' );
$ox->update_meta_data( '_tavarov_pay_invoice', $IDX ); $ox->update_meta_data( '_tavarov_pay_amount', '19.99' );
$ox->update_meta_data( '_tavarov_pay_currency', 'USDT' ); $ox->update_meta_data( '_tavarov_pay_network', 'xlayer' ); $ox->update_meta_data( '_tavarov_pay_test', 'no' );
$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE, 'network' => 'xlayer' ) );
$paid = array( 'id' => $IDX, 'status' => 'paid', 'amount' => '19.99', 'currency' => 'USDC', 'network' => 'xlayer', 'payment' => array( 'amount' => '19.99', 'payer' => '0x' . str_repeat( '11', 20 ), 'tx' => $TX ) );
check( 'X Layer: «оплачено» в другой валюте — заказ НЕ оплачен', false === $g->apply_invoice( $ox, $paid ) && ! $ox->is_paid() );
$paid['currency'] = 'USDT'; $paid['amount'] = '19.98';
check( 'X Layer: «оплачено» на другую сумму — заказ НЕ оплачен', false === $g->apply_invoice( $ox, $paid ) && ! $ox->is_paid() );
$paid['amount'] = '19.99'; $paid['id'] = '0x' . str_repeat( 'ef', 32 );
check( 'X Layer: чужой счёт — заказ НЕ оплачен', false === $g->apply_invoice( $ox, $paid ) && ! $ox->is_paid() );
$paid['id'] = $IDX;
check( 'X Layer: тот же счёт, сумма и валюта — оплачен', true === $g->apply_invoice( $ox, $paid ) && $ox->is_paid() );
check( 'X Layer: в заметке ссылка в обозреватель OKX', false !== strpos( implode( "\n", $ox->notes ), 'https://web3.okx.com/explorer/x-layer/tx/' . strtolower( $TX ) ) );

$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE ) );
$ff = $g->get_form_fields();
check( 'в настройках сеть X Layer есть', isset( $ff['network']['options']['xlayer'] ) && 'X Layer' === $ff['network']['options']['xlayer'] );
$version = preg_quote( TAVAROV_PAY_VERSION, '/' );
$plugin = file_get_contents( __DIR__ . '/../tavarov-pay/tavarov-pay.php' );
$readme = file_get_contents( __DIR__ . '/../tavarov-pay/readme.txt' );
check( 'версия совпадает в заголовке, Stable tag и changelog', preg_match( '/^ \* Version:[ \t]+' . $version . '$/m', $plugin ) && preg_match( '/^Stable tag: ' . $version . '$/m', $readme ) && preg_match( '/^= ' . $version . ' =$/m', $readme ) );

$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE, 'network' => 'solana', 'solana_address' => '', 'debug' => 'yes' ) );
$r = $g->process_payment( 7 );
check( 'Solana без адреса — оплата не начинается, понятная ошибка', 'failure' === $r['result'] && false !== strpos( implode( ' ', $GLOBALS['__log'] ?? array() ), 'no Solana address' ) );
ob_start(); $g->admin_options(); $h = ob_get_clean();
check( 'в настройках — предупреждение «нет адреса Solana»', false !== strpos( $h, 'Solana address is not set' ) );
check( 'проверка адреса Solana', Tavarov_Pay_Gateway::solana_address_looks_valid( $SOL ) && ! Tavarov_Pay_Gateway::solana_address_looks_valid( '0x' . str_repeat( '1', 40 ) ) && ! Tavarov_Pay_Gateway::solana_address_looks_valid( 'O0Il' . str_repeat( 'a', 30 ) ) );

echo "\n--- $ok of " . ( $ok + $bad ) . " ---\n";
}
