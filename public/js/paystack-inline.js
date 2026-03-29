/**
 * Load Paystack Inline v2 and open checkout with access_code from POST /transaction/initialize (resumeTransaction).
 */
(function () {
    var loadingPromise = null;

    function loadPaystackInlineScript() {
        if (window.PaystackPop) {
            return Promise.resolve();
        }
        if (loadingPromise) {
            return loadingPromise;
        }
        loadingPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://js.paystack.co/v2/inline.js';
            s.async = true;
            s.onload = function () {
                resolve();
            };
            s.onerror = function () {
                loadingPromise = null;
                reject(new Error('Could not load Paystack checkout.'));
            };
            document.head.appendChild(s);
        });
        return loadingPromise;
    }

    /**
     * @param {string} accessCode - from initialize response
     * @param {{ onSuccess?: Function, onCancel?: Function, onError?: Function, onLoad?: Function }} callbacks
     */
    window.sparklesPaystackResumeInline = function (accessCode, callbacks) {
        return loadPaystackInlineScript().then(function () {
            var PaystackPop = window.PaystackPop;
            if (!PaystackPop) {
                throw new Error('PaystackPop is not available.');
            }
            /* Hide our checkout modal so Paystack’s card form isn’t covered (stacking context / z-index). */
            var orderModal = document.getElementById('order-modal');
            if (orderModal) {
                orderModal.classList.add('hidden');
            }
            var cb = callbacks || {};
            var pop = new PaystackPop();
            return pop.resumeTransaction(accessCode, {
                onLoad: cb.onLoad,
                onSuccess: function (transaction) {
                    if (typeof cb.onSuccess === 'function') {
                        cb.onSuccess(transaction);
                    }
                },
                onCancel: function () {
                    if (orderModal) {
                        orderModal.classList.remove('hidden');
                    }
                    if (typeof cb.onCancel === 'function') {
                        cb.onCancel();
                    }
                },
                onError: function (err) {
                    if (orderModal) {
                        orderModal.classList.remove('hidden');
                    }
                    if (typeof cb.onError === 'function') {
                        cb.onError(err);
                    }
                }
            });
        });
    };
})();
