<?php
/**
 * Remove the plugin's settings when it is deleted from the Plugins screen.
 * Order notes and order meta are kept: they are part of the shop's records.
 *
 * @package TavarovPay
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'woocommerce_tavarov_pay_settings' );

// Pending payment re-checks: without the plugin they would only fail.
if ( function_exists( 'as_unschedule_all_actions' ) ) {
	as_unschedule_all_actions( 'tavarov_pay_check_order', array(), 'tavarov-pay' );
}
wp_unschedule_hook( 'tavarov_pay_check_order' );
