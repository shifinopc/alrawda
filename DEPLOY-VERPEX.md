# Deploying AL RAWDA ERP on Verpex (cPanel + Node.js + MySQL)

The whole app runs as **one Node process**: Express serves the API **and** the built
React frontend from the same origin, so there's no CORS/base-URL setup.

---

## 0. What you upload

Keep this folder structure on the server (both `backend` and `frontend` side by side):

```
alrawda/                 ← app folder under your home dir
├── backend/             ← package.json + src/  (the Node app)
└── frontend/            ← gets built into frontend/dist (served by backend)
```

You do **not** need the `migration/` SQL-Server scripts on the server — the data is
already in MySQL; you only move that MySQL database (step 2).

---

## 1. Create the MySQL database (cPanel → MySQL® Databases)

1. Create a database, e.g. `youruser_travels`.
2. Create a DB user + password, **Add User To Database**, grant **ALL PRIVILEGES**.
3. Note the final names — cPanel prefixes them (e.g. `cpaneluser_travels`, `cpaneluser_erp`).

### Move your local data up
On your PC, export the local `travels` database:
```bash
mysqldump -u root -p --default-character-set=utf8mb4 --routines --single-transaction travels > travels.sql
```
Then in cPanel → **phpMyAdmin** → select `youruser_travels` → **Import** → upload `travels.sql`.
(If the file is large, gzip it and import the `.sql.gz`, or use the terminal:
`mysql -u youruser_travels -p youruser_travels < travels.sql`.)

---

## 2. Upload the code

- **File Manager** (zip → upload → extract) or **Terminal** (`git clone` if you have a repo).
- Do **not** upload `node_modules` or `frontend/dist` — you'll build them on the server.

---

## 3. Create the Node.js app (cPanel → Setup Node.js App)

- **Node.js version:** 18 or 20 (LTS).
- **Application mode:** Production.
- **Application root:** `alrawda/backend`  ← the folder with `package.json`.
- **Application URL:** your domain / subdomain.
- **Application startup file:** `src/server.js`
- Click **Create**.

### Environment variables (add in the same screen)
| Name | Value |
|------|-------|
| `DB_HOST` | `localhost` |
| `DB_USER` | `youruser_travels` |
| `DB_PASSWORD` | your DB password |
| `DB_NAME` | `youruser_travels` |
| `JWT_SECRET` | a long random string |
| `JWT_EXPIRES` | `12h` |

> Don't set `PORT` — cPanel/Passenger injects it and `server.js` already reads `process.env.PORT`.
> Confirm `backend/src/db.js` reads these `DB_*` names (rename to match if needed).

---

## 4. Install dependencies & build the frontend (Terminal)

cPanel shows the exact "Enter to the virtual environment" command — run it first, then:

```bash
# from the Node app virtualenv, in alrawda/backend
npm install --omit=dev

# build the frontend (needs dev deps for vite)
cd ../frontend
npm install
npm run build        # creates frontend/dist that the backend serves
```

Back in **Setup Node.js App**, click **Restart**.

Visit your domain → the login page should load. Default admin: **admin / admin@123**
(change it immediately under the avatar → **My Profile**).

---

## 5. Daily summary email (optional)

The in-process scheduler runs while the app is alive. On shared hosting the app can be
idled out, so for a reliable nightly email add a **cPanel → Cron Jobs** entry that calls
the summary — or just use the **Settings → Email → "Send summary now"** button. (Ask me
and I'll add a token-protected cron endpoint if you want it fully automated.)

---

## PDF download — works on shared hosting (auto fallback)

PDF generation has **two engines** and picks automatically:
- **Chrome/puppeteer** (if a Chrome binary is found) → full HTML voucher incl. Arabic. Used on machines that have Chrome.
- **PDFKit fallback** (pure JS, no browser) → clean branded English voucher. Used automatically when no
  Chrome is present — i.e. on Verpex shared hosting. **No setup needed.**

So "Download PDF" works out of the box on Verpex (English voucher). Notes:
- To **force** the browser-free engine anywhere, set env `PDF_ENGINE=pdfkit`.
- If you later get a Chromium binary on the host and want Arabic in PDFs, set `CHROME_PATH=/path/to/chrome`
  (and leave `PDF_ENGINE` unset).
- `pdfkit` is in `backend/package.json`, so `npm install` in step 4 covers it.

---

## Quick checklist
- [ ] DB created, user granted, `travels.sql` imported via phpMyAdmin
- [ ] Code uploaded with `backend/` and `frontend/` side by side
- [ ] Node app: root=`backend`, startup=`src/server.js`, env vars set
- [ ] `npm install` in backend, `npm install && npm run build` in frontend
- [ ] App restarted, login works, admin password changed
- [ ] (Optional) cron for daily summary
- [ ] Decide on PDF approach (print vs Chromium vs pdfkit fallback)
