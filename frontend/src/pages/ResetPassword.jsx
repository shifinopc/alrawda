import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export default function ResetPassword() {
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!token) { setError('This reset link is invalid. Please request a new one from the sign-in page.'); return; }
    if (pw.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (pw !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const r = await api.post('/api/auth/reset-password', { token, newPassword: pw });
      setInfo(r.message || 'Your password has been reset. Redirecting to sign in…');
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="ls-hero">
        <h1>Set a new password. <span className="g">Secure your account.</span></h1>
      </div>
      <form className="ls-card" onSubmit={submit}>
        <img className="logo-img" src="/stimes-logo.svg" alt="Stimes ERP" />
        <h1>Reset password</h1>
        <div className="sub">Choose a new password for your account</div>
        {error && <div className="ls-error"><i className="ti ti-alert-circle" /> {error}</div>}
        {info && <div className="ls-error" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}><i className="ti ti-circle-check" /> {info}</div>}
        {!info && (
          <>
            <div className="ls-field">
              <i className="ti ti-lock ic" />
              <input
                type={show ? 'text' : 'password'}
                value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder="New password" autoFocus
              />
              <button type="button" className="eye" onClick={() => setShow(!show)}>
                <i className={`ti ${show ? 'ti-eye' : 'ti-eye-off'}`} />
              </button>
            </div>
            <div className="ls-field">
              <i className="ti ti-lock-check ic" />
              <input
                type={show ? 'text' : 'password'}
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>
            <button className="ls-btn" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button>
          </>
        )}
        <div className="ls-row" style={{ justifyContent: 'center', marginTop: 6 }}>
          <a onClick={() => navigate('/login')}>Back to sign in</a>
        </div>
        <div className="ls-foot">© 2026 Stimes Innovations</div>
      </form>
    </div>
  );
}
