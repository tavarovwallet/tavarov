<?php
/* Сети в плагине (2 октября 2026): BNB Chain, Ethereum, Base, Solana.
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

$g = gw( array( 'enabled' => 'yes', 'api_key' => $LIVE, 'network' => 'solana', 'solana_address' => '', 'debug' => 'yes' ) );
$r = $g->process_payment( 7 );
check( 'Solana без адреса — оплата не начинается, понятная ошибка', 'failure' === $r['result'] && false !== strpos( implode( ' ', $GLOBALS['__log'] ?? array() ), 'no Solana address' ) );
ob_start(); $g->admin_options(); $h = ob_get_clean();
check( 'в настройках — предупреждение «нет адреса Solana»', false !== strpos( $h, 'Solana address is not set' ) );
check( 'проверка адреса Solana', Tavarov_Pay_Gateway::solana_address_looks_valid( $SOL ) && ! Tavarov_Pay_Gateway::solana_address_looks_valid( '0x' . str_repeat( '1', 40 ) ) && ! Tavarov_Pay_Gateway::solana_address_looks_valid( 'O0Il' . str_repeat( 'a', 30 ) ) );

echo "\n--- $ok of " . ( $ok + $bad ) . " ---\n";
}
