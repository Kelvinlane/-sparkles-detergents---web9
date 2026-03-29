/**
 * Delivery address: read/validate fields + optional Google Places Autocomplete (Kenya).
 * Requires elements: order-address-search, order-shipping-county, order-shipping-region,
 * order-shipping-detail, order-shipping-formatted, order-shipping-place-id, maps-config-hint
 */
(function () {
    var mapsLoaded = false;
    var mapsLoadPromise = null;
    var autocompleteInited = false;

    function getVal(id) {
        var el = document.getElementById(id);
        return el && el.value ? String(el.value).trim() : '';
    }

    function parseAddressComponents(components) {
        if (!Array.isArray(components)) {
            return { county: '', region: '' };
        }
        function pick(types) {
            for (var i = 0; i < components.length; i++) {
                var c = components[i];
                if (!c.types) continue;
                for (var t = 0; t < types.length; t++) {
                    if (c.types.indexOf(types[t]) !== -1) {
                        return c.long_name || '';
                    }
                }
            }
            return '';
        }
        var county =
            pick(['administrative_area_level_1']) || pick(['administrative_area_level_2']);
        var region =
            pick(['locality']) ||
            pick(['sublocality']) ||
            pick(['sublocality_level_1']) ||
            pick(['neighborhood']) ||
            pick(['administrative_area_level_2']);
        return { county: county, region: region };
    }

    window.sparklesReadShippingPayload = function () {
        var search = getVal('order-address-search');
        var formatted = getVal('order-shipping-formatted');
        var locationLabel = formatted || search;
        return {
            shipping_county: getVal('order-shipping-county'),
            shipping_region: getVal('order-shipping-region'),
            shipping_location_label: locationLabel,
            shipping_detail: getVal('order-shipping-detail'),
            shipping_place_id: getVal('order-shipping-place-id')
        };
    };

    window.sparklesValidateShipping = function (p) {
        if (!p) {
            return 'Delivery address is incomplete.';
        }
        if (!p.shipping_county || p.shipping_county.length < 2) {
            return 'Please enter a county (or pick a place from search).';
        }
        if (!p.shipping_region || p.shipping_region.length < 2) {
            return 'Please enter a region or area.';
        }
        if (!p.shipping_location_label || p.shipping_location_label.length < 3) {
            return 'Search for your location or type a street, town, or landmark.';
        }
        return null;
    };

    function showMapsHint(show) {
        var el = document.getElementById('maps-config-hint');
        if (el) {
            el.classList.toggle('hidden', !show);
        }
    }

    function initAutocomplete() {
        if (autocompleteInited) {
            return;
        }
        if (!window.google || !google.maps || !google.maps.places) {
            return;
        }
        var input = document.getElementById('order-address-search');
        if (!input) {
            return;
        }
        autocompleteInited = true;
        var ac = new google.maps.places.Autocomplete(input, {
            componentRestrictions: { country: 'ke' },
            fields: ['address_components', 'formatted_address', 'place_id', 'geometry']
        });
        ac.addListener('place_changed', function () {
            var place = ac.getPlace();
            if (!place) {
                return;
            }
            var countyEl = document.getElementById('order-shipping-county');
            var regionEl = document.getElementById('order-shipping-region');
            var formattedEl = document.getElementById('order-shipping-formatted');
            var placeIdEl = document.getElementById('order-shipping-place-id');
            if (place.address_components && place.address_components.length) {
                var parsed = parseAddressComponents(place.address_components);
                if (countyEl && parsed.county) {
                    countyEl.value = parsed.county;
                }
                if (regionEl && parsed.region) {
                    regionEl.value = parsed.region;
                }
            }
            if (formattedEl) {
                formattedEl.value = place.formatted_address || '';
            }
            if (placeIdEl) {
                placeIdEl.value = place.place_id || '';
            }
        });
    }

    function loadMapsScript(apiKey) {
        if (mapsLoaded) {
            return Promise.resolve();
        }
        if (mapsLoadPromise) {
            return mapsLoadPromise;
        }
        mapsLoadPromise = new Promise(function (resolve, reject) {
            var cb = '__sparklesGmapsCb_' + Date.now();
            window[cb] = function () {
                mapsLoaded = true;
                mapsLoadPromise = null;
                try {
                    delete window[cb];
                } catch (e) {}
                resolve();
            };
            var s = document.createElement('script');
            s.async = true;
            s.defer = true;
            s.src =
                'https://maps.googleapis.com/maps/api/js?key=' +
                encodeURIComponent(apiKey) +
                '&libraries=places&callback=' +
                cb;
            s.onerror = function () {
                mapsLoadPromise = null;
                try {
                    delete window[cb];
                } catch (e) {}
                reject(new Error('Google Maps failed to load'));
            };
            document.head.appendChild(s);
        });
        return mapsLoadPromise;
    }

    /**
     * Call when checkout modal opens. Fetches /api/maps-config and loads Places once.
     */
    window.sparklesInitDeliveryAddress = function (apiBaseUrl) {
        var hintShown = false;
        fetch(apiBaseUrl.replace(/\/$/, '') + '/maps-config')
            .then(function (r) {
                return r.json();
            })
            .then(function (cfg) {
                var key = (cfg && cfg.googleMapsApiKey) || '';
                if (!key) {
                    showMapsHint(true);
                    hintShown = true;
                    return;
                }
                showMapsHint(false);
                return loadMapsScript(key).then(function () {
                    initAutocomplete();
                });
            })
            .catch(function () {
                if (!hintShown) {
                    showMapsHint(true);
                }
            });
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
