import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtMoney, fmtDate, fmtDateTime } from '../api';
import { Select, useToast, useConfirm, Panel, Field, Empty, Loader, Modal, Pager } from '../components/ui';
import { usePerms } from '../permissions';
import { docNo, useDocNo } from '../docNumber';
import FilterBuilder, { condVal, condRange, condMode } from '../components/FilterBuilder';

const PAGE_SIZE = 50;

const ADJ_FILTERS = [
  { key: 'invNo', label: 'Invoice No', op: 'contains', match: true, type: 'text', icon: 'ti-file-invoice', placeholder: 'e.g. 8466' },
  { key: 'customer', label: 'Customer', op: 'contains', type: 'text', icon: 'ti-user', placeholder: 'name' },
  { key: 'dateRange', label: 'Date', type: 'daterange', icon: 'ti-calendar' },
];

const REASONS = [
  'Uncollectable balance — write-off',
  'Goodwill / discount',
  'Customer dispute settled',
  'Bank charge / rounding',
  'Other',
];

export default function Adjustment() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = usePerms();
  useDocNo();
  const canAdjust = can('Invoice Adjustment', 'Create');

  const [rows, setRows] = useState(null);       // adjustable bills
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState(null);  // adjustments already made
  const [conds, setConds] = useState([]);
  const [sel, setSel] = useState(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  // detail/edit modal for an existing adjustment
  const [viewAdj, setViewAdj] = useState(null);
  const [edit, setEdit] = useState({ amount: '', reason: '', remarks: '' });
  const openAdj = (a) => { setViewAdj(a); setEdit({ amount: a.amount, reason: a.reason || REASONS[0], remarks: a.remarks || '' }); };

  const loadBills = useCallback(async () => {
    setRows(null);
    try {
      const p = new URLSearchParams({ pendingOnly: '1', approved: '1', page: String(page), pageSize: String(PAGE_SIZE) });
      const invNo = condVal(conds, 'invNo'); if (invNo) { p.set('invNo', invNo); if (condMode(conds, 'invNo') === 'equals') p.set('invNoMode', 'equals'); }
      const customer = condVal(conds, 'customer'); if (customer) p.set('customer', customer);
      const dr = condRange(conds, 'dateRange'); if (dr.from) p.set('from', dr.from); if (dr.to) p.set('to', dr.to);
      const d = await api.get(`/api/invoices?${p.toString()}`);
      setRows(d.rows || []);
      setTotal(d.total || 0);
    } catch (e) { toast(e.message); setRows([]); }
  }, [conds, page, toast]);

  const loadHistory = useCallback(async () => {
    try {
      const d = await api.get('/api/adjustments');
      setHistory(d.rows || []);
    } catch { setHistory([]); }
  }, []);

  // bills filter is debounced; search matches either invoice no or customer (OR is handled per-field server side,
  // so we send the same term to both and de-dupe client side)
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(loadBills, 300);
    return () => clearTimeout(timer.current);
  }, [loadBills]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { setPage(1); }, [conds]);

  const bills = (rows || []).filter((r, i, a) => a.findIndex((x) => x.InvoiceCode === r.InvoiceCode) === i);

  const pick = (r) => { setSel(r); setAmount(''); setReason(REASONS[0]); setRemarks(''); };

  const balance = Number(sel?.balance || 0);
  const amt = Number(amount) || 0;
  const after = balance - amt;

  const onAmount = (e) => {
    let v = e.target.value;
    if (v !== '' && Number(v) > balance) v = String(balance);
    if (v !== '' && Number(v) < 0) v = '0';
    setAmount(v);
  };

  const proceed = async () => {
    if (!sel || amt <= 0 || amt > balance || busy) return;
    if (!(await confirm({
      title: 'Apply adjustment?',
      message: `QAR ${fmtMoney(amt)} will be written off Invoice ${docNo('invoice', sel.InvoiceNo, sel.InvoiceDate, sel.CreatedAt)} (${sel.CustomerName}). New balance: QAR ${fmtMoney(after)}${after <= 0 ? ' — Fully Paid' : ''}.`,
      confirmText: 'Apply',
    }))) return;
    setBusy(true);
    try {
      const r = await api.post('/api/adjustments', { invoiceCode: sel.InvoiceCode, amount: amt, reason, remarks });
      toast(`Invoice ${docNo('invoice', sel.InvoiceNo, sel.InvoiceDate, sel.CreatedAt)} adjusted — new balance QAR ${fmtMoney(r.newBalance)}`);
      setSel(null); setAmount(''); setRemarks('');
      await Promise.all([loadBills(), loadHistory()]);
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  const saveEdit = async () => {
    const v = Number(edit.amount);
    if (!(v > 0)) { toast('Amount must be greater than zero'); return; }
    setBusy(true);
    try {
      const r = await api.put(`/api/adjustments/${viewAdj.id}`, { amount: v, reason: edit.reason, remarks: edit.remarks });
      toast(`Adjustment updated — Invoice ${docNo('invoice', viewAdj.InvoiceNo, viewAdj.InvoiceDate, viewAdj.InvCreatedAt)} balance QAR ${fmtMoney(r.newBalance)}`);
      setViewAdj(null);
      await Promise.all([loadBills(), loadHistory()]);
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  const deleteAdj = async () => {
    if (!viewAdj) return;
    if (!(await confirm({
      title: 'Remove adjustment?',
      message: `The QAR ${fmtMoney(viewAdj.amount)} write-off on Invoice ${docNo('invoice', viewAdj.InvoiceNo, viewAdj.InvoiceDate, viewAdj.InvCreatedAt)} will be reversed and the balance restored.`,
      confirmText: 'Remove', danger: true,
    }))) return;
    setBusy(true);
    try {
      await api.del(`/api/adjustments/${viewAdj.id}`);
      toast('Adjustment removed — invoice balance restored');
      setViewAdj(null);
      await Promise.all([loadBills(), loadHistory()]);
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="split">
      {/* LEFT — adjustable bills */}
      <Panel
        className="col-list col-list-wide"
        title="Bills to adjust"
        sub="Approved invoices with a pending balance"
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <FilterBuilder fields={ADJ_FILTERS} conds={conds} setConds={setConds} />
        <div className="scroller">
          {rows === null ? <Loader /> : bills.length === 0 ? (
            <Empty icon="ti-file-invoice" text="No bills with a pending balance." />
          ) : (
            <table className="tbl">
              <thead><tr><th>Inv No</th><th>Customer</th><th className="num">Balance due</th></tr></thead>
              <tbody>
                {bills.map((r) => (
                  <tr key={r.InvoiceCode} className={sel?.InvoiceCode === r.InvoiceCode ? 'sel' : ''} onClick={() => pick(r)}>
                    <td>{docNo('invoice', r.InvoiceNo, r.InvoiceDate, r.CreatedAt)}</td>
                    <td>{r.CustomerName}</td>
                    <td className="num"><b style={{ color: 'var(--red)' }}>{fmtMoney(r.balance)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      </Panel>

      {/* RIGHT — adjustment form (top) + adjustments already made (below) */}
      <div className="col-detail" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
        {!sel ? (
          <Panel title="Invoice Adjustment">
            <Empty icon="ti-adjustments" text="Select a bill on the left to write off part of its balance." />
          </Panel>
        ) : (
          <Panel title={`Adjust Invoice ${docNo('invoice', sel.InvoiceNo, sel.InvoiceDate, sel.CreatedAt)} · ${sel.CustomerName}`} bodyStyle={{ padding: 0 }}>
            <div className="totalbar" style={{ borderTop: 0, borderBottom: '1px solid var(--line)' }}>
              <div className="tcell"><small>Invoice (net)</small><b>QAR {fmtMoney(sel.NetAmount)}</b></div>
              <div className="tcell"><small>Already paid</small><b>QAR {fmtMoney(sel.received)}</b></div>
              <div className="tcell"><small>Pending</small><b style={{ color: 'var(--red)' }}>QAR {fmtMoney(sel.balance)}</b></div>
            </div>
            <div style={{ padding: 16 }}>
              <div className="fgrid">
                <Field label="Adjustment amount (QAR)" required>
                  <input type="number" min="0" max={balance} step="0.01" value={amount} onChange={onAmount} placeholder="0.00" />
                </Field>
                <Field label="Reason" required>
                  <Select value={reason} onChange={setReason} options={REASONS} />
                </Field>
                <Field label="Remarks" className="full">
                  <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional note — appended to the invoice remarks" />
                </Field>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
                <span className="muted" style={{ fontWeight: 700 }}>
                  Balance after adjustment:{' '}
                  <span style={{ color: after <= 0 ? 'var(--green)' : 'var(--ink)' }}>QAR {fmtMoney(after)}</span>
                  {after <= 0 && amt > 0 && ' — invoice will be marked Fully Paid'}
                </span>
                {canAdjust ? (
                  <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={amt <= 0 || amt > balance || busy} onClick={proceed}>
                    <i className="ti ti-scale" /> Apply adjustment
                  </button>
                ) : (
                  <span className="muted" style={{ marginLeft: 'auto' }}><i className="ti ti-lock" /> No permission to adjust invoices</span>
                )}
              </div>
            </div>
          </Panel>
        )}

        <Panel
          title="Adjustments made"
          sub="Recent write-offs (applied immediately)"
          bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <div className="scroller">
            {history === null ? <Loader /> : history.length === 0 ? (
              <Empty icon="ti-history" text="No adjustments recorded yet." />
            ) : (
              <table className="tbl">
                <thead>
                  <tr><th>Inv No</th><th>Customer</th><th>Reason</th><th className="num">Amount</th><th>By</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {history.map((a) => (
                    <tr key={a.id} onClick={() => openAdj(a)} style={{ cursor: 'pointer' }} title="View / edit">
                      <td>{docNo('invoice', a.InvoiceNo, a.InvoiceDate, a.InvCreatedAt)}</td>
                      <td>{a.CustomerName}</td>
                      <td>{a.reason || '—'}{a.remarks ? ` · ${a.remarks}` : ''}</td>
                      <td className="num">{fmtMoney(a.amount)}</td>
                      <td>{a.created_by_name || '—'}</td>
                      <td>{fmtDateTime(a.approved_at || a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      </div>

      {viewAdj && (
        <Modal
          title={`Adjustment · Invoice ${docNo('invoice', viewAdj.InvoiceNo, viewAdj.InvoiceDate, viewAdj.InvCreatedAt)}`}
          onClose={() => setViewAdj(null)}
          width={460}
          footer={
            <>
              {canAdjust && (
                <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={deleteAdj}>
                  <i className="ti ti-trash" /> Delete
                </button>
              )}
              <button className="btn" onClick={() => setViewAdj(null)}>Close</button>
              {canAdjust && (
                <button className="btn primary" disabled={busy} onClick={saveEdit}>
                  <i className="ti ti-device-floppy" /> Update
                </button>
              )}
            </>
          }
        >
          <div className="msection">Invoice details</div>
          <div className="pgrid" style={{ marginBottom: 16 }}>
            <div className="pitem"><small>Customer</small><b>{viewAdj.CustomerName}</b></div>
            <div className="pitem"><small>Current balance</small><b>QAR {fmtMoney(viewAdj.balance)}</b></div>
            <div className="pitem"><small>Applied by</small><b>{viewAdj.created_by_name || '—'}</b></div>
            <div className="pitem"><small>Applied on</small><b>{fmtDateTime(viewAdj.approved_at || viewAdj.created_at)}</b></div>
          </div>
          <div className="msection">Adjustment</div>
          <div className="fgrid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <Field label="Amount (QAR)" required>
              <input type="number" min="0" step="0.01" value={edit.amount} disabled={!canAdjust}
                onChange={(e) => setEdit((x) => ({ ...x, amount: e.target.value }))} />
            </Field>
            <Field label="Reason" required>
              <Select value={edit.reason} disabled={!canAdjust}
                onChange={(v) => setEdit((x) => ({ ...x, reason: v }))}
                options={[...REASONS, ...(!REASONS.includes(edit.reason) && edit.reason ? [edit.reason] : [])]} />
            </Field>
            <Field label="Remarks" className="full">
              <textarea value={edit.remarks} disabled={!canAdjust} placeholder="Optional note"
                onChange={(e) => setEdit((x) => ({ ...x, remarks: e.target.value }))} />
            </Field>
          </div>
          {!canAdjust && <div className="muted" style={{ marginTop: 8 }}><i className="ti ti-lock" /> You don't have permission to edit adjustments.</div>}
        </Modal>
      )}
    </div>
  );
}
