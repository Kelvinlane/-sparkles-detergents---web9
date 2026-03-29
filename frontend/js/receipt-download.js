/**
 * Save the receipt panel as a standalone HTML file (no print dialog).
 */
(function () {
    window.sparklesDownloadReceipt = function () {
        var root = document.getElementById('receipt-download-root');
        if (!root) {
            return;
        }
        var styles =
            'body{font-family:system-ui,-apple-system,sans-serif;max-width:28rem;margin:2rem auto;padding:1.5rem;color:#1e3a8a;line-height:1.45}' +
            'table{width:100%;border-collapse:collapse;margin-bottom:1rem}' +
            'th,td{padding:0.35rem 0;font-size:0.9rem}' +
            'th{border-bottom:1px solid #ccc}' +
            '.receipt-head{text-align:center;margin-bottom:1.5rem}' +
            '.receipt-meta{border-top:1px solid #ccc;border-bottom:1px solid #ccc;padding:1rem 0;margin:1rem 0}' +
            '.flex-row{display:flex;justify-content:space-between;margin-bottom:0.35rem}' +
            '.total-row{border-top:1px solid #ccc;padding-top:1rem;margin-top:1rem;display:flex;justify-content:space-between;font-weight:700;font-size:1.1rem}' +
            '.thanks{text-align:center;color:#64748b;font-size:0.875rem;margin-top:1.5rem}';
        var doc =
            '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Sparkles Detergents — Receipt</title><style>' +
            styles +
            '</style></head><body>' +
            root.innerHTML +
            '</body></html>';
        var blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
        var idEl = document.getElementById('receipt-id');
        var raw = idEl && idEl.textContent ? idEl.textContent.trim() : 'receipt';
        var safe = raw.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'receipt';
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'sparkles-receipt-' + safe + '.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    };
})();
