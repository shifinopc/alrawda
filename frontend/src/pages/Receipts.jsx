import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtMoney, fmtDate, fmtDateTimeOr0, todayStr, toInputDate, downloadPdf, getUser } from '../api';
import { useToast, useConfirm, Badge, Panel, Field, Empty, PrintStyle, usePaper, Pager, Drawer, Loader } from '../components/ui';
import ReceiptVoucher from '../components/ReceiptVoucher';
import DocTimeline from '../components/DocTimeline';
import { usePerms } from '../permissions';
import { docNo, useDocNo } from '../docNumber';
import FilterBuilder, { condVal, condRange, condMode } from '../components/FilterBuilder';

const RECEIPT_FILTERS = [
  { key: 'recNo', label: 'Rec No', op: 'contains', match: true, type: 'text', icon: 'ti-receipt', placeholder: 'e.g. 12748 or RCT-2026-07-0009' },
  { key: 'invoiceNo', label: 'Invoice No', op: 'contains', match: true, type: 'text', icon: 'ti-file-invoice', placeholder: 'e.g. 8466 or INV-26-0001' },
  { key: 'customer', label: 'Customer', op: 'contains', type: 'text', icon: 'ti-user', placeholder: 'name' },
  { key: 'dateRange', label: 'Date', type: 'daterange', icon: 'ti-calendar' },
];

// map a formatted doc-number query to the raw stored number (drop prefix + leading zeros)
// so "INV-26-0001"/"RCT-2026-07-0009" match, not just the plain sequence
const docNumSearchValue = (q) => {
  const m = String(q || '').trim().match(/(\d+)\s*$/);
  return m ? String(parseInt(m[1], 10)) : String(q || '').trim();
};

const receiptStatusTone = (s) => (s === 'Approved' ? 'green' : 'blue');

