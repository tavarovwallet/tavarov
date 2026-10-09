<?php
/**
 * WooCommerce payment gateway: pay an order in USDT or USDC through Tavarov Pay.
 *
 * Flow:
 *  1. Checkout → we create an invoice with the Tavarov Pay API and send the
 *     customer to its payment page.
 *  2. The customer pays from any wallet. The money goes straight to the shop's
 *     wallet through the Tavarov Pay contract on BNB Chain.
 *  3. We learn about the payment from the webhook, from the customer coming
 *     back to the "order received" page, or from background re-checks — and in
 *     every case we ask the API ourselves before marking the order paid.
 *
 * @package TavarovPay
 */

defined( 'ABSPATH' ) || exit;

/**
 * Tavarov Pay gateway.
 */
class Tavarov_Pay_Gateway extends WC_Payment_Gateway {

	const META_INVOICE  = '_tavarov_pay_invoice';
	const META_URL      = '_tavarov_pay_url';
	const META_AMOUNT   = '_tavarov_pay_amount';
	const META_CURRENCY = '_tavarov_pay_currency';
	const META_TEST     = '_tavarov_pay_test';
	const META_ATTEMPT  = '_tavarov_pay_attempt';
	const META_STATUS   = '_tavarov_pay_status';
	const META_NETWORK  = '_tavarov_pay_network';

	/** Networks the API accepts, and what it calls them in invoices. */
	const NETWORKS = array(
		'bnb'      => 'bnb',
		'ethereum' => 'eth',
		'base'     => 'base',
		'solana'   => 'solana',
	);

	/** Re-checks after the invoice is created, in seconds. */
	const CHECKS = array( 180, 900, 3600 );

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->id                 = 'tavarov_pay';
		$this->has_fields         = false;
		$this->method_title       = __( 'Tavarov Pay (USDT / USDC)', 'tavarov-pay' );
		$this->method_description = __( 'Accept USDT and USDC on BNB Chain, Ethereum, Base or Solana. The customer pays from any wallet and the money goes straight to your wallet — Tavarov Pay never holds it. Fee: 1% per payment.', 'tavarov-pay' );
		$this->icon               = apply_filters( 'tavarov_pay_icon', TAVAROV_PAY_URL . 'assets/icon.svg' );
		$this->supports           = array( 'products' );

		$this->init_form_fields();
		$this->init_settings();

