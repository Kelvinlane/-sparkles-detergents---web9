/**
 * Delivery address: read / validate / merge into order payload (manual fields only).
 */
(function () {
    function getVal(id) {
        var el = document.getElementById(id);
        return el && el.value ? String(el.value).trim() : '';
    }

    window.sparklesReadShippingPayload = function () {
        var line = getVal('order-shipping-line');
        var county = getVal('order-shipping-county');
        var region = getVal('order-shipping-region');
        var detail = getVal('order-shipping-detail');
        var locationLabel = line;
        if (!locationLabel && (county || region)) {
            locationLabel = [county, region].filter(Boolean).join(', ');
        }
        return {
            shipping_county: county,
            shipping_region: region,
            shipping_location_label: locationLabel,
            shipping_detail: detail,
            shipping_place_id: getVal('order-shipping-place-id')
        };
    };

    window.sparklesValidateShipping = function (p) {
        if (!p) {
            return 'Delivery address is incomplete.';
        }
        if (!p.shipping_county || p.shipping_county.length < 2) {
            return 'Please enter a county.';
        }
        if (!p.shipping_region || p.shipping_region.length < 2) {
            return 'Please enter a region or area.';
        }
        if (!p.shipping_location_label || p.shipping_location_label.length < 3) {
            return 'Please enter street, landmark, or area for delivery.';
        }
        return null;
    };

    window.sparklesMergeShippingIntoObject = function (obj, shipping) {
        if (!obj || !shipping) {
            return obj;
        }
        obj.shipping_county = shipping.shipping_county;
        obj.shipping_region = shipping.shipping_region;
        obj.shipping_location_label = shipping.shipping_location_label;
        obj.shipping_detail = shipping.shipping_detail || '';
        obj.shipping_place_id = shipping.shipping_place_id || '';
        return obj;
    };
})();
