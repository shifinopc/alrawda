import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, clearSession, getUser, mustChangePassword, isImpersonating, impersonator, stopImpersonation } from '../api';
import ForcePassword from './ForcePassword';
import ProfileModal from './ProfileModal';
import { Modal } from './ui';
import { usePerms } from '../permissions';
import { getTheme, toggleTheme } from '../theme';
import { getAppTimeZone, setAppTimeZone } from '../countries';

// "g then key" navigation shortcuts
const GOTO = {
  d: '/', i: '/invoices', r: '/receipts', q: '/receipt-request', a: '/approval',
  j: '/adjustment', p: '/payments', o: '/reports', m: '/masters', u: '/users', s: '/settings',
};
const SHORTCUTS = [
  { keys: '⌘/Ctrl + K  or  /', desc: 'Focus search' },
  { keys: 'G then D', desc: 'Go to Dashboard' },
  { keys: 'G then I', desc: 'Go to Invoices' },
  { keys: 'G then R', desc: 'Go to Receipts' },
  { keys: 'G then Q', desc: 'Go to Receipt Request' },
  { keys: 'G then A', desc: 'Go to Receipt Approval' },
  { keys: 'G then J', desc: 'Go to Invoice Adjustment' },
  { keys: 'G then P', desc: 'Go to Payments' },
  { keys: 'G then O', desc: 'Go to Reports' },
  { keys: 'G then M', desc: 'Go to Masters' },
  { keys: 'G then U', desc: 'Go to User Management' },
  { keys: 'G then S', desc: 'Go to Settings' },
  { keys: '?', desc: 'Show this help' },
  { keys: 'Esc', desc: 'Close menu / dialog' },
];

const NAV = [
  { group: 'Activity' },
  { to: '/', label: 'Dashboard', icon: 'ti-layout-dashboard', end: true, mod: 'Dashboard' },
  { to: '/invoices', label: 'Invoice', icon: 'ti-file-invoice', mod: 'Invoice' },
  { to: '/receipts', label: 'Receipt', icon: 'ti-receipt', mod: 'Receipt' },
  { to: '/receipt-request', label: 'Receipt Request', icon: 'ti-cash', mod: 'Receipt' },
  { to: '/approval', label: 'Receipt Approval', icon: 'ti-checks', mod: 'Receipt Approval' },
  { to: '/adjustment', label: 'Invoice Adjustment', icon: 'ti-adjustments-dollar', mod: 'Invoice Adjustment' },
  { to: '/payments', label: 'Payment', icon: 'ti-businessplan', mod: 'Payment' },
  { group: 'Reports' },
  { to: '/reports', label: 'All Report', icon: 'ti-chart-bar', mod: 'Reports' },
  { group: 'Master Data' },
  { to: '/masters', label: 'Master', icon: 'ti-database', mod: 'Master Data' },
  { group: 'Settings' },
  { to: '/users', label: 'User Management', icon: 'ti-users', mod: 'User Management' },
  { to: '/activity', label: 'Activity Log', icon: 'ti-history', adminOnly: true },
  { to: '/settings', label: 'Settings', icon: 'ti-settings', mod: 'Settings' },
];

const PAGE_LABELS = Object.fromEntries(NAV.filter((n) => n.to).map((n) => [n.to, n.label]));

function Clock() {
  const [now, setNow] = useState(new Date());
  const [tz, setTz] = useState(getAppTimeZone());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    // pick up region changes saved from Settings without a reload
    const onTz = () => setTz(getAppTimeZone());
    window.addEventListener('app-timezone-changed', onTz);
    return () => { clearInterval(t); window.removeEventListener('app-timezone-changed', onTz); };
  }, []);
  const opts = tz ? { timeZone: tz } : {};
  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', ...opts });
  const time = now.toLocaleTimeString('en-GB', opts);
  return (
    <div className="clockchip">
      <span className="today">Today</span>
      <span className="now">{date} · {time}</span>
    </div>
  );
}

