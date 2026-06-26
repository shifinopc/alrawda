import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, fmtMoney, fmtDate, fmtDateTimeOr0, toInputDate, todayStr, invoiceStatusBadge, downloadPdf, getUser } from '../api';
import { Select, useToast, useConfirm, Badge, Panel, Field, Empty, PrintStyle, PaperToggle, usePaper, Pager, Drawer, Loader } from '../components/ui';
import InvoiceDoc from '../components/InvoiceDoc';
import DocTimeline from '../components/DocTimeline';
import { usePerms } from '../permissions';
import { docNo, useDocNo } from '../docNumber';
import FilterBuilder, { condVal, condRange, condMode } from '../components/FilterBuilder';

const INVOICE_FILTERS = [
  { key: 'invNo', label: 'Invoice No', op: 'contains', match: true, type: 'text', icon: 'ti-file-invoice', placeholder: 'e.g. 8466' },
  { key: 'customer', label: 'Customer', op: 'contains', type: 'text', icon: 'ti-user', placeholder: 'name' },
  { key: 'dateRange', label: 'Date', type: 'daterange', icon: 'ti-calendar' },
];

const blankPassenger = () => ({ passengerName: '', visaTypeCode: '', visaRequiredCode: 1 });


const blankForm = () => ({
  invoiceDate: todayStr(),
  departureDate: '',
  customerName: '',
  nationalityCode: '',
  packageCode: '',
  agentCode: '',
  showAgent: false,
  mobile1: '',
  mobile2: '',
  passengerCount: 1,
  seatCount: 0,
  visaCount: 0,
  roomType: 'Normal',
  roomDetails: '',
  amount: 0,
  discountAmount: 0,
  remarks: '',
});


