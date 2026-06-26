import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const [info, setInfo] = useState('');
  const [mfaToken, setMfaToken] = useState('');  // set when the account requires a 2FA code
  const [code, setCode] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await api.post('/api/auth/login', { username, password });
      if (res.mfaRequired) { setMfaToken(res.mfaToken); setCode(''); return; }
      setSession(res.token, res.user, res.mustChangePassword);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify2fa = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { token, user, mustChangePassword } = await api.post('/api/auth/login/2fa', { mfaToken, code: code.trim() });
      setSession(token, user, mustChangePassword);
      navigate('/');
    } catch (err) {
      setError(err.message);
      if (/expired/i.test(err.message)) { setMfaToken(''); } // go back to password
    } finally {
      setBusy(false);
    }
  };

  const forgot = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!username.trim()) { setError('Enter your username or email first, then click "Forgot password?"'); return; }
    try {
      const r = await api.post('/api/auth/forgot-password', { username: username.trim() });
      setInfo(r.message || 'If the account exists, a password-reset link has been emailed.');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-wrap">
      <div className="ls-hero">
        <h1>The future is in your hands. <span className="g">Build it today.</span></h1>
      </div>
      <form className="ls-card" onSubmit={mfaToken ? verify2fa : submit}>
        <img className="logo-img" src="/stimes-logo.svg" alt="Stimes ERP" />
        <h1>{mfaToken ? 'Two-factor verification' : 'Sign in'}</h1>
        <div className="sub">{mfaToken ? 'Enter the 6-digit code from your authenticator app' : 'Welcome back to Stimes ERP'}</div>
        {error && <div className="ls-error"><i className="ti ti-alert-circle" /> {error}</div>}
        {info && <div className="ls-error" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}><i className="ti ti-mail-check" /> {info}</div>}

        {mfaToken ? (
          <>
            <div className="ls-field">
              <i className="ti ti-shield-lock ic" />
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" inputMode="numeric" autoFocus
                style={{ letterSpacing: '0.4em', fontWeight: 700 }} />
            </div>
            <button className="ls-btn" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify'}</button>
            <div className="ls-row" style={{ justifyContent: 'center' }}>
              <a onClick={() => { setMfaToken(''); setError(''); }}>← Back to sign in</a>
            </div>
          </>
        ) : (
          <>
            <div className="ls-field">
              <i className="ti ti-user ic" />
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoFocus />
            </div>
            <div className="ls-field">
              <i className="ti ti-lock ic" />
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
              />
              <button type="button" className="eye" onClick={() => setShow(!show)}>
                <i className={`ti ${show ? 'ti-eye' : 'ti-eye-off'}`} />
              </button>
            </div>
            <div className="ls-row">
              <label><input type="checkbox" defaultChecked /> Remember me</label>
              <a onClick={forgot}>Forgot password?</a>
            </div>
            <button className="ls-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </>
        )}
        <div className="ls-foot">© 2026 Stimes Innovations</div>
      </form>
    </div>
  );
}
