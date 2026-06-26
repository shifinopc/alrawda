import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ---- Select: searchable dropdown (replaces native <select>) ----
   Usage: <Select value={v} onChange={(val)=>...} options={[{value,label}] | ['a','b']} placeholder="…" />
   - onChange receives the VALUE (not an event)
   - portal popup (never clipped), type-to-search, keyboard nav */
export function Select({ value, onChange, options = [], placeholder = 'Select…', disabled, className, style }) {
  const norm = options.map((o) => (o && typeof o === 'object' ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: String(o) }));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(0);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const sel = norm.find((o) => String(o.value) === String(value));

  const close = () => { setOpen(false); setPos(null); setQ(''); };
  const openIt = () => {
    if (disabled) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: Math.round(r.bottom + 4), left: Math.round(r.left), width: Math.round(r.width) });
    setOpen(true); setActive(0);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return; close(); };
    // keep the popup glued to its button as the page scrolls — but DON'T close when the
    // user is scrolling inside the option list itself (that was making it vanish mid-scroll)
    const reposition = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) { close(); return; } // anchor scrolled off-screen
      setPos({ top: Math.round(r.bottom + 4), left: Math.round(r.left), width: Math.round(r.width) });
    };
    const onScroll = (e) => { if (menuRef.current && menuRef.current.contains(e.target)) return; reposition(); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const filtered = needle ? norm.filter((o) => o.label.toLowerCase().includes(needle)) : norm;
  const pick = (o) => { onChange(o.value); close(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) pick(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <>
      <button
        type="button" ref={btnRef} disabled={disabled}
        className={`selbtn${className ? ` ${className}` : ''}`} style={style}
        onClick={() => (open ? close() : openIt())}
      >
        <span className={sel ? 'selval' : 'selph'}>{sel ? sel.label : placeholder}</span>
        <i className="ti ti-chevron-down selarrow" />
      </button>
      {open && pos && createPortal(
        <div
          className="combo-pop selpop" ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 200), right: 'auto', zIndex: 1000 }}
        >
          {norm.length > 1 && (
            <input
              ref={inputRef} className="selsearch" value={q} placeholder="Search…"
              onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
            />
          )}
          <div className="seloptions">
            {filtered.length === 0 ? (
              <div className="combo-empty">No matches</div>
            ) : filtered.map((o, i) => (
              <div
                key={String(o.value)}
                className={`combo-opt${i === active ? ' active' : ''}${String(o.value) === String(value) ? ' picked' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              >
                {o.label}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ---- Toasts ---- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

// Errors and successes share the same call site (`toast(msg)`), so we colour-code
// by reading the message when an explicit tone isn't passed — a green tick means
// "it worked", a red alert means "it didn't", so the user never has to guess.
const ERR_RE = /\b(fail|failed|error|cannot|can't|could not|exceed|exceeds|required|invalid|denied|not allowed|must|already|no permission|don't have|expired|wrong|incorrect|missing|unable|not found|too (long|short|weak)|reject)/i;
const OK_RE = /\b(created|updated|saved|approved|deleted|restored|processed|success|sent|added|removed|locked|adjusted|booked|returned|reset|changed|enabled|disabled|copied|exported|welcome)/i;
function inferTone(msg) {
  const s = String(msg || '');
  if (ERR_RE.test(s)) return 'err';
  if (OK_RE.test(s)) return 'ok';
  return 'info';
}
const TONE_ICON = { ok: 'ti-circle-check', err: 'ti-alert-triangle', info: 'ti-info-circle' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((msg, tone) => {
    const id = Math.random().toString(36).slice(2);
    const t = tone || inferTone(msg);
    setToasts((cur) => [...cur, { id, msg, tone: t }]);
    // errors linger longer so they can be read; successes clear quickly
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), t === 'err' ? 6000 : 3400);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toastwrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismiss(t.id)} title="Dismiss">
            <i className={`ti ${TONE_ICON[t.tone]}`} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---- Badge ---- */
export const Badge = ({ tone = 'blue', children }) => (
  <span className={`badge ${tone}`}>{children}</span>
);

/* ---- Panel ---- */
export const Panel = ({ title, sub, toolbar, children, className = '', bodyStyle }) => (
  <div className={`panel ${className}`}>
    {(title || toolbar) && (
      <div className="panelhead">
        <div>
          {title}
          {sub && <small style={{ display: 'block' }}>{sub}</small>}
        </div>
        {toolbar && <div className="toolbar">{toolbar}</div>}
      </div>
    )}
    <div className="panelbody" style={bodyStyle}>{children}</div>
  </div>
);

/* ---- Field ---- */
export const Field = ({ label, required, children, className = '', error }) => (
  <div className={`field ${className} ${error ? 'invalid' : ''}`}>
    {label && <label>{label}{required && <span className="req"> *</span>}</label>}
    {children}
    {error && <span className="field-err"><i className="ti ti-alert-circle" /> {error}</span>}
  </div>
);

/* ---- Confirm dialog (branded replacement for window.confirm) ---- */
const ConfirmCtx = createContext(() => Promise.resolve(false));
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { opts, resolve }
  const [promptVal, setPromptVal] = useState('');
  const confirm = useCallback(
    (opts) => new Promise((resolve) => {
      setPromptVal('');
      setState({ opts: typeof opts === 'string' ? { message: opts } : (opts || {}), resolve });
    }),
    []
  );
  const close = (val) => { if (state) state.resolve(val); setState(null); };
  const o = state?.opts || {};
  // when a prompt is requested, confirm resolves with the entered text (or false if cancelled)
  const isPrompt = !!o.prompt;
  const promptInvalid = isPrompt && o.promptRequired && !promptVal.trim();
  const onConfirm = () => close(isPrompt ? promptVal.trim() : true);
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <div className="mov" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="modal confirm-modal" style={{ width: 440 }}>
            <div className="mhead">
              <i className={`ti ${o.danger ? 'ti-alert-triangle' : 'ti-help-circle'}`}
                 style={{ marginRight: 8, color: o.danger ? '#b3261e' : 'var(--accent)' }} />
              {o.title || 'Please confirm'}
            </div>
            <div className="mbody">
              {o.message}
              {isPrompt && (
                <input
                  autoFocus
                  style={{ width: '100%', marginTop: 12, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', outline: 'none', background: 'var(--panel, #fff)', color: 'var(--ink)', boxSizing: 'border-box' }}
                  placeholder={typeof o.prompt === 'string' ? o.prompt : 'Reason'}
                  value={promptVal}
                  onChange={(e) => setPromptVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !promptInvalid) onConfirm(); }}
                />
              )}
            </div>
            <div className="mfoot">
              <button className="btn" onClick={() => close(false)}>{o.cancelText || 'Cancel'}</button>
              <button className={`btn ${o.danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={promptInvalid} autoFocus={!isPrompt}>
                {o.confirmText || (o.danger ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ---- Modal ---- */
export function Modal({ title, onClose, footer, children, width }) {
  return (
    <div className="mov" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={width ? { width } : undefined}>
        <div className="mhead">
          {title}
          <button className="iconbtn" style={{ marginLeft: 'auto' }} onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="mbody">{children}</div>
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---- Drawer ---- */
export function Drawer({ title, onClose, children }) {
  return (
    <>
      <div className="drawer-ov" onMouseDown={onClose} />
      <div className="drawer">
        <div className="dhead">
          {title}
          <button className="iconbtn" style={{ marginLeft: 'auto' }} onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="dbody">{children}</div>
      </div>
    </>
  );
}

/* ---- Print isolation: prints only #id, collapses the app layout so it fits the page.
       paper: 'a4' | 'a5' (A5 compresses the voucher typography to fit the smaller sheet). ---- */
export const PrintStyle = ({ id, paper = 'a4', landscape = false }) => (
  <style>{`@media print {
    .topbar, .tabsbar, .sidebar, .col-list, .filterrow, .panelhead, .toolbar, .toastwrap, .tip { display: none !important; }
    .shell, .body { display: block !important; height: auto !important; }
    .main { padding: 0 !important; overflow: visible !important; }
    .split { display: block !important; }
    .col-detail { width: 100% !important; }
    .panel { border: 0 !important; border-radius: 0 !important; }
    .panelbody { padding: 0 !important; }
    body * { visibility: hidden; }
    #${id}, #${id} * { visibility: visible; }
    #${id} { position: absolute; left: 0; top: 0; width: 100%; padding: ${paper === 'a5' ? '1mm 5mm' : '1.5mm 7mm'}; box-sizing: border-box; }
    @page { size: ${paper === 'a5' ? 'A5' : 'A4'} ${landscape ? 'landscape' : 'portrait'}; margin: 0; }
    ${paper === 'a5' ? `
    #${id} .rcv { font-size: 10.5px; }
    #${id} .rcv-head { gap: 8px; padding-bottom: 6px; }
    #${id} .rcv-logo { width: 52px; height: 52px; }
    #${id} .rcv-ar-title { font-size: 15.5px; }
    #${id} .rcv-en-title { font-size: 13px; }
    #${id} .rcv-contact { font-size: 8.5px; }
    #${id} .rcv-titleband { gap: 7px; margin-bottom: 8px; }
    #${id} .rcv-doc { font-size: 12.5px; }
    #${id} .rcv-chip, #${id} .rcv-chip-num { font-size: 11px; padding: 2px 9px; }
    #${id} .rcv-mode { font-size: 10px; }
    #${id} .rcv-meta { font-size: 10px; }
    #${id} .rcv-amount { padding: 5px 12px; margin-bottom: 8px; font-size: 11px; }
    #${id} .rcv-amount b { font-size: 17px; }
    #${id} .rcv-grid { gap: 5px 8px; margin-bottom: 7px; }
    #${id} .rcv-cell { padding: 3px 8px; }
    #${id} .rcv-lbl { font-size: 8px; }
    #${id} .rcv-lbl .rcv-rtl { font-size: 9px; }
    #${id} .rcv-val { font-size: 11px; }
    #${id} .rcv-counts { gap: 6px; margin-bottom: 7px; }
    #${id} .rcv-counts > div { padding: 3px 8px; }
    #${id} .rcv-counts small { font-size: 8px; }
    #${id} .rcv-counts b { font-size: 13px; }
    #${id} .rcv-sec { font-size: 11px; margin: 6px 0 4px; }
    #${id} .rcv-table th { padding: 3px 7px; font-size: 8px; }
    #${id} .rcv-table td { padding: 3px 7px; font-size: 10px; }
    #${id} .rcv-sumrow { gap: 5px; margin: 6px 0; }
    #${id} .rcv-sumrow > div { padding: 3px 7px; }
    #${id} .rcv-sumrow small { font-size: 7.5px; }
    #${id} .rcv-sumrow b { font-size: 11px; }
    #${id} .rcv-split { gap: 8px; }
    #${id} .rcv-pax { padding: 3px 8px; }
    #${id} .rcv-paxline { font-size: 10px; padding: 1px 0; }
    #${id} .rcv-totals { min-width: 180px; gap: 4px; }
    #${id} .rcv-totals .row { padding: 4px 9px; font-size: 9.5px; }
    #${id} .rcv-totals .row b { font-size: 12px; }
    #${id} .rcv-notes { font-size: 8px; padding: 4px 9px; margin-top: 6px; line-height: 1.5; }
    #${id} .rcv-sigs { gap: 20px; margin: 16mm 0 8px; }
    #${id} .rcv-sigs > div { font-size: 9.5px; }
    #${id} .rcv-foot { font-size: 10.5px; padding: 4px; }
    #${id} .rcv-cases { font-size: 9px; padding: 4px 0 0; }
    #${id} .rcv-printmeta { font-size: 8px; margin-top: 5px; }
    ` : ''}
  }`}</style>
);

/* ---- A5/A4 paper toggle (persisted) for printable documents ---- */
export function usePaper() {
  const [paper, setPaper] = useState(() => localStorage.getItem('print_paper') || 'a5');
  const update = (p) => { setPaper(p); localStorage.setItem('print_paper', p); };
  return [paper, update];
}

export const PaperToggle = ({ value, onChange }) => (
  <div style={{ display: 'flex', gap: 4 }} title="Print paper size">
    {['a5', 'a4'].map((p) => (
      <button key={p} className={`btn sm${value === p ? ' primary' : ''}`} onClick={() => onChange(p)}>
        {p.toUpperCase()}
      </button>
    ))}
  </div>
);

/* ---- Pager: Prev/Next page control ---- */
export const Pager = ({ page, pageSize, total, onPage }) => {
  if (!total || total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="pagebar">
      <span className="muted">{from}–{to} of {total.toLocaleString()}</span>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <i className="ti ti-chevron-left" /> Prev
      </button>
      <span className="muted" style={{ fontWeight: 700 }}>{page} / {pages}</span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next <i className="ti ti-chevron-right" />
      </button>
    </div>
  );
};

/* ---- Empty state ---- */
export const Empty = ({ icon = 'ti-inbox', text }) => (
  <div className="empty">
    <i className={`ti ${icon}`} style={{ fontSize: 34, display: 'block', marginBottom: 8 }} />
    {text}
  </div>
);

/* ---- Loader (animated spinner) ---- */
export const Loader = ({ text = 'Loading…' }) => (
  <div className="loader"><span className="spinner" />{text && <span>{text}</span>}</div>
);
