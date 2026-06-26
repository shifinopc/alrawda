import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtDate } from '../api';

/**
 * Dynamic condition-chip filter (Linear/Notion style).
 *
 * Props:
 *  - fields: [{ key, label, op, type:'text'|'date'|'select', icon?, options?, placeholder? }]
 *  - conds:  [{ id, field, value }]  (controlled)
 *  - setConds: state setter for conds
 *
 * Each chip's value is written live into `conds`, so multiple filters apply together.
 * Enter/blur just closes a chip's editor (an empty chip is dropped).
 */
export function condVal(conds, key) {
  const c = (conds || []).find((x) => x.field === key && String(x.value ?? '').trim() !== '');
  return c ? String(c.value).trim() : '';
}

// for a 'daterange' field → { from, to }
export function condRange(conds, key) {
  const c = (conds || []).find((x) => x.field === key && x.value && typeof x.value === 'object');
  return { from: c?.value?.from || '', to: c?.value?.to || '' };
}

// match mode for a text field that opted in with { match: true }: 'equals' | 'contains'
// (defaults to 'equals' — precise match unless the chip explicitly chose 'contains')
export function condMode(conds, key) {
  const c = (conds || []).find((x) => x.field === key && String(x.value ?? '').trim() !== '');
  return c?.mode === 'contains' ? 'contains' : 'equals';
}

// selectable match modes shown in the operator dropdown
const MATCH_MODES = [
  { key: 'contains', label: 'Contains', icon: 'ti-letter-case', hint: 'matches anywhere' },
  { key: 'equals', label: 'Equals', icon: 'ti-equal', hint: 'exact match' },
];

