const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

require('dotenv').config();

const paystackSecretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
if (paystackSecretKey) {
    console.log('Paystack: online card checkout enabled');
} else {
    console.log('Paystack: disabled — set PAYSTACK_SECRET_KEY for card payments (Kenya / Paystack)');
}

/** KES → Paystack amount (minor units, typically KES × 100). */
function kesToPaystackAmountUnit(kes) {
    return Math.round(Number(kes) * 100);
}

async function paystackRequest(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = {
        Authorization: `Bearer ${paystackSecretKey}`,
        ...(options.headers || {})
    };
    if (method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`https://api.paystack.co${path}`, { ...options, headers });
    const json = await res.json().catch(() => ({}));
    return { res, json };
}

// Serve frontend from ../frontend (so backend and frontend are separate folders)
const frontendPath = path.join(__dirname, '..', 'frontend');
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || '').trim();
const FRONTEND_ORIGINS_EXTRA = (process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** If FRONTEND_ORIGIN is set, also allow the www ↔ apex pair so both URLs work. */
function buildCorsOrigins() {
    const seeds = [...(FRONTEND_ORIGIN ? [FRONTEND_ORIGIN] : []), ...FRONTEND_ORIGINS_EXTRA];
    if (seeds.length === 0) return null;
    const set = new Set();
    for (const o of seeds) {
        set.add(o);
        try {
            const u = new URL(o);
            const h = u.hostname;
            if (h.startsWith('www.')) {
                set.add(`${u.protocol}//${h.slice(4)}`);
            } else {
                set.add(`${u.protocol}//www.${h}`);
            }
        } catch (_) {
            /* ignore */
        }
    }
    const list = [...seeds].join(' ').toLowerCase();
    if (list.includes('sparklesdetergents')) {
        set.add('https://www.sparklesdetergents.com');
        set.add('https://sparklesdetergents.com');
    }
    return [...set];
}

const corsOrigins = buildCorsOrigins();
if (corsOrigins && corsOrigins.length) {
    console.log('CORS allowed origins:', corsOrigins.join(', '));
}
app.use(
    cors({
        origin(origin, callback) {
            if (!corsOrigins || corsOrigins.length === 0) {
                return callback(null, true);
            }
            if (!origin) {
                return callback(null, true);
            }
            if (corsOrigins.includes(origin)) {
                return callback(null, true);
            }
            console.warn('CORS blocked Origin:', origin);
            return callback(null, false);
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: false
    })
);
app.use(express.json());

function sendHealth(req, res) {
    res.json({
        ok: true,
        time: new Date().toISOString(),
        corsMode: corsOrigins && corsOrigins.length ? corsOrigins : 'allow-all'
    });
}
app.get('/api/health', sendHealth);
app.get('/health', sendHealth);

/** Browser key: enable Places Autocomplete on checkout (restrict key by HTTP referrer in Google Cloud). */
app.get('/api/maps-config', (req, res) => {
    const googleMapsApiKey = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
    res.json({ googleMapsApiKey });
});

app.post('/api/paystack/initialize', async (req, res) => {
    if (!paystackSecretKey) {
        return res.status(503).json({ error: 'Paystack is not configured on this server.' });
    }
    const email = String(req.body.email || '')
        .trim()
        .slice(0, 120);
    const amountKes = parseInt(req.body.amount_kes, 10);
    const callback_url = String(req.body.callback_url || '').trim().slice(0, 600);
    if (!email || !callback_url.startsWith('http')) {
        return res.status(400).json({ error: 'Valid email and callback_url are required' });
    }
    if (!Number.isFinite(amountKes) || amountKes < 1) {
        return res.status(400).json({ error: 'Invalid amount' });
    }
    const amount = kesToPaystackAmountUnit(amountKes);
    const rawMeta = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const metadata = {};
    for (const [k, v] of Object.entries(rawMeta)) {
        if (Object.keys(metadata).length >= 5) break;
        metadata[String(k).slice(0, 40)] = String(v).slice(0, 100);
    }
    try {
        const { res: psRes, json } = await paystackRequest('/transaction/initialize', {
            method: 'POST',
            body: JSON.stringify({
                email,
                amount,
                currency: 'KES',
                callback_url,
                metadata
            })
        });
        if (!psRes.ok || !json.status) {
            return res.status(400).json({ error: json.message || 'Paystack could not start checkout' });
        }
        res.json({
            authorization_url: json.data.authorization_url,
            access_code: json.data.access_code,
            reference: json.data.reference,
            amount_subunit: amount
        });
    } catch (err) {
        console.error('Paystack initialize:', err);
        res.status(500).json({ error: err.message || 'Paystack error' });
    }
});

app.get('/api/paystack/verify', async (req, res) => {
    if (!paystackSecretKey) {
        return res.status(503).json({ ok: false, error: 'Paystack is not configured' });
    }
    const reference = String(req.query.reference || '').trim();
    if (!reference) {
        return res.status(400).json({ ok: false, error: 'reference is required' });
    }
    try {
        const { res: psRes, json } = await paystackRequest(
            `/transaction/verify/${encodeURIComponent(reference)}`,
            { method: 'GET' }
        );
        if (!psRes.ok || !json.status) {
            return res.status(400).json({ ok: false, error: json.message || 'Verification failed' });
        }
        const d = json.data || {};
        const ok = (d.status || '').toLowerCase() === 'success';
        res.json({
            ok,
            amount: d.amount,
            currency: d.currency,
            reference: d.reference
        });
    } catch (err) {
        console.error('Paystack verify:', err);
        res.status(500).json({ ok: false, error: err.message || 'Verify error' });
    }
});

app.use(express.static(frontendPath));

// ==================== FIREBASE (Firestore) ====================
const serviceAccountPath = path.join(__dirname, 'sparkles-shop-firebase-adminsdk-fbsvc-396ee23a61.json');

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('Using Firebase credentials from FIREBASE_SERVICE_ACCOUNT env var');
    } catch (e) {
        console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT env var, falling back to local JSON file:', e.message);
        serviceAccount = require(serviceAccountPath);
    }
} else {
    serviceAccount = require(serviceAccountPath);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();
console.log('Connected to Firestore');

(function logSmtpStartup() {
    const s = getSmtpEnv();
    if (s.host && s.user) {
        console.log(`SMTP email notifications: enabled (host=${s.host}, user set: yes, pass set: ${s.pass ? 'yes' : 'no'})`);
    } else {
        const missing = [];
        if (!s.host) missing.push('SMTP_HOST');
        if (!s.user) missing.push('SMTP_USER');
        console.log(
            'SMTP email notifications: DISABLED — add these in Render → Web Service → Environment (not the static site): ' +
                missing.join(', ')
        );
    }
})();

// ==================== FIRESTORE COLLECTION REFS ====================
const usersRef = firestore.collection('users');
const ordersRef = firestore.collection('orders');
const productsRef = firestore.collection('products');
const contactMessagesRef = firestore.collection('contact_messages');

/** Trimmed SMTP settings (Render/UI often adds accidental spaces or empty lines.) */
function getSmtpEnv() {
    return {
        host: (process.env.SMTP_HOST || '').trim(),
        user: (process.env.SMTP_USER || '').trim(),
        pass: (process.env.SMTP_PASS || '').trim(),
        fromAddr: (process.env.SMTP_FROM || '').trim(),
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true'
    };
}

function stripPassword(userData) {
    if (!userData || typeof userData !== 'object') return userData;
    const { password: _p, ...rest } = userData;
    return rest;
}

async function sendContactEmails({ name, email, message, id }) {
    const to = (process.env.CONTACT_TO_EMAIL || 'sparklesdetergentskenya@gmail.com').trim();
    const s = getSmtpEnv();
    if (!s.host || !s.user) {
        console.log('Contact message stored; set SMTP_HOST + SMTP_USER (+ SMTP_PASS) to email notifications.');
        return { emailed: false };
    }
    try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: s.host,
            port: s.port,
            secure: s.secure,
            auth: {
                user: s.user,
                pass: s.pass
            }
        });
        const fromAddr = s.fromAddr || s.user;
        await transporter.sendMail({
            from: `"Sparkles Detergents" <${fromAddr}>`,
            to,
            replyTo: email,
            subject: `Website message from ${name}`,
            text: `From: ${name} <${email}>\n\n${message}\n\n(Ref: ${id})`,
            html: `<p><strong>${name}</strong> &lt;${email}&gt;</p><p>${message.replace(/\n/g, '<br>')}</p><p style="color:#666;font-size:12px">Ref: ${id}</p>`
        });
        if (process.env.CONTACT_SEND_AUTO_REPLY === 'true') {
            await transporter.sendMail({
                from: `"Sparkles Detergents" <${fromAddr}>`,
                to: email,
                subject: 'We received your message — Sparkles Detergents',
                text: `Hi ${name},\n\nThank you for contacting Sparkles Detergents. We will get back to you soon.\n\n— Sparkles Detergents`
            });
        }
        return { emailed: true };
    } catch (err) {
        console.error('Contact email failed:', err.message);
        return { emailed: false, emailError: err.message };
    }
}

