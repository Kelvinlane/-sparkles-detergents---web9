const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend files

// ==================== FIREBASE (Firestore) ====================
// IMPORTANT: Do NOT commit your service account JSON to a public repo.
// This uses the service account JSON file currently in your project folder.
// Recommended alternative is setting GOOGLE_APPLICATION_CREDENTIALS env var.
const serviceAccountPath = path.join(__dirname, 'sparkles-shop-firebase-adminsdk-fbsvc-396ee23a61.json');

admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath))
});

const firestore = admin.firestore();
console.log('Connected to Firestore');

// Initialize Database
const db = new sqlite3.Database('./data.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Create Tables
function initializeDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT UNIQUE NOT NULL,
            customer_name TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            customer_email TEXT,
            total_amount INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            product_name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price INTEGER NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `);

    // Create default admin user
    db.get("SELECT * FROM users WHERE email = 'admin@sparkles.com'", (err, row) => {
        if (!row) {
            db.run("INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)",
                ['Administrator', 'admin@sparkles.com', '0759102078', 'admin123']);
            console.log('Default admin created: admin@sparkles.com / admin123');
        }
    });
}

// ==================== API ROUTES ====================

// AUTH Routes
app.post('/api/register', (req, res) => {
    const { name, email, phone, password } = req.body;
    db.run("INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)",
        [name, email, phone, password],
        function(err) {
            if (err) {
                res.status(400).json({ error: 'Email already exists' });
            } else {
                res.json({ success: true, userId: this.lastID });
            }
        });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ? AND password = ?", 
        [email, password],
        (err, row) => {
            if (row) {
                res.json({ success: true, user: row });
            } else {
                res.status(401).json({ error: 'Invalid credentials' });
            }
        });
});

// ORDER Routes (Customer)
app.post('/api/orders', (req, res) => {
    const { customer_name, customer_phone, customer_email, items, total_amount } = req.body;
    const orderId = 'ORD-' + Date.now();
    const safeItems = Array.isArray(items) ? items : [];
    if (!customer_name || !customer_phone || !safeItems.length || !Number.isFinite(Number(total_amount))) {
        return res.status(400).json({ error: 'Invalid order payload' });
    }

    // Validate & decrement stock in Firestore (authoritative)
    firestore.runTransaction(async (t) => {
        for (const item of safeItems) {
            const productId = item?.id;
            const qty = parseInt(item?.qty, 10) || 0;
            if (!productId || qty <= 0) throw new Error('Invalid item in cart');

            const ref = productsRef.doc(String(productId));
            const snap = await t.get(ref);
            if (!snap.exists) throw new Error(`Product ${productId} not found`);
            const data = snap.data() || {};
            const currentStock = parseInt(data.stock, 10) || 0;
            if (currentStock < qty) throw new Error(`${data.name || 'Product'} has only ${currentStock} left`);
            t.update(ref, { stock: currentStock - qty });
        }
    }).then(() => {
        db.run(
            "INSERT INTO orders (order_id, customer_name, customer_phone, customer_email, total_amount, status) VALUES (?, ?, ?, ?, ?, ?)",
            [orderId, customer_name, customer_phone, customer_email || '', parseInt(total_amount, 10) || 0, 'completed'],
            function (err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                const newOrderId = this.lastID;

                // Insert order items
                const stmt = db.prepare("INSERT INTO order_items (order_id, product_name, quantity, price) VALUES (?, ?, ?, ?)");
                safeItems.forEach((item) => {
                    stmt.run(newOrderId, item.name, item.qty, item.price);
                });
                stmt.finalize();

                res.json({ success: true, order_id: orderId });
            }
        );
    }).catch((err) => {
        res.status(400).json({ error: err.message || 'Failed to place order' });
    });
});

// ADMIN Routes (Protected - in production add authentication middleware)
app.get('/api/admin/orders', (req, res) => {
    db.all(`
        SELECT o.*, 
               GROUP_CONCAT(oi.product_name || ' (x' || oi.quantity || ')', ', ') as items
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        GROUP BY o.id
        ORDER BY o.created_at DESC
    `, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.get('/api/admin/stats', (req, res) => {
    db.get("SELECT COUNT(*) as total_orders, SUM(total_amount) as total_revenue FROM orders", [], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(row);
        }
    });
});

app.get('/api/admin/order/:id', (req, res) => {
    const orderId = req.params.id;
    db.get("SELECT * FROM orders WHERE id = ?", [orderId], (err, order) => {
        if (err || !order) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }
        
        db.all("SELECT * FROM order_items WHERE order_id = ?", [orderId], (err, items) => {
            res.json({ ...order, items });
        });
    });
});

// ==================== PRODUCTS (Firestore) ====================
const productsRef = firestore.collection('products');

// Seed default products if empty
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

// Public: Get all products (in stock or all for display)
app.get('/api/products', async (req, res) => {
    try {
        const snap = await productsRef.orderBy('id').get();
        const products = snap.docs.map(d => ({ id: parseInt(d.id), ...d.data() }));
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Get all products (with stock)
app.get('/api/admin/products', async (req, res) => {
    try {
        const snap = await productsRef.orderBy('id').get();
        const products = snap.docs.map(d => ({ id: parseInt(d.id), ...d.data() }));
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Add product
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

// Admin: Update product (including stock)
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

// Admin: Delete product
app.delete('/api/admin/products/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await productsRef.doc(id).delete();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Run seed on startup
seedProductsIfEmpty().catch(console.error);

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Admin Dashboard: http://localhost:${PORT}/admin.html`);
});