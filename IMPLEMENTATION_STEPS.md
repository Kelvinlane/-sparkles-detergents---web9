# Detailed Implementation Steps: Firestore Migration & Website Operation

Follow these steps in order. Start from **Step 0** to confirm your environment, then complete **Steps 1–8** (each maps to a to-do from the plan).

---

## Step 0: Confirm Node.js and npm Installation

1. **Open a terminal** (PowerShell or Command Prompt on Windows).

2. **Check Node.js version:**
   ```powershell
   node --version
   ```
   You should see something like `v20.x.x` or `v18.x.x`. If you get "command not found" or an error, [install Node.js](https://nodejs.org/) (LTS) and restart the terminal.

3. **Check npm version:**
   ```powershell
   npm --version
   ```
   You should see a number like `10.x.x`. npm is included with Node.js.

4. **Go to your project folder:**
   ```powershell
   cd c:\Users\USER\Desktop\web9
   ```

5. **Install dependencies** (if not already done):
   ```powershell
   npm install
   npm install firebase-admin
   ```
   This installs `express`, `cors`, `sqlite3`, and `firebase-admin`. Keep `sqlite3` for now (needed for migration); it will be removed in Step 8.

6. **Confirm the service account file exists:**
   - You should have `sparkles-shop-firebase-adminsdk-fbsvc-396ee23a61.json` in `c:\Users\USER\Desktop\web9`.
   - Do not commit this file to a public repo.

Once Step 0 is done, proceed to Step 1.

---

## Step 1: Fix Express Static Serving (To-do: static-serving-fix)

**Goal:** So that `http://localhost:3000/index.html` and `http://localhost:3000/admin.html` work, the server must serve files from the folder where your HTML files live. There is no `public/` folder, so we serve from the project root.

1. Open `server.js`.

2. Find this line:
   ```js
   app.use(express.static('public')); // Serve frontend files
   ```

3. Replace it with:
   ```js
   app.use(express.static(__dirname)); // Serve HTML/CSS/JS from project root
   ```

4. Save the file.

5. **Verify:** Start the server (`node server.js`), then in a browser open:
   - `http://localhost:3000/index.html`
   - `http://localhost:3000/admin.html`
   Both should load. Stop the server (Ctrl+C) before continuing.

---

## Step 2: Harden Firebase Admin Initialization (To-do: firebase-init-env)

**Goal:** Prefer environment variable for the service account path so the JSON path is not hardcoded in the repo.

1. Open `server.js`.

2. Find the block that sets `serviceAccountPath` and calls `admin.initializeApp(...)`.

3. Replace that block so it:
   - Uses `process.env.GOOGLE_APPLICATION_CREDENTIALS` or `process.env.FIREBASE_SERVICE_ACCOUNT_PATH` if set.
   - Falls back to the local file `sparkles-shop-firebase-adminsdk-fbsvc-396ee23a61.json` in the project folder if neither env var is set.

   Example logic:
   ```js
   const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
     || process.env.FIREBASE_SERVICE_ACCOUNT_PATH
     || path.join(__dirname, 'sparkles-shop-firebase-adminsdk-fbsvc-396ee23a61.json');
   admin.initializeApp({
     credential: admin.credential.cert(require(serviceAccountPath))
   });
   ```

4. Save the file.

5. **Optional:** To use an env var, set it before starting the server (PowerShell):
   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\full\path\to\your\service-account.json"
   node server.js
   ```
   If you don’t set it, the fallback path in the project folder will be used.

---

## Step 3: One-Time Migration Script (To-do: migration-script)

**Goal:** Copy existing users and orders from SQLite (`data.db`) into Firestore, and ensure the default admin user exists.

1. **Create the scripts folder** (if it doesn’t exist):
   ```powershell
   mkdir scripts
   ```

2. **Create `scripts/migrate_sqlite_to_firestore.js`** with logic that:
   - Requires `sqlite3`, `path`, `firebase-admin`.
   - Initializes Firebase Admin using the same credential path as `server.js` (env var or fallback path).
   - Opens `data.db` (path: `path.join(__dirname, '..', 'data.db')`).
   - **Users:** Reads all rows from `users`; for each row, writes a document to Firestore collection `users` with document ID = email; fields: `name`, `email`, `phone`, `password`, `created_at` (convert SQLite datetime string to Firestore `Timestamp` or store as string and use consistently).
   - **Orders:** Reads all rows from `orders`; for each order, reads corresponding rows from `order_items`; writes one document per order to Firestore collection `orders` with document ID = `order_id`; fields: `order_id`, `customer_name`, `customer_phone`, `customer_email`, `total_amount`, `mpesa_code`, `status`, `created_at`, `items` (array of `{ name, qty, price }` from `order_items`).
   - **Default admin:** After migration, set (or overwrite) document `users/admin@sparkles.com` with `name`, `email`, `phone`, `password` (e.g. `admin123`), `created_at`, so admin login works.
   - Closes the SQLite db and exits.

3. **Run the migration once:**
   ```powershell
   cd c:\Users\USER\Desktop\web9
   node scripts/migrate_sqlite_to_firestore.js
   ```

4. **Verify:** In Firebase Console → Firestore Database, confirm collections `users` and `orders` exist and contain documents. Confirm `users` has a document for `admin@sparkles.com`.

---

## Step 4: Switch API Routes to Firestore (To-do: swap-routes-to-firestore)

**Goal:** Remove SQLite usage from API handlers and use Firestore instead. Keep response shapes compatible with the existing admin dashboard (e.g. `order_id`, `customer_name`, `items`, `total_amount`, `created_at`). Return `created_at` as **epoch milliseconds** or **ISO string** so `new Date(order.created_at)` works in the browser.

1. Open `server.js`.

2. **Remove** the SQLite initialization block (opening `data.db`, `initializeDatabase()` and the whole `initializeDatabase` function). Do not remove `firestore` or Firebase Admin.

3. **Implement or update each route:**

   - **POST /api/register**  
     Check if a user doc with that email exists in `users`. If yes, return 400 “Email already exists”. If no, create a doc with ID = email and fields `name`, `email`, `phone`, `password`, `created_at` (e.g. `admin.firestore.FieldValue.serverTimestamp()`). Return `{ success: true, userId: email }`.

   - **POST /api/login**  
     Get the user doc by email from `users`. If it doesn’t exist or password doesn’t match, return 401. Otherwise return `{ success: true, user: { ...userData } }`.

   - **POST /api/orders**  
     Build `orderId = 'ORD-' + Date.now()`. Create a document in `orders` with ID `orderId` and fields: `order_id`, `customer_name`, `customer_phone`, `customer_email`, `total_amount`, `mpesa_code`, `status: 'completed'`, `items` (array from request body), `created_at` (server timestamp). Return `{ success: true, order_id: orderId }`. Request body should already have `items` as array of `{ name, qty, price }`.

   - **GET /api/admin/orders**  
     Query `orders` ordered by `created_at` descending. Map each doc to a plain object; ensure `created_at` is serialized to **milliseconds** or **ISO string** (e.g. `doc.created_at?.toMillis?.() ?? doc.created_at`). For the admin table, you can send `items` as a string (e.g. items array formatted as "Product (x2), Other (x1)") so the existing admin UI still works. Return JSON array.

   - **GET /api/admin/stats**  
     Get all orders (or use aggregation if you add it). Compute `total_orders` (count) and `total_revenue` (sum of `total_amount`). Return `{ total_orders, total_revenue }`.

   - **GET /api/admin/order/:id**  
     The `:id` here is the order document ID (same as `order_id`). Get the order doc from `orders`. If not found, 404. Otherwise return the doc data with `created_at` as ms or ISO string.

4. Save `server.js`.

5. **Verify:** Start the server, log in at `http://localhost:3000/admin.html` with `admin@sparkles.com` / `admin123`. Dashboard should show Total Orders, Total Revenue, and the orders table. No SQLite code should run.

---

## Step 5: Add Admin CRUD Endpoints (To-do: admin-crud-endpoints)

**Goal:** Allow the dashboard to update and delete orders via the backend.

1. Open `server.js`.

2. **PUT /api/admin/order/:orderId**  
   - Parse request body for fields to update (e.g. `status`, or other order fields).
   - Update the Firestore document `orders/{orderId}` with those fields (e.g. `doc.ref.update({ status: req.body.status })`).
   - Return success JSON. If document doesn’t exist, return 404.

3. **DELETE /api/admin/order/:orderId**  
   - Delete the Firestore document `orders/{orderId}`.
   - Return success JSON. If document doesn’t exist, return 404.

4. Save the file.

5. **Verify:** Use a REST client (e.g. Postman or browser devtools) to send PUT and DELETE to `http://localhost:3000/api/admin/order/ORD-...` and confirm Firestore updates/deletes.

---

## Step 6: Update Admin Dashboard for CRUD (To-do: admin-dashboard-crud-ui)

**Goal:** Add an Actions column so an admin can change order status and delete orders.

1. Open `admin.html`.

2. In the orders table, add an **Actions** column header in the `<thead>` (e.g. after Status).

3. In the row template where you map `orders.map(order => ...)`, add an **Actions** cell that includes:
   - A **status dropdown** (e.g. "pending", "completed", "cancelled") with the current `order.status` selected.
   - A **Save** button that calls `PUT /api/admin/order/${order.order_id}` with the selected status (e.g. `fetch(..., { method: 'PUT', body: JSON.stringify({ status: selectedValue }) })`), then refreshes the list.
   - A **Delete** button that calls `DELETE /api/admin/order/${order.order_id}`, then refreshes the list (and optionally `loadStats()`).

4. Ensure the table still shows Order ID, Customer, Items, Total, Date, Status, and the new Actions column.

5. **Verify:** Open the admin dashboard, change an order’s status and click Save, then delete an order. List and stats should update; Firestore should reflect the changes.

---

## Step 7: Frontend Checkout Posts Orders to Backend (To-do: frontend-create-orders)

**Goal:** When a customer completes checkout (M-Pesa simulation), the frontend should POST the order to the backend so it is stored in Firestore and appears in the admin dashboard.

1. Open `index.html` (and any other pages that contain the same checkout logic, e.g. `detergents.html`, `about.html`, `contact.html` if they have cart/checkout).

2. Find the `initiateCheckout()` (or equivalent) function that currently simulates M-Pesa and then clears the cart.

3. After the simulated payment succeeds (e.g. inside the `setTimeout` callback), add a `fetch` call to `POST /api/orders` with:
   - **URL:** `http://localhost:3000/api/orders` (or use a relative URL `/api/orders` if the site is always served from the same origin).
   - **Method:** POST.
   - **Headers:** `Content-Type: application/json`.
   - **Body:** JSON with `customer_name`, `customer_phone`, `customer_email` (from current user or a prompt/form), `items` (array of `{ name, qty, price }` from the cart), `total_amount` (number), `mpesa_code` (e.g. simulated code or empty string).

4. Optionally show a success message or error based on the response. Then clear the cart and update the UI as you already do.

5. **Verify:** Place an order from the frontend (add items, go through checkout). Confirm the order appears in the admin dashboard and in Firestore under the `orders` collection.

---

## Step 8: Remove SQLite (To-do: remove-sqlite-after-verify)

**Goal:** Remove all SQLite code and the `sqlite3` dependency.

1. Open `server.js`.

2. Remove the `require('sqlite3')` and any remaining references to `db` or SQLite (there should be none left after Step 4; if any remain, remove them).

3. Save the file.

4. Remove the dependency:
   ```powershell
   npm uninstall sqlite3
   ```

5. **Verify:** Run `node server.js`. The app should start without errors. Test login, orders list, stats, create order from frontend, and CRUD from admin. The migration script in `scripts/` can stay; it still uses `sqlite3` for the one-time migration and is run separately, so you can either leave it as-is or remove `sqlite3` from the main app only (migration script would need to be run before uninstall, or you run migration from a copy of the project that still has sqlite3). Prefer: run migration once, then remove sqlite3 from the main app; the migration script is one-time and can be kept for reference or deleted.

---

## Quick Checklist

- [ ] Step 0: Node.js and npm installed; `npm install` and `firebase-admin` done; project folder and service account path confirmed.
- [ ] Step 1: Static serving fixed; `index.html` and `admin.html` load at `http://localhost:3000`.
- [ ] Step 2: Firebase Admin init uses env var with fallback to local JSON.
- [ ] Step 3: Migration script created and run once; Firestore has `users` and `orders`; admin user exists.
- [ ] Step 4: All auth and order API routes use Firestore; `created_at` returned as ms or ISO; admin dashboard loads data.
- [ ] Step 5: PUT and DELETE admin order endpoints implemented and tested.
- [ ] Step 6: Admin dashboard has Actions column (status + Save, Delete).
- [ ] Step 7: Frontend checkout POSTs to `/api/orders`; new orders appear in admin and Firestore.
- [ ] Step 8: SQLite removed from `server.js` and `sqlite3` uninstalled; server runs and all flows work.

After completing all steps, the website operates with Firestore as the database, admin can do CRUD from the dashboard, and customer orders are stored and visible in the admin panel.
