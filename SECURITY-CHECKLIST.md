# Security Hardening Checklist — Stimes / AL RAWDA ERP

Based on the code review (auth, JWT, DB, route guards, secrets, SQL, XSS).
Work top-down: 🔴 High first. Check items off as done.

---

> **Status: implemented 2026-06-22.** 9/11 fully done, 2 partial (#4, #6 — deeper rework noted). Build green, backend restarted, headers/auth verified.

## 🔴 High priority

- [x] **1. Gate backend READ endpoints by permission** *(broken access control)* — DONE: `requireAnyPermission` on invoices/receipts/receipt-requests/payments/adjustments/reports/customers/search/pdf; `users` list + `sessions/recent` admin-only; `:id/activity` self-or-admin; `/api/activity` admin-only.
  - Today every `GET` is behind `authRequired` only — a low-privilege user can read all data via direct API calls.
  - Add `requirePermission(module,'View')` to list/detail routes: `invoices`, `receipts`, `receipt-requests`, `payments`, `adjustments`, `reports`, `customers`, `search`, `pdf`.
  - Make admin-only: `GET /users`, `GET /users/sessions/recent`, `GET /users/:id/activity`.
  - Files: `backend/src/server.js`, each `backend/src/routes/*.js`, `backend/src/permissions.js`.
  - ✅ Done when an "Employee" token gets `403` on a module its matrix denies.

- [x] **2. Remove the default admin password risk** — DONE: seed now sets `must_change_password=1` (forces change at first login) and supports `SEED_ADMIN_PASSWORD` env; no password printed when env is set.

---

## 🟠 Medium priority

- [x] **3. Add rate limiting** — DONE: `express-rate-limit` installed; global 300/min/IP on `/api`, auth limiter 30/15min (failed-only) on `/api/auth`, plus a dedicated 5/hour limiter on `/forgot-password`. `trust proxy` set for correct client IPs.

- [x] **4. Harden forgot-password** — DONE & TESTED: time-limited (30 min), single-use reset-**link** flow. New `password_resets` table (sha256 token hashes), `POST /auth/reset-password`, new frontend `/reset` page. No more instant password reset on request. Verified: weak-pw/garbage/expired/reused tokens all rejected, valid token works once and invalidates old sessions.

- [x] **5. Add `helmet` + security headers** — DONE: `app.use(helmet())` (HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, referrer policy). CSP left off for now (SPA assets same-origin) — enable a tuned CSP later.

- [x] **6. Shrink the stolen-JWT blast radius** — IMPLEMENTED (backend tested; needs a live login test before relying on it):
  - Auth now rides in an **httpOnly cookie** (JS can't read it → XSS can't steal the token). Token removed from `localStorage`; only non-sensitive UI info kept.
  - Backend: cookie set on login, `cookie-parser`, dual-read (cookie **or** Authorization header, so API clients still work), `POST /auth/logout` clears it, CORS `credentials:true`.
  - SameSite=Lax (config via `COOKIE_SAMESITE`) gives CSRF protection for same-site subdomains.
  - **HTTP-verified:** login sets HttpOnly cookie; protected routes work with cookie alone; no-auth → 401; logout clears.
  - **NOT yet verified in a browser** (Chrome extension is blocked from localhost + password-entry disallowed). **Action:** after deploy, set the prod cookie env (below), log in, confirm it works; roll back if not.

---

## 🟡 Low priority

- [x] **7. Stronger temp passwords** — DONE: `crypto.randomBytes`-based 12-char temp (guarantees upper/lower/digit/symbol).

- [x] **8. Validate `JWT_SECRET` at startup** — DONE: process exits if `JWT_SECRET` is missing or < 32 chars.

- [x] **9. `CORS_ORIGIN`** — DONE (code side): startup now **warns** when unset. **Action for you:** set `CORS_ORIGIN=https://stimesapp.ionob.in` in the production `.env` (config only).

- [x] **10. Auto force-logout on role change** — DONE: `PUT /users/:id` sets `sessions_invalid_before` + `markInvalid` when role or active-status changes.

- [x] **11. Server-side size check on `photo`** — DONE: rejects base64 photos > ~700 KB (≈500 KB image) on create/update/self-update; body cap stays 8 MB.

---

## ➕ Extra hardening (this pass)
- [x] **Patched dependency vuln** — `nodemailer 8.0.11 → 9.0.1` (fixes high-severity raw-option file-read/SSRF advisory). Frontend: 0 vulns.
- [x] **JWT algorithm pinned** — `jwt.verify(..., { algorithms: ['HS256'] })` blocks algorithm-confusion / `alg:none` attacks.

## ✅ Already solid (verified — no action needed)
- No SQL injection — queries fully parameterized.
- Secrets externalized — `.env` git-ignored, not in deploy zips, no hardcoded JWT fallback.
- bcrypt password hashing; password policy; generic auth responses (no user enumeration).
- Privilege escalation blocked — user create / role change is admin-only; self-profile can't change role.
- JWT expiry + force-logout revocation.
- No XSS sinks; PDF HTML escapes user fields; error handler hides internals.
- `pageSize` capped at 200; async error wrapper prevents crashes.

---

## Suggested order
1 → 2 → 3 → 5 → 4 → 6 → 7 → 8 → 9 → 10 → 11

> Note: items 1–5 require **both** redeploys (backend changes). 9 is config-only.