		$this->title       = $this->get_option( 'title' );
		$this->description = $this->get_option( 'description' );

		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
		add_action( 'woocommerce_thankyou_' . $this->id, array( $this, 'thankyou_page' ) );
	}

	/**
	 * The gateway instance WooCommerce already built (so hooks are not added twice).
	 *
	 * @return Tavarov_Pay_Gateway|null
	 */
	public static function get() {
		if ( ! function_exists( 'WC' ) || ! WC()->payment_gateways() ) {
			return null;
		}
		$all = WC()->payment_gateways()->payment_gateways();
		return isset( $all['tavarov_pay'] ) && $all['tavarov_pay'] instanceof self ? $all['tavarov_pay'] : null;
	}

	/* ===================== settings ===================== */

	/**
	 * Settings fields.
	 */
	public function init_form_fields() {
		$this->form_fields = array(
			'enabled'        => array(
				'title'   => __( 'Enable', 'tavarov-pay' ),
				'type'    => 'checkbox',
				'label'   => __( 'Accept USDT / USDC with Tavarov Pay', 'tavarov-pay' ),
				'default' => 'no',
			),
			'title'          => array(
				'title'       => __( 'Title', 'tavarov-pay' ),
				'type'        => 'text',
				'description' => __( 'What the customer sees at checkout.', 'tavarov-pay' ),
				'default'     => __( 'USDT or USDC (crypto)', 'tavarov-pay' ),
				'desc_tip'    => true,
			),
			'description'    => array(
				'title'       => __( 'Description', 'tavarov-pay' ),
				'type'        => 'textarea',
				'description' => __( 'Shown under the title at checkout.', 'tavarov-pay' ),
				'default'     => __( 'Pay in USDT or USDC from any crypto wallet: MetaMask, Trust Wallet, Phantom, NoN Wallet and others.', 'tavarov-pay' ),
				'desc_tip'    => true,
			),
			'api_key'        => array(
				'title'       => __( 'API key', 'tavarov-pay' ),
				'type'        => 'password',
				'description' => __( 'Get it in the developer cabinet at wallet.tavarov.com/dev (sign in with the wallet that should receive the money). Keys starting with tp_test_ work on the BNB test network with test dollars.', 'tavarov-pay' ),
				'default'     => '',
			),
			'webhook_secret' => array(
				'title'       => __( 'Webhook secret', 'tavarov-pay' ),
				'type'        => 'password',
				'description' => __( 'Optional but recommended. In the cabinet, set the webhook URL shown above and paste the whsec_… secret here: payments are then confirmed within seconds.', 'tavarov-pay' ),
				'default'     => '',
			),
			'network'        => array(
				'title'       => __( 'Network', 'tavarov-pay' ),
				'type'        => 'select',
				'description' => __( 'Where the customer pays. BNB Chain, Base and Solana cost a fraction of a cent per payment; Ethereum network fees are noticeably higher. Base has USDC only. Test keys (tp_test_) always use the BNB test network.', 'tavarov-pay' ),
				'options'     => array(
					'bnb'      => 'BNB Chain',
					'ethereum' => 'Ethereum',
					'base'     => 'Base',
					'solana'   => 'Solana',
				),
				'default'     => 'bnb',
			),
			'solana_address' => array(
				'title'       => __( 'Your Solana address', 'tavarov-pay' ),
				'type'        => 'text',
				'description' => __( 'Only for the Solana network: the wallet address (base58) that receives the money. Your API key is tied to your EVM wallet, so the Solana address is set here.', 'tavarov-pay' ),
				'default'     => '',
			),
			'currency'       => array(
				'title'   => __( 'Charge in', 'tavarov-pay' ),
				'type'    => 'select',
				'options' => array(
					'USDT' => 'USDT',
					'USDC' => 'USDC',
				),
				'default' => 'USDT',
			),
			'expires'        => array(
				'title'             => __( 'Invoice lifetime, minutes', 'tavarov-pay' ),
				'type'              => 'number',
				'default'           => '60',
				'custom_attributes' => array(
					'min'  => '5',
					'max'  => '10080',
					'step' => '1',
				),
			),
			'debug'          => array(
				'title'       => __( 'Debug log', 'tavarov-pay' ),
				'type'        => 'checkbox',
				'label'       => __( 'Write events to WooCommerce → Status → Logs (source: tavarov-pay)', 'tavarov-pay' ),
				'default'     => 'no',
			),
		);
	}

	/**
	 * Reject obviously wrong keys when the settings are saved.
	 *
	 * @param string $key   Field key.
	 * @param string $value Posted value.
	 * @return string
	 */
	public function validate_api_key_field( $key, $value ) {
		$value = trim( (string) $value );
		if ( '' !== $value && ! Tavarov_Pay_API::key_looks_valid( $value ) ) {
			WC_Admin_Settings::add_error( __( 'This does not look like a Tavarov Pay API key (tp_live_… or tp_test_…).', 'tavarov-pay' ) );
			return (string) $this->get_option( 'api_key' );
		}
		return $value;
	}

	/**
	 * @param string $key   Field key.
	 * @param string $value Posted value.
	 * @return string
	 */
	public function validate_webhook_secret_field( $key, $value ) {
		$value = trim( (string) $value );
		if ( '' !== $value && ! preg_match( '/^whsec_[A-Za-z0-9_-]{20,}$/', $value ) ) {
			WC_Admin_Settings::add_error( __( 'The webhook secret starts with whsec_ — copy it from the cabinet as is.', 'tavarov-pay' ) );
			return (string) $this->get_option( 'webhook_secret' );
		}
		return $value;
	}

	/**
	 * @param string $key   Field key.
	 * @param string $value Posted value.
	 * @return string
	 */
	public function validate_solana_address_field( $key, $value ) {
		$value = trim( (string) $value );
		if ( '' !== $value && ! self::solana_address_looks_valid( $value ) ) {
			WC_Admin_Settings::add_error( __( 'This does not look like a Solana address (32–44 base58 characters).', 'tavarov-pay' ) );
			return (string) $this->get_option( 'solana_address' );
		}
		return $value;
	}

	/**
	 * Shape check only; the API also refuses addresses that are not wallets.
	 *
	 * @param string $v Address.
	 * @return bool
	 */
	public static function solana_address_looks_valid( $v ) {
		return (bool) preg_match( '/^[1-9A-HJ-NP-Za-km-z]{32,44}$/', (string) $v );
	}

	/**
	 * Network and currency actually used for a new invoice.
	 *
	 * @return array [ network key, currency ]
	 */
	private function payment_route() {
		$network  = (string) $this->get_option( 'network', 'bnb' );
		if ( ! isset( self::NETWORKS[ $network ] ) ) {
			$network = 'bnb';
		}
		$currency = 'USDC' === $this->get_option( 'currency' ) ? 'USDC' : 'USDT';
		if ( $this->api()->is_test() ) {
			return array( 'bnb', 'USDT' ); // The test network only has test USDT.
		}
		if ( 'base' === $network ) {
			$currency = 'USDC'; // There is no USDT on Base.
		}
		return array( $network, $currency );
	}

	/**
	 * Settings screen: a short status block above the fields.
	 */
	public function admin_options() {
		$hook = self::webhook_url();
		echo '<h2>' . esc_html( $this->get_method_title() ) . '</h2>';
		echo wp_kses_post( wpautop( $this->get_method_description() ) );

		echo '<div class="notice notice-info inline"><p>';
		echo esc_html__( 'Webhook URL for the cabinet:', 'tavarov-pay' ) . ' <code>' . esc_html( $hook ) . '</code><br>';
		echo esc_html__( '1. Open wallet.tavarov.com/dev and sign in with your wallet. 2. Create a key and paste it below. 3. Set the webhook URL above and paste the secret below.', 'tavarov-pay' );
		echo '</p></div>';

		if ( ! self::store_currency_supported() ) {
			echo '<div class="notice notice-error inline"><p>' . esc_html(
				sprintf(
					/* translators: %s: store currency code, e.g. EUR */
					__( 'Your store currency is %s. Tavarov Pay charges in US dollar stablecoins, so it is offered at checkout only when the store currency is USD.', 'tavarov-pay' ),
					get_woocommerce_currency()
				)
			) . '</p></div>';
		}
		if ( 'solana' === $this->get_option( 'network' ) && ! self::solana_address_looks_valid( (string) $this->get_option( 'solana_address' ) ) ) {
			echo '<div class="notice notice-error inline"><p>' . esc_html__( 'Network is Solana, but your Solana address is not set. Checkout will not work until you add it.', 'tavarov-pay' ) . '</p></div>';
		}
		$key = (string) $this->get_option( 'api_key' );
		if ( 0 === strpos( $key, 'tp_test_' ) ) {
			echo '<div class="notice notice-warning inline"><p>' . esc_html__( 'Test mode: a tp_test_ key is set. Payments use test dollars on the BNB test network — switch to a tp_live_ key before selling.', 'tavarov-pay' ) . '</p></div>';
		}

		echo '<table class="form-table">';
		$this->generate_settings_html( $this->get_form_fields(), true );
		echo '</table>';
	}

	/* ===================== availability ===================== */

	/**
	 * @return bool
	 */
	public static function store_currency_supported() {
		$ok = apply_filters( 'tavarov_pay_supported_currencies', array( 'USD' ) );
		return in_array( get_woocommerce_currency(), (array) $ok, true );
	}

	/**
	 * Offer the method only when it can actually work.
	 *
	 * @return bool
	 */
	public function is_available() {
		return parent::is_available()
			&& Tavarov_Pay_API::key_looks_valid( $this->get_option( 'api_key' ) )
			&& self::store_currency_supported();
	}

	/**
	 * @return Tavarov_Pay_API
	 */
	public function api() {
		return new Tavarov_Pay_API( $this->get_option( 'api_key' ) );
	}

	/**
	 * @return string
	 */
	public static function webhook_url() {
		return WC()->api_request_url( 'tavarov_pay' );
	}

	/* ===================== checkout ===================== */

	/**
	 * Create an invoice and send the customer to the payment page.
	 *
	 * @param int $order_id Order id.
	 * @return array
	 */
	public function process_payment( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return array( 'result' => 'failure' );
		}

		$api                   = $this->api();
		list( $network, $currency ) = $this->payment_route();
		if ( 'solana' === $network && ! self::solana_address_looks_valid( (string) $this->get_option( 'solana_address' ) ) ) {
			$this->log( 'Order ' . $order->get_id() . ': network is Solana but no Solana address is set.' );
			wc_add_notice( __( 'Could not start the crypto payment right now. Please try again in a minute or choose another payment method.', 'tavarov-pay' ), 'error' );
			return array( 'result' => 'failure' );
		}
		$amount = self::format_amount( $order->get_total() );

		// Same order, same sum, invoice still open: send the customer back to it.
		$reuse = $this->reusable_invoice( $order, $amount, $currency, $network );
		if ( $reuse ) {
			return array(
				'result'   => 'success',
				'redirect' => $reuse,
			);
		}

		$attempt = (int) $order->get_meta( self::META_ATTEMPT );
		$invoice = null;
		for ( $i = 0; $i < 2; $i++ ) {
			$invoice = $api->create_invoice( $this->invoice_request( $order, $amount, $currency, $attempt, $network ) );
			// An open invoice for this order with a different sum (the order was edited): take a fresh number.
			if ( is_wp_error( $invoice ) && 'tavarov_pay_order_exists' === $invoice->get_error_code() ) {
				$attempt++;
				continue;
			}
			break;
		}

		if ( is_wp_error( $invoice ) || ! $this->invoice_is_sane( $invoice, $amount, $currency, $network ) ) {
			$this->log( 'Invoice not created for order ' . $order->get_id() . ': ' . ( is_wp_error( $invoice ) ? $invoice->get_error_message() : 'unexpected answer' ) );
			wc_add_notice( __( 'Could not start the crypto payment right now. Please try again in a minute or choose another payment method.', 'tavarov-pay' ), 'error' );
			return array( 'result' => 'failure' );
		}

		$order->update_meta_data( self::META_INVOICE, $invoice['id'] );
		$order->update_meta_data( self::META_URL, $invoice['payment_url'] );
		$order->update_meta_data( self::META_AMOUNT, $amount );
		$order->update_meta_data( self::META_CURRENCY, $currency );
		$order->update_meta_data( self::META_NETWORK, $network );
		$order->update_meta_data( self::META_TEST, $api->is_test() ? 'yes' : 'no' );
		$order->update_meta_data( self::META_ATTEMPT, $attempt );
		$order->delete_meta_data( self::META_STATUS );
		$order->add_order_note(
			sprintf(
				/* translators: 1: amount, 2: USDT/USDC, 3: invoice id, 4: "(test)" or empty */
				__( 'Tavarov Pay invoice created: %1$s %2$s, invoice %3$s %4$s', 'tavarov-pay' ),
				$amount,
				$currency,
				$invoice['id'],
				$api->is_test() ? __( '(test network)', 'tavarov-pay' ) : ''
			)
		);
		$order->save();

		self::schedule_checks( $order->get_id(), isset( $invoice['expires_at'] ) ? (int) $invoice['expires_at'] : 0 );
		$this->log( 'Invoice ' . $invoice['id'] . ' for order ' . $order->get_id() );

		return array(
			'result'   => 'success',
			'redirect' => $invoice['payment_url'],
		);
	}

	/**
	 * Body of POST /invoices.
	 *
	 * @param WC_Order $order    Order.
	 * @param string   $amount   Amount.
	 * @param string   $currency USDT|USDC.
	 * @param int      $attempt  Attempt number.
	 * @param string   $network  Network key (bnb, ethereum, base, solana).
	 * @return array
	 */
	private function invoice_request( $order, $amount, $currency, $attempt, $network = 'bnb' ) {
		$body = array(
			'amount'      => $amount,
			'currency'    => $currency,
			// Unique per site: one API key may serve several shops.
			'order_id'    => 'wc' . $order->get_id() . '-' . substr( md5( home_url( '/' ) ), 0, 8 ) . ( $attempt ? '-' . $attempt : '' ),
			/* translators: %s: order number */
			'description' => self::clean_text( sprintf( __( 'Order #%s', 'tavarov-pay' ), $order->get_order_number() ), 64 ),
			'shop_name'   => self::clean_text( wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ), 48 ),
			'expires_in'  => max( 5, min( 10080, (int) $this->get_option( 'expires', 60 ) ) ) * 60,
			'metadata'    => array(
				'wc_order_id' => (string) $order->get_id(),
				'site'        => self::clean_text( (string) wp_parse_url( home_url( '/' ), PHP_URL_HOST ), 200 ),
			),
		);
		$return = $this->get_return_url( $order );
		if ( 0 === strpos( $return, 'https://' ) ) {
			$body['success_url'] = $return; // The API only returns customers to https:// pages.
		}
		$lang = strtolower( substr( (string) determine_locale(), 0, 2 ) );
		if ( in_array( $lang, array( 'ru', 'en', 'es', 'tr', 'pt' ), true ) ) {
			$body['lang'] = $lang;
		}
		if ( '' === $body['shop_name'] ) {
			unset( $body['shop_name'] );
		}
		// BNB Chain is the API's default: old installs keep sending exactly what they sent before.
		if ( 'bnb' !== $network ) {
			$body['network'] = $network;
			if ( 'solana' === $network ) {
				$body['solana_address'] = trim( (string) $this->get_option( 'solana_address' ) );
			}
		}
		return $body;
	}

	/**
	 * The API answer must be an invoice for exactly what we asked, on the API's own payment page.
	 *
	 * @param mixed  $inv      Answer.
	 * @param string $amount   Amount asked.
	 * @param string $currency Currency asked.
	 * @param string $network  Network asked.
	 * @return bool
	 */
	private function invoice_is_sane( $inv, $amount, $currency, $network = 'bnb' ) {
		if ( ! is_array( $inv ) || ! isset( $inv['id'], $inv['payment_url'], $inv['amount'], $inv['currency'] ) ) {
			return false;
		}
		// Send customers only to the Tavarov Pay payment page, never to an address from elsewhere.
		$hosts = (array) apply_filters( 'tavarov_pay_payment_hosts', array( 'wallet.tavarov.com', wp_parse_url( Tavarov_Pay_API::base(), PHP_URL_HOST ) ) );
		$url   = (string) $inv['payment_url'];
		$host  = 0 === strpos( $url, 'https://' ) ? wp_parse_url( $url, PHP_URL_HOST ) : '';
		return Tavarov_Pay_API::id_looks_valid( $inv['id'] )
			&& $host && in_array( strtolower( $host ), array_map( 'strtolower', $hosts ), true )
			&& self::same_amount( $inv['amount'], $amount )
			&& $inv['currency'] === $currency
			// The API names the network in the invoice; it must be the one we asked for.
			&& ( 'bnb' === $network || ( isset( $inv['network'] ) && self::NETWORKS[ $network ] === $inv['network'] ) );
	}

	/**
	 * An invoice already created for this order that the customer can still pay.
	 *
	 * @param WC_Order $order    Order.
	 * @param string   $amount   Current amount.
	 * @param string   $currency Current currency.
	 * @param string   $network  Current network.
	 * @return string|null Payment URL.
	 */
	private function reusable_invoice( $order, $amount, $currency, $network = 'bnb' ) {
		$id   = (string) $order->get_meta( self::META_INVOICE );
		$was  = (string) $order->get_meta( self::META_NETWORK );
		if ( ! Tavarov_Pay_API::id_looks_valid( $id )
			|| ! self::same_amount( $order->get_meta( self::META_AMOUNT ), $amount )
			|| $order->get_meta( self::META_CURRENCY ) !== $currency
			|| ( '' === $was ? 'bnb' : $was ) !== $network ) {
			return null;
		}
		$inv = $this->api()->get_invoice( $id );
		if ( is_wp_error( $inv ) || ! is_array( $inv ) ) {
			return null;
		}
		$this->apply_invoice( $order, $inv );
		if ( isset( $inv['status'] ) && 'pending' === $inv['status'] && isset( $inv['expires_at'] ) && (int) $inv['expires_at'] > time() + 120 ) {
			return (string) $order->get_meta( self::META_URL );
		}
		return null;
	}

	/* ===================== confirming payment ===================== */

	/**
	 * Bring the order in line with the invoice as the API reports it.
	 *
	 * The invoice must be the one we created for this order, for the same sum
	 * and currency. Only then does "paid" complete the order.
	 *
	 * @param WC_Order $order Order.
	 * @param array    $inv   Invoice from the API (never from a webhook body).
	 * @return bool Whether the order is paid now.
	 */
	public function apply_invoice( $order, $inv ) {
		if ( ! is_array( $inv ) || ! isset( $inv['id'], $inv['status'] ) || $inv['id'] !== $order->get_meta( self::META_INVOICE ) ) {
			return false;
		}
		$status = (string) $inv['status'];
		$seen   = (string) $order->get_meta( self::META_STATUS );
		$paid   = $order->is_paid();

		if ( 'paid' === $status ) {
			if ( $paid ) {
				return true;
			}
			if ( ! self::same_amount( $inv['amount'], $order->get_meta( self::META_AMOUNT ) ) || $inv['currency'] !== $order->get_meta( self::META_CURRENCY ) ) {
				$this->note_once( $order, 'mismatch', __( 'Tavarov Pay reports the invoice as paid, but its amount or currency does not match this order. The order was NOT marked paid — please check it manually.', 'tavarov-pay' ) );
				return false;
			}
			$tx = isset( $inv['payment']['tx'] ) && is_string( $inv['payment']['tx'] ) && preg_match( '/^0x[0-9a-f]{64}$/', $inv['payment']['tx'] ) ? $inv['payment']['tx'] : '';
			$test = 'yes' === $order->get_meta( self::META_TEST );
			$order->update_meta_data( self::META_STATUS, 'paid' );
			$order->payment_complete( $tx );
			$order->add_order_note(
				sprintf(
					/* translators: 1: amount, 2: currency, 3: payer address, 4: link or dash, 5: "(test)" or empty */
					__( 'Paid with Tavarov Pay: %1$s %2$s from %3$s. Transaction: %4$s %5$s', 'tavarov-pay' ),
					$inv['payment']['amount'] ?? $inv['amount'],
					$inv['currency'],
					isset( $inv['payment']['payer'] ) ? $inv['payment']['payer'] : '—',
					$tx ? ( $test ? 'https://testnet.bscscan.com/tx/' : 'https://bscscan.com/tx/' ) . $tx : '—',
					$test ? __( '(TEST network — no real money)', 'tavarov-pay' ) : ''
				)
			);
			$order->save();
			$this->log( 'Order ' . $order->get_id() . ' paid, invoice ' . $inv['id'] );
			return true;
		}

		if ( ( 'underpaid' === $status || 'wrong_currency' === $status ) && ! $paid && $seen !== $status ) {
			$order->update_meta_data( self::META_STATUS, $status );
			$order->update_status(
				'on-hold',
				'underpaid' === $status
					? __( 'Tavarov Pay: the customer paid less than the invoice amount. Check the payment and contact the customer.', 'tavarov-pay' )
					: __( 'Tavarov Pay: the customer paid in a different currency than the invoice. Check the payment and contact the customer.', 'tavarov-pay' )
			);
			return false;
		}

		if ( 'refunded' === $status && $seen !== 'refunded' ) {
			$order->update_meta_data( self::META_STATUS, 'refunded' );
			$order->add_order_note( __( 'Tavarov Pay: the payment for this invoice was refunded to the customer.', 'tavarov-pay' ) );
			$order->save();
			return false;
		}

		if ( 'expired' === $status && ! $paid && $seen !== 'expired' ) {
			$order->update_meta_data( self::META_STATUS, 'expired' );
			$order->add_order_note( __( 'Tavarov Pay: the invoice expired unpaid. If the customer pays the order again, a new invoice is created.', 'tavarov-pay' ) );
			$order->save();
		}
		return $paid;
	}

	/**
	 * Ask the API about the order's invoice and apply the answer.
	 *
	 * @param WC_Order $order Order.
	 * @return bool|WP_Error Paid or not; WP_Error if the API did not answer.
	 */
	public function check_order( $order ) {
		if ( ! $order || $order->get_payment_method() !== $this->id ) {
			return false;
		}
		$id = (string) $order->get_meta( self::META_INVOICE );
		if ( ! Tavarov_Pay_API::id_looks_valid( $id ) ) {
			return false;
		}
		$inv = $this->api()->get_invoice( $id );
		if ( is_wp_error( $inv ) ) {
			$this->log( 'Check failed for order ' . $order->get_id() . ': ' . $inv->get_error_message() );
			return $inv;
		}
		return $this->apply_invoice( $order, $inv );
	}

	/**
	 * Webhook: POST /?wc-api=tavarov_pay
	 *
	 * The body only tells us WHICH invoice to look at. Whether it is paid we
	 * ask the API ourselves, with our key — so a forged webhook cannot mark an
	 * order paid even if the secret leaked or was never set.
	 */
	public static function handle_webhook() {
		$gw = self::get();
		if ( ! $gw ) {
			wp_send_json( array( 'error' => 'gateway not loaded' ), 503 );
		}
		$raw    = (string) file_get_contents( 'php://input' );
		$secret = (string) $gw->get_option( 'webhook_secret' );
		$sig    = isset( $_SERVER['HTTP_TAVAROV_SIGNATURE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_TAVAROV_SIGNATURE'] ) ) : '';
		if ( '' !== $secret && ! Tavarov_Pay_API::verify_signature( $raw, $sig, $secret ) ) {
			$gw->log( 'Webhook with a bad signature rejected' );
			wp_send_json( array( 'error' => 'bad signature' ), 401 );
		}
		$event = json_decode( $raw, true );
		if ( ! is_array( $event ) || ! isset( $event['type'] ) ) {
			wp_send_json( array( 'error' => 'bad body' ), 400 );
		}
		if ( 'ping' === $event['type'] ) {
			wp_send_json( array( 'ok' => true ), 200 );
		}
		$id = isset( $event['data']['id'] ) ? (string) $event['data']['id'] : '';
		if ( ! Tavarov_Pay_API::id_looks_valid( $id ) ) {
			wp_send_json( array( 'ok' => true, 'ignored' => true ), 200 );
		}
		$order = self::find_order( $id, $event['data']['metadata']['wc_order_id'] ?? null );
		if ( ! $order ) {
			// Not ours (another shop on the same key) — acknowledge, nothing to do.
			wp_send_json( array( 'ok' => true, 'ignored' => true ), 200 );
		}
		$res = $gw->check_order( $order );
		if ( is_wp_error( $res ) ) {
			wp_send_json( array( 'error' => 'api unavailable, retry later' ), 503 ); // Tavarov Pay will retry.
		}
		wp_send_json( array( 'ok' => true, 'paid' => (bool) $res ), 200 );
	}

	/**
	 * Find the order of an invoice.
	 *
	 * @param string          $invoice_id Invoice id.
	 * @param string|int|null $hint       Order id from metadata.
	 * @return WC_Order|null
	 */
	private static function find_order( $invoice_id, $hint ) {
		if ( is_scalar( $hint ) && ctype_digit( (string) $hint ) ) {
			$order = wc_get_order( (int) $hint );
			if ( $order && $order->get_meta( self::META_INVOICE ) === $invoice_id ) {
				return $order;
			}
		}
		$found = wc_get_orders(
			array(
				'limit'      => 1,
				'meta_key'   => self::META_INVOICE, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value' => $invoice_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);
		return $found ? $found[0] : null;
	}

	/**
	 * "Order received" page: check right away, the customer usually comes straight from paying.
	 *
	 * @param int $order_id Order id.
	 */
	public function thankyou_page( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return;
		}
		if ( ! $order->is_paid() ) {
			$this->check_order( $order );
		}
		if ( $order->is_paid() ) {
			echo '<p class="tavarov-pay-status">' . esc_html__( 'Payment received. Thank you!', 'tavarov-pay' ) . '</p>';
			return;
		}
		if ( $order->has_status( 'on-hold' ) ) {
			echo '<p class="tavarov-pay-status">' . esc_html__( 'We received a payment that does not match the order. The shop will contact you.', 'tavarov-pay' ) . '</p>';
			return;
		}
		$url = (string) $order->get_meta( self::META_URL );
		echo '<p class="tavarov-pay-status">' . esc_html__( 'We have not seen the payment yet. If you have just paid, it usually shows up within a minute — refresh this page.', 'tavarov-pay' );
		if ( $url ) {
			echo ' <a href="' . esc_url( $url ) . '">' . esc_html__( 'Open the payment page', 'tavarov-pay' ) . '</a>';
		}
		echo '</p>';
	}

	/* ===================== background checks ===================== */

	/**
	 * Schedule re-checks for an order.
	 *
	 * @param int $order_id   Order id.
	 * @param int $expires_at Invoice expiry (unix time).
	 */
	public static function schedule_checks( $order_id, $expires_at ) {
		$when = array();
		foreach ( self::CHECKS as $delay ) {
			$when[] = time() + $delay;
		}
		if ( $expires_at > time() ) {
			$when[] = $expires_at + 600; // A late payment may still arrive.
		}
		foreach ( array_unique( $when ) as $t ) {
			if ( function_exists( 'as_schedule_single_action' ) ) {
				as_schedule_single_action( $t, 'tavarov_pay_check_order', array( 'order_id' => (int) $order_id ), 'tavarov-pay' );
			} else {
				wp_schedule_single_event( $t, 'tavarov_pay_check_order', array( (int) $order_id ) );
			}
		}
	}

	/**
	 * @param int $order_id Order id.
	 */
	public static function scheduled_check( $order_id ) {
		$gw    = self::get();
		$order = wc_get_order( (int) $order_id );
		if ( $gw && $order && ! $order->is_paid() ) {
			$gw->check_order( $order );
		}
	}

	/**
	 * Order screen → Order actions → "Check Tavarov Pay payment".
	 *
	 * @param array         $actions Actions.
	 * @param WC_Order|null $order   Order.
	 * @return array
	 */
	public static function order_actions( $actions, $order = null ) {
		if ( ! $order ) {
			global $theorder;
			$order = $theorder;
		}
		if ( $order && 'tavarov_pay' === $order->get_payment_method() ) {
			$actions['tavarov_pay_check'] = __( 'Check Tavarov Pay payment', 'tavarov-pay' );
		}
		return $actions;
	}

	/**
	 * @param WC_Order $order Order.
	 */
	public static function order_action_check( $order ) {
		$gw = self::get();
		if ( ! $gw ) {
			return;
		}
		$res = $gw->check_order( $order );
		if ( is_wp_error( $res ) ) {
			$order->add_order_note( __( 'Tavarov Pay: could not reach the API, try again later.', 'tavarov-pay' ) );
		} elseif ( ! $res ) {
			$order->add_order_note( __( 'Tavarov Pay: no payment for this order yet.', 'tavarov-pay' ) );
		}
	}

	/* ===================== helpers ===================== */

	/**
	 * Order total as a plain decimal string: "12.5", "0.99".
	 *
	 * @param mixed $total Total.
	 * @return string
	 */
	public static function format_amount( $total ) {
		$s = number_format( (float) $total, min( 6, max( 2, (int) wc_get_price_decimals() ) ), '.', '' );
		$s = rtrim( rtrim( $s, '0' ), '.' );
		return '' === $s ? '0' : $s;
	}

	/**
	 * Compare two decimal strings exactly (to 6 decimals).
	 *
	 * @param mixed $a A.
	 * @param mixed $b B.
	 * @return bool
	 */
	public static function same_amount( $a, $b ) {
		$norm = static function ( $v ) {
			$v = trim( (string) $v );
			if ( ! preg_match( '/^(\d+)(?:\.(\d{1,18}))?$/', $v, $m ) ) {
				return null;
			}
			$frac = isset( $m[2] ) ? $m[2] : '';
			if ( strlen( rtrim( $frac, '0' ) ) > 6 ) {
				return null;
			}
			return ltrim( $m[1], '0' ) . '.' . str_pad( substr( $frac, 0, 6 ), 6, '0' );
		};
		$x = $norm( $a );
		$y = $norm( $b );
		return null !== $x && $x === $y;
	}

	/**
	 * One line, no control characters, limited length — as the API wants.
	 *
	 * @param string $s   Text.
	 * @param int    $max Max characters.
	 * @return string
	 */
	public static function clean_text( $s, $max ) {
		$s = preg_replace( '/[\x{0000}-\x{001F}\x{007F}-\x{009F}\x{2028}\x{2029}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]+/u', ' ', (string) $s );
		$s = trim( preg_replace( '/\s+/u', ' ', (string) $s ) );
		return function_exists( 'mb_substr' ) ? mb_substr( $s, 0, $max ) : substr( $s, 0, $max );
	}

	/**
	 * Add a note only once per kind.
	 *
	 * @param WC_Order $order Order.
	 * @param string   $kind  Kind.
	 * @param string   $text  Note.
	 */
	private function note_once( $order, $kind, $text ) {
		if ( $order->get_meta( self::META_STATUS ) === $kind ) {
			return;
		}
		$order->update_meta_data( self::META_STATUS, $kind );
		$order->add_order_note( $text );
		$order->save();
	}

	/**
	 * @param string $msg Message.
	 */
	public function log( $msg ) {
		if ( 'yes' === $this->get_option( 'debug' ) && function_exists( 'wc_get_logger' ) ) {
			wc_get_logger()->info( $msg, array( 'source' => 'tavarov-pay' ) );
		}
	}
}
