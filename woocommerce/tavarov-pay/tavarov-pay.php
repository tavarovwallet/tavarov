<?php
/**
 * Plugin Name:       Tavarov Pay
 * Plugin URI:        https://tavarov.com/woocommerce
 * Description:       Accept USDT and USDC on BNB Chain, Ethereum, Base or Solana in WooCommerce. Customers pay from any wallet, the money goes straight to your own wallet, no custodian in between.
 * Version:           1.1.0
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            Tavarov
 * Author URI:        https://tavarov.com
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       tavarov-pay
 * Requires Plugins:  woocommerce
 * WC requires at least: 7.6
 * WC tested up to:   11.1
 *
 * @package TavarovPay
 */

defined( 'ABSPATH' ) || exit;

define( 'TAVAROV_PAY_VERSION', '1.1.0' );
define( 'TAVAROV_PAY_FILE', __FILE__ );
define( 'TAVAROV_PAY_DIR', plugin_dir_path( __FILE__ ) );
define( 'TAVAROV_PAY_URL', plugin_dir_url( __FILE__ ) );

/*
 * Declare compatibility with WooCommerce features before WooCommerce
 * initialises: High-Performance Order Storage and the Cart/Checkout blocks.
 */
add_action(
	'before_woocommerce_init',
	static function () {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', TAVAROV_PAY_FILE, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', TAVAROV_PAY_FILE, true );
		}
	}
);

add_action( 'plugins_loaded', 'tavarov_pay_init', 11 );

/**
 * Load the gateway once WooCommerce is available.
 */
function tavarov_pay_init() {
	if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
		add_action( 'admin_notices', 'tavarov_pay_notice_no_woocommerce' );
		return;
	}

	require_once TAVAROV_PAY_DIR . 'includes/class-tavarov-pay-api.php';
	require_once TAVAROV_PAY_DIR . 'includes/class-tavarov-pay-gateway.php';

	add_filter( 'woocommerce_payment_gateways', 'tavarov_pay_add_gateway' );
	add_filter( 'plugin_action_links_' . plugin_basename( TAVAROV_PAY_FILE ), 'tavarov_pay_action_links' );

	// Webhook endpoint: https://your-shop/?wc-api=tavarov_pay  (or /wc-api/tavarov_pay/).
	add_action( 'woocommerce_api_tavarov_pay', array( 'Tavarov_Pay_Gateway', 'handle_webhook' ) );
	// Background re-checks, in case neither the webhook nor the customer came back.
	add_action( 'tavarov_pay_check_order', array( 'Tavarov_Pay_Gateway', 'scheduled_check' ) );
	// Manual "check payment" action on the order screen.
	add_filter( 'woocommerce_order_actions', array( 'Tavarov_Pay_Gateway', 'order_actions' ), 10, 2 );
	add_action( 'woocommerce_order_action_tavarov_pay_check', array( 'Tavarov_Pay_Gateway', 'order_action_check' ) );

	add_action( 'woocommerce_blocks_loaded', 'tavarov_pay_register_blocks' );
}

/**
 * Register the gateway with WooCommerce.
 *
 * @param array $gateways Gateway class names.
 * @return array
 */
function tavarov_pay_add_gateway( $gateways ) {
	$gateways[] = 'Tavarov_Pay_Gateway';
	return $gateways;
}

/**
 * "Settings" link on the Plugins screen.
 *
 * @param array $links Existing links.
 * @return array
 */
function tavarov_pay_action_links( $links ) {
	$url = admin_url( 'admin.php?page=wc-settings&tab=checkout&section=tavarov_pay' );
	array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'tavarov-pay' ) . '</a>' );
	return $links;
}

/**
 * Register the payment method for the Checkout block.
 */
function tavarov_pay_register_blocks() {
	if ( ! class_exists( '\Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType' ) ) {
		return;
	}
	require_once TAVAROV_PAY_DIR . 'includes/class-tavarov-pay-blocks.php';
	add_action(
		'woocommerce_blocks_payment_method_type_registration',
		static function ( $registry ) {
			$registry->register( new Tavarov_Pay_Blocks() );
		}
	);
}

/**
 * Admin notice when WooCommerce is missing.
 */
function tavarov_pay_notice_no_woocommerce() {
	if ( ! current_user_can( 'activate_plugins' ) ) {
		return;
	}
	echo '<div class="notice notice-error"><p>' .
		esc_html__( 'Tavarov Pay needs WooCommerce to be installed and active.', 'tavarov-pay' ) .
		'</p></div>';
}
