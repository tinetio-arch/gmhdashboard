<?php
/**
 * ABX TAC — Suppress customer-facing WooCommerce emails for company-paid orders.
 *
 * INSTALL on abxtac.com (NOT in this repo's runtime — this lives on WordPress):
 *   Option A: paste into the active theme's functions.php
 *   Option B (preferred): drop this file into wp-content/mu-plugins/ as
 *            abxtac-suppress-company-emails.php (no activation needed)
 *
 * What it does:
 *   The GMH iPad "Order for Patient (Company-Paid)" flow creates WooCommerce
 *   orders with the meta key `_suppress_wc_customer_emails = yes`. Without
 *   this filter, WooCommerce would still email the patient an "order received"
 *   email containing the price — defeating the whole point of the flow.
 *   This filter intercepts those emails and short-circuits them when the meta
 *   is set. ShipStation's separate shipment notification is unaffected.
 *
 * What it does NOT touch:
 *   - Admin "new order" notifications (staff still get those)
 *   - ShipStation tracking emails (those come from ShipStation, not WC)
 *   - Regular patient-paid orders (no `_suppress_wc_customer_emails` meta)
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

add_filter( 'woocommerce_email_enabled_customer_processing_order', 'gmh_suppress_if_company', 10, 2 );
add_filter( 'woocommerce_email_enabled_customer_completed_order',  'gmh_suppress_if_company', 10, 2 );
add_filter( 'woocommerce_email_enabled_customer_on_hold_order',    'gmh_suppress_if_company', 10, 2 );
add_filter( 'woocommerce_email_enabled_customer_invoice',          'gmh_suppress_if_company', 10, 2 );
add_filter( 'woocommerce_email_enabled_customer_refunded_order',   'gmh_suppress_if_company', 10, 2 );
add_filter( 'woocommerce_email_enabled_customer_partial_refunded_order', 'gmh_suppress_if_company', 10, 2 );

function gmh_suppress_if_company( $enabled, $order ) {
    if ( is_a( $order, 'WC_Order' ) && $order->get_meta( '_suppress_wc_customer_emails' ) === 'yes' ) {
        return false;
    }
    return $enabled;
}
