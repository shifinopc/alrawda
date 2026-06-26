# Production Deploy Runbook — Stimes / AL RAWDA ERP

This release adds **security hardening** (helmet, rate-limiting, httpOnly-cookie auth,
reset-link flow) and a **big invoice speed-up**. It introduces **new backend dependencies**
and **new environment variables**, so read steps 4–5 carefully.

> ⚠️ This is the one release where skipping `npm install` or the env vars will break startup/login.
> Do it when you can watch it and roll back.

---

## 0. Before you start — take a backup (for rollback)
- In cPanel File Manager, **rename** the current `backend/src` to `backend/src_bak` (or zip it).
- Note your current `.env` values.
- Keep the previously-deployed `deploy-*.zip` if you have them (rollback = redeploy those).

## 1. Frontend
1. Upload **`deploy-frontend.zip`** to the frontend web root (e.g. `~/stimesapp` / `public_html`).
2. **Extract** it there, overwriting existing files.

## 2. Backend
1. Upload **`deploy-backend.zip`** to the backend app folder (e.g. `~/stimesapi`).
2. **Extract**, overwriting `src/`, `assets/`, `package.json`, `package-lock.json`.

## 3. Install backend dependencies  ← REQUIRED this release
New packages were added (`helmet`, `express-rate-limit`, `cookie-parser`, upgraded `nodemailer`).
In **cPanel → Setup Node.js App → (your app) → Run NPM Install**, **or** via terminal:
```bash
cd ~/stimesapi        # your backend folder
npm install --omit=dev
```
> If you skip this, the app crashes on `require('helmet')`.

## 4. Environment variables  ← set these in “Setup Node.js App → Environment variables” (or .env)
**Required (app refuses to start without a strong secret):**
```
JWT_SECRET=<a long random string, at least 32 characters>
```
**Auth cookie (new) — for a single-domain deploy (Node serves the app + API):**
```
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
```
**Keep your existing values:**
```
DB_HOST=...  DB_USER=...  DB_PASSWORD=...  DB_NAME=...
PDF_ENGINE=pdfkit
JWT_EXPIRES=12h
APP_URL=https://stimesapp.ionob.in     # used in password-reset emails
```
**Only if frontend and backend are on DIFFERENT subdomains** (e.g. stimesapp ↔ stimesapi):
```
CORS_ORIGIN=https://stimesapp.ionob.in
COOKIE_DOMAIN=.ionob.in
```
> If you serve the frontend from a separate origin, the frontend bundle must also be built with
> `VITE_API_BASE=https://stimesapi.ionob.in`. The current zip is built for **same-origin** (`/api`).
> Tell me if that's your setup and I'll rebuild it.

## 5. Restart the Node app
- cPanel → Setup Node.js App → **Restart**, **or**:
```bash
touch ~/stimesapi/tmp/restart.txt
```
- The database **auto-migrates** on startup (creates `password_resets`, adds `must_change_password`,
  etc.) — no manual SQL needed.

## 6. Smoke test (do this immediately)
1. Open the app, **hard-refresh** (Ctrl/Cmd+Shift+R) to load the new bundle.
2. **Log in.** It should land on the dashboard normally.
3. Open the **Invoice** list and a single invoice — should load fast (~instant).
4. Open **Receipt / Payment / Reports** — confirm they load.
5. (Optional) **Forgot password** → confirm the email now contains a **reset link** (not a temp password).

## 7. If login fails or keeps bouncing to /login  → it's the cookie config
Most likely `COOKIE_SECURE`/`COOKIE_SAMESITE`/`COOKIE_DOMAIN` vs your origin setup.
- Quick fix: ping me — flipping the frontend back to header-mode is a 3-line change + rebuild.
- Or roll back: redeploy the previous `deploy-*.zip` (or restore `src_bak`) and restart.

---

## What changed in this release
**Security:** read-permission enforcement on all data endpoints; rate limiting; helmet headers;
httpOnly-cookie auth (token no longer in localStorage); single-use 30-min password **reset link**;
forced password change for the seeded admin; crypto temp passwords; JWT secret check + HS256 pinned;
force-logout on role change; photo size cap; nodemailer security patch.

**Performance:** invoice list & detail rewritten — **~594 ms → ~11 ms** (list), **~113 ms → ~6 ms** (detail).

**Features (earlier):** chip-based filters + date-range on all lists, Invoice-Adjustment report,
receipt voucher tweaks, sidebar animation, per-user→custom-role permissions, etc.

## First-login note
The seeded `admin` account (fresh installs) now **requires a password change at first login**.
Existing admin accounts are unaffected.
