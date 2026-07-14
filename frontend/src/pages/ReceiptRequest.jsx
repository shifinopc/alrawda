import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtMoney, fmtDate, fmtDateTime, fmtDateTimeOr0, todayStr } from '../api';
import { useToast, Badge, Panel, Field, Drawer, Empty, Loader } from '../components/ui';
import { docNo, useDocNo } from '../docNumber';
import FilterBuilder from '../components/FilterBuilder';

const REQ_TONE = { Pending: 'warn', Approved: 'green', Rejected: 'red', Reverted: 'warn' };
const REQ_LABEL = { Pending: 'Pending approval', Approved: 'Approved · Locked', Rejected: 'Rejected', Reverted: 'Reverted' };

/* ---------- dynamic filter fields for the open-receipts picker (client-side) ---------- */
const RR_FILTERS = [
  { key: 'recNo',      label: 'Rec No',            op: 'contains', match: true, type: 'text', icon: 'ti-receipt',      placeholder: 'e.g. 12748' },
  { key: 'invoiceNo',  label: 'Invoice No',        op: 'contains', match: true, type: 'text', icon: 'ti-file-invoice', placeholder: 'e.g. 8465' },
  { key: 'invNoRange', label: 'Invoice No (range)', type: 'numrange', icon: 'ti-file-invoice', fromPlaceholder: 'e.g. INV-26-0001', toPlaceholder: 'e.g. INV-26-0004' },
  { key: 'customer',   label: 'Customer',           op: 'contains', type: 'text', icon: 'ti-user',         placeholder: 'name' },
  { key: 'dateRange',  label: 'Date',               type: 'daterange', icon: 'ti-calendar' },
  { key: 'mode',      label: 'Mode',       op: '=',        type: 'select', icon: 'ti-wallet', options: ['Cash', 'Bank'] },
];

// map a formatted doc-number query to the raw stored number (drop prefix + leading zeros)
const docNumSearchValue = (q) => {
  const m = String(q || '').trim().match(/(\d+)\s*$/);
  return m ? String(parseInt(m[1], 10)) : String(q || '').trim();
};

// date/recNo/invoiceNo/customer are all applied server-side (see loadOpen); only Mode is
// filtered on the client because the receipts endpoint has no payment-mode parameter.
function matchesConds(r, conds) {
  return conds.every((c) => {
    if (c.field !== 'mode') return true;
    const v = (c.value ?? '').toString().trim().toLowerCase();
    return !v || String(r.PaymentMode || '').toLowerCase() === v;
  });
}