/* Searchable invoice picker — type to filter open invoices by no / customer / balance. */
function InvoiceCombo({ invoices, value, onSelect, error }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const label = (i) => `${docNo('invoice', i.InvoiceNo, i.InvoiceDate)} — ${i.CustomerName} (balance QAR ${fmtMoney(i.balance)})`;
  const sel = invoices.find((i) => String(i.InvoiceCode) === String(value));

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? invoices.filter((i) => label(i).toLowerCase().includes(needle))
    : invoices;

  const pick = (i) => { onSelect(i); setOpen(false); setQ(''); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (open && filtered[active]) { e.preventDefault(); pick(filtered[active]); } }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={boxRef} className="combo">
      <input
        type="text"
        className={error ? 'invalid' : undefined}
        value={open ? q : (sel ? label(sel) : '')}
        placeholder="— Search & select open invoice —"
        onFocus={() => { setOpen(true); setQ(''); setActive(0); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKey}
        autoComplete="off"
      />
      {open && (
        <div className="combo-pop">
          {filtered.length === 0 ? (
            <div className="combo-empty">No matching open invoice</div>
          ) : filtered.map((i, idx) => (
            <div
              key={i.InvoiceCode}
              className={`combo-opt${idx === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(idx)}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
            >
              {label(i)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const blankForm = () => ({
  invoiceCode: '',
  receiptDate: todayStr(),
  receivedAmount: '',
  paymentMode: 'Cash',
  bank: '',
  chequeNo: '',
  roomDetails: '',
  passengerDetails: '',
  remarks: '',
});

// Build the Passenger Details text from an invoice's passengers: "NAME — Visa Type" per line
// (the visa-required flag is shown on the invoice only, not on the receipt).
const paxDetailsText = (passengers) => (passengers || [])
  .filter((p) => (p.PassengerName || '').trim())
  .map((p) => {
    const nm = p.PassengerName.trim();
    const vt = (p.VisaType || '').trim();
    return vt ? `${nm} — ${vt}` : nm;
  })
  .join('\n');


const DetailCell = ({ label, children }) => (
  <div>
    <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
    <b>{children ?? '—'}</b>
  </div>
);

export default function Receipts() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = usePerms();
  useDocNo();
  const isAdmin = ['Super Admin', 'Admin'].includes(getUser()?.role);

  /* ---- list ---- */
  const [sp] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [conds, setConds] = useState(() => {
    const c = sp.get('customer');
    return c ? [{ id: 'init-customer', field: 'customer', value: c }] : [];
  });
  useEffect(() => {
    const c = sp.get('customer');
    if (!c) return;
    setConds((cur) => (cur.some((x) => x.field === 'customer')
      ? cur.map((x) => (x.field === 'customer' ? { ...x, value: c } : x))
      : [...cur, { id: `sp-customer-${Date.now()}`, field: 'customer', value: c }]));
  }, [sp]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  /* ---- right side ---- */
  const [view, setView] = useState('form'); // 'form' | 'preview'
  const [showDeleted, setShowDeleted] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [editing, setEditing] = useState(false); // editing an existing receipt
  const [editCode, setEditCode] = useState(null);
  const [sel, setSel] = useState(null); // selected receipt row (preview)
  const [invAmount, setInvAmount] = useState(null); // NetAmount of selected receipt's invoice
  const [invPassengers, setInvPassengers] = useState([]); // invoice passengers (with visa type) for the voucher
  const [invRemarks, setInvRemarks] = useState(''); // invoice remark, shown on the receipt voucher
  const [templates, setTemplates] = useState({ print: null, receipt: null }); // Settings → templates
  const [paper, setPaper] = usePaper();

  useEffect(() => {
    api.get('/api/settings/prefs')
      .then((d) => setTemplates({ print: d.prefs?.printTemplate || {}, receipt: d.prefs?.receiptTemplate || {} }))
      .catch(() => setTemplates({ print: {}, receipt: {} }));
  }, []);
  const [nextNo, setNextNo] = useState(null);
  const [openInvoices, setOpenInvoices] = useState([]);
  const [form, setForm] = useState(blankForm());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(null);

  const openHistory = async () => {
    if (!sel) return;
    setShowHistory(true);
    setHistory(null);
    try {
      const d = await api.get(`/api/receipts/${sel.RecieptCode}/history`);
      setHistory(d.events || []);
    } catch (e) {
      toast(e.message);
      setHistory([]);
    }
  };

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const selInvoice = openInvoices.find((i) => String(i.InvoiceCode) === String(form.invoiceCode));
  const prevBalance = editing && sel ? Number(sel.PreBalanceAmount) || 0 : (selInvoice ? Number(selInvoice.balance) || 0 : 0);
  const liveBalance = prevBalance - (Number(form.receivedAmount) || 0);
  const selStatus = sel ? (sel.status || 'Open') : null;
  const selLocked = sel && selStatus !== 'Open' && !isAdmin;

  const fetchList = useCallback(async () => {
    setListLoading(true);
    try {
      const p = new URLSearchParams();
      const recNo = condVal(conds, 'recNo'); if (recNo) { p.set('recNo', docNumSearchValue(recNo)); if (condMode(conds, 'recNo') === 'equals') p.set('recNoMode', 'equals'); }
      const invoiceNo = condVal(conds, 'invoiceNo'); if (invoiceNo) { p.set('invoiceNo', docNumSearchValue(invoiceNo)); if (condMode(conds, 'invoiceNo') === 'equals') p.set('invoiceNoMode', 'equals'); }
      const dr = condRange(conds, 'dateRange'); if (dr.from) p.set('from', dr.from); if (dr.to) p.set('to', dr.to);
      const customer = condVal(conds, 'customer'); if (customer) p.set('customer', customer);
      p.set('deleted', showDeleted ? '1' : '0');
      p.set('pageSize', String(pageSize));
      p.set('page', String(page));
      const d = await api.get(`/api/receipts?${p.toString()}`);
      setRows(d.rows || []);
      setTotal(d.total || 0);
    } catch (e) {
      toast(e.message);
    } finally {
      setListLoading(false);
    }
  }, [conds, page, showDeleted, toast]);

  useEffect(() => { setPage(1); }, [conds]);

  /* debounce list fetch on filter change */
  useEffect(() => {
    const t = setTimeout(fetchList, 300);
    return () => clearTimeout(t);
  }, [fetchList]);

  const refreshFormData = async () => {
    try {
      const [nn, oi] = await Promise.all([
        api.get('/api/receipts/next-no'),
        api.get('/api/masters/open-invoices'),
      ]);
      setNextNo(nn.next);
      setOpenInvoices(oi.rows || []);
    } catch (e) {
      toast(e.message);
    }
  };

  useEffect(() => {
    refreshFormData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectRow = (r) => {
    setSel(r);
    setView('preview');
    setInvAmount(null);
    setInvPassengers([]);
    setInvRemarks('');
    if (r.InvoiceCode) {
      api.get(`/api/invoices/${r.InvoiceCode}`)
        .then((d) => { setInvAmount(d.invoice?.NetAmount ?? null); setInvPassengers(d.passengers || []); setInvRemarks((d.invoice?.Remarks || '').trim()); })
        .catch(() => {});
    }
  };

  const startNew = () => {
    setEditing(false);
    setEditCode(null);
    setForm(blankForm());
    setView('form');
    refreshFormData();
  };

  const startEdit = () => {
    if (!sel) return;
    setEditing(true);
    setEditCode(sel.RecieptCode);
    setForm({
      invoiceCode: sel.InvoiceCode,
      receiptDate: toInputDate(sel.RecieptDate),
      receivedAmount: sel.RecievedAmount,
      paymentMode: sel.PaymentMode || 'Cash',
      bank: sel.Bank || '',
      chequeNo: sel.ChequeNo || '',
      roomDetails: sel.RoomDetails || '',
      passengerDetails: sel.PassengerDetails || '',
      remarks: sel.InvRemarks || '',
    });
    setErrors({});
    setView('form');
    // older receipts were saved without passenger details — backfill from the invoice
    if (!(sel.PassengerDetails || '').trim() && sel.InvoiceCode) {
      api.get(`/api/invoices/${sel.InvoiceCode}`)
        .then((d) => {
          const text = paxDetailsText(d.passengers);
          if (text) setForm((f) => ({ ...f, passengerDetails: f.passengerDetails || text }));
        })
        .catch(() => {});
    }
  };

  const cancelForm = () => {
    setEditing(false);
    setEditCode(null);
    if (sel) setView('preview');
    else setForm(blankForm());
  };

  const removeReceipt = async () => {
    if (!sel) return;
    if (!(await confirm({
      title: 'Move to recycle bin?',
      message: `Receipt ${docNo('receipt', sel.RecieptNo, sel.RecieptDate)} will be moved to the recycle bin. The invoice balance is restored.`,
      confirmText: 'Move to bin', danger: true,
    }))) return;
    try {
      await api.del(`/api/receipts/${sel.RecieptCode}`);
      toast('Receipt moved to recycle bin');
      startNew();
      await fetchList();
    } catch (e) {
      toast(e.message);
    }
  };

  const restoreReceipt = async (code, e) => {
    if (e) e.stopPropagation();
    try {
      await api.post(`/api/receipts/${code}/restore`);
      toast('Receipt restored');
      await fetchList();
    } catch (err) {
      toast(err.message);
    }
  };

  const save = async () => {
    const amt = Number(form.receivedAmount);
    const errs = {};
    if (!form.invoiceCode) errs.invoiceCode = 'Please select an invoice';
    if (!form.receiptDate) errs.receiptDate = 'Receipt date is required';
    if (!Number.isFinite(amt) || amt < 0) errs.receivedAmount = 'Enter a valid amount (0 or more)';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    const payload = {
      invoiceCode: form.invoiceCode,
      receiptDate: form.receiptDate,
      receivedAmount: amt,
      paymentMode: form.paymentMode,
      bank: form.paymentMode === 'Bank' ? form.bank : '',
      chequeNo: form.paymentMode === 'Bank' ? form.chequeNo : '',
      roomDetails: form.roomDetails,
      passengerDetails: form.passengerDetails,
      remarks: form.remarks,
    };
    if (editing && editCode) {
      try {
        await api.put(`/api/receipts/${editCode}`, payload);
        toast(`Receipt ${sel.RecieptNo} updated`);
        const d = await api.get(`/api/receipts/${editCode}`);
        setEditing(false);
        setEditCode(null);
        setForm(blankForm());
        if (d.receipt) selectRow(d.receipt);
        await fetchList();
      } catch (e) {
        toast(e.message);
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const res = await api.post('/api/receipts', payload);
      toast(`Receipt ${res.receiptNo} saved`);
      const inv = selInvoice || {};
      setSel({
        RecieptCode: res.receiptCode,
        RecieptNo: res.receiptNo,
        RecieptDate: form.receiptDate,
        InvoiceCode: form.invoiceCode,
        InvoiceNo: inv.InvoiceNo,
        RecievedAmount: amt,
        PreBalanceAmount: res.preBalance,
        CurrentBalanceAmount: res.currentBalance,
        PaymentMode: form.paymentMode,
        Bank: form.paymentMode === 'Bank' ? form.bank : '',
        ChequeNo: form.paymentMode === 'Bank' ? form.chequeNo : '',
        RoomDetails: form.roomDetails,
        PassengerDetails: form.passengerDetails,
        InvRemarks: form.remarks,
        status: 'Open',
        CustomerName: inv.CustomerName,
        Mobile1: inv.Mobile1,
        DepartureDate: inv.DepartureDate,
        PassengerCount: inv.PassengerCount,
        PackageName: inv.PackageName,
        Nationality: inv.Nationality,
      });
      setInvAmount(inv.NetAmount ?? null);
      setView('preview');
      setForm(blankForm());
      await fetchList();
      refreshFormData();
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const roInput = (val) => <input readOnly value={val ?? ''} />;

  return (
    <div className="split">
      {/* ============ LEFT: list ============ */}
      <Panel
        className="col-list col-list-wide"
        title={showDeleted ? 'Recycle Bin' : 'Receipt List'}
        toolbar={
          <>
            {can('Receipt', 'Delete') && (
              <button
                className={`btn sm${showDeleted ? ' primary' : ''}`}
                onClick={() => { setShowDeleted(!showDeleted); startNew(); }}
                title="Deleted receipts"
              >
                <i className="ti ti-trash" /> {showDeleted ? 'Back to list' : 'Recycle bin'}
              </button>
            )}
            <button className="iconbtn" title="Refresh" onClick={fetchList}>
              <i className="ti ti-refresh" />
            </button>
          </>
        }
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <FilterBuilder fields={RECEIPT_FILTERS} conds={conds} setConds={setConds} />
        <div className="scroller">
          {listLoading ? (
            <Loader />
          ) : rows.length === 0 ? (
            <Empty icon="ti-receipt" text="No receipts found" />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Rec No</th>
                  <th>Invoice No</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.RecieptCode}
                    className={view === 'preview' && sel && sel.RecieptCode === r.RecieptCode ? 'sel' : ''}
                    onClick={() => !showDeleted && selectRow(r)}
                    style={showDeleted ? { cursor: 'default' } : undefined}
                  >
                    <td>{docNo('receipt', r.RecieptNo, r.RecieptDate, r.CreatedAt)}</td>
                    <td>{r.InvoiceNo ? docNo('invoice', r.InvoiceNo, r.InvoiceDate, r.InvoiceCreatedAt) : '—'}</td>
                    <td>{fmtDateTimeOr0(r.CreatedAt, r.RecieptDate)}</td>
                    <td>{r.CustomerName}</td>
                    <td className="num" onClick={(e) => showDeleted && e.stopPropagation()}>
                      {fmtMoney(r.RecievedAmount)}
                      <div style={{ marginTop: 3 }}>
                        {showDeleted ? (
                          <button className="btn sm" onClick={(e) => restoreReceipt(r.RecieptCode, e)} title="Restore">
                            <i className="ti ti-arrow-back-up" /> Restore
                          </button>
                        ) : (
                          <Badge tone={receiptStatusTone(r.status)}>{r.status}</Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </Panel>

      {/* ============ RIGHT ============ */}
      <div className="col-detail">
        {view === 'form' ? (
          <Panel
            title={editing ? `Edit Receipt ${sel ? docNo('receipt', sel.RecieptNo, sel.RecieptDate) : ''}` : 'Receipt — Create'}
            toolbar={
              <>
                <button className="btn primary" onClick={startNew}><i className="ti ti-plus" /> New</button>
                <button className="btn success" disabled={saving} onClick={save}><i className="ti ti-device-floppy" /> {editing ? 'Update' : 'Save'}</button>
                <button className="btn" onClick={cancelForm}>Cancel</button>
              </>
            }
          >
            <div className="fgrid">
              <Field label="Receipt No">
                <input readOnly value={editing ? (sel ? docNo('receipt', sel.RecieptNo, sel.RecieptDate) : '') : `Auto — ${nextNo ?? '...'}`} />
              </Field>
              <Field label="Receipt Date" required error={errors.receiptDate}>
                <input type="date" value={form.receiptDate} onChange={(e) => set('receiptDate', e.target.value)} />
              </Field>
              <Field label="Select Invoice" required error={errors.invoiceCode}>
                {editing ? (
                  <input readOnly value={`${sel?.InvoiceNo ? docNo('invoice', sel.InvoiceNo) : ''} — ${sel?.CustomerName ?? ''}`} />
                ) : (
                  <InvoiceCombo
                    invoices={openInvoices}
                    value={form.invoiceCode}
                    error={errors.invoiceCode}
                    onSelect={(inv) => {
                      setForm((f) => ({ ...f, invoiceCode: String(inv.InvoiceCode), receivedAmount: Number(inv.balance) }));
                      setErrors((er) => ({ ...er, invoiceCode: undefined, receivedAmount: undefined }));
                      // pre-fill passenger + room details from the invoice
                      api.get(`/api/invoices/${inv.InvoiceCode}`)
                        .then((d) => {
                          // receipt Room Details holds the full descriptor: "Normal" / "Separate - 2 BEDS" / "Nil"
                          const rtype = (d.invoice?.RoomType || '').trim();
                          const rdet = (d.invoice?.RoomDetails || '').trim();
                          const room = rtype && rdet ? `${rtype} - ${rdet}` : (rtype || rdet);
                          setForm((f) => ({
                            ...f,
                            passengerDetails: paxDetailsText(d.passengers),
                            roomDetails: room,
                            remarks: f.remarks || (d.invoice?.Remarks || '').trim(),
                          }));
                        })
                        .catch(() => {});
                    }}
                  />
                )}
              </Field>

              <Field label="Customer Name">{roInput((editing ? sel?.CustomerName : selInvoice?.CustomerName))}</Field>
              <Field label="Nationality">{roInput((editing ? sel?.Nationality : selInvoice?.Nationality))}</Field>
              <Field label="Package">{roInput((editing ? sel?.PackageName : selInvoice?.PackageName))}</Field>
              {(() => {
                const src = editing ? sel : selInvoice; // agent shows only when the invoice has "Show agent" on
                return src && src.ShowAgent && src.AgentName ? (
                  <Field label="Agent">{roInput(`${src.AgentName}${src.AgentMobile ? ` (${src.AgentMobile})` : ''}`)}</Field>
                ) : null;
              })()}

              <Field label="Mobile No 1">{roInput((editing ? sel?.Mobile1 : selInvoice?.Mobile1))}</Field>
              <Field label="Departure Date">{roInput((editing ? (sel?.DepartureDate ? fmtDate(sel.DepartureDate) : '') : (selInvoice ? fmtDate(selInvoice.DepartureDate) : '')))}</Field>
              <Field label="No. of Passengers">{roInput((editing ? sel?.PassengerCount : selInvoice?.PassengerCount))}</Field>

              <Field label="Room Details" className="full">
                <input value={form.roomDetails} onChange={(e) => set('roomDetails', e.target.value)} />
              </Field>
              <Field label="Passenger Details" className="full">
                <textarea value={form.passengerDetails} onChange={(e) => set('passengerDetails', e.target.value)} />
              </Field>
            </div>

            {/* payment section */}
            <div style={{ fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, margin: '18px 0 8px', paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              Payment
            </div>
            <div className="fgrid">
              <Field label="Mode of Payment">
                <div className="radios">
                  {['Cash', 'Bank'].map((m) => (
                    <label key={m}>
                      <input
                        type="radio"
                        name="paymentMode"
                        checked={form.paymentMode === m}
                        onChange={() => set('paymentMode', m)}
                      />
                      {m}
                    </label>
                  ))}
                </div>
              </Field>
              {form.paymentMode === 'Bank' && (
                <>
                  <Field label="Bank name">
                    <input value={form.bank} onChange={(e) => set('bank', e.target.value)} />
                  </Field>
                  <Field label="Cheque No">
                    <input value={form.chequeNo} onChange={(e) => set('chequeNo', e.target.value)} />
                  </Field>
                </>
              )}
              <Field label="Remarks" className="full">
                <textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
              </Field>
            </div>

            <div className="totalbar" style={{ marginTop: 14, borderRadius: 10 }}>
              <div className="tcell">
                <small>Invoice Amount</small>
                <b>QAR {fmtMoney(selInvoice ? selInvoice.NetAmount : 0)}</b>
              </div>
              <div className="tcell">
                <small>Previous Balance</small>
                <b>QAR {fmtMoney(prevBalance)}</b>
              </div>
              <div className="tcell">
                <small>Received Amount *</small>
                <input
                  type="number"
                  min="0"
                  value={form.receivedAmount}
                  onChange={(e) => set('receivedAmount', e.target.value)}
                  style={{ width: 130, textAlign: 'right', borderRadius: 8, padding: '5px 8px', fontWeight: 700,
                    border: `1px solid ${errors.receivedAmount ? '#b3261e' : 'var(--line)'}`,
                    boxShadow: errors.receivedAmount ? '0 0 0 2px rgba(179,38,30,.12)' : 'none' }}
                />
                {errors.receivedAmount && <span className="field-err"><i className="ti ti-alert-circle" /> {errors.receivedAmount}</span>}
              </div>
              <div className="tcell">
                <small>Balance</small>
                <b style={{ color: 'var(--accent2)' }}>QAR {fmtMoney(liveBalance)}</b>
              </div>
            </div>
          </Panel>
        ) : (
          sel && (
            <Panel
              title={
                <span>
                  Receipt Preview{' '}
                  <Badge tone={receiptStatusTone(sel.status)}>{sel.status}</Badge>
                </span>
              }
              toolbar={
                <>
                  <button className="btn primary" onClick={startNew}><i className="ti ti-plus" /> New receipt</button>
                  {can('Receipt', 'Edit') && !selLocked && (
                    <button className="btn" onClick={startEdit}><i className="ti ti-pencil" /> Edit</button>
                  )}
                  <button className="btn" onClick={openHistory}><i className="ti ti-history" /> History</button>
                  <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" /> Print</button>
                  {can('Receipt', 'Delete') && !selLocked && (
                    <button className="btn danger" onClick={removeReceipt}><i className="ti ti-trash" /> Delete</button>
                  )}
                </>
              }
            >
              <PrintStyle id="rec-print" paper={paper} />
              <div id="rec-print">
                <ReceiptVoucher r={sel} invoiceAmount={invAmount} passengers={invPassengers} invoiceRemarks={invRemarks} printTemplate={templates.print} receiptTemplate={templates.receipt} />
              </div>
            </Panel>
          )
        )}
      </div>

      {showHistory && sel && (
        <Drawer title={`History — Receipt ${docNo('receipt', sel.RecieptNo, sel.RecieptDate)}`} onClose={() => setShowHistory(false)}>
          <DocTimeline events={history} />
        </Drawer>
      )}
    </div>
  );
}
