<?php
/**
 * Minimal client for the Tavarov Pay API (https://wallet.tavarov.com/dev).
 *
 * @package TavarovPay
 */

defined( 'ABSPATH' ) || exit;

/**
 * Talks to the Tavarov Pay API over HTTPS with the shop's API key.
 */
class Tavarov_Pay_API {

	/** Default API address. Can be changed with the `tavarov_pay_api_base` filter. */
	const BASE = 'https://wallet.tavarov.com/api/v1';

	/** How old a webhook may be before we reject it, in seconds. */
	const WEBHOOK_TOLERANCE = 300;

	/**
	 * API key: tp_live_… or tp_test_…
	 *
	 * @var string
	 */
	private $key;

	/**
	 * @param string $key API key.
	 */
	public function __construct( $key ) {
		$this->key = trim( (string) $key );
	}

	/**
	 * Whether the key looks like a Tavarov Pay key.
	 *
	 * @param string $key Key.
	 * @return bool
	 */
	public static function key_looks_valid( $key ) {
		return (bool) preg_match( '/^tp_(live|test)_[A-Za-z0-9_-]{43}$/', trim( (string) $key ) );
	}

	/**
	 * True for test-network keys.
	 *
	 * @return bool
	 */
	public function is_test() {
		return 0 === strpos( $this->key, 'tp_test_' );
	}

	/**
	 * API base URL.
	 *
	 * @return string
	 */
	public static function base() {
		return untrailingslashit( apply_filters( 'tavarov_pay_api_base', self::BASE ) );
	}

	/**
	 * Create an invoice.
	 *
	 * @param array $body Request fields (amount, currency, order_id, …).
	 * @return array|WP_Error Invoice object or error.
	 */
	public function create_invoice( array $body ) {
		return $this->request( 'POST', '/invoices', $body );
	}

	/**
	 * Read an invoice by id.
	 *
	 * @param string $id Invoice id (0x + 64 hex).
	 * @return array|WP_Error
	 */
	public function get_invoice( $id ) {
		if ( ! self::id_looks_valid( $id ) ) {
			return new WP_Error( 'tavarov_pay_bad_id', 'Bad invoice id.' );
		}
		return $this->request( 'GET', '/invoices/' . rawurlencode( $id ) );
	}

	/**
	 * @param string $id Invoice id.
	 * @return bool
	 */
	public static function id_looks_valid( $id ) {
		return is_string( $id ) && (bool) preg_match( '/^0x[0-9a-f]{64}$/', $id );
	}

	/**
	 * Send a request and decode the JSON answer.
	 *
	 * @param string     $method HTTP method.
	 * @param string     $path   Path after /api/v1.
	 * @param array|null $body   JSON body.
	 * @return array|WP_Error
	 */
	private function request( $method, $path, $body = null ) {
		if ( ! self::key_looks_valid( $this->key ) ) {
			return new WP_Error( 'tavarov_pay_no_key', __( 'Tavarov Pay API key is missing or malformed.', 'tavarov-pay' ) );
		}
		$args = array(
			'method'      => $method,
			'timeout'     => 20,
			'redirection' => 0,
			'headers'     => array(
				'Authorization' => 'Bearer ' . $this->key,
				'Content-Type'  => 'application/json',
				'Accept'        => 'application/json',
				'User-Agent'    => 'TavarovPay-WooCommerce/' . TAVAROV_PAY_VERSION . '; ' . home_url( '/' ),
			),
		);
		if ( null !== $body ) {
			$args['body'] = wp_json_encode( $body );
		}
		$res = wp_remote_request( self::base() . $path, $args );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
		if ( $code >= 200 && $code < 300 && is_array( $data ) ) {
			return $data;
		}
		$err = is_array( $data ) && isset( $data['error'] ) && is_array( $data['error'] ) ? $data['error'] : array();
		$msg = isset( $err['message'] ) ? (string) $err['message'] : 'HTTP ' . $code;
		return new WP_Error(
			'tavarov_pay_' . ( isset( $err['code'] ) ? sanitize_key( $err['code'] ) : 'http_' . $code ),
			$msg,
			array(
				'status' => $code,
				'body'   => $data,
			)
		);
	}

	/**
	 * Check the Tavarov-Signature header of a webhook.
	 *
	 * Header: t=<unix time>,v1=<hex HMAC-SHA256 of "t.raw_body" with the secret>.
	 *
	 * @param string   $raw_body Raw request body, exactly as received.
	 * @param string   $header   Tavarov-Signature header.
	 * @param string   $secret   Webhook secret whsec_…
	 * @param int|null $now      Current time (for tests).
	 * @return bool
	 */
	public static function verify_signature( $raw_body, $header, $secret, $now = null ) {
		if ( '' === (string) $secret || ! is_string( $header ) ) {
			return false;
		}
		if ( ! preg_match( '/^t=(\d{9,11}),v1=([0-9a-f]{64})$/', trim( $header ), $m ) ) {
			return false;
		}
		$now = null === $now ? time() : (int) $now;
		if ( abs( $now - (int) $m[1] ) > self::WEBHOOK_TOLERANCE ) {
			return false;
		}
		$expected = hash_hmac( 'sha256', $m[1] . '.' . $raw_body, (string) $secret );
		return hash_equals( $expected, $m[2] );
	}
}
