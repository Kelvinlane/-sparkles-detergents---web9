/**
 * Easter offer banner (client pages)
 * Conspicuous "10% off new customers" banner until after Easter Monday.
 * Clients cannot dismiss (no close button); it only auto-hides when the offer ends.
 */
(function () {
    function byId(id) {
        return document.getElementById(id);
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function getEasterMondayEndLocal() {
        // Easter Monday in 2026: 2026-04-06 (end of day, local time).
        return new Date(2026, 3, 6, 23, 59, 59);
    }

    function injectStyles() {
        if (document.getElementById('sparkles-easter-offer-style')) return;
        var style = document.createElement('style');
        style.id = 'sparkles-easter-offer-style';
        style.textContent = '\
@keyframes sparklesEasterPop {\
  0% { transform: scale(1); }\
  30% { transform: scale(1.02); }\
  60% { transform: scale(0.995); }\
  100% { transform: scale(1); }\
}\
@keyframes sparklesEasterGlow {\
  0% { box-shadow: 0 0 0 rgba(245, 158, 11, 0.0); }\
  40% { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25); }\
  80% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.0); }\
  100% { box-shadow: 0 0 0 rgba(245, 158, 11, 0.0); }\
}\
.easter-offer-popping {\
  animation: sparklesEasterPop 1.7s ease-in-out infinite, sparklesEasterGlow 2.6s ease-in-out infinite;\
}';
        document.head.appendChild(style);
    }

    function hideBanner(banner) {
        if (!banner) return;
        banner.classList.add('hidden');
        banner.classList.remove('easter-offer-popping');
    }

    function tick() {
        var banner = byId('easter-offer-banner');
        var countdown = byId('easter-offer-countdown');
        if (!banner || !countdown) return;

        var end = getEasterMondayEndLocal();
        var now = new Date();

        if (now.getTime() > end.getTime()) {
            hideBanner(banner);
            countdown.textContent = '00:00:00';
            return;
        }

        banner.classList.remove('hidden');
        banner.classList.add('easter-offer-popping');

        var diffMs = end.getTime() - now.getTime();
        var totalSeconds = Math.floor(diffMs / 1000);

        var days = Math.floor(totalSeconds / 86400);
        var hours = Math.floor((totalSeconds % 86400) / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;

        countdown.textContent = (days > 0 ? days + 'd ' : '') + pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds);
    }

    function init() {
        injectStyles();

        tick();
        setInterval(tick, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

