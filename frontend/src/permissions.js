import { useEffect, useState } from 'react';
import { api, getUser } from './api';

/** Module/action model — mirrors the backend (permissions.js) and the Permissions matrix UI. */
const APPROVABLE = new Set(['Invoice', 'Receipt Approval', 'Payment']);
const STATIC_MODULES = new Set(['Dashboard', 'Reports']);
const MODULES = [
  'Dashboard', 'User Management', 'Master Data', 'Invoice', 'Receipt', 'Payment',
  'Receipt Approval', 'Invoice Adjustment', 'Reports', 'Settings',
];

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
    } else {
      if (!['User Management', 'Settings', 'Receipt Approval', 'Invoice Adjustment'].includes(mod)) {
        row.View = true;
        if (!isStatic) { row.Create = true; row.Edit = true; }
      }
    }
    m[mod] = row;
  }
  return m;
}

// cache the saved matrix across components for the session
let cached = null;
async function loadMatrices() {
  if (cached) return cached;
  try {
    const d = await api.get('/api/settings/prefs');
    cached = { permissions: d.prefs?.permissions || {}, roles: d.prefs?.roles || [] };
  } catch {
    cached = { permissions: {}, roles: [] };
  }
  return cached;
}

// Privilege rank for impersonation — mirrors backend permissions.js.
// You may only "Login as" a strictly lower rank.
const ROLE_RANK = { 'Super Admin': 4, 'Admin': 3, 'Manager': 2 };
export const roleRank = (role) => ROLE_RANK[role] || 1;

/** Hook: returns can(module, action). Defaults to allow until loaded (avoids button flicker), Super Admin always true. */
export function usePerms() {
  const role = getUser()?.role;
  const [data, setData] = useState(cached);
  useEffect(() => { loadMatrices().then(setData); }, []);

  const can = (module, action) => {
    if (role === 'Super Admin' || role === 'Admin') return true;
    if (!data) return true; // not yet loaded — don't hide prematurely
    const saved = data.permissions[role];
    const custom = (data.roles || []).find((r) => r.name === role);
    const matrix = saved || custom?.matrix || defaultMatrix(role);
    return !!(matrix[module] && matrix[module][action]);
  };
  return { can, ready: !!data };
}
