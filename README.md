# Sparkles Detergents

Project is split into **backend** and **frontend** for clarity and deployment flexibility.

## Structure

```
web9/
├── backend/           # Node.js API (Express + Firestore only)
│   ├── server.js      # Main app & API routes
│   ├── package.json   # Backend dependencies (express, firebase-admin, etc.)
│   └── sparkles-shop-firebase-adminsdk-*.json (local only, gitignored)
├── frontend/          # Static site (HTML, CSS, JS, images)
│   ├── index.html
│   ├── detergents.html
│   ├── contact.html
│   ├── admin.html
│   ├── about.html
│   ├── *.css
│   └── images/
├── package.json       # Root: thin wrapper to run backend
├── .env               # Local-only env vars (not committed)
└── README.md
```

## Environment variables

Backend (`backend/server.js`) reads configuration from env vars:

- **`PORT`**: HTTP port (defaults to `3000` locally; on Render this is injected).
- **`FIREBASE_SERVICE_ACCOUNT`**: full Firebase service account JSON string.
- **`BACKEND_PUBLIC_URL`** (optional): e.g. `http://localhost:3000` or your Render URL, for use by the frontend.

Example local `.env` at repo root (never commit this):

```env
PORT=3000
FIREBASE_SERVICE_ACCOUNT={ ...firebase service account JSON... }
BACKEND_PUBLIC_URL=http://localhost:3000
```

## Run locally

1. **Install backend dependencies** (once):

   ```bash
   npm run install:backend
   # or
   cd backend && npm install
   ```

2. **Create `.env`** in the repo root with `FIREBASE_SERVICE_ACCOUNT` and optional `PORT`, `BACKEND_PUBLIC_URL`.

3. **Start the server** (serves frontend + API):

   ```bash
   npm start
   # or
   cd backend && npm start
   ```

4. Open **http://localhost:3000**:
   - Frontend is served from `frontend/` (home, detergents, contact, about, admin).
   - API is available under `/api/...` (e.g. `/api/products`, `/api/orders`, `/api/admin/orders`).

## Deploy on Render

### Backend (Web Service)

- **Root directory:** `backend`
- **Build command:** `npm install`
- **Start command:** `node server.js`
- **Environment variables:**
  - `FIREBASE_SERVICE_ACCOUNT` – paste the full Firebase service account JSON.
  - `BACKEND_PUBLIC_URL` – e.g. `https://your-backend.onrender.com`
  - (Render sets `PORT` automatically; code uses `process.env.PORT`.)

After deploy you should be able to hit:

- `https://your-backend.onrender.com/api/products`

### Frontend (Static Site)

Frontend is pure static HTML/CSS/JS:

- **Root directory:** `frontend`
- **Build command:** _(leave empty)_
- **Publish directory:** `.`

In the frontend HTML (e.g. `index.html`, `detergents.html`, `contact.html`, `about.html`, `admin.html`), the app uses an `API_URL` constant that should point to the backend, for example:

```js
// example pattern
const API_URL = (window.ENV_BACKEND_URL || 'http://localhost:3000') + '/api';
```

On Render, you can either:

- Hard‑code `API_URL` to your backend URL, e.g. `https://your-backend.onrender.com/api`, or
- Serve a small `config.js` that defines `window.ENV_BACKEND_URL = 'https://your-backend.onrender.com';`.

Once both services are deployed:

- Customers browse the static site (Render Static Site).
- All data (products, orders, admin stats) flows through the Express API (Render Web Service) backed by **Firebase Firestore**—no SQLite required.