// Ensure default admin user exists in Firestore
async function ensureDefaultAdmin() {
    try {
        const snap = await usersRef.where('email', '==', 'admin@sparkles.com').limit(1).get();
        if (snap.empty) {
            await usersRef.add({
                name: 'Administrator',
                email: 'admin@sparkles.com',
                phone: '0759102078',
                password: 'admin123',
                created_at: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log('Default admin created in Firestore: admin@sparkles.com / admin123');
        }
    } catch (e) {
        console.error('Failed to ensure default admin:', e.message);
    }
}

// ==================== API ROUTES (AUTH) ====================

app.post('/api/register', async (req, res) => {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    try {
        const existing = await usersRef.where('email', '==', email).limit(1).get();
        if (!existing.empty) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        const doc = await usersRef.add({
            name,
            email,
            phone: phone || '',
            password,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });
        res.json({ success: true, userId: doc.id });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Failed to register user' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    try {
        const snap = await usersRef
            .where('email', '==', email)
            .where('password', '==', password)
            .limit(1)
            .get();
        if (snap.empty) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const doc = snap.docs[0];
        res.json({ success: true, user: { id: doc.id, ...stripPassword(doc.data()) } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Failed to login' });
    }
});

// Contact form (public)
app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body || {};
    const n = (name || '').trim();
    const em = (email || '').trim();
    const msg = (message || '').trim();
    if (!n || !em || !msg) {
        return res.status(400).json({ error: 'Name, email, and message are required' });
    }
    try {
        const docRef = await contactMessagesRef.add({
            name: n,
            email: em,
            message: msg,
            status: 'new',
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });
        const emailResult = await sendContactEmails({ name: n, email: em, message: msg, id: docRef.id });
        res.json({ success: true, id: docRef.id, emailed: emailResult.emailed });
    } catch (err) {
        console.error('Contact save error:', err);
        res.status(500).json({ error: 'Failed to save message' });
    }
});

app.get('/api/admin/contact-messages', async (req, res) => {
    try {
        const snap = await contactMessagesRef.get();
        const rows = snap.docs
            .map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    name: data.name,
                    email: data.email,
                    message: data.message,
                    status: data.status || 'new',
                    created_at: data.created_at ? data.created_at.toDate() : null
                };
            })
            .sort((a, b) => {
                const ta = a.created_at ? a.created_at.getTime() : 0;
                const tb = b.created_at ? b.created_at.getTime() : 0;
                return tb - ta;
            })
            .slice(0, 100);
        res.json(rows);
    } catch (err) {
        console.error('Admin contact messages error:', err);
        res.status(500).json({ error: err.message || 'Failed to load messages' });
    }
});

