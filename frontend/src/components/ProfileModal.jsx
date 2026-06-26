import React, { useEffect, useState } from 'react';
import { api, getUser, getToken, setSession, fmtDate } from '../api';
import { Modal, Field, useToast, Loader } from './ui';

/** "My Profile" — view & edit own details + change password (any signed-in user). */
export default function ProfileModal({ onClose, onSaved }) {
  const toast = useToast();
  const [u, setU] = useState(null);
  const [form, setForm] = useState({ displayName: '', email: '', mobile: '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/users/me')
      .then((d) => {
        setU(d.user);
        setForm({ displayName: d.user.display_name || '', email: d.user.email || '', mobile: d.user.mobile || '' });
      })
      .catch((e) => toast(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!form.displayName.trim()) { toast('Full name is required'); return; }
    setBusy(true);
    try {
      const r = await api.put('/api/users/me', form);
      const cur = getUser();
      if (cur) setSession(getToken(), { ...cur, name: r.displayName }); // refresh header name
      toast('Profile updated');
      onSaved && onSaved(r.displayName);
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  const changePw = async () => {
    if (!pw.current || !pw.next) { toast('Enter your current and new password'); return; }
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: pw.current, newPassword: pw.next });
      toast('Password changed');
      setPw({ current: '', next: '' });
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  return (
    <Modal
      title="My Profile"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" disabled={busy || !u} onClick={save}>
            <i className="ti ti-device-floppy" /> Save changes
          </button>
        </>
      }
    >
      {!u ? <Loader /> : (
        <>
          <div className="msection">Account</div>
          <div className="pgrid" style={{ marginBottom: 16 }}>
            <div className="pitem"><small>Username</small><b>{u.username}</b></div>
            <div className="pitem"><small>Role</small><b>{u.role}</b></div>
            <div className="pitem"><small>Status</small><b>{u.status || 'Active'}</b></div>
            <div className="pitem"><small>Last login</small><b>{u.last_login ? fmtDate(u.last_login) : '—'}</b></div>
          </div>

          <div className="msection">Details</div>
          <div className="fgrid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <Field label="Full name" required>
              <input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
            </Field>
            <Field label="Mobile">
              <input value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} />
            </Field>
            <Field label="Email" className="full">
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
          </div>

          <div className="msection" style={{ marginTop: 16 }}>Change password</div>
          <div className="fgrid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <Field label="Current password">
              <input type="password" autoComplete="current-password" value={pw.current}
                onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
            </Field>
            <Field label="New password">
              <input type="password" autoComplete="new-password" value={pw.next}
                onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
            </Field>
            <div className="full">
              <button className="btn" disabled={busy} onClick={changePw}>
                <i className="ti ti-key" /> Update password
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
