import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtMoney, fmtDate, fmtDateTimeOr0, toInputDate, todayStr, downloadPdf, getUser } from '../api';
import { Select, useToast, useConfirm, Badge, Panel, Field, Empty, PrintStyle, PaperToggle, usePaper, Pager, Drawer, Loader } from '../components/ui';
import PaymentVoucher from '../components/PaymentVoucher';
import DocTimeline from '../components/DocTimeline';
import { usePerms } from '../permissions';
import { docNo, useDocNo } from '../docNumber';
import FilterBuilder, { condVal, condRange, condMode } from '../components/FilterBuilder';

const PAYMENT_FILTERS = [
  { key: 'payNo', label: 'Payment No', op: 'contains', match: true, type: 'text', icon: 'ti-businessplan', placeholder: 'e.g. 1023' },
  { key: 'payee', label: 'Payee', op: 'contains', type: 'text', icon: 'ti-user', placeholder: 'name' },
  { key: 'dateRange', label: 'Date', type: 'daterange', icon: 'ti-calendar' },
];

const REFUND_REASONS = [
  'Service not provided / shortfall',
  'Invoice cancelled',
  'Overpayment returned',
  'Goodwill',
  'Other',
];

const blankForm = () => ({
  paymentDate: todayStr(),
  type: 'Expense',
  paidTo: '',
  mobileNo: '',
  narration: '',
  amount: '',
  mode: 'Cash',
  reason: REFUND_REASONS[0],
  cancelInvoice: false,
  remarks: '',
});