// ORDER Routes (Customer)
app.post('/api/orders', async (req, res) => {
    const {
        customer_name,
        customer_phone,
        customer_email,
        items,
        total_amount,
        payment_method,
        payment_reference,
        order_group_id,
        is_multi_item_order,
        paystack_reference,
        paystack_cart_total_subunit,
        shipping_county,
        shipping_region,
        shipping_location_label,
        shipping_detail,
        shipping_place_id
    } = req.body;

    const originalTotalAmount = parseInt(total_amount, 10) || 0;

    let pm =
        typeof payment_method === 'string' && payment_method.trim()
            ? payment_method.trim().slice(0, 64)
            : 'unspecified';
    let pref =
        typeof payment_reference === 'string'
            ? payment_reference.trim().slice(0, 200)
            : '';
    const groupId =
        typeof order_group_id === 'string' ? order_group_id.trim().slice(0, 128) : '';
    const multiFlag = !!is_multi_item_order;

    const paystackRef =
        typeof paystack_reference === 'string' ? paystack_reference.trim().slice(0, 128) : '';
    const paystackExpectedSub = parseInt(paystack_cart_total_subunit, 10);

    const orderId = 'ORD-' + Date.now() + '-' + Math.floor(1000 + Math.random() * 8999);
    const safeItems = Array.isArray(items) ? items : [];

    if (!customer_name || !customer_phone || !safeItems.length || !Number.isFinite(Number(total_amount))) {
        return res.status(400).json({ error: 'Invalid order payload' });
    }

    const scounty = String(shipping_county || '')
        .trim()
        .slice(0, 120);
    const sregion = String(shipping_region || '')
        .trim()
        .slice(0, 120);
    const slocation = String(shipping_location_label || '')
        .trim()
        .slice(0, 500);
    const sdetail = String(shipping_detail || '')
        .trim()
        .slice(0, 300);
    const splace = String(shipping_place_id || '')
        .trim()
        .slice(0, 256);
    if (scounty.length < 2 || sregion.length < 2 || slocation.length < 3) {
        return res.status(400).json({
            error: 'County, region/area, and delivery location (search or description) are required.'
        });
    }

    if (paystackRef) {
        if (!paystackSecretKey) {
            return res.status(503).json({ error: 'Paystack is not configured on this server.' });
        }
        if (!Number.isFinite(paystackExpectedSub) || paystackExpectedSub < 1) {
            return res.status(400).json({ error: 'Invalid Paystack verification' });
        }
        try {
            const { res: psRes, json } = await paystackRequest(
                `/transaction/verify/${encodeURIComponent(paystackRef)}`,
                { method: 'GET' }
            );
            if (!psRes.ok || !json.status || !json.data) {
                return res.status(400).json({ error: json.message || 'Could not verify Paystack payment' });
            }
            const d = json.data;
            if ((d.status || '').toLowerCase() !== 'success') {
                return res.status(400).json({ error: 'Paystack payment was not successful' });
            }
            if ((d.currency || '').toUpperCase() !== 'KES') {
                return res.status(400).json({ error: 'Unexpected Paystack currency' });
            }
            const paid = parseInt(d.amount, 10);
            if (!Number.isFinite(paid) || paid !== paystackExpectedSub) {
                return res.status(400).json({ error: 'Paystack amount mismatch' });
            }
        } catch (err) {
            console.error('Paystack order verify:', err);
            return res.status(400).json({ error: err.message || 'Paystack verification failed' });
        }
        pm = 'card_paystack';
        pref = paystackRef.slice(0, 200);
    }

    // ==================== Easter New Customer Offer ====================
    // Apply 10% off only for eligible "first order" customers during the Easter period.
    // Eligibility: no previous orders for this customer with a different order_group_id.
    // We only apply the discount for non-card payments so Paystack amounts remain consistent.
    let offer_applied = false;
    let discount_percent = 0;
    let discounted_total_amount = originalTotalAmount;

    const easterEndUtc = Date.UTC(2026, 3, 6, 20, 59, 59); // 2026-04-06 23:59:59 in Africa/Nairobi (UTC+3)
    const nowUtc = Date.now();
    const custEmail = String(customer_email || '').trim();
    const offerActive = nowUtc <= easterEndUtc;

    if (
        offerActive &&
        custEmail &&
        (pm === 'mpesa_till' || pm === 'cash_delivery') &&
        originalTotalAmount > 0 &&
        typeof groupId === 'string' &&
        groupId.length
    ) {
        try {
            const groupIdForQuery = groupId || '__none__';
            const prevSnap = await ordersRef
                .where('customer_email', '==', custEmail)
                .limit(20)
                .get();

            const hasDifferentGroup = prevSnap.docs.some((d) => {
                const od = d.data() || {};
                return String(od.order_group_id || '') !== groupIdForQuery;
            });

            offer_applied = !hasDifferentGroup;
            if (offer_applied) {
                discount_percent = 10;
                discounted_total_amount = Math.round(originalTotalAmount * 0.9);
            }
        } catch (e) {
            // If the Firestore query needs an index (or fails), do not block checkout.
            console.error('Offer eligibility check failed:', e.message || e);
        }
    }

    try {
        await firestore.runTransaction(async (t) => {
            const productRefs = safeItems.map(item => {
                const productId = item?.id;
                if (!productId) throw new Error('Invalid item in cart');
                return productsRef.doc(String(productId));
            });

            const productDocs = await t.getAll(...productRefs);
            const updates = [];

            for (let i = 0; i < safeItems.length; i++) {
                const item = safeItems[i];
                const qty = parseInt(item?.qty, 10) || 0;
                const snap = productDocs[i];

                if (qty <= 0) throw new Error('Invalid quantity in cart');
                if (!snap.exists) throw new Error(`Product ${item.id} not found`);

                const data = snap.data() || {};
                const currentStock = parseInt(data.stock, 10) || 0;

                if (currentStock < qty) {
                    throw new Error(`${data.name || 'Product'} has only ${currentStock} left`);
                }

                updates.push({
                    ref: productRefs[i],
                    newStock: currentStock - qty
                });
            }

            for (const update of updates) {
                t.update(update.ref, { stock: update.newStock });
            }
        });

        // Save order in Firestore
        const orderDoc = {
            order_id: orderId,
            customer_name,
            customer_phone,
            customer_email: customer_email || '',
            total_amount: discounted_total_amount,
            original_total_amount: originalTotalAmount,
            discounted_total_amount: discounted_total_amount,
            discount_percent: discount_percent,
            offer_applied: offer_applied,
            status: 'completed',
            payment_method: pm,
            payment_reference: pref,
            order_group_id: groupId,
            is_multi_item_order: multiFlag,
            items: safeItems.map(i => ({
                id: i.id,
                name: i.name,
                qty: i.qty,
                price: i.price
            })),
            shipping_county: scounty,
            shipping_region: sregion,
            shipping_location_label: slocation,
            shipping_detail: sdetail,
            shipping_place_id: splace,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        };
        await ordersRef.doc(orderId).set(orderDoc);

        res.json({
            success: true,
            order_id: orderId,
            pricing: {
                offer_applied: offer_applied,
                discount_percent: discount_percent,
                original_total_amount: originalTotalAmount,
                discounted_total_amount: discounted_total_amount
            }
        });
    } catch (err) {
        console.error('Order error:', err);
        res.status(400).json({ error: err.message || 'Failed to place order' });
    }
});

