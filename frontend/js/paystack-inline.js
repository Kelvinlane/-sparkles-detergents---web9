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
            var pop = new PaystackPop();
            return pop.resumeTransaction(accessCode, callbacks || {});
        });
    };
})();