export default function Payments() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = usePerms();
  useDocNo();
  const isAdmin = ['Super Admin', 'Admin'].includes(getUser()?.role);

  /* ---- list ---- */
  const [sp] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [conds, setConds] = useState(() => {
    const p = sp.get('payee');
    return p ? [{ id: 'init-payee', field: 'payee', value: p }] : [];
  });
  useEffect(() => {
    const p = sp.get('payee');
    if (!p) return;
    setConds((cur) => (cur.some((x) => x.field === 'payee')
      ? cur.map((x) => (x.field === 'payee' ? { ...x, value: p } : x))
      : [...cur, { id: `sp-payee-${Date.now()}`, field: 'payee', value: p }]));
  }, [sp]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const pageSize = 50;
  const listTimer = useRef(null);

  /* ---- form ---- */
  const [sel, setSel] = useState(null); // selected payment row → read-only preview
  const [editing, setEditing] = useState(false); // editing the selected payment
  const [form, setForm] = useState(blankForm);
  const [nextNo, setNextNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState({ print: null, payment: null });
  const [paper, setPaper] = usePaper();
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(null);

  const openHistory = async () => {
    if (!sel) return;
    setShowHistory(true);
    setHistory(null);
    try {
      const d = await api.get(`/api/payments/${sel.PaymentCode}/history`);
      setHistory(d.events || []);
    } catch (e) {
      toast(e.message);
      setHistory([]);
    }
  };

  useEffect(() => {
    api.get('/api/settings/prefs')
      .then((d) => setTemplates({ print: d.prefs?.printTemplate || {}, payment: d.prefs?.paymentTemplate || {} }))
      .catch(() => setTemplates({ print: {}, payment: {} }));
  }, []);

  /* ---- refund invoice picker ---- */
  const [inv, setInv] = useState(null); // {InvoiceCode, InvoiceNo, CustomerName, net, paid, pending}
  const [invSearch, setInvSearch] = useState('');
  const [invResults, setInvResults] = useState([]);
  const invTimer = useRef(null);

  const ro = !!sel && !editing; // read-only preview mode (selected and not editing)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const selStatus = sel ? (sel.ApprovalStatus || 'Approved') : null;
  const selLocked = sel && selStatus === 'Approved' && !isAdmin; // approved → locked for non-admins

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const p = new URLSearchParams({ deleted: showDeleted ? '1' : '0', page: String(page), pageSize: String(pageSize) });
      const payNo = condVal(conds, 'payNo'); if (payNo) { p.set('payNo', payNo); if (condMode(conds, 'payNo') === 'equals') p.set('payNoMode', 'equals'); }
      const payee = condVal(conds, 'payee'); if (payee) p.set('payee', payee);
      const dr = condRange(conds, 'dateRange'); if (dr.from) p.set('from', dr.from); if (dr.to) p.set('to', dr.to);
      const d = await api.get(`/api/payments?${p.toString()}`);
      setRows(d.rows || []);
      setTotal(d.total || 0);
    } catch (e) {
      toast(e.message);
    } finally {
      setListLoading(false);
    }
  }, [conds, showDeleted, page, toast]);

  useEffect(() => { setPage(1); }, [conds, showDeleted]);

  const loadNextNo = useCallback(async () => {
    try {
      const d = await api.get('/api/payments/next-no');
      setNextNo(d.next);
    } catch {
      setNextNo('');
    }
  }, []);

  useEffect(() => {
    clearTimeout(listTimer.current);
    listTimer.current = setTimeout(loadList, 350);
    return () => clearTimeout(listTimer.current);
  }, [loadList]);

  useEffect(() => { loadNextNo(); }, [loadNextNo]);

  /* debounced invoice search for the refund picker */
  useEffect(() => {
    clearTimeout(invTimer.current);
    const q = invSearch.trim();
    if (!q || ro) { setInvResults([]); return undefined; }
    invTimer.current = setTimeout(async () => {
      try {
        const byNo = /^\d/.test(q);
        const d = await api.get(
          `/api/invoices?invNo=${byNo ? encodeURIComponent(q) : ''}&customer=${byNo ? '' : encodeURIComponent(q)}&pageSize=30`
        );
        setInvResults(d.rows || []);
      } catch {
        setInvResults([]);
      }
    }, 350);
    return () => clearTimeout(invTimer.current);
  }, [invSearch, ro]);

  const resetForm = () => {
    setSel(null);
    setEditing(false);
    setForm(blankForm());
    setInv(null);
    setInvSearch('');
    setInvResults([]);
  };

  const selectRow = (r) => {
    setSel(r);
    setForm({
      paymentDate: toInputDate(r.PaymentDate),
      type: r.TypeOfPayment,
      paidTo: r.PaidTo || '',
      mobileNo: r.MobileNo || '',
      narration: r.Narration || '',
      amount: r.PaymentAmount,
      mode: 'Cash',
      reason: REFUND_REASONS.includes(r.Narration) ? r.Narration : REFUND_REASONS[4],
      cancelInvoice: !!r.IsInvoiceCancel,
      remarks: r.Remark || '',
    });
    if (r.TypeOfPayment === 'Refund' && r.InvoiceCode) {
      const net = Number(r.InvoiceAmount || 0);
      const paid = Number(r.CollectedAmount || 0);
      setInv({
        InvoiceCode: r.InvoiceCode,
        InvoiceNo: r.InvoiceNo,
        InvoiceDate: r.InvoiceDate,
        CreatedAt: r.InvoiceCreatedAt,
        CustomerName: r.CustomerName,
        net,
        paid,
        pending: net - paid,
      });
    } else {
      setInv(null);
    }
    setInvSearch('');
    setInvResults([]);
  };

  const pickInvoice = (r) => {
    setInv({
      InvoiceCode: r.InvoiceCode,
      InvoiceNo: r.InvoiceNo,
      InvoiceDate: r.InvoiceDate,
      CreatedAt: r.CreatedAt,
      CustomerName: r.CustomerName,
      net: Number(r.NetAmount || 0),
      paid: Number(r.received || 0),
      pending: Number(r.balance || 0),
    });
    setInvSearch('');
    setInvResults([]);
  };

  const onCancelToggle = (checked) => {
    setForm((f) => ({
      ...f,
      cancelInvoice: checked,
      amount: checked && inv ? inv.paid : f.amount,
    }));
  };

  const amt = Number(form.amount) || 0;
  const canSave =
    !ro &&
    !busy &&
    form.paymentDate &&
    // an expense must be positive; a refund may be zero (e.g. cancel invoice, nothing collected)
    (form.type === 'Refund' ? amt >= 0 : amt > 0) &&
    (form.type === 'Expense' ? form.paidTo.trim() !== '' : !!inv);

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const body =
        form.type === 'Expense'
          ? {
              type: 'Expense',
              paymentDate: form.paymentDate,
              paidTo: form.paidTo.trim(),
              mobileNo: form.mobileNo,
              narration: form.narration,
              amount: amt,
              remarks: form.remarks,
            }
          : {
              type: 'Refund',
              paymentDate: form.paymentDate,
              invoiceCode: inv.InvoiceCode,
              mobileNo: form.mobileNo,
              amount: amt,
              reason: form.reason,
              remarks: form.remarks,
              cancelInvoice: form.cancelInvoice,
            };
      if (editing && sel) {
        await api.put(`/api/payments/${sel.PaymentCode}`, body);
        toast(`Payment ${sel.PaymentNo} updated`);
      } else {
        const res = await api.post('/api/payments', body);
        toast(`Payment ${res.paymentNo} saved`);
      }
      resetForm();
      await Promise.all([loadList(), loadNextNo()]);
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  const startEdit = () => { if (sel) setEditing(true); };

  const approve = async () => {
    if (!sel || busy) return;
    if (!(await confirm({
      title: 'Approve payment?',
      message: `Payment ${sel.PaymentNo} will be approved and locked. This can't be undone by non-admins.`,
      confirmText: 'Approve',
    }))) return;
    setBusy(true);
    try {
      await api.post(`/api/payments/${sel.PaymentCode}/approve`);
      toast(`Payment ${sel.PaymentNo} approved`);
      resetForm();
      await loadList();
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!sel || busy) return;
    if (!(await confirm({
      title: 'Move to recycle bin?',
      message: `Payment ${sel.PaymentNo} will be moved to the recycle bin. You can restore it later.`,
      confirmText: 'Move to bin', danger: true,
    }))) return;
    setBusy(true);
    try {
      await api.del(`/api/payments/${sel.PaymentCode}`);
      toast(`Payment ${sel.PaymentNo} moved to recycle bin`);
      resetForm();
      await Promise.all([loadList(), loadNextNo()]);
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  const restore = async (code, no) => {
    setBusy(true);
    try {
      await api.post(`/api/payments/${code}/restore`);
      toast(`Payment ${no} restored`);
      await loadList();
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  return (
    <div>
      <div className="split">
        {/* LEFT — payment list */}
        <div className="panel col-list col-list-wide">
          <div className="panelhead">
            {showDeleted ? 'Recycle Bin' : 'Payment List'}
            <button
              className={`btn sm${showDeleted ? ' primary' : ''}`}
              style={{ marginLeft: 'auto' }}
              onClick={() => { setShowDeleted(!showDeleted); resetForm(); }}
              title="Deleted payments"
            >
              <i className="ti ti-trash" /> {showDeleted ? 'Back to list' : 'Recycle bin'}
            </button>
          </div>
          <FilterBuilder fields={PAYMENT_FILTERS} conds={conds} setConds={setConds} />
          <div className="scroller">
            {listLoading ? (
              <Loader />
            ) : rows.length === 0 ? (
              <Empty icon="ti-cash-banknote" text={showDeleted ? 'Recycle bin is empty.' : 'No payments found.'} />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Pay No</th>
                    <th>Date</th>
                    <th>Payee</th>
                    <th className="num">Amount</th>
                    {showDeleted && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.PaymentCode}
                      className={sel?.PaymentCode === r.PaymentCode ? 'sel' : ''}
                      onClick={() => !showDeleted && selectRow(r)}
                      style={showDeleted ? { cursor: 'default' } : undefined}
                    >
                      <td>
                        {docNo('payment', r.PaymentNo, r.PaymentDate, r.CreatedAt)}{' '}
                        {r.TypeOfPayment === 'Refund' ? (
                          <Badge tone="violet">Refund</Badge>
                        ) : (
                          <Badge tone="warn">Expense</Badge>
                        )}
                        {(r.ApprovalStatus || 'Approved') !== 'Approved' && ' '}
                        {(r.ApprovalStatus || 'Approved') !== 'Approved' && <Badge tone="warn">Draft</Badge>}
                      </td>
                      <td>{fmtDateTimeOr0(r.CreatedAt, r.PaymentDate)}</td>
                      <td>{r.TypeOfPayment === 'Refund' ? r.CustomerName : r.PaidTo}</td>
                      <td className="num">{fmtMoney(r.PaymentAmount)}</td>
                      {showDeleted && (
                        <td onClick={(e) => e.stopPropagation()}>
                          {can('Payment', 'Delete') && (
                            <button className="btn sm" disabled={busy} onClick={() => restore(r.PaymentCode, r.PaymentNo)} title="Restore">
                              <i className="ti ti-arrow-back-up" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </div>

        {/* RIGHT — payment form */}
        <div className="col-detail">
          <Panel
            title={sel ? (
              <span>
                {editing ? 'Edit Payment' : 'Payment Preview'}{' '}
                <Badge tone={sel.TypeOfPayment === 'Refund' ? 'violet' : 'warn'}>{sel.TypeOfPayment}</Badge>{' '}
                <Badge tone={selStatus === 'Approved' ? 'green' : 'warn'}>{selStatus === 'Approved' ? 'Approved · Locked' : 'Draft'}</Badge>
              </span>
            ) : 'Payment — New'}
            toolbar={
              <>
                <button className="btn primary sm" onClick={resetForm}>
                  <i className="ti ti-plus" /> New
                </button>
                {!ro && (
                  <button className="btn success sm" disabled={!canSave} onClick={save}>
                    <i className="ti ti-device-floppy" /> {editing ? 'Update' : 'Save'}
                  </button>
                )}
                {ro && (
                  <>
                    {can('Payment', 'Edit') && !selLocked && (
                      <button className="btn sm" onClick={startEdit}>
                        <i className="ti ti-pencil" /> Edit
                      </button>
                    )}
                    {selStatus !== 'Approved' && can('Payment', 'Approve') && (
                      <button className="btn success sm" disabled={busy} onClick={approve}>
                        <i className="ti ti-check" /> Approve
                      </button>
                    )}
                    <button className="btn sm" onClick={openHistory}>
                      <i className="ti ti-history" /> History
                    </button>
                    <PaperToggle value={paper} onChange={setPaper} />
                    <button className="btn sm" onClick={() => downloadPdf('payment', sel.PaymentCode, { paper, filename: `Payment-${sel.PaymentNo}.pdf` }).catch((e) => toast(e.message))}>
                      <i className="ti ti-file-type-pdf" /> PDF
                    </button>
                    <button className="btn sm" onClick={() => window.print()}>
                      <i className="ti ti-printer" /> Print
                    </button>
                    {can('Payment', 'Delete') && !selLocked && (
                      <button className="btn danger sm" disabled={busy} onClick={remove}>
                        <i className="ti ti-trash" /> Delete
                      </button>
                    )}
                  </>
                )}
              </>
            }
          >
            {ro ? (
              <>
                <PrintStyle id="pay-print" paper={paper} />
                <div id="pay-print">
                  <PaymentVoucher p={sel} printTemplate={templates.print} paymentTemplate={templates.payment} />
                </div>
              </>
            ) : (
            <div className="fgrid">
              <Field label="Payment No">
                <input
                  readOnly
                  value={sel ? sel.PaymentNo : `Auto — ${nextNo || '…'}`}
                />
              </Field>
              <Field label="Payment Date" required>
                <input
                  type="date"
                  value={form.paymentDate}
                  disabled={ro}
                  onChange={(e) => set('paymentDate', e.target.value)}
                />
              </Field>
              <Field label="Type of Payment" required>
                <div className="radios">
                  <label>
                    <input
                      type="radio"
                      name="paytype"
                      checked={form.type === 'Expense'}
                      disabled={ro || editing}
                      onChange={() => set('type', 'Expense')}
                    />
                    Expense
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="paytype"
                      checked={form.type === 'Refund'}
                      disabled={ro || editing}
                      onChange={() => set('type', 'Refund')}
                    />
                    Refund
                  </label>
                </div>
              </Field>

              {form.type === 'Expense' ? (
                /* ---- Expense sub-form ---- */
                <>
                  <Field label="Paid To" required>
                    <input
                      placeholder="Supplier / office / staff name"
                      value={form.paidTo}
                      disabled={ro}
                      onChange={(e) => set('paidTo', e.target.value)}
                    />
                  </Field>
                  <Field label="Mobile No.">
                    <input
                      value={form.mobileNo}
                      disabled={ro}
                      onChange={(e) => set('mobileNo', e.target.value)}
                    />
                  </Field>
                  <Field label="Mode">
                    <Select
                      value={form.mode}
                      disabled={ro}
                      onChange={(v) => set('mode', v)}
                      options={['Cash', 'Bank']}
                    />
                  </Field>
                  <Field label="Narration" className="full">
                    <textarea
                      placeholder="What is this expense for?"
                      value={form.narration}
                      disabled={ro}
                      onChange={(e) => set('narration', e.target.value)}
                    />
                  </Field>
                  <Field label="Paid Amount (QAR)" required>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.amount}
                      disabled={ro}
                      onChange={(e) => set('amount', e.target.value)}
                    />
                  </Field>
                </>
              ) : (
                /* ---- Refund sub-form ---- */
                <>
                  <Field label="Select Invoice" required className="full">
                    {!ro && !editing && (
                      <div style={{ position: 'relative' }}>
                        <input
                          placeholder="Search by invoice no / customer…"
                          value={invSearch}
                          onChange={(e) => setInvSearch(e.target.value)}
                        />
                        {invResults.length > 0 && (
                          <div
                            style={{
                              position: 'absolute',
                              top: '100%',
                              left: 0,
                              right: 0,
                              zIndex: 20,
                              background: '#fff',
                              border: '1px solid var(--line)',
                              borderRadius: 9,
                              marginTop: 4,
                              maxHeight: 220,
                              overflowY: 'auto',
                              boxShadow: '0 10px 30px rgba(34,26,53,0.12)',
                            }}
                          >
                            {invResults.map((r) => (
                              <div
                                key={r.InvoiceCode}
                                style={{
                                  padding: '8px 12px',
                                  cursor: 'pointer',
                                  borderBottom: '1px solid var(--line)',
                                }}
                                onMouseDown={() => pickInvoice(r)}
                              >
                                <b>{docNo('invoice', r.InvoiceNo, r.InvoiceDate, r.CreatedAt)}</b> · {r.CustomerName}{' '}
                                <span className="muted">
                                  — paid QAR {fmtMoney(r.received)} · {r.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {inv ? (
                      <div style={{ marginTop: ro ? 0 : 8 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>
                          Invoice {docNo('invoice', inv.InvoiceNo, inv.InvoiceDate, inv.CreatedAt)} · {inv.CustomerName}
                        </div>
                        <div
                          className="totalbar"
                          style={{
                            border: '1px solid var(--line)',
                            borderRadius: 10,
                            justifyContent: 'flex-start',
                          }}
                        >
                          <div className="tcell">
                            <small>Invoice amount</small>
                            <b>QAR {fmtMoney(inv.net)}</b>
                          </div>
                          <div className="tcell">
                            <small>Paid amount</small>
                            <b>QAR {fmtMoney(inv.paid)}</b>
                          </div>
                          <div className="tcell">
                            <small>Pending</small>
                            <b>QAR {fmtMoney(inv.pending)}</b>
                          </div>
                        </div>
                      </div>
                    ) : (
                      !ro && (
                        <div className="muted" style={{ marginTop: 6 }}>
                          Type above to find the invoice this refund is against.
                        </div>
                      )
                    )}
                  </Field>
                  <Field label=" " className="full">
                    <label
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        fontWeight: 600,
                        cursor: ro ? 'default' : 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={form.cancelInvoice}
                        disabled={ro || !inv}
                        onChange={(e) => onCancelToggle(e.target.checked)}
                      />
                      Invoice cancelled — full refund
                    </label>
                  </Field>
                  <Field label="Mobile No.">
                    <input
                      value={form.mobileNo}
                      disabled={ro}
                      onChange={(e) => set('mobileNo', e.target.value)}
                    />
                  </Field>
                  <Field label="Refund Amount (QAR)" required>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.amount}
                      disabled={ro}
                      onChange={(e) => set('amount', e.target.value)}
                    />
                  </Field>
                  <Field label="Reason">
                    <Select
                      value={form.reason}
                      disabled={ro}
                      onChange={(v) => set('reason', v)}
                      options={REFUND_REASONS}
                    />
                  </Field>
                </>
              )}

              <Field label="Remarks" className="full">
                <textarea
                  value={form.remarks}
                  disabled={ro}
                  onChange={(e) => set('remarks', e.target.value)}
                />
              </Field>
            </div>
            )}
          </Panel>
        </div>
      </div>

      {showHistory && sel && (
        <Drawer title={`History — Payment ${docNo('payment', sel.PaymentNo, sel.PaymentDate)}`} onClose={() => setShowHistory(false)}>
          <DocTimeline events={history} />
        </Drawer>
      )}
    </div>
  );
}
