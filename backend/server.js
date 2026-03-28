const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

require('dotenv').config();

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

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        time: new Date().toISOString(),
        corsMode: corsOrigins && corsOrigins.length ? corsOrigins : 'allow-all'
    });
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
    const { customer_name, customer_phone, customer_email, items, total_amount } = req.body;
    const orderId = 'ORD-' + Date.now();
    const safeItems = Array.isArray(items) ? items : [];

    if (!customer_name || !customer_phone || !safeItems.length || !Number.isFinite(Number(total_amount))) {
        return res.status(400).json({ error: 'Invalid order payload' });
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
            total_amount: parseInt(total_amount, 10) || 0,
            status: 'completed',
            items: safeItems.map(i => ({
                id: i.id,
                name: i.name,
                qty: i.qty,
                price: i.price
            })),
            created_at: admin.firestore.FieldValue.serverTimestamp()
        };
        await ordersRef.doc(orderId).set(orderDoc);

        res.json({ success: true, order_id: orderId });
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
            return {
                id: d.id,
                order_id: data.order_id || d.id,
                customer_name: data.customer_name,
                customer_phone: data.customer_phone,
                customer_email: data.customer_email || '',
                total_amount: data.total_amount || 0,
                status: data.status || 'pending',
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

async function seedProductsIfEmpty() {
    const snap = await productsRef.limit(1).get();
    if (!snap.empty) return;
    const defaults = [
        { name: "Liquid Laundry", price: 600, image: "https://placehold.co/400x600/3b82f6/ffffff?text=Laundry", desc: "Powerful stain removal for all fabrics. Gentle on hands, tough on dirt. 5 Litres.", category: "Laundry", stock: 100 },
        { name: "Hair Shampoo", price: 699, image: "https://placehold.co/400x600/10b981/ffffff?text=Shampoo", desc: "Nourishing formula for silky smooth hair. Contains natural extracts. 5 Litres.", category: "Personal Care", stock: 80 },
        { name: "Shower Gel", price: 749, image: "https://placehold.co/400x600/0ea5e9/ffffff?text=Shower+Gel", desc: "Refreshing and moisturizing body wash. Long lasting fragrance. 5 Litres.", category: "Personal Care", stock: 75 },
        { name: "Multi-purpose Detergent", price: 549, image: "https://placehold.co/400x600/f59e0b/ffffff?text=Multi+Purpose", desc: "All surface cleaner for floors, tiles, and kitchen tops. 5 Litres.", category: "Household", stock: 90 },
        { name: "Dish Washing Liquid", price: 449, image: "https://placehold.co/400x600/ef4444/ffffff?text=Dish+Wash", desc: "Cuts through grease instantly. Lemon fresh scent. 5 Litres.", category: "Kitchen", stock: 120 },
        { name: "Bleach", price: 499, image: "https://placehold.co/400x600/6366f1/ffffff?text=Bleach", desc: "Strong whitening and disinfecting action. 5 Litres.", category: "Laundry", stock: 85 },
        { name: "Fabric Softener", price: 900, image: "https://placehold.co/400x600/ec4899/ffffff?text=Softener", desc: "Leaves clothes soft, fluffy, and smelling amazing. 5 Litres.", category: "Laundry", stock: 70 }
    ];
    for (let i = 0; i < defaults.length; i++) {
        await productsRef.doc(String(i + 1)).set({ ...defaults[i], id: i + 1 });
    }
    console.log('Seeded default products');
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
        const { name, price, image, desc, category, stock } = req.body;
        if (!name || price == null) return res.status(400).json({ error: 'Name and price required' });
        const snap = await productsRef.orderBy('id', 'desc').limit(1).get();
        const nextId = snap.empty ? 1 : (snap.docs[0].data().id || parseInt(snap.docs[0].id)) + 1;
        const doc = {
            name, price: parseInt(price) || 0, image: image || '',
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
        const { name, price, image, desc, category, stock } = req.body;
        const ref = productsRef.doc(id);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ error: 'Product not found' });
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (price !== undefined) updates.price = parseInt(price);
        if (image !== undefined) updates.image = image;
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

seedProductsIfEmpty().catch(console.error);
ensureDefaultAdmin().catch(console.error);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Frontend served from: ${frontendPath}`);
    console.log(`Admin: http://localhost:${PORT}/admin.html`);
});
