# AL RAWDA ERP — Production Deployment

## 1. Build the frontend
```powershell
cd M:\Travels\frontend
npm install
npm run build        # outputs frontend\dist
```
The backend automatically serves `frontend\dist` (single origin) — no separate Vite dev
server is needed in production. The whole app is then served from the backend port.

## 2. Run the backend under a process manager (auto-restart on crash / reboot)
```powershell
npm install -g pm2
cd M:\Travels
pm2 start ecosystem.config.js
pm2 save
pm2 startup           # run the command it prints so PM2 launches on Windows boot
```
The app is now at **http://<server-ip>:5001**.

Useful: `pm2 status`, `pm2 logs alrawda-erp`, `pm2 restart alrawda-erp`.

## 3. HTTPS
Two options:

**A) Reverse proxy (recommended).** Put IIS, Nginx, or Caddy in front, terminate TLS there,
and forward to `http://localhost:5001`. Caddy example (`Caddyfile`):
```
erp.alrawda.qa {
    reverse_proxy localhost:5001
}
```
Caddy obtains and renews a free certificate automatically.

**B) Direct HTTPS in Node.** Provide a cert/key and run the backend over `https` (small
change to `server.js`). Use this only if a reverse proxy isn't available.

## 4. Environment
`backend\.env`:
```
PORT=5001
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=********
DB_NAME=travels
JWT_SECRET=<set a long random secret for production>
JWT_EXPIRES=12h
```
Set a strong `JWT_SECRET` before go-live (anything currently committed is for development).

## 5. Database backups
Schedule a daily dump (Windows Task Scheduler):
```powershell
mysqldump -u root -p"********" travels > "D:\backups\travels_%date:~-4%-%date:~3,2%-%date:~0,2%.sql"
```
Keep at least 7 daily copies off the application server.

## 6. First-run accounts
Default `admin` / `admin@123` (change immediately under Settings → My Account).
Migrated users `jassim` and `faheem` are flagged to set a new password on first login.