export default function Invoices() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = usePerms();
  useDocNo();
  const isAdmin = ['Super Admin', 'Admin'].includes(getUser()?.role);
  const [templates, setTemplates] = useState({ print: null, invoice: null });
  const [paper, setPaper] = usePaper();

  useEffect(() => {
    api.get('/api/settings/prefs')
      .then((d) => setTemplates({ print: d.prefs?.printTemplate || {}, invoice: d.prefs?.invoiceTemplate || {} }))
      .catch(() => setTemplates({ print: {}, invoice: {} }));
  }, []);

  /* ---- list ---- */
  const [rows, setRows] = useState([]);
  const [conds, setConds] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;
  const location = useLocation();

  // global topbar search lands here as ?q=
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('q');
    if (!q) return;
    const field = /^\d+$/.test(q) ? 'invNo' : 'customer';
    // topbar search is a broad find → use 'contains' (manual filter chips default to 'equals')
    setConds([{ id: `q-${field}-${Date.now()}`, field, value: q, mode: field === 'invNo' ? 'contains' : undefined }]);
  }, [location.search]);

  /* ---- masters ---- */
  const [packages, setPackages] = useState([]);
  const [visaTypes, setVisaTypes] = useState([]);
  const [nationalities, setNationalities] = useState([]);
  const [agents, setAgents] = useState([]);

  /* ---- right side ---- */
  const [view, setView] = useState('form'); // 'form' | 'preview'
  const [detail, setDetail] = useState(null); // {invoice, passengers, receipts, refunds}
  const [editingCode, setEditingCode] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [nextNo, setNextNo] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [errors, setErrors] = useState({});
  const [passengers, setPassengers] = useState([blankPassenger()]);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(null);

  const openHistory = async () => {
    if (!detail) return;
    setShowHistory(true);
    setHistory(null);
    try {
      const d = await api.get(`/api/invoices/${detail.invoice.InvoiceCode}/history`);
      setHistory(d.events || []);
    } catch (e) {
      toast(e.message);
      setHistory([]);
    }
  };

  /* ---- customer autocomplete ---- */
  const [sugg, setSugg] = useState([]);
  const [suggOpen, setSuggOpen] = useState(false);
  const suggTimer = useRef(null);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };
  const net = (Number(form.amount) || 0) - (Number(form.discountAmount) || 0);
  const selectedCode = view === 'preview' && detail ? detail.invoice.InvoiceCode : null;

  const fetchList = useCallback(async () => {
    setListLoading(true);
    try {
      const p = new URLSearchParams();
      const invNo = condVal(conds, 'invNo'); if (invNo) { p.set('invNo', invNo); if (condMode(conds, 'invNo') === 'equals') p.set('invNoMode', 'equals'); }
      const dr = condRange(conds, 'dateRange'); if (dr.from) p.set('from', dr.from); if (dr.to) p.set('to', dr.to);
      const customer = condVal(conds, 'customer'); if (customer) p.set('customer', customer);
      p.set('deleted', showDeleted ? '1' : '0');
      p.set('pageSize', String(pageSize));
      p.set('page', String(page));
      const d = await api.get(`/api/invoices?${p.toString()}`);
      setRows(d.rows || []);
      setTotal(d.total || 0);
    } catch (e) {
      toast(e.message);
    } finally {
      setListLoading(false);
    }
  }, [conds, page, showDeleted, toast]);

  /* reset to page 1 whenever filters change */
  useEffect(() => { setPage(1); }, [conds]);

  /* debounce list fetch on filter/page change */
  useEffect(() => {
    const t = setTimeout(fetchList, 300);
    return () => clearTimeout(t);
  }, [fetchList]);

  /* masters + next no, once */
  useEffect(() => {
    (async () => {
      try {
        const [pk, vt, na, ag, nn] = await Promise.all([
          api.get('/api/masters/packages'),
          api.get('/api/masters/visa-types'),
          api.get('/api/masters/nationalities'),
          api.get('/api/masters/agents'),
          api.get('/api/invoices/next-no'),
        ]);
        setPackages(pk.rows || []);
        setVisaTypes(vt.rows || []);
        setNationalities(na.rows || []);
        setAgents(ag.rows || []);
        setNextNo(nn.next);
      } catch (e) {
        toast(e.message);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshNextNo = async () => {
    try {
      const d = await api.get('/api/invoices/next-no');
      setNextNo(d.next);
    } catch { /* non-fatal */ }
  };

  const loadDetail = async (code) => {
    try {
      const d = await api.get(`/api/invoices/${code}`);
      setDetail(d);
      setView('preview');
    } catch (e) {
      toast(e.message);
    }
  };

  const startNew = () => {
    setForm(blankForm());
    setPassengers([blankPassenger()]);
    setEditingCode(null);
    setView('form');
    refreshNextNo();
  };

  const approveInvoice = async () => {
    if (!detail) return;
    const inv = detail.invoice;
    if (!(await confirm({
      title: 'Approve invoice?',
      message: `Invoice #${inv.InvoiceNo} will be approved. It then becomes available for receipts and is locked from editing (admins excepted).`,
      confirmText: 'Approve',
    }))) return;
    try {
      await api.post(`/api/invoices/${inv.InvoiceCode}/approve`, { status: 'Approved' });
      toast(`Invoice #${inv.InvoiceNo} approved`);
      await loadDetail(inv.InvoiceCode);
      await fetchList();
    } catch (e) {
      toast(e.message);
    }
  };

  const removeInvoice = async () => {
    if (!detail) return;
    const inv = detail.invoice;
    if (!(await confirm({
      title: 'Move to recycle bin?',
      message: `Invoice ${docNo('invoice', inv.InvoiceNo, inv.InvoiceDate)} will be moved to the recycle bin. You can restore it later.`,
      confirmText: 'Move to bin', danger: true,
    }))) return;
    try {
      await api.del(`/api/invoices/${inv.InvoiceCode}`);
      toast('Invoice moved to recycle bin');
      startNew();
      await fetchList();
    } catch (e) {
      toast(e.message);
    }
  };

  const restoreInvoice = async (code, e) => {
    if (e) e.stopPropagation();
    try {
      await api.post(`/api/invoices/${code}/restore`);
      toast('Invoice restored');
      await fetchList();
    } catch (err) {
      toast(err.message);
    }
  };

  const startEdit = () => {
    if (!detail) return;
    const inv = detail.invoice;
    setForm({
      invoiceDate: toInputDate(inv.InvoiceDate),
      departureDate: toInputDate(inv.DepartureDate),
      customerName: inv.CustomerName || '',
      nationalityCode: inv.NatinalityCode ?? '',
      packageCode: inv.PackageCode ?? '',
      agentCode: inv.AgentCode ?? '',
      showAgent: !!inv.ShowAgent,
      mobile1: inv.Mobile1 || '',
      mobile2: inv.Mobile2 || '',
      passengerCount: inv.PassengerCount ?? 0,
      seatCount: inv.SeatCount ?? 0,
      visaCount: inv.VisaCount ?? 0,
      roomType: inv.RoomType || 'Normal',
      roomDetails: inv.RoomDetails || '',
      amount: inv.Amount ?? 0,
      discountAmount: inv.DiscountAmount ?? 0,
      remarks: inv.Remarks || '',
    });
    setPassengers(
      (detail.passengers || []).length
        ? detail.passengers.map((p) => ({
            passengerName: p.PassengerName || '',
            visaTypeCode: p.VisaTypeCode ?? '',
            visaRequiredCode: p.VisaRequiredCode ? 1 : 0,
          }))
        : [blankPassenger()]
    );
    setEditingCode(inv.InvoiceCode);
    setView('form');
  };

  const cancelForm = () => {
    if (detail) setView('preview');
    else startNew();
  };

  /* ---- customer autocomplete ---- */
  const onCustomerType = (v) => {
    set('customerName', v);
    clearTimeout(suggTimer.current);
    if (!v.trim()) { setSugg([]); setSuggOpen(false); return; }
    suggTimer.current = setTimeout(async () => {
      try {
        const q = encodeURIComponent(v.trim());
        // search BOTH the customer master (sopCustomerInfo — includes newly-created ones)
        // and the invoice history, then merge & de-dupe by name (master takes priority)
        const [master, invoiced] = await Promise.all([
          api.get(`/api/masters/customer-master?q=${q}&pageSize=10`).catch(() => ({ rows: [] })),
          api.get(`/api/masters/customers?q=${q}`).catch(() => ({ rows: [] })),
        ]);
        const norm = [
          ...(master.rows || []).map((c) => ({ CustomerName: c.CustomerName, Mobile1: c.MobileNo, NatinalityCode: c.CountryCode })),
          ...(invoiced.rows || []).map((c) => ({ CustomerName: c.CustomerName, Mobile1: c.Mobile1, NatinalityCode: c.NatinalityCode })),
        ];
        const seen = new Set();
        const merged = norm.filter((c) => {
          const k = String(c.CustomerName || '').trim().toLowerCase();
          if (!k || seen.has(k)) return false;
          seen.add(k); return true;
        }).slice(0, 12);
        setSugg(merged);
        setSuggOpen(merged.length > 0);
      } catch { /* ignore */ }
    }, 250);
  };

  const pickCustomer = (c) => {
    setForm((f) => ({
      ...f,
      customerName: c.CustomerName || '',
      mobile1: c.Mobile1 || f.mobile1,
      nationalityCode: c.NatinalityCode ?? f.nationalityCode,
    }));
    setSuggOpen(false);
  };

  /* ---- passengers grid ---- */
  const setPax = (i, k, v) =>
    setPassengers((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
  const addPax = () => setPassengers((ps) => [...ps, blankPassenger()]);
  const removePax = (i) => setPassengers((ps) => ps.filter((_, idx) => idx !== i));

  /* ---- package select ---- */
  const onPackageChange = (code) => {
    setForm((f) => {
      const pkg = packages.find((p) => String(p.PackageCode) === String(code));
      const amount = pkg && !(Number(f.amount) > 0) ? pkg.Rate : f.amount;
      return { ...f, packageCode: code, amount };
    });
  };

  /* ---- save ---- */
  const save = async () => {
    const errs = {};
    if (!form.invoiceDate) errs.invoiceDate = 'Invoice date is required';
    if (!form.departureDate) errs.departureDate = 'Departure date is required';
    if (!form.customerName.trim()) errs.customerName = 'Customer name is required';
    if (!(Number(net) > 0)) errs.amount = 'Net amount must be greater than zero';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    const body = {
      invoiceDate: form.invoiceDate,
      customerName: form.customerName.trim(),
      nationalityCode: form.nationalityCode || null,
      mobile1: form.mobile1,
      mobile2: form.mobile2,
      packageCode: form.packageCode || null,
      agentCode: form.agentCode || null,
      showAgent: !!form.agentCode && !!form.showAgent,
      departureDate: form.departureDate,
      passengerCount: Number(form.passengerCount) || 0,
      seatCount: Number(form.seatCount) || 0,
      visaCount: Number(form.visaCount) || 0,
      roomType: form.roomType,
      roomDetails: form.roomDetails,
      amount: Number(form.amount) || 0,
      discountAmount: Number(form.discountAmount) || 0,
      netAmount: net,
      remarks: form.remarks,
      passengers: passengers
        .filter((p) => p.passengerName.trim())
        .map((p) => ({
          passengerName: p.passengerName.trim(),
          visaTypeCode: p.visaTypeCode || null,
          visaRequiredCode: Number(p.visaRequiredCode) ? 1 : 0,
        })),
    };
    setSaving(true);
    try {
      let code = editingCode;
      if (editingCode) {
        await api.put(`/api/invoices/${editingCode}`, body);
        toast('Invoice updated');
      } else {
        const res = await api.post('/api/invoices', body);
        code = res.invoiceCode;
        toast(`Invoice ${res.invoiceNo} saved`);
        refreshNextNo();
      }
      await fetchList();
      await loadDetail(code);
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ================= render ================= */
  const inv = detail?.invoice;
  const paid = inv ? Number(inv.received) || 0 : 0;
  const balance = inv ? Number(inv.balance) || 0 : 0;

  const totalInputStyle = { width: 130, textAlign: 'right', border: '1px solid var(--line)', borderRadius: 8, padding: '5px 8px', fontWeight: 700 };

  return (
    <div className="split">
      {/* ============ LEFT: list ============ */}
      <Panel
        className="col-list col-list-wide"
        title={showDeleted ? 'Recycle Bin' : 'Invoice List'}
        toolbar={
          <>
            {can('Invoice', 'Delete') && (
              <button
                className={`btn sm${showDeleted ? ' primary' : ''}`}
                onClick={() => { setShowDeleted(!showDeleted); startNew(); }}
                title="Deleted invoices"
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
        <FilterBuilder fields={INVOICE_FILTERS} conds={conds} setConds={setConds} />
        <div className="scroller">
          {listLoading ? (
            <Loader />
          ) : rows.length === 0 ? (
            <Empty icon="ti-file-invoice" text="No invoices found" />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Inv No</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.InvoiceCode}
                    className={selectedCode === r.InvoiceCode ? 'sel' : ''}
                    onClick={() => !showDeleted && loadDetail(r.InvoiceCode)}
                    style={showDeleted ? { cursor: 'default' } : undefined}
                  >
                    <td>{docNo('invoice', r.InvoiceNo, r.InvoiceDate, r.CreatedAt)}</td>
                    <td>{fmtDateTimeOr0(r.CreatedAt, r.InvoiceDate)}</td>
                    <td>{r.CustomerName}</td>
                    <td onClick={(e) => showDeleted && e.stopPropagation()}>
                      {showDeleted ? (
                        <button className="btn sm" onClick={(e) => restoreInvoice(r.InvoiceCode, e)} title="Restore">
                          <i className="ti ti-arrow-back-up" /> Restore
                        </button>
                      ) : r.ApprovalStatus !== 'Approved' && r.status !== 'Cancelled'
                        ? <Badge tone="warn">Draft</Badge>
                        : <Badge tone={invoiceStatusBadge(r.status)}>{r.status}</Badge>}
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
            title="Invoice — Create / Edit"
            toolbar={
              <>
                <button className="btn primary" onClick={startNew}><i className="ti ti-plus" /> New</button>
                <button className="btn success" disabled={saving} onClick={save}><i className="ti ti-device-floppy" /> Save</button>
                <button className="btn" onClick={cancelForm}>Cancel</button>
              </>
            }
            bodyStyle={{ padding: 0 }}
          >
            <div style={{ padding: 16 }}>
              <div className="fgrid">
                <Field label="Invoice No">
                  <input readOnly value={editingCode ? (inv?.InvoiceNo ?? '') : `Auto — ${nextNo ?? '...'}`} />
                </Field>
                <Field label="Invoice Date" required error={errors.invoiceDate}>
                  <input type="date" value={form.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} />
                </Field>
                <Field label="Departure Date" required error={errors.departureDate}>
                  <input type="date" value={form.departureDate} onChange={(e) => set('departureDate', e.target.value)} />
                </Field>

                <Field label="Customer Name" required error={errors.customerName}>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={form.customerName}
                      placeholder="Type to search…"
                      onChange={(e) => onCustomerType(e.target.value)}
                      onBlur={() => setTimeout(() => setSuggOpen(false), 150)}
                      style={{ width: '100%' }}
                    />
                    {suggOpen && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
                        background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
                        boxShadow: '0 8px 22px rgba(34,26,53,0.14)', maxHeight: 200, overflowY: 'auto',
                      }}>
                        {sugg.map((c, i) => (
                          <div
                            key={i}
                            onMouseDown={() => pickCustomer(c)}
                            style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
                          >
                            <b>{c.CustomerName}</b>
                            {c.Mobile1 && <span className="muted" style={{ marginLeft: 8 }}>{c.Mobile1}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
                <Field label="Nationality">
                  <Select value={form.nationalityCode ?? ''} placeholder="— Select —"
                    onChange={(v) => set('nationalityCode', v)}
                    options={nationalities.map((n) => ({ value: n.CountryCode, label: n.CountryName }))} />
                </Field>
                <Field label="Package">
                  <Select value={form.packageCode ?? ''} placeholder="— Select —"
                    onChange={onPackageChange}
                    options={packages.map((p) => ({ value: p.PackageCode, label: p.PackageName }))} />
                </Field>
                <Field label="Agent">
                  <Select value={form.agentCode ?? ''} placeholder="— None —"
                    onChange={(v) => set('agentCode', v)}
                    options={[{ value: '', label: '— None —' },
                      ...agents.map((a) => ({ value: a.AgentCode, label: a.MobileNo ? `${a.AgentName} · ${a.MobileNo}` : a.AgentName }))]} />
                  {form.agentCode && (
                    <label className="chk-field" title="Print the agent name on this invoice">
                      <input type="checkbox" checked={!!form.showAgent} onChange={(e) => set('showAgent', e.target.checked)} />
                      Show agent
                    </label>
                  )}
                </Field>

                <Field label="Mobile No 1">
                  <input value={form.mobile1} onChange={(e) => set('mobile1', e.target.value)} />
                </Field>
                <Field label="Mobile No 2">
                  <input value={form.mobile2} onChange={(e) => set('mobile2', e.target.value)} />
                </Field>
                <Field label="No. of Passengers">
                  <input type="number" min="0" value={form.passengerCount} onChange={(e) => set('passengerCount', e.target.value)} />
                </Field>

                <Field label="No. of Seat">
                  <input type="number" min="0" value={form.seatCount} onChange={(e) => set('seatCount', e.target.value)} />
                </Field>
                <Field label="No. of Visa Required">
                  <input type="number" min="0" value={form.visaCount} onChange={(e) => set('visaCount', e.target.value)} />
                </Field>
                <Field label="Room Type">
                  <div className="radios">
                    {['Normal', 'Separate', 'Nil'].map((rt) => (
                      <label key={rt}>
                        <input
                          type="radio"
                          name="roomType"
                          checked={form.roomType === rt}
                          onChange={() => set('roomType', rt)}
                        />
                        {rt}
                      </label>
                    ))}
                  </div>
                </Field>

                <Field label="Room Details" className="full">
                  <input value={form.roomDetails} onChange={(e) => set('roomDetails', e.target.value)} />
                </Field>
              </div>
            </div>

            {/* passengers */}
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <span className="msec" style={{ margin: 0, flex: 1 }}>
                  Passengers Details · {passengers.length}
                </span>
                <button className="btn sm" onClick={addPax}>
                  <i className="ti ti-plus" /> Add passenger
                </button>
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 11, overflow: 'hidden' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>SL</th>
                      <th>Passenger Name</th>
                      <th style={{ width: 180 }}>Visa Type</th>
                      <th style={{ width: 130 }}>Visa Required</th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {passengers.length === 0 && (
                      <tr style={{ cursor: 'default' }}>
                        <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 18 }}>
                          No passengers yet — click "Add passenger".
                        </td>
                      </tr>
                    )}
                    {passengers.map((p, i) => (
                      <tr key={i} style={{ cursor: 'default' }}>
                        <td className="muted">{i + 1}</td>
                        <td>
                          <input
                            className="cellinput"
                            placeholder="Passenger full name"
                            value={p.passengerName}
                            onChange={(e) => setPax(i, 'passengerName', e.target.value)}
                          />
                        </td>
                        <td>
                          <Select
                            className="cellinput"
                            value={p.visaTypeCode ?? ''} placeholder="— Select —"
                            onChange={(v) => setPax(i, 'visaTypeCode', v)}
                            options={visaTypes.map((vt) => ({ value: vt.VisaTypeCode, label: vt.VisaType }))}
                          />
                        </td>
                        <td>
                          <Select
                            className="cellinput"
                            value={Number(p.visaRequiredCode) ? 1 : 0}
                            onChange={(v) => setPax(i, 'visaRequiredCode', Number(v))}
                            options={[{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }]}
                          />
                        </td>
                        <td>
                          <button className="iconbtn" title="Remove" onClick={() => removePax(i)} style={{ width: 30, height: 30 }}>
                            <i className="ti ti-trash" style={{ fontSize: 14, color: 'var(--red)' }} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* totals */}
            <div className="totalbar">
              <div className="tcell">
                <small>Amount</small>
                <input type="number" min="0" value={form.amount}
                  onChange={(e) => { set('amount', e.target.value); setErrors((er) => (er.amount ? { ...er, amount: undefined } : er)); }}
                  style={{ ...totalInputStyle, border: `1px solid ${errors.amount ? '#b3261e' : 'var(--line)'}` }} />
                {errors.amount && <span className="field-err" style={{ display: 'block' }}><i className="ti ti-alert-circle" /> {errors.amount}</span>}
              </div>
              <div className="tcell">
                <small>Discount Amount</small>
                <input type="number" min="0" value={form.discountAmount} onChange={(e) => set('discountAmount', e.target.value)} style={totalInputStyle} />
              </div>
              <div className="tcell">
                <small>Net Amount</small>
                <b>QAR {fmtMoney(net)}</b>
              </div>
            </div>

            <div style={{ padding: 16 }}>
              <div className="fgrid">
                <Field label="Remarks" className="full">
                  <textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
                </Field>
              </div>
            </div>
          </Panel>
        ) : (
          /* ============ preview ============ */
          inv && (
            <Panel
              title={
                <span>
                  Invoice Preview{' '}
                  <Badge tone={invoiceStatusBadge(inv.status)}>{inv.status}</Badge>{' '}
                  {inv.status !== 'Cancelled' && (
                    <Badge tone={inv.ApprovalStatus === 'Approved' ? 'green' : 'warn'}>
                      {inv.ApprovalStatus === 'Approved' ? 'Approved' : 'Draft'}
                    </Badge>
                  )}
                </span>
              }
              toolbar={
                <>
                  {inv.ApprovalStatus !== 'Approved' && inv.status !== 'Cancelled' && can('Invoice', 'Approve') && (
                    <button className="btn success" onClick={approveInvoice}><i className="ti ti-check" /> Approve</button>
                  )}
                  {(inv.ApprovalStatus !== 'Approved' || isAdmin) && inv.status !== 'Cancelled' && (
                    <button className="btn" onClick={startEdit}><i className="ti ti-pencil" /> Edit</button>
                  )}
                  <button className="btn" onClick={openHistory}><i className="ti ti-history" /> History</button>
                  <button className="btn primary" onClick={startNew}><i className="ti ti-plus" /> New invoice</button>
                  <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" /> Print</button>
                  {can('Invoice', 'Delete') && (
                    <button className="btn danger" onClick={removeInvoice}><i className="ti ti-trash" /> Delete</button>
                  )}
                </>
              }
            >
              <PrintStyle id="inv-print" paper={paper} />
              <div id="inv-print">
                <InvoiceDoc
                  invoice={inv}
                  passengers={detail.passengers}
                  receipts={detail.receipts}
                  refunds={detail.refunds}
                  printTemplate={templates.print}
                  invoiceTemplate={templates.invoice}
                />
              </div>
            </Panel>
          )
        )}
      </div>

      {showHistory && detail && (
        <Drawer title={`History — Invoice ${docNo('invoice', detail.invoice.InvoiceNo, detail.invoice.InvoiceDate)}`} onClose={() => setShowHistory(false)}>
          <DocTimeline events={history} />
        </Drawer>
      )}
    </div>
  );
}
