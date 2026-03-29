/**
 * Shared Paystack post-payment: verify amount, then POST /orders (used by inline checkout and checkout-callback.html).
 */
(function () {
    function applyShipping(body, pending) {
        var s = pending && pending.shipping;
        if (!s) {
            return body;
        }
        body.shipping_county = s.shipping_county;
        body.shipping_region = s.shipping_region;
        body.shipping_location_label = s.shipping_location_label;
        body.shipping_detail = s.shipping_detail || '';
        body.shipping_place_id = s.shipping_place_id || '';
        return body;
    }

    async function postOrderSingle(apiUrl, pending, paystackRef, subunit) {
        const { name, phone, email, total_amount, cart, orderIdBase } = pending;
        const items = cart.map(function (item) {
            return { id: item.id, name: item.name, qty: item.qty, price: item.price };
        });
        const body = applyShipping(
            {
                customer_name: name,
                customer_phone: phone,
                customer_email: email,
                items: items,
                total_amount: total_amount,
                order_group_id: orderIdBase || '',
                is_multi_item_order: cart.length > 1,
                payment_method: 'card_paystack',
                payment_reference: paystackRef,
                paystack_reference: paystackRef,
                paystack_cart_total_subunit: subunit
            },
            pending
        );
        const res = await fetch(apiUrl + '/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return res.json();
    }

    async function postOrderLine(apiUrl, pending, item, paystackRef, subunit) {
        const { name, phone, email, orderIdBase, cart } = pending;
        const body = applyShipping(
            {
                customer_name: name,
                customer_phone: phone,
                customer_email: email,
                items: [{ id: item.id, name: item.name, qty: item.qty, price: item.price }],
                total_amount: item.price * item.qty,
                order_group_id: orderIdBase,
                is_multi_item_order: cart.length > 1,
                payment_method: 'card_paystack',
                payment_reference: paystackRef,
                paystack_reference: paystackRef,
                paystack_cart_total_subunit: subunit
            },
            pending
        );
        const res = await fetch(apiUrl + '/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return res.json();
    }

    /**
     * @returns {Promise<{ ok: boolean, error?: string, mode?: string, orderIds?: number[], paystackRef?: string, pending?: object }>}
     */
    window.sparklesCompletePaystackPending = async function (apiUrl, reference, pending) {
        if (!pending || pending.version !== 1 || !Array.isArray(pending.cart)) {
            return { ok: false, error: 'We could not restore your cart for this payment.' };
        }
        const ref = String(reference || '').trim();
        if (!ref) {
            return { ok: false, error: 'Missing payment reference.' };
        }

        const vRes = await fetch(apiUrl + '/paystack/verify?reference=' + encodeURIComponent(ref));
        const v = await vRes.json().catch(function () {
            return {};
        });
        if (!vRes.ok || !v.ok) {
            return { ok: false, error: v.error || 'Payment verification failed.' };
        }

        const paidSub = parseInt(v.amount, 10);
        const expectedSub = parseInt(pending.cart_subunit, 10);
        if (!Number.isFinite(paidSub) || paidSub !== expectedSub) {
            return {
                ok: false,
                error: 'Amount mismatch after payment. Contact support with reference: ' + ref
            };
        }

        const mode = pending.mode === 'perLine' ? 'perLine' : 'singleOrder';
        if (mode === 'singleOrder') {
            const data = await postOrderSingle(apiUrl, pending, ref, paidSub);
            if (!data.success) {
                return { ok: false, error: data.error || 'Saving the order failed.', paystackRef: ref, pending: pending };
            }
            return {
                ok: true,
                mode: 'singleOrder',
                orderIds: [data.order_id],
                paystackRef: ref,
                pending: pending
            };
        }

        const ids = [];
        for (let i = 0; i < pending.cart.length; i++) {
            const data = await postOrderLine(apiUrl, pending, pending.cart[i], ref, paidSub);
            if (!data.success) {
                return {
                    ok: false,
                    error: data.error || 'Part of your order failed to save.',
                    paystackRef: ref,
                    partialIds: ids,
                    pending: pending
                };
            }
            ids.push(data.order_id);
        }
        return {
            ok: true,
            mode: 'perLine',
            orderIds: ids,
            paystackRef: ref,
            pending: pending
        };
    };
})();