export default function ReceiptRequest() {
  const toast = useToast();
  useDocNo();
  const [open, setOpen] = useState([]);          // open receipts available for booking (fetched, capped)
  const [openTotal, setOpenTotal] = useState(0); // total open receipts matching the current filter (server count)
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState({});            // RecieptCode -> bool
  // dynamic condition-chip filters for the open-receipts picker
  const [conds, setConds] = useState([]);
  const [nextNo, setNextNo] = useState('');
  const [requestDate, setRequestDate] = useState(todayStr());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [drawer, setDrawer] = useState(null);    // { request, receipts }

  // ALL filters are applied SERVER-SIDE: there can be thousands of open receipts (incl. ones
  // freed up by a rejected request), so client-only filtering of the newest 200 would hide them.
  const dateCond = conds.find((c) => c.field === 'dateRange');
  const from = dateCond?.value?.from || '';
  const to = dateCond?.value?.to || '';
  const recCond = conds.find((c) => c.field === 'recNo');
  const invCond = conds.find((c) => c.field === 'invoiceNo');
  const custCond = conds.find((c) => c.field === 'customer');
  const recNo = (recCond?.value || '').toString().trim();
  const invoiceNo = (invCond?.value || '').toString().trim();
  const customer = (custCond?.value || '').toString().trim();
  const invRangeCond = conds.find((c) => c.field === 'invNoRange');
  const invNoFrom = (invRangeCond?.value?.from || '').toString().trim();
  const invNoTo = (invRangeCond?.value?.to || '').toString().trim();
  const loadSeq = React.useRef(0); // monotonic id so only the latest open-receipts fetch wins

  const loadOpen = async () => {
    const hasFilter = from || to || recNo || invoiceNo || customer || invNoFrom || invNoTo;
    const q = new URLSearchParams({ status: 'open', pageSize: hasFilter ? '1000' : '200' });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (recNo) { q.set('recNo', docNumSearchValue(recNo)); if (recCond.mode === 'equals') q.set('recNoMode', 'equals'); }
    if (invoiceNo) { q.set('invoiceNo', docNumSearchValue(invoiceNo)); if (invCond.mode === 'equals') q.set('invoiceNoMode', 'equals'); }
    // invoice-number range targets the current INV-26 series only (numbers 1-199 also exist as
    // old migrated invoices; scope to docs with a creation date so the two don't mix)
    if (invNoFrom) q.set('invNoFrom', docNumSearchValue(invNoFrom));
    if (invNoTo) q.set('invNoTo', docNumSearchValue(invNoTo));
    if (invNoFrom || invNoTo) q.set('invNoNew', '1');
    if (customer) q.set('customer', customer);
    // guard against out-of-order responses: typing a range fires several requests, and a
    // broader (slower) one must not clobber the newer, narrower result. Only the latest applies.
    const seq = ++loadSeq.current;
    const o = await api.get(`/api/receipts?${q.toString()}`);
    if (seq !== loadSeq.current) return;
    setOpen(o.rows || []);
    setOpenTotal(o.total ?? (o.rows || []).length);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [r, n] = await Promise.all([
        api.get('/api/receipt-requests'),
        api.get('/api/receipt-requests/next-no'),
      ]);
      setRequests(r.rows || []);
      setNextNo(n.next);
      setSel({});
      await loadOpen();
    } catch (e) {
      toast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // re-fetch open receipts from the server whenever any filter changes (skips the initial mount)
  const mounted = React.useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    loadOpen().catch((e) => toast(e.message));
  }, [from, to, recNo, invoiceNo, customer, invNoFrom, invNoTo, recCond?.mode, invCond?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => open.filter((r) => sel[r.RecieptCode]), [open, sel]);
  const total = selected.reduce((a, r) => a + Number(r.RecievedAmount || 0), 0);

  const shownOpen = useMemo(() => (
    open
      .filter((r) => matchesConds(r, conds))
      .sort((a, b) => (Number(b.InvoiceNo) || 0) - (Number(a.InvoiceNo) || 0)) // latest invoice first
  ), [open, conds]);

  const allChecked = shownOpen.length > 0 && shownOpen.every((r) => sel[r.RecieptCode]);

  const toggleAll = () => {
    if (allChecked) setSel((s) => { const n = { ...s }; shownOpen.forEach((r) => { delete n[r.RecieptCode]; }); return n; });
    else setSel((s) => ({ ...s, ...Object.fromEntries(shownOpen.map((r) => [r.RecieptCode, true])) }));
  };

  const onSave = async () => {
    if (!selected.length) { toast('Select at least one receipt to book'); return; }
    setSaving(true);
    try {
      const r = await api.post('/api/receipt-requests', {
        requestDate,
        note: note.trim(),
        receiptCodes: selected.map((x) => x.RecieptCode),
      });
      toast(`${r.requestNo} saved & sent for approval`);
      setNote('');
      await load();
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openDrawer = async (id) => {
    try {
      setDrawer(await api.get(`/api/receipt-requests/${id}`));
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <div>
      <Panel
        title="New Receipt Request — select receipts"
        sub="Bundle open receipts together, then send for manager approval"
        toolbar={
          <button className="btn primary" onClick={onSave} disabled={saving || !selected.length}>
            <i className="ti ti-send" /> Save &amp; send for approval
          </button>
        }
      >
        <div className="fgrid">
          <Field label="Request No">
            <input readOnly value={`Auto — ${nextNo}`} />
          </Field>
          <Field label="Request Date" required>
            <input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} />
          </Field>
          <Field label="Note">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Today's counter collection" />
          </Field>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '16px 0 8px', flexWrap: 'wrap' }}>
          <b>Select receipts to book</b>
          <span className="muted" style={{ fontWeight: 700 }}>
            Showing {shownOpen.length} of {openTotal.toLocaleString()}
            {openTotal > open.length && <span style={{ color: 'var(--accent)' }}> · newest {open.length} loaded — filter by date / number to load the rest</span>}
            {' '}· Selected {selected.length} · Total QAR {fmtMoney(total)}
          </span>
        </div>
        <FilterBuilder fields={RR_FILTERS} conds={conds} setConds={setConds} />

        {loading ? (
          <Loader />
        ) : open.length === 0 ? (
          <Empty icon="ti-receipt" text="No open receipts to book — all receipts are already booked or approved." />
        ) : shownOpen.length === 0 ? (
          <Empty icon="ti-search-off" text="No open receipts match your filters." />
        ) : (
          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 11 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll}
                      style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                  </th>
                  <th>Invoice No</th><th>Rec No</th><th>Date</th><th>Customer</th><th>Built from</th><th>Mode</th>
                  <th className="num">Amount</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shownOpen.map((r) => (
                  <tr key={r.RecieptCode} onClick={() => setSel((s) => ({ ...s, [r.RecieptCode]: !s[r.RecieptCode] }))}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={!!sel[r.RecieptCode]}
                        onChange={() => setSel((s) => ({ ...s, [r.RecieptCode]: !s[r.RecieptCode] }))}
                        style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                    </td>
                    <td>{r.InvoiceNo ? docNo('invoice', r.InvoiceNo, r.InvoiceDate, r.InvoiceCreatedAt) : '—'}</td>
                    <td>{docNo('receipt', r.RecieptNo, r.RecieptDate, r.CreatedAt)}</td>
                    <td>{fmtDateTimeOr0(r.CreatedAt, r.RecieptDate)}</td>
                    <td>{r.CustomerName}</td>
                    <td>{r.PackageName || (r.InvoiceNo ? `Invoice ${docNo('invoice', r.InvoiceNo, r.InvoiceDate, r.InvoiceCreatedAt)}` : '—')}</td>
                    <td>{r.PaymentMode}</td>
                    <td className="num">{fmtMoney(r.RecievedAmount)}</td>
                    <td><Badge tone="blue">Open</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div style={{ height: 14 }} />

      <Panel title="Receipt Requests" sub="Click a request to see its receipts" bodyStyle={{ padding: 0 }}>
        {loading ? (
          <Loader />
        ) : requests.length === 0 ? (
          <Empty icon="ti-cash" text="No receipt requests yet." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Request No</th><th>Requested on</th><th>Note</th><th>Requested by</th><th>Approved by</th><th>Approved on</th>
                <th className="num">Receipts</th><th className="num">Total</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((q) => (
                <tr key={q.id} onClick={() => openDrawer(q.id)}>
                  <td className="mono" style={{ fontWeight: 700 }}>{q.request_no}</td>
                  <td>{fmtDateTimeOr0(q.created_at, q.request_date)}</td>
                  <td>{q.note || <span className="muted">—</span>}</td>
                  <td>{q.created_by_name || '—'}</td>
                  <td>{q.status === 'Approved' ? (q.processed_by_name || '—') : <span className="muted">—</span>}</td>
                  <td>{q.processed_at ? fmtDateTime(q.processed_at) : <span className="muted">—</span>}</td>
                  <td className="num">{q.receiptCount}</td>
                  <td className="num">{fmtMoney(q.total)}</td>
                  <td><Badge tone={REQ_TONE[q.status] || 'blue'}>{REQ_LABEL[q.status] || q.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {drawer && (
        <Drawer title={`${drawer.request.request_no} — ${REQ_LABEL[drawer.request.status]}`} onClose={() => setDrawer(null)}>
          <div className="pgrid" style={{ marginBottom: 14 }}>
            <div className="pitem"><small>Requested by</small><b>{drawer.request.created_by_name || '—'}</b></div>
            <div className="pitem"><small>Requested on</small><b>{fmtDateTimeOr0(drawer.request.created_at, drawer.request.request_date)}</b></div>
            <div className="pitem"><small>Note</small><b>{drawer.request.note || '—'}</b></div>
            <div className="pitem"><small>Status</small><b>{REQ_LABEL[drawer.request.status]}</b></div>
            {(drawer.request.status === 'Approved' || drawer.request.status === 'Rejected') && (
              <>
                <div className="pitem">
                  <small>{drawer.request.status === 'Approved' ? 'Approved by' : 'Rejected by'}</small>
                  <b>{drawer.request.processed_by_name || '—'}</b>
                </div>
                <div className="pitem">
                  <small>{drawer.request.status === 'Approved' ? 'Approved on' : 'Rejected on'}</small>
                  <b>{drawer.request.processed_at ? fmtDateTime(drawer.request.processed_at) : '—'}</b>
                </div>
              </>
            )}
            {drawer.request.comment && (
              <div className="pitem"><small>Comment</small><b>{drawer.request.comment}</b></div>
            )}
            {drawer.request.status === 'Reverted' && (
              <>
                <div className="pitem"><small>Reverted by</small><b>{drawer.request.reverted_by_name || '—'}</b></div>
                <div className="pitem"><small>Reverted on</small><b>{drawer.request.reverted_at ? fmtDateTime(drawer.request.reverted_at) : '—'}</b></div>
                <div className="pitem"><small>Revert reason</small><b>{drawer.request.revert_reason || '—'}</b></div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontWeight: 700, padding: '10px 12px', marginBottom: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--bg2)' }}>
            <span>Requested {drawer.receipts.length}</span>
            <span style={{ color: 'var(--green)' }}>· Approved {drawer.receipts.filter((r) => r.lineStatus === 'Approved').length}</span>
            <span style={{ color: 'var(--red)' }}>· Rejected {drawer.receipts.filter((r) => r.lineStatus === 'Rejected').length}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 800 }}>QAR {fmtMoney(drawer.receipts.reduce((s, r) => s + Number(r.RecievedAmount || 0), 0))}</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Rec No</th><th>Invoice No</th><th>Customer</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {drawer.receipts.map((r) => (
                <tr key={r.RecieptCode} style={{ cursor: 'default' }}>
                  <td>{docNo('receipt', r.RecieptNo, r.RecieptDate, r.CreatedAt)}</td>
                  <td>{r.InvoiceNo ? docNo('invoice', r.InvoiceNo, r.InvoiceDate, r.InvoiceCreatedAt) : '—'}</td>
                  <td>{r.CustomerName}</td>
                  <td className="num">{fmtMoney(r.RecievedAmount)}</td>
                  <td>
                    <Badge tone={r.lineStatus === 'Approved' ? 'green' : r.lineStatus === 'Rejected' ? 'red' : 'warn'}>
                      {r.lineStatus}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Request total</td>
                <td className="num">{fmtMoney(drawer.request.total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Drawer>
      )}
    </div>
  );
}