// ==================== ADMIN ORDER ROUTES (Firestore) ====================
app.get('/api/admin/orders', async (req, res) => {
    try {
        const snap = await ordersRef.orderBy('created_at', 'desc').get();
        const orders = snap.docs.map(d => {
            const data = d.data();
            const itemsArr = Array.isArray(data.items) ? data.items : [];
            const itemsDisplay = itemsArr.map(it => `${it.name} (x${it.qty})`).join(', ');
            const shipBits = [data.shipping_county, data.shipping_region].filter(Boolean);
            return {
                id: d.id,
                order_id: data.order_id || d.id,
                customer_name: data.customer_name,
                customer_phone: data.customer_phone,
                customer_email: data.customer_email || '',
                shipping_summary: shipBits.length ? shipBits.join(' · ') : '',
                shipping_county: data.shipping_county || '',
                shipping_region: data.shipping_region || '',
                shipping_location_label: data.shipping_location_label || '',
                shipping_detail: data.shipping_detail || '',
                total_amount: data.total_amount || 0,
                status: data.status || 'pending',
                payment_method: data.payment_method || '',
                payment_reference: data.payment_reference || '',
                order_group_id: data.order_group_id || '',
                is_multi_item_order: !!data.is_multi_item_order,
                created_at: data.created_at ? data.created_at.toDate() : new Date(0),
                items: itemsDisplay
            };
        });
        res.json(orders);
    } catch (err) {
        console.error('Admin orders error:', err);
        res.status(500).json({ error: err.message || 'Failed to load orders' });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const snap = await ordersRef.get();
        let totalOrders = 0;
        let totalRevenue = 0;
        snap.forEach(d => {
            totalOrders += 1;
            const data = d.data();
            totalRevenue += Number(data.total_amount || 0);
        });
        res.json({ total_orders: totalOrders, total_revenue: totalRevenue });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: err.message || 'Failed to load stats' });
    }
});

