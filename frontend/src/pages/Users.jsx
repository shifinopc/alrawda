import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtDate, fmtDateTime, getUser, startImpersonation } from '../api';
import { Select, useToast, useConfirm, Badge, Panel, Field, Modal, Empty, Loader } from '../components/ui';
import { usePerms, roleRank } from '../permissions';

const ROLES = ['Super Admin', 'Admin', 'Manager', 'Employee'];
const DEPARTMENTS = ['Management', 'Operations', 'Sales & Counter', 'Finance', 'Support'];
const STATUSES = ['Active', 'Invite pending', 'Suspended', 'Inactive'];
const STATUS_TONE = { Active: 'green', 'Invite pending': 'warn', Suspended: 'red', Inactive: 'blue' };

const MODULES = [
  'Dashboard', 'User Management', 'Master Data', 'Invoice', 'Receipt', 'Payment',
  'Receipt Approval', 'Invoice Adjustment', 'Reports', 'Settings',
];
const ACTIONS = ['View', 'Create', 'Edit', 'Delete', 'Approve'];
const APPROVABLE = new Set(['Invoice', 'Receipt Approval', 'Payment']);
const STATIC_MODULES = new Set(['Dashboard', 'Reports']); // view-only modules

const STANDARD_ROLES = [
  { name: 'Super Admin', desc: 'Unrestricted access to every module and setting.', icon: 'ti-shield-star' },
  { name: 'Admin', desc: 'Manage users, master data and all business documents.', icon: 'ti-shield-check' },
  { name: 'Manager', desc: 'Approvals, adjustments and full reporting.', icon: 'ti-user-star' },
  { name: 'Employee', desc: 'Day-to-day counter work — invoices, receipts, payments.', icon: 'ti-user' },
];

