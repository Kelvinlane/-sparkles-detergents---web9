/**
 * Easter offer banner (client pages)
 * Shows a conspicuous "10% off new customers" banner until after Easter Monday.
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

    function hideBanner(banner) {
        if (!banner) return;
        banner.classList.add('hidden');
    }

    function tick() {
        var banner = byId('easter-offer-banner');
        var countdown = byId('easter-offer-countdown');
        if (!banner || !countdown) return;

        if (localStorage.getItem('sparkles_easter_offer_closed') === '1') {
            hideBanner(banner);
            return;
        }

        var end = getEasterMondayEndLocal();
        var now = new Date();

        if (now.getTime() > end.getTime()) {
            hideBanner(banner);
            countdown.textContent = '00:00:00';
            return;
        }

        banner.classList.remove('hidden');

        var diffMs = end.getTime() - now.getTime();
        var totalSeconds = Math.floor(diffMs / 1000);

        var days = Math.floor(totalSeconds / 86400);
        var hours = Math.floor((totalSeconds % 86400) / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;

        countdown.textContent = (days > 0 ? days + 'd ' : '') + pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds);
    }

    function init() {
        var banner = byId('easter-offer-banner');
        var closeBtn = byId('easter-offer-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                localStorage.setItem('sparkles_easter_offer_closed', '1');
                hideBanner(banner);
            });
        }

        tick();
        setInterval(tick, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

