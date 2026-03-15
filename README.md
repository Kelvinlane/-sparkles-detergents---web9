# Sparkles Detergents

Project is split into **backend** and **frontend** for easier navigation.

## Structure

```
web9/
├── backend/          # Node.js API (Express, Firestore, SQLite)
│   ├── server.js     # Main app & API routes
│   ├── package.json  # Backend dependencies
│   └── ...           # Firebase key (local), data.db (created at runtime)
├── frontend/         # Static site (HTML, CSS, JS, images)
│   ├── index.html
│   ├── detergents.html
│   ├── contact.html
│   ├── admin.html
│   ├── about.html
│   ├── *.css
│   └── images/
├── package.json      # Root: run backend from here
└── README.md
```

## Run locally

1. **Install backend dependencies** (once):
   ```bash
   npm run install:backend
   ```
   Or: `cd backend && npm install`

2. **Start the server** (serves frontend + API):
   ```bash
   npm start
   ```
   Or: `cd backend && npm start`

3. Open **http://localhost:3000** — frontend is served from `frontend/`, API from `/api/...`.

## Deploy (e.g. Render)

- **Root directory:** leave blank (repo root).
- **Build command:** `cd backend && npm install`
- **Start command:** `node backend/server.js`
- **Environment:** Add `FIREBASE_SERVICE_ACCOUNT` with your Firebase JSON string.