const initials = (name) =>
  String(name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

const userId = (id) => `USR-${String(id).padStart(3, '0')}`;

const Avatar = ({ name, photo, size = 32 }) => (
  <span
    style={{
      width: size, height: size, borderRadius: '50%', background: 'var(--grad)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
      fontSize: size * 0.37, flex: `0 0 ${size}px`, overflow: 'hidden',
    }}
  >
    {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(name)}
  </span>
);

const Swt = ({ on, onChange, disabled }) => (
  <button
    type="button" className={`swt${on ? ' on' : ''}`} aria-pressed={on}
    style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
    onClick={() => !disabled && onChange(!on)}
  />
);
const SwtRow = ({ label, sub, on, onChange, disabled }) => (
  <div className="swtrow">
    <div className="swl">{label}{sub && <small>{sub}</small>}</div>
    <Swt on={on} onChange={onChange} disabled={disabled} />
  </div>
);

/* ---------- permission matrix defaults + component ---------- */
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

function PermMatrix({ value, onChange, disabled }) {
  const toggle = (mod, act) => {
    if (disabled) return;
    onChange({ ...value, [mod]: { ...value[mod], [act]: !value[mod][act] } });
  };
  return (
    <table className="pmx">
      <thead>
        <tr>
          <th>Module</th>
          {ACTIONS.map((a) => <th key={a}>{a}</th>)}
        </tr>
      </thead>
      <tbody>
        {MODULES.map((mod) => (
          <tr key={mod}>
            <td>{mod}</td>
            {ACTIONS.map((act) => {
              const na = (act === 'Approve' && !APPROVABLE.has(mod)) ||
                         (STATIC_MODULES.has(mod) && act !== 'View');
              return (
                <td key={act}>
                  {na ? <span className="na">—</span> : (
                    <input
                      type="checkbox"
                      checked={!!(value[mod] && value[mod][act])}
                      onChange={() => toggle(mod, act)}
                      disabled={disabled}
                    />
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ============================================================
   Tab 1 — User Directory
   ============================================================ */
const EMPTY_FORM = {
  displayName: '', username: '', email: '', mobile: '', department: 'Operations',
  designation: '', reportingTo: '', password: '', role: 'Employee', status: 'Active',
  mfa: false, welcomeEmail: true, photo: null, customPerms: false, matrix: null,
};

function DirectoryTab({ isAdmin, canImpersonate, allRoles, prefs, customRoles, savePrefs }) {
  const toast = useToast();
  const confirm = useConfirm();
  const me = getUser();
  // a user can be impersonated only if you may impersonate, they're not you,
  // they're active, and their role is strictly BELOW yours (Super Admin can act as
  // Admin↓, Admin as Manager↓, etc. — never an equal/higher role)
  const canActAs = (u) =>
    canImpersonate && u.id !== me?.id &&
    roleRank(u.role) < roleRank(me?.role) &&
    (u.status ? u.status === 'Active' : u.active);
  const onImpersonate = async (u) => {
    const reason = await confirm({
      title: `Log in as ${u.display_name}?`,
      message: `You'll see the app exactly as ${u.display_name} (${u.role}) does, with their permissions. Every action is recorded against both of you, and you can return to your own account anytime from the banner at the top.`,
      confirmText: 'Login as user',
      prompt: 'Reason (recorded in the audit log)',
      promptRequired: true,
    });
    if (!reason) return; // cancelled or empty
    try { await startImpersonation(u.id, reason); } // hard-reloads on success
    catch (e) { toast(e.message); }
  };
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [activity, setActivity] = useState(null);

  useEffect(() => {
    setActivity(null);
    if (viewing) {
      api.get(`/api/users/${viewing.id}/activity`).then(setActivity).catch(() => setActivity({ rows: [], totalActions: 0 }));
    }
  }, [viewing]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/users');
      setRows(data.rows || []);
    } catch (e) {
      toast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) =>
      [u.display_name, u.username, u.email, u.department, u.designation, u.role]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter((u) => u.status === 'Active').length,
    suspended: rows.filter((u) => u.status === 'Suspended').length,
    inactive: rows.filter((u) => ['Inactive', 'Invite pending'].includes(u.status)).length,
  }), [rows]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setV = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  // effective permission matrix for a role (saved override → custom-role matrix → built-in default)
  const effectiveMatrix = (role) =>
    (prefs?.permissions?.[role]) || (customRoles.find((r) => r.name === role)?.matrix) || defaultMatrix(role);
  const matrixEqual = (a, b) =>
    MODULES.every((m) => ACTIONS.every((act) => !!(a?.[m]?.[act]) === !!(b?.[m]?.[act])));

  // changing the role in the form re-bases the permission matrix to that role
  const onRoleChange = (e) => {
    const role = e.target.value;
    setForm((f) => ({ ...f, role, matrix: effectiveMatrix(role) }));
  };

  const openCreate = () => { setForm({ ...EMPTY_FORM, matrix: effectiveMatrix('Employee') }); setEditing('new'); };

  const openEdit = (u) => {
    const role = u.role || 'Employee';
    setForm({
      displayName: u.display_name || '', username: u.username || '', email: u.email || '',
      mobile: u.mobile || '', department: u.department || 'Operations', designation: u.designation || '',
      reportingTo: u.reporting_to || '', password: '', role,
      status: u.status || (u.active ? 'Active' : 'Inactive'), mfa: !!u.mfa, welcomeEmail: false,
      photo: u.photo || null, customPerms: false, matrix: effectiveMatrix(role),
    });
    setViewing(null);
    setEditing(u);
  };

  const pickPhoto = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose a JPG or PNG image'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result.length > 400 * 1024) { toast('Photo is too large — keep it under ~300 KB'); return; }
      setV('photo')(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const onSave = async () => {
    if (!form.displayName.trim()) { toast('Full name is required'); return; }
    if (editing === 'new') {
      if (!form.username.trim()) { toast('Username is required'); return; }
      if (!form.password) { toast('Password is required'); return; }
    }

    // user-specific permission edits → offer to capture them as a named custom role
    let role = form.role;
    if (isAdmin && form.customPerms && form.matrix && !matrixEqual(form.matrix, effectiveMatrix(form.role))) {
      const asRole = await confirm({
        title: 'Custom permissions',
        message: `These permissions differ from the "${form.role}" role. Save them as a new custom role and assign it to ${form.displayName.trim() || 'this user'}?`,
        confirmText: 'Name & save role',
        cancelText: 'Keep role permissions',
      });
      if (asRole) {
        const name = (window.prompt('Name for the new custom role:', `${form.role} (custom)`) || '').trim();
        if (!name) { toast('A role name is required to save custom permissions'); return; }
        if (allRoles.some((r) => r.toLowerCase() === name.toLowerCase())) {
          toast('A role with that name already exists — choose another name'); return;
        }
        try {
          await savePrefs({ roles: [...customRoles, { name, basedOn: form.role, description: `Custom role for ${form.displayName.trim()}`, matrix: form.matrix }] });
          role = name;
          toast(`Custom role "${name}" created`);
        } catch (e) { toast(e.message); return; }
      }
    }

    setSaving(true);
    const profile = {
      displayName: form.displayName.trim(), email: form.email.trim(), mobile: form.mobile.trim(),
      department: form.department, designation: form.designation.trim(), reportingTo: form.reportingTo,
      role, status: form.status, mfa: form.mfa, photo: form.photo,
    };
    try {
      if (editing === 'new') {
        await api.post('/api/users', { ...profile, username: form.username.trim(), password: form.password });
        toast('User created');
        if (form.welcomeEmail) toast('Note: invite emails are not configured — share the credentials manually');
      } else {
        await api.put(`/api/users/${editing.id}`, profile);
        toast('User updated');
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onForceLogout = async (u) => {
    if (!(await confirm({
      title: 'Force logout?',
      message: `${u.display_name} (${u.username}) will be signed out on all devices immediately and must log in again.`,
      confirmText: 'Force logout', danger: true,
    }))) return;
    try {
      await api.post(`/api/users/${u.id}/force-logout`, {});
      toast(`${u.username} has been signed out of all sessions`);
    } catch (e) {
      toast(e.message);
    }
  };

  const onResetPassword = async () => {
    if (!newPassword) { toast('New password is required'); return; }
    setSaving(true);
    try {
      await api.post(`/api/users/${resetUser.id}/reset-password`, { newPassword });
      toast(`Password reset for ${resetUser.username}`);
      setResetUser(null);
      setNewPassword('');
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const managers = rows.filter((u) => editing === 'new' || u.id !== editing?.id);

  return (
    <div>
      {!isAdmin && (
        <div className="tip"><i className="ti ti-lock" /> You have read-only access to user management.</div>
      )}

      <div className="kpis">
        <div className="kpi"><div className="klabel"><i className="ti ti-users" /> Total users</div><div className="kval">{stats.total}</div></div>
        <div className="kpi"><div className="klabel"><i className="ti ti-user-check" /> Active</div><div className="kval">{stats.active}</div></div>
        <div className="kpi"><div className="klabel"><i className="ti ti-user-pause" /> Suspended</div><div className="kval">{stats.suspended}</div></div>
        <div className="kpi"><div className="klabel"><i className="ti ti-user-off" /> Inactive</div><div className="kval">{stats.inactive}</div></div>
      </div>

      <Panel
        title="User Directory"
        sub="Click a user to view the full profile"
        toolbar={
          <>
            <div className="searchbox" style={{ maxWidth: 280, padding: '6px 10px' }}>
              <i className="ti ti-search" />
              <input
                placeholder="Search by name, email, department…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {isAdmin && (
              <button className="btn primary" onClick={openCreate}>
                <i className="ti ti-user-plus" /> Invite user
              </button>
            )}
          </>
        }
        bodyStyle={{ padding: 0 }}
      >
        {loading ? (
          <Loader />
        ) : filtered.length === 0 ? (
          <Empty icon="ti-users" text={search ? 'No users match your search.' : 'No users found.'} />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>User</th><th>Mobile</th><th>Department</th><th>Designation</th><th>Reporting to</th>
                <th>Role</th><th>Status</th><th>Last login</th>{(isAdmin || canImpersonate) && <th />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} onClick={() => setViewing(u)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={u.display_name || u.username} photo={u.photo} />
                      <div>
                        <div style={{ fontWeight: 700 }}>{u.display_name || u.username}</div>
                        <small className="muted">{userId(u.id)}{u.email ? ` · ${u.email}` : ''}</small>
                      </div>
                    </div>
                  </td>
                  <td>{u.mobile || <span className="muted">—</span>}</td>
                  <td>{u.department || <span className="muted">—</span>}</td>
                  <td>{u.designation || <span className="muted">—</span>}</td>
                  <td>{u.reporting_to || <span className="muted">—</span>}</td>
                  <td><Badge tone="violet">{u.role}</Badge></td>
                  <td><Badge tone={STATUS_TONE[u.status] || 'blue'}>{u.status || 'Active'}</Badge></td>
                  <td>{u.last_login ? fmtDateTime(u.last_login) : <span className="muted">Never</span>}</td>
                  {(isAdmin || canImpersonate) && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {canActAs(u) && (
                          <button className="btn sm" title={`Login as ${u.display_name}`} onClick={() => onImpersonate(u)}>
                            <i className="ti ti-user-share" />
                          </button>
                        )}
                        {isAdmin && (
                          <>
                            <button className="btn sm" title="Edit profile" onClick={() => openEdit(u)}>
                              <i className="ti ti-pencil" />
                            </button>
                            <button className="btn sm" title="Reset password" onClick={() => { setResetUser(u); setNewPassword(''); }}>
                              <i className="ti ti-key" />
                            </button>
                            <button className="btn sm" title="Force logout (end all sessions)" onClick={() => onForceLogout(u)}>
                              <i className="ti ti-logout-2" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* View profile — details left, activity right */}
      {viewing && (
        <Modal
          title="User profile"
          onClose={() => setViewing(null)}
          width="min(1060px, 96vw)"
          footer={
            <>
              <button className="btn" onClick={() => setViewing(null)}>Close</button>
              {isAdmin && (
                <button className="btn primary" onClick={() => openEdit(viewing)}>
                  <i className="ti ti-pencil" /> Edit profile
                </button>
              )}
            </>
          }
        >
          <div className="profile-cols">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
                <Avatar name={viewing.display_name || viewing.username} photo={viewing.photo} size={64} />
                <div>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{viewing.display_name || viewing.username}</div>
                  <div className="muted" style={{ margin: '2px 0 7px' }}>
                    {[viewing.designation, viewing.department].filter(Boolean).join(' · ') || '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Badge tone={STATUS_TONE[viewing.status] || 'blue'}>{viewing.status || 'Active'}</Badge>
                    <Badge tone="violet">{viewing.role}</Badge>
                  </div>
                </div>
              </div>

              <div className="msec">Contact</div>
              <div className="pgrid">
                <div className="pitem"><small>Full name</small><b>{viewing.display_name || '—'}</b></div>
                <div className="pitem"><small>Email</small><b>{viewing.email || '—'}</b></div>
                <div className="pitem"><small>Mobile</small><b>{viewing.mobile || '—'}</b></div>
                <div className="pitem"><small>Department</small><b>{viewing.department || '—'}</b></div>
                <div className="pitem"><small>Designation</small><b>{viewing.designation || '—'}</b></div>
                <div className="pitem"><small>Reporting to</small><b>{viewing.reporting_to || '—'}</b></div>
              </div>

              <div className="msec" style={{ marginTop: 18 }}>Account</div>
              <div className="pgrid">
                <div className="pitem"><small>User ID</small><b>{userId(viewing.id)}</b></div>
                <div className="pitem"><small>Username</small><b>{viewing.username}</b></div>
                <div className="pitem"><small>Created</small><b>{fmtDateTime(viewing.created_at)}</b></div>
                <div className="pitem"><small>Last login</small><b>{viewing.last_login ? fmtDateTime(viewing.last_login) : 'Never'}</b></div>
                <div className="pitem"><small>MFA</small><b>{viewing.mfa ? 'Enabled' : 'Disabled'}</b></div>
                <div className="pitem"><small>Role</small><b>{viewing.role}</b></div>
              </div>
            </div>

            <div className="profile-activity">
              <div className="msec">
                Activity history{activity && activity.totalActions > 0 ? ` · ${activity.totalActions.toLocaleString()} actions` : ''}
              </div>
              {!activity ? (
                <Loader />
              ) : activity.rows.length === 0 ? (
                <div className="muted">No recorded activity yet.</div>
              ) : (
                <div className="activity-list">
                  {activity.rows.map((a, i) => (
                    <div key={i} className="activity-row">
                      <span style={{ fontWeight: 600 }}>
                        <i className={`ti ${a.Action === 'D' ? 'ti-trash' : a.Action === 'A' ? 'ti-plus' : 'ti-pencil'}`}
                           style={{ color: 'var(--accent)', marginRight: 7 }} />
                        {a.Narration}
                      </span>
                      <span className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.AuditDate)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Invite / Edit */}
      {editing !== null && (
        <Modal
          title={editing === 'new' ? 'Invite new user' : `Edit user — ${editing.username}`}
          onClose={() => setEditing(null)}
          width={660}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={onSave} disabled={saving}>
                <i className={`ti ${editing === 'new' ? 'ti-send' : 'ti-device-floppy'}`} />
                {editing === 'new' ? ' Send invite' : ' Save changes'}
              </button>
            </>
          }
        >
          <div className="photoup">
            <span className="ph">
              {form.photo ? <img src={form.photo} alt="" /> : initials(form.displayName || form.username)}
            </span>
            <div className="phbtns">
              <label className="btn sm" style={{ cursor: 'pointer' }}>
                <i className="ti ti-photo-up" /> Upload photo
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickPhoto} />
              </label>
              {form.photo && (
                <button className="btn sm danger" onClick={() => setV('photo')(null)}>
                  <i className="ti ti-x" /> Remove
                </button>
              )}
              <small>JPG / PNG, square, up to ~300 KB</small>
            </div>
          </div>

          <div className="msec">Profile</div>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Full name" required>
              <input value={form.displayName} onChange={set('displayName')} placeholder="e.g. Ahmed Hassan" />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={set('email')} placeholder="name@alrawda.qa" />
            </Field>
            <Field label="Mobile">
              <input value={form.mobile} onChange={set('mobile')} placeholder="+974 …" />
            </Field>
            <Field label="Department">
              <Select value={form.department} onChange={setV('department')} options={DEPARTMENTS} />
            </Field>
            <Field label="Designation">
              <input value={form.designation} onChange={set('designation')} placeholder="e.g. Counter Staff" />
            </Field>
            <Field label="Reporting manager">
              <Select value={form.reportingTo} onChange={setV('reportingTo')}
                options={[{ value: '', label: 'None' }, ...managers.map((m) => ({ value: m.display_name, label: m.display_name }))]} />
            </Field>
          </div>

          <div className="msec">Access &amp; security</div>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Username" required>
              <input value={form.username} onChange={set('username')} readOnly={editing !== 'new'} placeholder="e.g. ahmed" />
            </Field>
            {editing === 'new' && (
              <Field label="Password" required>
                <input type="password" value={form.password} onChange={set('password')} />
              </Field>
            )}
            <Field label="Role">
              <Select value={form.role} onChange={(v) => onRoleChange({ target: { value: v } })}
                options={allRoles} />
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={setV('status')} options={STATUSES} />
            </Field>
          </div>
          <div className="swtrow">
            <div className="swl">Require multi-factor authentication<small>User must verify with OTP at sign-in</small></div>
            <Swt on={form.mfa} onChange={setV('mfa')} />
          </div>
          {editing === 'new' && (
            <div className="swtrow">
              <div className="swl">Send welcome email with invite link<small>Uses the SMTP settings under Settings → Email Settings</small></div>
              <Swt on={form.welcomeEmail} onChange={setV('welcomeEmail')} />
            </div>
          )}

          {isAdmin && (
            <>
              <div className="msec">Permissions</div>
              <div className="swtrow">
                <div className="swl">Customize permissions for this user
                  <small>Starts from the {form.role} role — adjust below, then on save you can store it as a new custom role.</small>
                </div>
                <Swt
                  on={form.customPerms}
                  onChange={(v) => setForm((f) => ({ ...f, customPerms: v, matrix: f.matrix || effectiveMatrix(f.role) }))}
                />
              </div>
              {form.customPerms && form.matrix && (
                <PermMatrix value={form.matrix} onChange={(m) => setForm((f) => ({ ...f, matrix: m }))} />
              )}
            </>
          )}

          <div className="msec">Record</div>
          <div className="pillrow">
            <span className="recpill">User ID · <b>{editing === 'new' ? 'auto' : userId(editing.id)}</b></span>
            <span className="recpill">Created · <b>{editing === 'new' ? fmtDateTime(new Date()) : fmtDateTime(editing.created_at)}</b></span>
            <span className="recpill">Last login · <b>{editing !== 'new' && editing.last_login ? fmtDateTime(editing.last_login) : '—'}</b></span>
          </div>
        </Modal>
      )}

      {/* Reset password */}
      {resetUser && (
        <Modal
          title={`Reset password — ${resetUser.username}`}
          onClose={() => setResetUser(null)}
          width={380}
          footer={
            <>
              <button className="btn" onClick={() => setResetUser(null)}>Cancel</button>
              <button className="btn primary" onClick={onResetPassword} disabled={saving}>
                <i className="ti ti-key" /> Reset password
              </button>
            </>
          }
        >
          <Field label="New password" required>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   Tab 2 — Roles
   ============================================================ */
function RolesTab({ users, customRoles, saveCustomRoles, isAdmin }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editRole, setEditRole] = useState(null); // null | 'new' | custom role object | standard role object (readonly-ish)
  const [form, setForm] = useState({ name: '', basedOn: 'Employee', description: '', matrix: defaultMatrix('Employee') });
  const [saving, setSaving] = useState(false);

  const memberCount = (role) => users.filter((u) => u.role === role).length;

  const openNew = () => {
    setForm({ name: '', basedOn: 'Employee', description: '', matrix: defaultMatrix('Employee') });
    setEditRole('new');
  };
  const openCustom = (r) => {
    setForm({ name: r.name, basedOn: r.basedOn || 'Employee', description: r.description || '', matrix: r.matrix || defaultMatrix(r.basedOn || 'Employee') });
    setEditRole(r);
  };
  const openStandard = (r) => {
    setForm({ name: r.name, basedOn: r.name, description: r.desc, matrix: defaultMatrix(r.name) });
    setEditRole({ ...r, standard: true });
  };

  const onSave = async () => {
    const name = form.name.trim();
    if (!name) { toast('Role name is required'); return; }
    if (STANDARD_ROLES.some((r) => r.name.toLowerCase() === name.toLowerCase()) && editRole === 'new') {
      toast('That name is a standard role'); return;
    }
    setSaving(true);
    try {
      let next;
      if (editRole === 'new') {
        if (customRoles.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
          toast('A custom role with that name already exists'); setSaving(false); return;
        }
        next = [...customRoles, { name, basedOn: form.basedOn, description: form.description, matrix: form.matrix }];
      } else {
        next = customRoles.map((r) =>
          r.name === editRole.name ? { name, basedOn: form.basedOn, description: form.description, matrix: form.matrix } : r);
      }
      await saveCustomRoles(next);
      toast(editRole === 'new' ? `Role "${name}" created` : 'Role updated');
      setEditRole(null);
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (memberCount(editRole.name) > 0) { toast('Role is assigned to users — reassign them first'); return; }
    if (!(await confirm({
      title: 'Delete role?',
      message: `The custom role "${editRole.name}" will be permanently deleted.`,
      confirmText: 'Delete', danger: true,
    }))) return;
    await saveCustomRoles(customRoles.filter((r) => r.name !== editRole.name));
    toast('Role deleted');
    setEditRole(null);
  };

  const onBaseChange = (e) => {
    const basedOn = e.target.value;
    setForm((f) => ({ ...f, basedOn, matrix: defaultMatrix(basedOn) }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel
        title="Standard roles"
        sub="Built-in roles — click to view their permissions"
        toolbar={isAdmin ? (
          <button className="btn primary" onClick={openNew}><i className="ti ti-plus" /> Create custom role</button>
        ) : undefined}
      >
        <div className="rolecards">
          {STANDARD_ROLES.map((r) => (
            <div key={r.name} className="rolecard" onClick={() => openStandard(r)}>
              <div className="rc-name"><i className={`ti ${r.icon}`} /> {r.name}</div>
              <div className="rc-desc">{r.desc}</div>
              <span className="rc-count">{memberCount(r.name)} member{memberCount(r.name) === 1 ? '' : 's'}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Custom roles" sub="Roles created for this organisation">
        <div className="rolecards">
          {customRoles.map((r) => (
            <div key={r.name} className="rolecard custom" onClick={() => openCustom(r)}>
              <div className="rc-name"><i className="ti ti-puzzle" /> {r.name}</div>
              <div className="rc-desc">{r.description || `Based on ${r.basedOn || 'Employee'}`}</div>
              <span className="rc-count">{memberCount(r.name)} member{memberCount(r.name) === 1 ? '' : 's'}</span>
            </div>
          ))}
          {isAdmin && (
            <div className="rolecard newcard" onClick={openNew}>
              <i className="ti ti-plus" /> New custom role
            </div>
          )}
          {!customRoles.length && !isAdmin && <div className="muted">No custom roles yet.</div>}
        </div>
      </Panel>

      {editRole !== null && (
        <Modal
          title={editRole === 'new' ? 'Create custom role'
            : editRole.standard ? `${editRole.name} — standard role`
            : `Edit role — ${editRole.name}`}
          onClose={() => setEditRole(null)}
          width={680}
          footer={
            <>
              {editRole !== 'new' && !editRole.standard && isAdmin && (
                <button className="btn danger" style={{ marginRight: 'auto' }} onClick={onDelete}>
                  <i className="ti ti-trash" /> Delete role
                </button>
              )}
              <button className="btn" onClick={() => setEditRole(null)}>Cancel</button>
              {!editRole.standard && isAdmin && (
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <i className="ti ti-device-floppy" /> {editRole === 'new' ? 'Create role' : 'Save changes'}
                </button>
              )}
            </>
          }
        >
          {!editRole.standard && (
            <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label="Role name" required>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Visa Officer" />
              </Field>
              <Field label="Based on">
                <Select value={form.basedOn} onChange={(v) => onBaseChange({ target: { value: v } })} options={ROLES} />
              </Field>
              <Field label="Description" className="full">
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What this role is for" />
              </Field>
            </div>
          )}
          <div className="msec" style={{ marginTop: editRole.standard ? 0 : 16 }}>Permissions</div>
          <PermMatrix
            value={form.matrix}
            onChange={(m) => setForm((f) => ({ ...f, matrix: m }))}
            disabled={!!editRole.standard || !isAdmin}
          />
          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Approve applies to Invoice, Receipt Approval and Payment only.
            {editRole.standard && ' Standard role permissions are fixed — create a custom role to adjust them.'}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   Tab 3 — Permissions
   ============================================================ */
function PermissionsTab({ prefs, savePrefs, customRoles, isAdmin }) {
  const toast = useToast();
  const roleNames = [...ROLES, ...customRoles.map((r) => r.name)];
  const [role, setRole] = useState('Manager');
  const [matrix, setMatrix] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const saved = (prefs.permissions || {})[role];
    const custom = customRoles.find((r) => r.name === role);
    setMatrix(saved || custom?.matrix || defaultMatrix(role));
  }, [role, prefs, customRoles]);

  const onSave = async () => {
    setSaving(true);
    try {
      await savePrefs({ permissions: { ...(prefs.permissions || {}), [role]: matrix } });
      toast(`Permissions saved for ${role}`);
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onClone = async () => {
    const name = window.prompt(`Clone "${role}" permissions into a new custom role.\nNew role name:`);
    if (!name || !name.trim()) return;
    if (roleNames.some((r) => r.toLowerCase() === name.trim().toLowerCase())) { toast('That role name already exists'); return; }
    const next = [...customRoles, { name: name.trim(), basedOn: role, description: `Cloned from ${role}`, matrix }];
    await savePrefs({ roles: next });
    toast(`Custom role "${name.trim()}" created from ${role}`);
  };

  const locked = role === 'Super Admin';

  return (
    <Panel
      title="Permissions"
      sub="What each role can see and do — applies across the whole application"
      toolbar={
        <>
          <Select value={role} onChange={setRole} options={roleNames} style={{ width: 220 }} />
          {isAdmin && (
            <>
              <button className="btn" onClick={onClone}><i className="ti ti-copy" /> Clone</button>
              <button className="btn primary" onClick={onSave} disabled={saving || locked}>
                <i className="ti ti-device-floppy" /> Save permissions
              </button>
            </>
          )}
        </>
      }
      bodyStyle={{ padding: 0 }}
    >
      {locked && (
        <div className="tip" style={{ margin: 14, marginBottom: 0 }}>
          <i className="ti ti-shield-star" /> Super Admin always has full access — this matrix is locked.
        </div>
      )}
      {matrix && (
        <PermMatrix value={matrix} onChange={setMatrix} disabled={locked || !isAdmin} />
      )}
      <div className="muted" style={{ padding: '10px 14px', fontSize: 12 }}>
        "—" means the action does not apply to that module. Approve applies to Invoice, Receipt Approval and Payment only.
      </div>
    </Panel>
  );
}

/* ============================================================
   Tab 4 — Security & Sessions
   ============================================================ */
const SECURITY_DEFAULTS = {
  authPassword: true, authGoogle: false, authMicrosoft: false, authSSO: false, mfaAll: false,
  pwMinLength: 8, pwExpiry: 'never', pwLockout: 5, pwComplexity: 'upper-number',
  // session & access controls (read by the backend)
  singleSession: true, idleMinutes: 0, ipAllowEnabled: false, ipAllowlist: [],
  notifyNewDevice: true, notifyAdminAction: true,
};

function describeAgent(ua) {
  if (!ua) return '—';
  const os = /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
  const br = /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

function SecurityTab({ prefs, savePrefs, isAdmin }) {
  const toast = useToast();
  const [s, setS] = useState({ ...SECURITY_DEFAULTS, ...(prefs.security || {}) });
  const [sessions, setSessions] = useState(null);
  const [failures, setFailures] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (v) => setS((x) => ({ ...x, [key]: v }));

  useEffect(() => {
    api.get('/api/users/sessions/recent').then((d) => setSessions(d.rows || [])).catch(() => setSessions([]));
    api.get('/api/users/login-failures').then((d) => setFailures(d.rows || [])).catch(() => setFailures([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = async () => {
    setSaving(true);
    try {
      await savePrefs({ security: s });
      toast('Security settings saved');
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="grid2eq" style={{ marginBottom: 0 }}>
        <Panel
          title="Authentication methods"
          toolbar={isAdmin ? (
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <i className="ti ti-device-floppy" /> Save
            </button>
          ) : undefined}
        >
          <SwtRow label="Email & password" sub="Primary sign-in method" on={s.authPassword} onChange={() => {}} disabled />
        </Panel>

        <Panel title="Password policy">
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Minimum length">
              <Select value={s.pwMinLength} disabled={!isAdmin} onChange={(v) => set('pwMinLength')(Number(v))}
                options={[{ value: 8, label: '8 characters' }, { value: 10, label: '10 characters' }, { value: 12, label: '12 characters' }]} />
            </Field>
            <Field label="Lockout after failed attempts">
              <Select value={s.pwLockout} disabled={!isAdmin} onChange={(v) => set('pwLockout')(Number(v))}
                options={[{ value: 3, label: '3 attempts' }, { value: 5, label: '5 attempts' }, { value: 10, label: '10 attempts' }]} />
            </Field>
            <Field label="Require complexity">
              <Select value={s.pwComplexity} disabled={!isAdmin} onChange={(v) => set('pwComplexity')(v)}
                options={[{ value: 'upper-number-symbol', label: 'Upper + number + symbol' }, { value: 'upper-number', label: 'Upper + number' }, { value: 'none', label: 'None' }]} />
            </Field>
          </div>
        </Panel>
      </div>

      <Panel
        title="Session & access security"
        toolbar={isAdmin ? (
          <button className="btn primary" onClick={onSave} disabled={saving}><i className="ti ti-device-floppy" /> Save</button>
        ) : undefined}
      >
        <SwtRow label="One active session per user" sub="A new sign-in automatically logs out the previous device" on={s.singleSession} onChange={isAdmin ? set('singleSession') : () => {}} disabled={!isAdmin} />
        <SwtRow label="Email user on new-device sign-in" sub="Alert when an account signs in from an IP not seen before" on={s.notifyNewDevice} onChange={isAdmin ? set('notifyNewDevice') : () => {}} disabled={!isAdmin} />
        <SwtRow label="Email management on admin actions" sub="Role changes and password resets" on={s.notifyAdminAction} onChange={isAdmin ? set('notifyAdminAction') : () => {}} disabled={!isAdmin} />
        <SwtRow label="Restrict logins by IP" sub="Block sign-ins from networks not in the allowlist below" on={s.ipAllowEnabled} onChange={isAdmin ? set('ipAllowEnabled') : () => {}} disabled={!isAdmin} />
        <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 6 }}>
          <Field label="Idle auto-logout">
            <Select value={s.idleMinutes} disabled={!isAdmin} onChange={(v) => set('idleMinutes')(Number(v))}
              options={[{ value: 0, label: 'Off' }, { value: 15, label: '15 minutes' }, { value: 30, label: '30 minutes' }, { value: 60, label: '60 minutes' }]} />
          </Field>
          {s.ipAllowEnabled && (
            <Field label="Allowed IP prefixes (one per line)">
              <textarea rows={2} disabled={!isAdmin} value={(s.ipAllowlist || []).join('\n')}
                onChange={(e) => set('ipAllowlist')(e.target.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))}
                placeholder="178.153." />
            </Field>
          )}
        </div>
      </Panel>

      {failures && failures.length > 0 && (
        <Panel title="Failed sign-in attempts" sub="Recent wrong-password / blocked-IP / unknown-user attempts" bodyStyle={{ padding: 0 }}>
          <table className="tbl">
            <thead><tr><th>Account</th><th>Reason</th><th>IP address</th><th>When</th></tr></thead>
            <tbody>
              {failures.map((x) => (
                <tr key={x.id} style={{ cursor: 'default' }}>
                  <td>{x.display_name || x.username || '—'}</td>
                  <td><Badge tone={x.reason === 'blocked-ip' ? 'red' : 'warn'}>{({ 'bad-password': 'Wrong password', 'unknown-user': 'Unknown user', 'blocked-ip': 'Blocked IP' }[x.reason]) || x.reason || 'Failed'}</Badge></td>
                  <td className="mono">{x.ip || '—'}</td>
                  <td>{fmtDateTime(x.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title="Active sessions & device tracking" sub="Recent sign-ins recorded by the server" bodyStyle={{ padding: 0 }}>
        {!sessions ? (
          <Loader />
        ) : sessions.length === 0 ? (
          <Empty icon="ti-devices" text="No sign-ins recorded yet." />
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>User</th><th>Device / Browser</th><th>IP address</th><th>Signed in</th></tr>
            </thead>
            <tbody>
              {sessions.map((x, i) => (
                <tr key={x.id} style={{ cursor: 'default' }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={x.display_name || x.username} photo={x.photo} />
                      <div>
                        <div style={{ fontWeight: 700 }}>{x.display_name || x.username}</div>
                        <small className="muted">{x.role}</small>
                      </div>
                    </div>
                  </td>
                  <td>{describeAgent(x.user_agent)}</td>
                  <td className="mono">{x.ip || '—'}</td>
                  <td>
                    {fmtDateTime(x.created_at)}
                    {i === 0 && <Badge tone="green" >Latest</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/* ============================================================
   Page
   ============================================================ */
const TABS = [
  { id: 'dir', label: 'User Directory', icon: 'ti-users' },
  { id: 'roles', label: 'Roles', icon: 'ti-id-badge-2' },
  { id: 'perms', label: 'Permissions', icon: 'ti-lock-cog' },
  { id: 'security', label: 'Security & Sessions', icon: 'ti-shield-lock' },
];

export default function Users() {
  const toast = useToast();
  const { can } = usePerms();
  const me = getUser();
  const isAdmin = ['Super Admin', 'Admin'].includes(me?.role);
  const canImpersonate = isAdmin || can('User Management', 'Edit');
  const [tab, setTab] = useState('dir');
  const [prefs, setPrefs] = useState(null);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    api.get('/api/settings/prefs').then((d) => setPrefs(d.prefs || {})).catch(() => setPrefs({}));
    api.get('/api/users').then((d) => setUsers(d.rows || [])).catch(() => {});
  }, [tab]); // refresh counts when switching tabs

  const customRoles = (prefs && prefs.roles) || [];
  const allRoles = [...ROLES, ...customRoles.map((r) => r.name)];

  const savePrefs = async (patch) => {
    await api.put('/api/settings/prefs', patch);
    setPrefs((p) => ({ ...p, ...patch }));
  };
  const saveCustomRoles = (roles) => savePrefs({ roles });

  return (
    <div>
      <div className="set-tabs" style={{ marginBottom: 14, borderRadius: 14, border: '1px solid var(--line)' }}>
        {TABS.map((t) => (
          <div key={t.id} className={`set-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <i className={`ti ${t.icon}`} style={{ marginRight: 6 }} />
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'dir' && <DirectoryTab isAdmin={isAdmin} canImpersonate={canImpersonate} allRoles={allRoles} prefs={prefs || {}} customRoles={customRoles} savePrefs={savePrefs} />}
      {tab === 'roles' && (prefs
        ? <RolesTab users={users} customRoles={customRoles} saveCustomRoles={saveCustomRoles} isAdmin={isAdmin} />
        : <Loader />)}
      {tab === 'perms' && (prefs
        ? <PermissionsTab prefs={prefs} savePrefs={savePrefs} customRoles={customRoles} isAdmin={isAdmin} />
        : <Loader />)}
      {tab === 'security' && (prefs
        ? <SecurityTab prefs={prefs} savePrefs={savePrefs} isAdmin={isAdmin} />
        : <Loader />)}
    </div>
  );
}