app.get('/api/admin/order/:id', async (req, res) => {
    const orderId = req.params.id;
    try {
        const doc = await ordersRef.doc(orderId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const data = doc.data();
        res.json({ id: doc.id, ...data });
    } catch (err) {
        console.error('Admin order detail error:', err);
        res.status(500).json({ error: err.message || 'Failed to load order' });
    }
});

/**
 * Original seven products — keep these photos (paths root-relative).
 * Six newer pack-shot images are separate products (ids 8–13), not replacements.
 */
const PRODUCT_CATALOG_LEGACY_1_7 = [
    { id: 1, name: 'Liquid Laundry', price: 600, image: '/images/Dofoto_20260105_151624084.jpg', imageAlt: 'Liquid laundry detergent 5 litre bottle Sparkles Detergents Kenya', desc: 'Powerful stain removal for all fabrics. Gentle on hands, tough on dirt. 5 Litres.', category: 'Laundry', stock: 100 },
    { id: 2, name: 'Hair Shampoo', price: 699, image: '/images/ChatGPT Image Feb 20, 2026, 11_37_30 AM.png', imageAlt: 'Hair shampoo 5 litre Sparkles bulk bottle Kenya', desc: 'Nourishing formula for silky smooth hair. Contains natural extracts. 5 Litres.', category: 'Personal Care', stock: 80 },
    { id: 3, name: 'Shower Gel', price: 749, image: '/images/Dofoto_20260106_130957947.jpg', imageAlt: 'Shower gel body wash 5 litre Sparkles Detergents Kenya', desc: 'Refreshing and moisturizing body wash. Long lasting fragrance. 5 Litres.', category: 'Personal Care', stock: 75 },
    { id: 4, name: 'Multi-purpose Detergent', price: 549, image: '/images/Dofoto_20260106_131334771.jpg', imageAlt: 'Multi-purpose surface cleaner 5 litre Sparkles Kenya', desc: 'All surface cleaner for floors, tiles, and kitchen tops. 5 Litres.', category: 'Household', stock: 90 },
    { id: 5, name: 'Dish Washing Liquid', price: 449, image: '/images/Dofoto_20260105_150608139.jpg', imageAlt: 'Dish washing liquid 5 litre Sparkles Kenya', desc: 'Cuts through grease instantly. Lemon fresh scent. 5 Litres.', category: 'Kitchen', stock: 120 },
    { id: 6, name: 'Bleach', price: 499, image: '/images/Dofoto_20260105_145304900.jpg', imageAlt: 'Laundry bleach 5 litre whitening Sparkles Kenya', desc: 'Strong whitening and disinfecting action. 5 Litres.', category: 'Laundry', stock: 85 },
    { id: 7, name: 'Fabric Softener', price: 900, image: '/images/Dofoto_20260105_150739737.jpg', imageAlt: 'Fabric softener 5 litre Sparkles floral Kenya', desc: 'Leaves clothes soft, fluffy, and smelling amazing. 5 Litres.', category: 'Laundry', stock: 70 }
];

/** Six additional listings using the new pack photography (ids 8–13). */
const PRODUCT_CATALOG_NEW_8_13 = [
    { id: 8, name: 'Liquid Laundry (blue jug)', price: 600, image: '/images/sparkles-liquid-laundry-5l.png', imageAlt: 'Sparkles 5 litre blue liquid laundry detergent in a jerrycan — smart dirt removal, washing machine graphic, Nairobi Kenya', desc: 'Same great formula — alternate label and jug style. Powerful stain removal, 5 Litres.', category: 'Laundry', stock: 100 },
    { id: 9, name: 'Hair Shampoo (salon jug)', price: 699, image: '/images/sparkles-hair-shampoo-5l.png', imageAlt: 'Sparkles Hair Shampoo 5 litre bulk bottle — colour care, shine and detangling, Nairobi Kenya', desc: 'Same line — shown in blue salon-style jug. Nourishing formula, 5 Litres.', category: 'Personal Care', stock: 80 },
    { id: 10, name: 'Shower Gel — pink jug', price: 749, image: '/images/sparkles-shower-gel-pink-5l.png', imageAlt: 'Sparkles Detergents pink shower gel 5 litre — moisturizing body wash, Nairobi Kenya', desc: 'Moisturizing body wash — pink pack. All natural feel, 5 Litres.', category: 'Personal Care', stock: 75 },
    { id: 11, name: 'Shower Gel — red jug', price: 749, image: '/images/sparkles-shower-gel-red-5l.png', imageAlt: 'Sparkles Detergents red shower gel 5 litre — moisturizing body wash, Nairobi Kenya', desc: 'Moisturizing body wash — red pack variant. 5 Litres.', category: 'Personal Care', stock: 75 },
    { id: 12, name: 'Dish Washing Liquid — lemon jug', price: 449, image: '/images/sparkles-dishwash-lemon-5l.png', imageAlt: "Mommy D's Sparkles lemon dishwashing liquid 5 litre jug — grease-cutting kitchen soap, Kenya", desc: 'Lemon dish wash — green jug label style. Cuts grease, 5 Litres.', category: 'Kitchen', stock: 120 },
    { id: 13, name: 'Fabric Softener — floral jug', price: 900, image: '/images/sparkles-fabric-softener-5l.png', imageAlt: 'Sparkles fabric softener 5 litre pink bottle — long-lasting floral fragrance, Kenya', desc: 'Softener with floral artwork on jug. Long-lasting fragrance, 5 Litres.', category: 'Laundry', stock: 70 }
];

const PRODUCT_CATALOG_ALL = [...PRODUCT_CATALOG_LEGACY_1_7, ...PRODUCT_CATALOG_NEW_8_13];

/** Keep legacy photos on ids 1–7 (image + imageAlt only; preserves price, stock, name from admin). */
async function syncLegacyProductMedia1to7() {
    const updated = [];
    for (const row of PRODUCT_CATALOG_LEGACY_1_7) {
        const ref = productsRef.doc(String(row.id));
        const doc = await ref.get();
        if (!doc.exists) continue;
        await ref.update({ image: row.image, imageAlt: row.imageAlt });
        updated.push(row.id);
    }
    if (updated.length) {
        console.log('Synced legacy product images for ids 1–7:', updated.join(', '));
    }
}

/** Create products 8–13 if missing (adds new photos without removing 1–7). */
async function ensureExtendedProducts8to13() {
    const created = [];
    for (const row of PRODUCT_CATALOG_NEW_8_13) {
        const ref = productsRef.doc(String(row.id));
        const doc = await ref.get();
        if (doc.exists) continue;
        await ref.set({ ...row });
        created.push(row.id);
    }
    if (created.length) {
        console.log('Created extended catalog products:', created.join(', '));
    }
}

async function seedProductsIfEmpty() {
    const snap = await productsRef.limit(1).get();
    if (!snap.empty) return;
    for (const row of PRODUCT_CATALOG_ALL) {
        const { id, ...rest } = row;
        await productsRef.doc(String(id)).set({ ...rest, id });
    }
    console.log('Seeded default products (13 items)');
}

app.get('/api/products', async (req, res) => {
    try {
        const snap = await productsRef.orderBy('id').get();
        const products = snap.docs.map(d => ({ id: parseInt(d.id), ...d.data() }));
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/products', async (req, res) => {
    try {
        const snap = await productsRef.orderBy('id').get();
        const products = snap.docs.map(d => ({ id: parseInt(d.id), ...d.data() }));
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/products', async (req, res) => {
    try {
        const { name, price, image, imageAlt, desc, category, stock } = req.body;
        if (!name || price == null) return res.status(400).json({ error: 'Name and price required' });
        const snap = await productsRef.orderBy('id', 'desc').limit(1).get();
        const nextId = snap.empty ? 1 : (snap.docs[0].data().id || parseInt(snap.docs[0].id)) + 1;
        const doc = {
            name, price: parseInt(price) || 0, image: image || '',
            imageAlt: imageAlt || '',
            desc: desc || '', category: category || '', stock: parseInt(stock) || 0, id: nextId
        };
        await productsRef.doc(String(nextId)).set(doc);
        res.json({ success: true, product: { id: nextId, ...doc } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/products/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const { name, price, image, imageAlt, desc, category, stock } = req.body;
        const ref = productsRef.doc(id);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ error: 'Product not found' });
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (price !== undefined) updates.price = parseInt(price);
        if (image !== undefined) updates.image = image;
        if (imageAlt !== undefined) updates.imageAlt = imageAlt;
        if (desc !== undefined) updates.desc = desc;
        if (category !== undefined) updates.category = category;
        if (stock !== undefined) updates.stock = parseInt(stock);
        await ref.update(updates);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/products/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await productsRef.doc(id).delete();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

seedProductsIfEmpty()
    .then(() => syncLegacyProductMedia1to7())
    .then(() => ensureExtendedProducts8to13())
    .catch(console.error);
ensureDefaultAdmin().catch(console.error);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Frontend served from: ${frontendPath}`);
    console.log(`Admin: http://localhost:${PORT}/admin.html`);
    console.log(`Health check: /health and /api/health`);
});
