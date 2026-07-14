const TOKEN_KEY = 'alrawda_token';
const USER_KEY = 'alrawda_user';
const MUSTCHANGE_KEY = 'alrawda_mustchange';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
};
export const isLoggedIn = () => !!getToken();
export const setSession = (token, user, mustChange = false) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (mustChange) localStorage.setItem(MUSTCHANGE_KEY, '1');
  else localStorage.removeItem(MUSTCHANGE_KEY);
};
export const mustChangePassword = () => localStorage.getItem(MUSTCHANGE_KEY) === '1';
export const clearMustChange = () => localStorage.removeItem(MUSTCHANGE_KEY);

// ---- impersonation ("Login as user") ----
// While impersonating, the stored user payload carries an `impersonator` field
// (the real admin). All requests then run with the target user's identity/permissions.
export const isImpersonating = () => !!getUser()?.impersonator;
export const impersonator = () => getUser()?.impersonator || null;
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(MUSTCHANGE_KEY);
};

// Base URL for the API. Empty = same origin (relative /api, dev proxy).
// Set VITE_API_BASE (e.g. https://stimesapi.ionob.in) for a split frontend/backend deploy.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.includes('/auth/login')) {
    clearSession();
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};

// Start impersonating a user (caller must have User Management → Edit).
// Swaps the active session to the target and hard-reloads so the whole app
// re-reads the new identity & permissions.
export async function startImpersonation(userId, reason) {
  const d = await api.post(`/api/users/${userId}/impersonate`, { reason });
  setSession(d.token, d.user); // d.user includes the `impersonator` field
  window.location.assign('/');
}
// Return from impersonation to the real admin account.
// Resilient: if the server no longer sees an impersonation (e.g. the cookie already
// points to the admin, or the impersonation token expired), recover by reading the
// real identity from /me instead of leaving the user stuck in the banner.
export async function stopImpersonation() {
  let token, user;
  try {
    const d = await api.post('/api/auth/stop-impersonate', {});
    token = d.token; user = d.user;
  } catch {
    const me = await api.get('/api/auth/me').catch(() => null);
    if (me?.user && !me.user.impersonator) { user = me.user; token = getToken(); }
  }
  if (user) {
    setSession(token, { id: user.id, username: user.username, name: user.name, role: user.role });
    window.location.assign('/');
  } else {
    clearSession();
    window.location.assign('/login');
  }
}

/** Download a server-rendered PDF voucher (kind: 'receipt'|'invoice'|'payment').
 *  Keeps the Bearer token in the header (a plain link can't), then saves the blob. */
export async function downloadPdf(kind, code, { paper = 'a5', filename } = {}) {
  const res = await fetch(`${API_BASE}/api/pdf/${kind}/${code}?paper=${paper}`, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
  });
  if (!res.ok) {
    let msg = `Could not generate PDF (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${kind}-${code}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** POST JSON and open the returned PDF in a new tab (for server-rendered reports). */
export async function postPdf(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Could not generate PDF (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---- formatting helpers ---- */
export const fmtMoney = (v) =>
  Number(v ?? 0).toLocaleString('en-QA', { maximumFractionDigits: 2 });

export const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// date + time — use for real timestamps (created_at, login times, activity, history)
export const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
};

// show the real creation time when present, else the business date with a 00:00 placeholder
export const fmtDateTimeOr0 = (ts, fallbackDate) => {
  if (ts) return fmtDateTime(ts);
  const date = fmtDate(fallbackDate);
  return date === '—' ? date : `${date} 00:00`;
};

// 'en-CA' formats as YYYY-MM-DD in LOCAL time (toISOString would shift the date in UTC+3)
export const toInputDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-CA');
};

export const todayStr = () => new Date().toLocaleDateString('en-CA');

export const invoiceStatusBadge = (status) =>
  ({ Paid: 'green', 'Partially Paid': 'warn', 'Not Paid': 'red', Cancelled: 'red' }[status] || 'blue');
