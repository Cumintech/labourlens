# Labour Lens Admin Portal

Single-admin, web-only internal tool for monitoring factories, payment status, and employee trends — separate from the factory-owner Expo app entirely (different login, different frontend, different backend routes: `/admin/*`).

## Local development

```bash
npm install
cp .env.local.example .env.local   # set VITE_API_URL to your backend, e.g. http://localhost:8010
npm run dev
```

Log in with the admin account created via `backend/seed_admin.py` or the `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars on the backend (see that script's docstring).

## Build

```bash
npm run build
```

Outputs a static site to `dist/` — deployable as-is to Vercel (or any static host). No server-side rendering; this is a plain client-side SPA that talks to the FastAPI backend's `/admin/*` routes over `VITE_API_URL`.

## Environment variables

- `VITE_API_URL` — the backend's base URL (e.g. `https://labourlens-backend.onrender.com`). Required at build time (Vite inlines it into the bundle).
