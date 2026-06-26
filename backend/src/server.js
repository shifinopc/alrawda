require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const { authRequired, requireRole, ADMINS } = require('./middleware/auth');
const { requireAnyPermission } = require('./permissions');
const { activityLogger, ensureActivityLog } = require('./middleware/activityLog');
const { router: authRouter, ensureAppUsers } = require('./routes/auth');

// ---- fail fast on a missing/weak JWT secret (forged tokens otherwise) ----
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET is missing or too short (need ≥ 32 chars). Set it in .env.');
  process.exit(1);
}
if (!process.env.CORS_ORIGIN) {
  console.warn('WARNING: CORS_ORIGIN is not set — the API will accept requests from any origin. Set it in production.');
}

const app = express();
app.set('trust proxy', 1); // behind cPanel/Passenger — needed for correct client IPs (rate limit + audit)

// security headers (HSTS, no-sniff, frame-ancestors/clickjacking, referrer policy, …)
app.use(helmet({
  contentSecurityPolicy: false, // SPA assets are same-origin; enable a tuned CSP later if needed
  crossOriginEmbedderPolicy: false,
}));

// CORS_ORIGIN = comma-separated allowed origins (e.g. https://stimesapp.ionob.in). Unset = allow all.
// credentials:true is required so the browser sends the httpOnly auth cookie cross-origin.
const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '8mb' }));

// ---- rate limiting ----
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true, message: { error: 'Too many attempts — try again later.' } });

// async error wrapper for all routes
const wrap = (router) => {
  router.stack.forEach((layer) => {
    if (!layer.route) return;
    layer.route.stack.forEach((l) => {
      const fn = l.handle;
      l.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    });
  });
  return router;
};

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.use('/api/auth', authLimiter, wrap(authRouter));
// global rate limit + auth for everything else (auth populates req.user, then activity logging)
app.use('/api', apiLimiter);
app.use('/api', (req, res, next) => (req.path.startsWith('/auth') ? next() : authRequired(req, res, next)), activityLogger);

// read-access guards: a low-privilege user can only read modules their role can View.
// Financial lookups (invoices/receipts/customers/search/pdf) are shared by several pages,
// so they accept any of the related modules' View permission.
const FIN = ['Invoice', 'Receipt', 'Payment', 'Invoice Adjustment', 'Receipt Approval'];
app.use('/api/dashboard', authRequired, wrap(require('./routes/dashboard')));
app.use('/api/invoices', authRequired, requireAnyPermission(FIN, 'View'), wrap(require('./routes/invoices')));
app.use('/api/receipts', authRequired, requireAnyPermission(['Receipt', 'Receipt Approval'], 'View'), wrap(require('./routes/receipts')));
app.use('/api/receipt-requests', authRequired, requireAnyPermission(['Receipt', 'Receipt Approval'], 'View'), wrap(require('./routes/receiptRequests').router));
app.use('/api/payments', authRequired, requireAnyPermission(['Payment'], 'View'), wrap(require('./routes/payments')));
app.use('/api/adjustments', authRequired, requireAnyPermission(['Invoice Adjustment'], 'View'), wrap(require('./routes/adjustments').router));
app.use('/api/masters', authRequired, wrap(require('./routes/masters')));
app.use('/api/reports', authRequired, requireAnyPermission(['Reports'], 'View'), wrap(require('./routes/reports')));
app.use('/api/customers', authRequired, requireAnyPermission([...FIN, 'Reports'], 'View'), wrap(require('./routes/customers')));
app.use('/api/search', authRequired, requireAnyPermission(FIN, 'View'), wrap(require('./routes/search')));
app.use('/api/pdf', authRequired, requireAnyPermission(FIN, 'View'), wrap(require('./routes/pdf')));
app.use('/api/users', authRequired, wrap(require('./routes/users')));
app.use('/api/settings', authRequired, wrap(require('./routes/settings')));
app.use('/api/activity', authRequired, requireRole(ADMINS), wrap(require('./routes/activity')));

app.use('/api', (req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));

// ----- serve the built frontend in production (single-origin, no separate dev server) -----
const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // full error stays in the server log; clients only get a generic message (no internals leaked)
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err.stack || err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 5000);
Promise.all([ensureAppUsers(), require('./routes/receiptRequests').ensureTables(), ensureActivityLog(), require('./docNumber').ensureCounter(), require('./routes/masters').ensureAgentSchema(), require('./sessionStore').ensureTable()])
  .then(() => app.listen(port, () => {
    console.log(`AL RAWDA ERP backend listening on http://localhost:${port}`);
    require('./notify').startScheduler();
  }))
  .catch((e) => { console.error('Startup failed:', e); process.exit(1); });
