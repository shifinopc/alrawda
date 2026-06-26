import React, { useEffect, useState } from 'react';
import { api, getUser } from '../api';
import { Select, useToast, Badge, Panel, Field, Empty, Loader } from '../components/ui';

const ENTITY_LABEL = {
  invoices: 'Invoice', receipts: 'Receipt', 'receipt-requests': 'Receipt Request',
  payments: 'Payment', masters: 'Master Data', users: 'User', settings: 'Settings',
  auth: 'Account', activity: 'Activity', customers: 'Customer',
};
const ENTITIES = Object.keys(ENTITY_LABEL).filter((k) => !['auth', 'activity'].includes(k));
const LIMITS = [100, 250, 500];

/* map an HTTP method + request path to a coloured action badge */
function actionBadge(method, path) {
  const p = String(path || '');
  if (method === 'POST') {
    if (p.includes('/approve') || p.includes('/process')) return { label: 'Approve', tone: 'warn' };
    if (p.includes('/cancel')) return { label: 'Cancel', tone: 'red' };
    if (p.includes('/adjust')) return { label: 'Adjust', tone: 'warn' };
    if (p.includes('/restore')) return { label: 'Restore', tone: 'blue' };
    if (p.includes('/reset-password')) return { label: 'Reset password', tone: 'warn' };
    if (p.includes('/change-password')) return { label: 'Change password', tone: 'warn' };
    return { label: 'Create', tone: 'green' };
  }
  if (method === 'PUT') return { label: 'Update', tone: 'warn' };
  if (method === 'DELETE') return { label: 'Delete', tone: 'red' };
  return { label: method || '—', tone: 'blue' };
}

/** Turn an HTTP status code into a plain-English outcome. */
function statusLabel(status) {
  const s = Number(status);
  if (s === 201) return { label: 'Created', tone: 'green' };
  if (s >= 200 && s < 300) return { label: 'Success', tone: 'green' };
  if (s === 400) return { label: 'Rejected', tone: 'warn' };
  if (s === 401) return { label: 'Not signed in', tone: 'red' };
  if (s === 403) return { label: 'Blocked', tone: 'red' };
  if (s === 404) return { label: 'Not found', tone: 'warn' };
  if (s === 409) return { label: 'Conflict', tone: 'warn' };
  if (s === 429) return { label: 'Rate limited', tone: 'red' };
  if (s >= 500) return { label: 'Failed', tone: 'red' };
  return { label: String(status || '—'), tone: 'blue' };
}

const entityLabel = (e) => ENTITY_LABEL[e] || (e || '—');

// camelCase / snake_case key → "Title Case"
const humanizeKey = (k) =>
  k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** Turn the stored JSON detail into a readable sentence (no braces/quotes). */
function humanizeDetail(detail) {
  if (!detail) return '—';
  let obj;
  try { obj = JSON.parse(detail); } catch { return detail; }
  if (!obj || typeof obj !== 'object') return String(detail);
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
    .map(([k, v]) => `${humanizeKey(k)}: ${v}`);
  return parts.length ? parts.join(' · ') : '—';
}

const fmtTime = (v) =>
  v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export default function ActivityLog() {
  const toast = useToast();
  const me = getUser();
  const isAdmin = ['Super Admin', 'Admin'].includes(me?.role);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState('');
  const [user, setUser] = useState('');
  const [limit, setLimit] = useState(100);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (entity) params.set('entity', entity);
      if (user.trim()) params.set('user', user.trim());
      params.set('limit', String(limit));
      const data = await api.get(`/api/activity?${params.toString()}`);
      setRows(data.rows || []);
    } catch (e) {
      toast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [entity, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) {
    return (
      <div className="tip">
        <i className="ti ti-lock" /> You need administrator access to view the activity log.
      </div>
    );
  }

  return (
    <Panel title="Activity Log" sub="Every create, edit and delete across the system" bodyStyle={{ padding: 0 }}>
      {/* standardized filter bar */}
      <div className="filterbar">
        <Field label="Module">
          <Select value={entity} onChange={setEntity}
            options={[{ value: '', label: 'All modules' }, ...ENTITIES.map((en) => ({ value: en, label: entityLabel(en) }))]} />
        </Field>
        <Field label="User">
          <input
            placeholder="Filter by user name…"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
        </Field>
        <Field label="Show">
          <Select value={limit} onChange={(v) => setLimit(Number(v))}
            options={LIMITS.map((n) => ({ value: n, label: `Last ${n}` }))} />
        </Field>
        <button className="btn primary" onClick={load} style={{ height: 38 }}>
          <i className="ti ti-refresh" /> Refresh
        </button>
      </div>

      {loading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <Empty icon="ti-history" text="No activity recorded yet." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Role</th>
              <th>Action</th>
              <th>Module</th>
              <th>Result</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const act = actionBadge(r.method, r.path);
              const st = statusLabel(r.status);
              const detail = humanizeDetail(r.detail);
              return (
                <tr key={r.id} style={{ cursor: 'default' }}>
                  <td>{fmtTime(r.created_at)}</td>
                  <td style={{ fontWeight: 600 }}>{r.user_name || '—'}</td>
                  <td>{r.user_role ? <Badge tone="violet">{r.user_role}</Badge> : <span className="muted">—</span>}</td>
                  <td><Badge tone={act.tone}>{act.label}</Badge></td>
                  <td>{entityLabel(r.entity)}</td>
                  <td><Badge tone={st.tone}>{st.label}</Badge></td>
                  <td
                    className="muted"
                    title={detail}
                    style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}
                  >
                    {detail}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
