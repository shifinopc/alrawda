const { query } = require('./db');

/** Module + action model — must match the frontend Permissions matrix (Users.jsx). */
const MODULES = [
  'Dashboard', 'User Management', 'Master Data', 'Invoice', 'Receipt', 'Payment',
  'Receipt Approval', 'Invoice Adjustment', 'Reports', 'Settings',
];
const APPROVABLE = new Set(['Invoice', 'Receipt Approval', 'Payment']);
const STATIC_MODULES = new Set(['Dashboard', 'Reports']); // view-only

/** Default permissions per built-in role (mirrors Users.jsx defaultMatrix). */
function defaultMatrix(role) {
  const m = {};
  for (const mod of MODULES) {
    const isStatic = STATIC_MODULES.has(mod);
    const row = { View: false, Create: false, Edit: false, Delete: false, Approve: false };
    if (role === 'Super Admin' || role === 'Admin') {
      row.View = true; row.Create = !isStatic; row.Edit = !isStatic; row.Delete = !isStatic;
      row.Approve = APPROVABLE.has(mod);
    } else if (role === 'Manager') {
      row.View = true;
      if (!['User Management', 'Settings'].includes(mod)) { row.Create = !isStatic; row.Edit = !isStatic; }
      row.Approve = APPROVABLE.has(mod);
    } else { // Employee / custom base
      if (!['User Management', 'Settings', 'Receipt Approval', 'Invoice Adjustment'].includes(mod)) {
        row.View = true;
        if (!isStatic) { row.Create = true; row.Edit = true; }
      }
    }
    m[mod] = row;
  }
  return m;
}

// small cache so we don't hit app_settings on every request
let cache = { at: 0, perms: null, roles: null };
async function loadSaved() {
  if (Date.now() - cache.at < 15000 && cache.perms) return cache;
  const rows = await query("SELECT k, v FROM app_settings WHERE k IN ('permissions','roles')").catch(() => []);
  const out = { permissions: {}, roles: [] };
  for (const r of rows) {
    try { out[r.k] = JSON.parse(r.v); } catch { /* ignore */ }
  }
  cache = { at: Date.now(), perms: out.permissions || {}, roles: out.roles || [] };
  return cache;
}

/** Resolve the effective matrix for a role: saved override → custom role's matrix → built-in default. */
async function matrixForRole(role) {
  const { perms, roles } = await loadSaved();
  if (perms && perms[role]) return perms[role];
  const custom = (roles || []).find((r) => r.name === role);
  if (custom && custom.matrix) return custom.matrix;
  return defaultMatrix(role);
}

/** Has the role got `action` on `module`? Super Admin always yes. */
async function can(role, module, action) {
  if (role === 'Super Admin') return true;
  const m = await matrixForRole(role);
  return !!(m && m[module] && m[module][action]);
}

/** Express middleware: require permission(module, action). Admins bypass. */
function requirePermission(module, action) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role;
      if (role === 'Super Admin' || role === 'Admin') return next();
      if (await can(role, module, action)) return next();
      return res.status(403).json({ error: `You don't have ${action} permission for ${module}` });
    } catch {
      return next(); // never hard-fail the request on a permissions lookup error
    }
  };
}

/** Require the action on ANY of the given modules (for endpoints shared by several pages,
 *  e.g. the invoice lookup used by Receipt / Payment / Adjustment). Admins bypass. */
function requireAnyPermission(modules, action) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role;
      if (role === 'Super Admin' || role === 'Admin') return next();
      for (const m of modules) { if (await can(role, m, action)) return next(); }
      return res.status(403).json({ error: 'You don\'t have permission to view this resource' });
    } catch {
      return next(); // fail open on a lookup error (consistent with requirePermission)
    }
  };
}

/** Privilege rank for impersonation: you may only "Login as" a strictly lower rank.
 *  Super Admin > Admin > Manager > everyone else (Employee / custom roles). */
const ROLE_RANK = { 'Super Admin': 4, 'Admin': 3, 'Manager': 2 };
function roleRank(role) { return ROLE_RANK[role] || 1; }

module.exports = { requirePermission, requireAnyPermission, can, defaultMatrix, MODULES, roleRank };
