import React, { useState } from 'react';
import { api, clearMustChange } from '../api';
import { useToast, Modal, Field } from './ui';

/** Blocking modal shown when the logged-in user must change a temporary password. */
export default function ForcePassword({ onDone }) {
  const toast = useToast();
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pw.next) { toast('Enter a new password'); return; }
    if (pw.next !== pw.confirm) { toast('Passwords do not match'); return; }
    setBusy(true);
    try {
      // current password isn't required to be re-entered here; use a sentinel the backend accepts?
      // backend change-password needs the current password, so ask for it too.
      await api.post('/api/auth/change-password', { currentPassword: pw.current, newPassword: pw.next });
      clearMustChange();
      toast('Password updated');
      onDone();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Set a new password"
      onClose={() => {}}
      width={420}
      footer={<button className="btn primary" onClick={submit} disabled={busy}><i className="ti ti-key" /> Update password</button>}
    >
      <div className="tip" style={{ marginBottom: 12 }}>
        <i className="ti ti-shield-lock" /> Your password is temporary. Please set a new one to continue.
      </div>
      <div className="fgrid" style={{ gridTemplateColumns: '1fr' }}>
        <Field label="Current / temporary password" required>
          <input type="password" value={pw.current || ''} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} autoFocus />
        </Field>
        <Field label="New password" required>
          <input type="password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" required>
          <input type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}
