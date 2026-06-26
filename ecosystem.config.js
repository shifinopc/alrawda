/**
 * PM2 process manager config — keeps the backend running and auto-restarts on crash/reboot.
 *
 * Setup (one time):
 *   npm install -g pm2
 *   cd M:\Travels\frontend && npm run build      # produces frontend/dist
 *   cd M:\Travels && pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup            # follow the printed command to start PM2 on Windows boot
 *
 * The backend serves the built frontend (frontend/dist) on the same port, so the whole
 * app is reachable at http://<server>:<PORT> with no separate dev server.
 */
module.exports = {
  apps: [
    {
      name: 'alrawda-erp',
      cwd: 'M:\\Travels\\backend',
      script: 'src/server.js',
      env: { NODE_ENV: 'production', PORT: '5001' },
      autorestart: true,
      max_restarts: 10,
      watch: false,
      time: true,
    },
  ],
};