function Dropdown({ open, children }) {
  if (!open) return null;
  return <div className="dd">{children}</div>;
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 820);
  const [menu, setMenu] = useState(null); // 'help' | 'notif' | 'user' | null
  const [counts, setCounts] = useState({ openReceipts: 0, invoicesToApprove: 0 });
  const [tabs, setTabs] = useState([]);
  const [search, setSearch] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [denied, setDenied] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [theme, setTheme] = useState(getTheme());
  const gPending = useRef(0);
  const { can } = usePerms();
  const canSettings = can('Settings', 'View');
  const meRole = getUser()?.role;
  const isAdminRole = ['Super Admin', 'Admin'].includes(meRole);
  // sidebar items the current user may see (View permission), with group headers only when non-empty
  const visibleNav = (() => {
    const out = [];
    let pendingGroup = null;
    for (const n of NAV) {
      if (n.group) { pendingGroup = n.group; continue; }
      const allowed = n.adminOnly ? isAdminRole : (n.mod ? can(n.mod, 'View') : true);
      if (!allowed) continue;
      if (pendingGroup) { out.push({ group: pendingGroup }); pendingGroup = null; }
      out.push(n);
    }
    return out;
  })();
  const navigate = useNavigate();
  const location = useLocation();
  const topRef = useRef(null);
  const searchRef = useRef(null);

  // global keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

      // ⌘/Ctrl+K → focus search (works even while typing elsewhere)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      // Esc → close any open overlay
      if (e.key === 'Escape') {
        setMenu(null); setShowKeys(false); setShowProfile(false); setDenied(false);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      // "/" → focus search ; "?" → shortcuts help
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === '?') { e.preventDefault(); setShowKeys(true); return; }

      // "g" then a key → navigate
      const now = Date.now();
      if (e.key.toLowerCase() === 'g') { gPending.current = now; return; }
      if (gPending.current && now - gPending.current < 1200) {
        const dest = GOTO[e.key.toLowerCase()];
        gPending.current = 0;
        if (dest) {
          e.preventDefault();
          if (dest === '/settings' && !canSettings) { setDenied(true); return; }
          navigate(dest);
        }
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [navigate, canSettings]);

  const runSearch = (e) => {
    if (e.key === 'Enter' && search.trim()) {
      navigate(`/search?q=${encodeURIComponent(search.trim())}`);
      setSearch('');
      e.target.blur();
    }
  };
  const [user, setUser] = useState(getUser() || { name: 'User', role: '' });
  const initials = (user.name || 'U').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const isAdmin = ['Super Admin', 'Admin'].includes(user.role);
  const [forcePw, setForcePw] = useState(mustChangePassword());

  const goSettings = () => { setMenu(null); if (canSettings) navigate('/settings'); else setDenied(true); };

  // track visited screens as open tabs
  useEffect(() => {
    const label = PAGE_LABELS[location.pathname];
    if (!label) return;
    setTabs((t) => (t.some((x) => x.to === location.pathname) ? t : [...t, { to: location.pathname, label }]));
  }, [location.pathname]);

  // notification counts — lightweight endpoint (works for users without Dashboard access)
  useEffect(() => {
    api.get('/api/dashboard/counts')
      .then((d) => setCounts({ openReceipts: d.unbookedReceipts, invoicesToApprove: d.invoicesToApprove }))
      .catch(() => {});
  }, []);

  // load the saved region time zone so the header clock matches the configured country,
  // and set up the idle auto-logout timer (Settings → Security)
  useEffect(() => {
    let timer;
    let idleMs = 0;
    const doLogout = () => { clearSession(); navigate('/login'); };
    const reset = () => { if (timer) clearTimeout(timer); if (idleMs > 0) timer = setTimeout(doLogout, idleMs); };
    const evts = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    api.get('/api/settings/prefs')
      .then((p) => {
        const tz = p?.prefs?.region?.timeZone;
        if (tz) { setAppTimeZone(tz); window.dispatchEvent(new Event('app-timezone-changed')); }
        const mins = Number(p?.prefs?.security?.idleMinutes) || 0;
        if (mins > 0) {
          idleMs = mins * 60000;
          evts.forEach((e) => window.addEventListener(e, reset, { passive: true }));
          reset();
        }
      })
      .catch(() => {});
    return () => { if (timer) clearTimeout(timer); evts.forEach((e) => window.removeEventListener(e, reset)); };
  }, [navigate]);

  // close menus on outside click
  useEffect(() => {
    const h = (e) => { if (topRef.current && !topRef.current.contains(e.target)) setMenu(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const closeTab = (e, to) => {
    e.stopPropagation();
    setTabs((t) => {
      const next = t.filter((x) => x.to !== to);
      if (location.pathname === to) navigate(next.length ? next[next.length - 1].to : '/');
      return next;
    });
  };

  const signOut = async () => {
    try { await api.post('/api/auth/logout', {}); } catch { /* clear locally regardless */ }
    clearSession();
    navigate('/login');
  };
  const toggle = (m) => setMenu((cur) => (cur === m ? null : m));
  const flipTheme = () => setTheme(toggleTheme());
  const notifTotal = (counts.openReceipts > 0 ? 1 : 0) + (counts.invoicesToApprove > 0 ? 1 : 0);

  const onStopImpersonation = async () => {
    try { await stopImpersonation(); } catch (e) { alert(e.message || 'Could not return to your account'); }
  };

  return (
    <div className="shell">
      {isImpersonating() && (
        <div className="imp-bar">
          <i className="ti ti-eye" />
          <span>
            You are viewing as <b>{user.name}</b> ({user.role}) — started by <b>{impersonator()?.name}</b>
          </span>
          <button type="button" onClick={onStopImpersonation}>
            <i className="ti ti-arrow-back-up" /> Return to your account
          </button>
        </div>
      )}
      {forcePw && <ForcePassword onDone={() => setForcePw(false)} />}
      <div className="topbar" ref={topRef}>
        <button className="tb-icon" onClick={() => setCollapsed(!collapsed)} title="Toggle menu">
          <i className="ti ti-menu-2" />
        </button>
        <div className="logo">
          <img src="/stimes-logo.svg" alt="Stimes ERP" style={{ width: 116, height: 27, display: 'block' }} />
        </div>
        <div className="searchbox">
          <i className="ti ti-search" />
          <input
            ref={searchRef}
            placeholder="Search invoices, receipts, payments, customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={runSearch}
          />
          <span className="kbd">⌘K</span>
        </div>
        <div className="orgchip">
          <span className="oc-ic"><i className="ti ti-building" /></span>
          <div><b>AL RAWDA GROUP</b><small>Hajj &amp; Umrah Services</small></div>
        </div>
        <Clock />
        <div className="tb-sep" />
        <button className="tb-icon" onClick={flipTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          <i className={`ti ${theme === 'dark' ? 'ti-sun' : 'ti-moon'}`} />
        </button>
        <button className="tb-icon" onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)">
          <i className="ti ti-keyboard" />
        </button>
        <div className="dd-wrap">
          <button className="tb-icon" onClick={() => toggle('notif')} title="Notifications">
            <i className="ti ti-bell" />
            {notifTotal > 0 && <span className="nbadge">{notifTotal}</span>}
          </button>
          <Dropdown open={menu === 'notif'}>
            <div className="dd-head">Notifications</div>
            {counts.openReceipts > 0 && (
              <div className="dd-item" onClick={() => { setMenu(null); navigate('/approval'); }}>
                <i className="ti ti-receipt" />
                <div>{counts.openReceipts.toLocaleString()} receipts awaiting approval<small>Receipt Approval</small></div>
              </div>
            )}
            {counts.invoicesToApprove > 0 && (
              <div className="dd-item" onClick={() => { setMenu(null); navigate('/invoices'); }}>
                <i className="ti ti-file-invoice" />
                <div>{counts.invoicesToApprove.toLocaleString()} invoices pending approval<small>Invoice</small></div>
              </div>
            )}
            {notifTotal === 0 && <div className="dd-item"><i className="ti ti-check" /> All caught up</div>}
          </Dropdown>
        </div>
        <div className="dd-wrap">
          <div className="userbox" onClick={() => toggle('user')}>
            <div className="avatar">{initials}<span className="online" /></div>
            <div><b>{user.name}</b><small>{user.role}</small></div>
            <i className="ti ti-chevron-down chev" />
          </div>
          <Dropdown open={menu === 'user'}>
            <div className="dd-item" onClick={() => { setMenu(null); setShowProfile(true); }}>
              <i className="ti ti-user" /> My profile
            </div>
            <div className="dd-item" onClick={goSettings}>
              <i className="ti ti-settings" /> Settings
            </div>
            <div className="dd-sep" />
            <div className="dd-item danger" onClick={signOut}>
              <i className="ti ti-logout" /> Sign out
            </div>
          </Dropdown>
        </div>
      </div>
      <div className="tabsbar">
        {tabs.map((t) => (
          <div
            key={t.to}
            className={`tabitem ${location.pathname === t.to ? 'active' : ''}`}
            onClick={() => navigate(t.to)}
          >
            {t.label}
            <i className="ti ti-x tx" onClick={(e) => closeTab(e, t.to)} />
          </div>
        ))}
      </div>
      <div className="body">
        <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
          {visibleNav.map((n, i) =>
            n.group ? (
              <div key={`g-${i}`} className="navgroup">{n.group}</div>
            ) : (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `navitem ${isActive ? 'active' : ''}`}
                onClick={() => { if (window.innerWidth <= 820) setCollapsed(true); }}
              >
                <i className={`ti ${n.icon}`} />
                <span>{n.label}</span>
              </NavLink>
            )
          )}
        </div>
        <div className="main">
          <Outlet />
        </div>
      </div>

      {showProfile && (
        <ProfileModal
          onClose={() => setShowProfile(false)}
          onSaved={(name) => setUser((u) => ({ ...u, name }))}
        />
      )}

      {showKeys && (
        <Modal title="Keyboard shortcuts" onClose={() => setShowKeys(false)} width={460}
          footer={<button className="btn primary" onClick={() => setShowKeys(false)}>Done</button>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SHORTCUTS.map((sc) => (
              <div key={sc.desc} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 2px', borderBottom: '1px solid var(--line)' }}>
                <span>{sc.desc}</span>
                <span className="kbd" style={{ fontWeight: 700 }}>{sc.keys}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {denied && (
        <Modal title="Access denied" onClose={() => setDenied(false)} width={420}
          footer={<button className="btn primary" onClick={() => setDenied(false)}>OK</button>}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <i className="ti ti-lock" style={{ fontSize: 26, color: '#b3261e' }} />
            <div>You don't have permission to open <b>Settings</b>. Please contact an administrator if you need access.</div>
          </div>
        </Modal>
      )}
    </div>
  );
}
