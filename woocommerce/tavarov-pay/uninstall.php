<?php
/**
 * Remove the plugin's settings when it is deleted from the Plugins screen.
 * Order notes and order meta are kept: they are part of the shop's records.
 *
 * @package TavarovPay
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'woocommerce_tavarov_pay_settings' );
