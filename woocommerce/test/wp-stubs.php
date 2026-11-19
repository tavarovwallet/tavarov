<?php
/* Just enough WordPress and WooCommerce for the plugin's offline tests
   (php test/networks.php). Nothing here talks to the network: the API call
   answers with an error, so a test can only see what the plugin would SEND
   and how it judges an answer it is handed. */

define( 'ABSPATH', __DIR__ . '/' );

$GLOBALS['__options'] = array();
$GLOBALS['__log']     = array();
$GLOBALS['__notices'] = array();
$GLOBALS['__orders']  = array();

function add_action( ...$a ) { return true; }
function add_filter( ...$a ) { return true; }
function apply_filters( $tag, $value, ...$a ) { return $value; }
function __( $s, $d = '' ) { return $s; }
function esc_html__( $s, $d = '' ) { return htmlspecialchars( $s, ENT_QUOTES ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_url( $s ) { return (string) $s; }
function wp_kses_post( $s ) { return (string) $s; }
function wpautop( $s ) { return '<p>' . $s . '</p>'; }
function plugin_dir_path( $f ) { return dirname( $f ) . '/'; }
function plugin_dir_url( $f ) { return 'https://shop.example/wp-content/plugins/tavarov-pay/'; }
function plugin_basename( $f ) { return 'tavarov-pay/tavarov-pay.php'; }
function admin_url( $p = '' ) { return 'https://shop.example/wp-admin/' . $p; }
function home_url( $p = '' ) { return 'https://shop.example' . $p; }
function get_bloginfo( $k ) { return 'Test Shop'; }
function wp_specialchars_decode( $s, $q = 0 ) { return htmlspecialchars_decode( (string) $s, ENT_QUOTES ); }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function untrailingslashit( $s ) { return rtrim( (string) $s, '/\\' ); }
function determine_locale() { return 'en_US'; }
function get_option( $k, $d = false ) { return $GLOBALS['__options'][ $k ] ?? $d; }
function get_woocommerce_currency() { return 'USD'; }
function wc_get_price_decimals() { return 2; }
function wc_add_notice( $m, $t = 'success' ) { $GLOBALS['__notices'][] = array( $t, $m ); }
function wp_json_encode( $v ) { return json_encode( $v ); }
function sanitize_key( $k ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $k ) ); }
function current_user_can( $c ) { return true; }
function is_wp_error( $v ) { return $v instanceof WP_Error; }
function wp_remote_request( $url, $args ) { $GLOBALS['__requests'][] = array( $url, $args ); return new WP_Error( 'offline', 'no network in tests' ); }
function wp_remote_retrieve_response_code( $r ) { return 0; }
function wp_remote_retrieve_body( $r ) { return ''; }
function as_schedule_single_action( ...$a ) { return 1; }

class WP_Error {
	private $code; private $msg; private $data;
	public function __construct( $code = '', $msg = '', $data = null ) { $this->code = $code; $this->msg = $msg; $this->data = $data; }
	public function get_error_code() { return $this->code; }
	public function get_error_message() { return $this->msg; }
	public function get_error_data() { return $this->data; }
}

class WC_Logger_Stub { public function info( $m, $c = array() ) { $GLOBALS['__log'][] = $m; } }
function wc_get_logger() { return new WC_Logger_Stub(); }

class WC_Admin_Settings { public static $errors = array(); public static function add_error( $m ) { self::$errors[] = $m; } }

class WC_Gateways_Stub { public $list = array(); public function payment_gateways() { return $this->list; } }
class WC_Stub {
	public $pg;
	public function __construct() { $this->pg = new WC_Gateways_Stub(); }
	public function payment_gateways() { return $this->pg; }
	public function api_request_url( $n ) { return 'https://shop.example/wc-api/' . $n . '/'; }
}
function WC() { static $wc = null; if ( ! $wc ) { $wc = new WC_Stub(); } return $wc; }

class WC_Payment_Gateway {
	public $id; public $has_fields; public $method_title; public $method_description; public $icon;
	public $supports = array(); public $form_fields = array(); public $settings = array();
	public $title; public $description; public $enabled = 'no';
	public function init_settings() {
		$saved = get_option( 'woocommerce_' . $this->id . '_settings', array() );
		$this->settings = is_array( $saved ) ? $saved : array();
		foreach ( $this->form_fields as $k => $f ) {
			if ( ! array_key_exists( $k, $this->settings ) ) { $this->settings[ $k ] = $f['default'] ?? ''; }
		}
		$this->enabled = $this->settings['enabled'] ?? 'no';
	}
	public function get_option( $k, $d = null ) { return array_key_exists( $k, $this->settings ) ? $this->settings[ $k ] : $d; }
	public function get_form_fields() { return $this->form_fields; }
	public function get_method_title() { return $this->method_title; }
	public function get_method_description() { return $this->method_description; }
	public function generate_settings_html( $f, $echo = true ) { echo '<tr><td>settings</td></tr>'; }
	public function is_available() { return 'yes' === $this->enabled; }
	public function get_return_url( $order = null ) { return 'https://shop.example/checkout/order-received/' . ( $order ? $order->get_id() : '' ) . '/'; }
}

class WC_Order {
	private $id; private $total; private $meta = array(); public $notes = array(); private $paid = false; private $status = 'pending';
	public function __construct( $id = 1, $total = '0' ) { $this->id = $id; $this->total = $total; $GLOBALS['__orders'][ $id ] = $this; }
	public function get_id() { return $this->id; }
	public function get_total() { return $this->total; }
	public function get_order_number() { return (string) $this->id; }
	public function get_meta( $k ) { return $this->meta[ $k ] ?? ''; }
	public function update_meta_data( $k, $v ) { $this->meta[ $k ] = $v; }
	public function delete_meta_data( $k ) { unset( $this->meta[ $k ] ); }
	public function add_order_note( $n ) { $this->notes[] = $n; }
	public function save() { return $this->id; }
	public function is_paid() { return $this->paid; }
	public function payment_complete( $tx = '' ) { $this->paid = true; $this->status = 'processing'; $this->meta['_transaction_id'] = $tx; return true; }
	public function has_status( $s ) { return $this->status === $s; }
	public function update_status( $s, $note = '' ) { $this->status = $s; if ( $note ) { $this->notes[] = $note; } }
	public function get_payment_method() { return 'tavarov_pay'; }
}
function wc_get_order( $id ) { return $GLOBALS['__orders'][ $id ] ?? null; }
function wc_get_orders( $q ) { return array(); }
