<?php
/**
 * Tavarov Pay in the Checkout block.
 *
 * @package TavarovPay
 */

defined( 'ABSPATH' ) || exit;

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

/**
 * Registers the payment method with the block-based checkout.
 */
final class Tavarov_Pay_Blocks extends AbstractPaymentMethodType {

	/**
	 * Payment method name — same as the gateway id.
	 *
	 * @var string
	 */
	protected $name = 'tavarov_pay';

	/**
	 * Read settings.
	 */
	public function initialize() {
		$this->settings = get_option( 'woocommerce_tavarov_pay_settings', array() );
	}

	/**
	 * @return bool
	 */
	public function is_active() {
		$gw = Tavarov_Pay_Gateway::get();
		return $gw ? $gw->is_available() : false;
	}

	/**
	 * @return string[]
	 */
	public function get_payment_method_script_handles() {
		wp_register_script(
			'tavarov-pay-blocks',
			TAVAROV_PAY_URL . 'assets/blocks.js',
			array( 'wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-html-entities' ),
			TAVAROV_PAY_VERSION,
			true
		);
		return array( 'tavarov-pay-blocks' );
	}

	/**
	 * Data for the script (wc.wcSettings.getSetting('tavarov_pay_data')).
	 *
	 * @return array
	 */
	public function get_payment_method_data() {
		return array(
			'title'       => $this->get_setting( 'title', __( 'USDT or USDC (crypto)', 'tavarov-pay' ) ),
			'description' => $this->get_setting( 'description', '' ),
			'icon'        => TAVAROV_PAY_URL . 'assets/icon.svg',
			'supports'    => array( 'products' ),
		);
	}
}
