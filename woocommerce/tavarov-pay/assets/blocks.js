/* Tavarov Pay in the WooCommerce Checkout block. No build step: plain
   WordPress globals only. */
( function () {
	var registry = window.wc && window.wc.wcBlocksRegistry;
	var settingsApi = window.wc && window.wc.wcSettings;
	var el = window.wp && window.wp.element && window.wp.element.createElement;
	var decode = window.wp && window.wp.htmlEntities ? window.wp.htmlEntities.decodeEntities : function ( s ) { return s; };
	if ( ! registry || ! settingsApi || ! el ) {
		return;
	}
	var data = settingsApi.getSetting( 'tavarov_pay_data', {} ) || {};
	var title = decode( data.title || 'USDT or USDC (crypto)' );
	var description = decode( data.description || '' );

	var Label = function () {
		return el(
			'span',
			{ style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
			data.icon ? el( 'img', { src: data.icon, alt: '', width: 24, height: 24, style: { borderRadius: '6px' } } ) : null,
			el( 'span', null, title )
		);
	};
	var Content = function () {
		return description ? el( 'p', null, description ) : null;
	};

	registry.registerPaymentMethod( {
		name: 'tavarov_pay',
		label: el( Label ),
		content: el( Content ),
		edit: el( Content ),
		canMakePayment: function () { return true; },
		ariaLabel: title,
		supports: { features: data.supports || [ 'products' ] }
	} );
} )();
