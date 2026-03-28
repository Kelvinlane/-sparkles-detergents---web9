(function () {
    const KEY = 'sparkles_customer';

    window.getCustomerUser = function () {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    };

    window.setCustomerUser = function (user) {
        if (!user) return;
        var safe = {
            id: user.id,
            name: user.name || 'Customer',
            email: user.email || ''
        };
        localStorage.setItem(KEY, JSON.stringify(safe));
        if (typeof window.refreshAuthNav === 'function') window.refreshAuthNav();
    };

    window.clearCustomerUser = function () {
        localStorage.removeItem(KEY);
        if (typeof window.refreshAuthNav === 'function') window.refreshAuthNav();
    };

    window.refreshAuthNav = function () {
        var u = window.getCustomerUser();
        var area = document.getElementById('nav-user-area');
        var nameEl = document.getElementById('nav-user-name');
        var btnLogin = document.getElementById('btn-login-nav');
        var btnLogout = document.getElementById('btn-logout-nav');
        if (!area || !nameEl) return;
        if (u && u.name) {
            area.classList.remove('hidden');
            area.classList.add('flex');
            nameEl.textContent = u.name;
            nameEl.title = u.email ? u.email : '';
            if (btnLogin) btnLogin.classList.add('hidden');
            if (btnLogout) btnLogout.classList.remove('hidden');
        } else {
            area.classList.add('hidden');
            area.classList.remove('flex');
            nameEl.textContent = '';
            nameEl.title = '';
            if (btnLogin) btnLogin.classList.remove('hidden');
            if (btnLogout) btnLogout.classList.add('hidden');
        }
    };

    window.logoutCustomer = function () {
        window.clearCustomerUser();
        if (typeof window.currentUser !== 'undefined') window.currentUser = null;
        alert('You have been logged out.');
    };

    document.addEventListener('DOMContentLoaded', function () {
        var u = window.getCustomerUser();
        if (typeof window.currentUser !== 'undefined') window.currentUser = u;
        window.refreshAuthNav();
    });
})();
