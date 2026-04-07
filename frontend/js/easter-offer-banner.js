/**
 * New customer offer banner (client pages)
 * Permanent "10% off first order" banner for new customers.
 */
(function () {
    function byId(id) {
        return document.getElementById(id);
    }

    function injectStyles() {
        if (document.getElementById('sparkles-easter-offer-style')) return;
        var style = document.createElement('style');
        style.id = 'sparkles-easter-offer-style';
        // Only animate transforms to avoid layout shift.
        style.textContent = '\
@keyframes sparklesEasterPop {\
  0% { transform: scale(1); }\
  25% { transform: scale(1.03); }\
  55% { transform: scale(0.997); }\
  100% { transform: scale(1); }\
}\
.easter-offer-popping {\
  transform-origin: center;\
  animation: sparklesEasterPop 1.6s ease-in-out infinite;\
  will-change: transform;\
}';
        document.head.appendChild(style);
    }

    function showBanner() {
        var banner = byId('easter-offer-banner');
        var card = byId('easter-offer-card');
        if (!banner) return;

        banner.classList.remove('opacity-0', 'pointer-events-none');
        banner.classList.add('opacity-100', 'pointer-events-auto');
        if (card) card.classList.add('easter-offer-popping');
    }

    function init() {
        injectStyles();
        showBanner();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