export default function FilterBuilder({ fields, conds, setConds }) {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  const [adding, setAdding] = useState(false);
  const [menuPos, setMenuPos] = useState(null); // {top,left} for the portal dropdown
  const [editId, setEditId] = useState(null); // which chip is showing its editor
  const [opMenu, setOpMenu] = useState(null); // { id, top, left } — operator dropdown for a chip
  const ref = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const opMenuRef = useRef(null);

  const closeMenu = () => { setAdding(false); setMenuPos(null); };
  const openMenu = () => {
    if (adding) { closeMenu(); return; }
    const r = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: Math.round(r.bottom + 4), left: Math.round(r.left) });
    setAdding(true);
  };

  useEffect(() => {
    if (!adding) return undefined;
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      closeMenu();
    };
    // follow the button on page scroll, but don't close when scrolling inside the menu list
    const reposition = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) { closeMenu(); return; }
      setMenuPos({ top: Math.round(r.bottom + 4), left: Math.round(r.left) });
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
  }, [adding]);

  // operator (match-mode) dropdown, anchored under the clicked operator pill
  const openOpMenu = (e, id) => {
    if (opMenu?.id === id) { setOpMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setOpMenu({ id, top: Math.round(r.bottom + 4), left: Math.round(r.left) });
  };
  useEffect(() => {
    if (!opMenu) return undefined;
    const onDoc = (e) => { if (!opMenuRef.current?.contains(e.target)) setOpMenu(null); };
    // ignore scrolls inside the little menu; close on page scroll/resize (it's a tiny anchored list)
    const close = () => setOpMenu(null);
    const onScroll = (e) => { if (opMenuRef.current && opMenuRef.current.contains(e.target)) return; close(); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [opMenu]);

  const newId = (key) => `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const add = (key) => {
    const def = byKey[key];
    closeMenu();
    const id = newId(key);
    const value = def.type === 'select' ? (def.options?.[0] ?? '') : def.type === 'daterange' ? { from: '', to: '' } : '';
    const mode = def.match ? 'equals' : undefined; // default precise match; switchable to contains
    setConds((c) => [...c, { id, field: key, value, mode }]);
    // text/date open an inline editor; select/daterange are usable immediately
    setEditId(def.type === 'select' ? null : id);
  };

  // values are written LIVE into each condition, so multiple filters coexist
  // (server pages debounce their reload, so this doesn't spam the API)
  const setVal = (id, value) => setConds((c) => c.map((x) => (x.id === id ? { ...x, value } : x)));
  const setMode = (id, mode) => setConds((c) => c.map((x) => (x.id === id ? { ...x, mode } : x)));
  const setRange = (id, part, v) => setConds((c) => c.map((x) => (x.id === id ? { ...x, value: { ...(x.value || {}), [part]: v } } : x)));
  const removeCond = (id) => { setConds((c) => c.filter((x) => x.id !== id)); if (editId === id) setEditId(null); };
  // leaving the editor just closes it — the chip stays (even if blank) so adding another
  // filter never drops the previous one; use the × (or Esc) to remove a chip.
  const stopEdit = () => setEditId(null);

  const disp = (c) => (byKey[c.field]?.type === 'date' ? fmtDate(c.value) : c.value);

  return (
    <div className="fbar" ref={ref}>
      {conds.map((c) => {
        const def = byKey[c.field];
        if (!def) return null;
        const editing = editId === c.id;
        return (
          <span className="fchip" key={c.id}>
            {def.icon && <i className={`ti ${def.icon}`} style={{ fontSize: 14, color: 'var(--accent)' }} />}
            <span className="fk">{def.label}</span>
            {def.type === 'daterange' ? (
              <>
                <input type="date" title="From date" value={c.value?.from || ''} onChange={(e) => setRange(c.id, 'from', e.target.value)} />
                <span className="fop">–</span>
                <input type="date" title="To date" value={c.value?.to || ''} onChange={(e) => setRange(c.id, 'to', e.target.value)} />
              </>
            ) : (
              <>
                {def.match ? (
                  <button
                    type="button" className={`fop fop-toggle${opMenu?.id === c.id ? ' open' : ''}`}
                    title="Choose how to match" onClick={(e) => openOpMenu(e, c.id)}
                  >
                    {c.mode === 'equals' ? 'equals' : 'contains'}
                    <i className="ti ti-chevron-down" style={{ fontSize: 11, marginLeft: 2 }} />
                  </button>
                ) : (
                  <span className="fop">{def.op}</span>
                )}
                {editing ? (
                  def.type === 'select' ? (
                    <select autoFocus value={c.value} onChange={(e) => setVal(c.id, e.target.value)} onBlur={() => setEditId(null)}>
                      {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      autoFocus type={def.type === 'date' ? 'date' : 'text'} value={c.value || ''}
                      placeholder={def.placeholder}
                      onChange={(e) => setVal(c.id, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') stopEdit(c.id); if (e.key === 'Escape') removeCond(c.id); }}
                      onBlur={() => stopEdit(c.id)}
                    />
                  )
                ) : (
                  <b className="fv" onClick={() => setEditId(c.id)} title="Edit">{disp(c) || '—'}</b>
                )}
              </>
            )}
            <button type="button" onClick={() => removeCond(c.id)} title="Remove filter"><i className="ti ti-x" style={{ fontSize: 13 }} /></button>
          </span>
        );
      })}

      <button type="button" className="faddbtn" ref={btnRef} onClick={openMenu}>
        <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add filter
      </button>

      {conds.length > 0 && (
        <button type="button" className="fclear" onClick={() => { setConds([]); setEditId(null); }}>Clear all</button>
      )}

      {adding && menuPos && createPortal(
        <div
          className="combo-pop fb-menu" ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, right: 'auto', width: 200, zIndex: 1000 }}
        >
          {fields.map((f) => (
            <div key={f.key} className="combo-opt" onMouseDown={(e) => { e.preventDefault(); add(f.key); }}>
              {f.icon && <i className={`ti ${f.icon}`} style={{ marginRight: 8, color: 'var(--accent)' }} />}{f.menuLabel || f.label}
            </div>
          ))}
        </div>,
        document.body
      )}

      {opMenu && createPortal(
        <div
          className="combo-pop fb-menu" ref={opMenuRef}
          style={{ position: 'fixed', top: opMenu.top, left: opMenu.left, right: 'auto', width: 184, zIndex: 1001 }}
        >
          {MATCH_MODES.map((m) => {
            const cur = conds.find((x) => x.id === opMenu.id);
            const active = (cur?.mode === 'equals' ? 'equals' : 'contains') === m.key;
            return (
              <div
                key={m.key} className={`combo-opt${active ? ' picked' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); setMode(opMenu.id, m.key); setOpMenu(null); }}
              >
                <i className={`ti ${m.icon}`} style={{ marginRight: 8, color: 'var(--accent)' }} />
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                  {m.label}<small style={{ color: 'var(--muted)', fontWeight: 500 }}>{m.hint}</small>
                </span>
                {active && <i className="ti ti-check" style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
