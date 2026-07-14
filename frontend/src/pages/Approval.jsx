import React, { useEffect, useState } from 'react';
import { api, fmtMoney, fmtDate, fmtDateTime, fmtDateTimeOr0 } from '../api';
import { useToast, useConfirm, Badge, Panel, Empty, Loader, Modal, Drawer } from '../components/ui';
import { usePerms } from '../permissions';
import { docNo, useDocNo } from '../docNumber';

const REQ_TONE = { Pending: 'warn', Approved: 'green', Rejected: 'red', Reverted: 'warn' };
const REQ_LABEL = { Pending: 'Pending approval', Approved: 'Approved · Locked', Rejected: 'Rejected', Reverted: 'Reverted' };

/* ---- compact preview cards (no long scrolling document) ---- */
const cmpMoney = (v) => (v == null || v === '' ? '—' : `${fmtMoney(v)} QAR`);
const cmpCard = { border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: 'var(--panel)' };
const cmpHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', background: 'rgba(138,21,56,.06)', borderBottom: '1px solid var(--line)' };
const cmpGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px', padding: '6px 14px' };
const cmpAmts = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 8, padding: '12px 14px', borderTop: '1px solid var(--line)' };

function KV({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
      <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function Amt({ label, value, accent }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 14, color: accent ? '#8a1538' : 'inherit' }}>{value}</div>
    </div>
  );
}

function ReceiptCompact({ r }) {
  const received = Number(r.RecievedAmount) || 0;
  const total = r.InvoiceAmount != null && r.InvoiceAmount !== '' ? Number(r.InvoiceAmount) : null;
  const hasPre = r.PreBalanceAmount != null && r.PreBalanceAmount !== '';
  const hasCur = r.CurrentBalanceAmount != null && r.CurrentBalanceAmount !== '';
  const preBalance = hasPre ? Number(r.PreBalanceAmount) : hasCur ? Number(r.CurrentBalanceAmount) + received : total;
  const curBalance = hasCur ? Number(r.CurrentBalanceAmount) : hasPre ? Number(r.PreBalanceAmount) - received : (total != null ? total - received : null);
  const status = curBalance == null ? null : curBalance <= 0 ? 'Paid' : received > 0 ? 'Partially Paid' : 'Not Paid';
  const tone = status === 'Paid' ? 'green' : status === 'Partially Paid' ? 'warn' : 'red';
  return (
    <div style={cmpCard}>
      <div style={cmpHead}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}><i className="ti ti-receipt" /> Receipt {docNo('receipt', r.RecieptNo, r.RecieptDate, r.CreatedAt)}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {fmtDate(r.RecieptDate)} · {r.PaymentMode}{r.InvoiceNo ? ` · Invoice ${docNo('invoice', r.InvoiceNo)}` : ''}
          </div>
        </div>
        {status && <Badge tone={tone}>{status}</Badge>}
      </div>
      <div style={cmpGrid}>
        <KV label="Customer" value={`${r.CustomerName || '—'}${r.Nationality ? ` (${r.Nationality})` : ''}`} />
        <KV label="Package" value={r.PackageName || '—'} />
        <KV label="Passengers" value={r.PassengerCount ?? 0} />
        <KV label="Departure" value={fmtDate(r.DepartureDate)} />
      </div>
      <div style={cmpAmts}>
        <Amt label="Invoice Amount" value={cmpMoney(total)} />
        <Amt label="Previous Balance" value={cmpMoney(preBalance)} />
        <Amt label="Received" value={cmpMoney(received)} accent />
        <Amt label="Current Balance" value={cmpMoney(curBalance)} accent />
      </div>
    </div>
  );
}

function InvoiceCompact({ d }) {
  const inv = d.invoice || d;
  const paid = Number(inv.received || 0);
  const balance = inv.balance != null ? Number(inv.balance) : Number(inv.NetAmount || 0) - paid;
  const status = inv.status || (balance <= 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Not Paid');
  const tone = status === 'Paid' ? 'green' : status === 'Partially Paid' ? 'warn' : 'red';
  return (
    <div style={cmpCard}>
      <div style={cmpHead}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}><i className="ti ti-file-invoice" /> Invoice {docNo('invoice', inv.InvoiceNo, inv.InvoiceDate, inv.CreatedAt)}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {fmtDate(inv.InvoiceDate)}{inv.DepartureDate ? ` · Departure ${fmtDate(inv.DepartureDate)}` : ''}
          </div>
        </div>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <div style={cmpGrid}>
        <KV label="Customer" value={`${inv.CustomerName || '—'}${inv.Nationality ? ` (${inv.Nationality})` : ''}`} />
        <KV label="Package" value={inv.PackageName || '—'} />
        <KV label="Room" value={inv.RoomType || inv.RoomDetails || '—'} />
        <KV label="Passengers" value={`${inv.PassengerCount ?? 0} pax · ${inv.VisaCount ?? 0} visa`} />
      </div>
      <div style={cmpAmts}>
        <Amt label="Amount" value={cmpMoney(inv.Amount)} />
        <Amt label="Discount" value={cmpMoney(inv.DiscountAmount)} />
        <Amt label="Net Amount" value={cmpMoney(inv.NetAmount)} accent />
        <Amt label="Paid" value={cmpMoney(paid)} />
        <Amt label="Balance Due" value={cmpMoney(balance)} accent />
      </div>
    </div>
  );
}

function RequestCard({ req, onProcessed, canApprove, onView, onViewInvoice }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [detail, setDetail] = useState(null);
  const [ticks, setTicks] = useState({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/api/receipt-requests/${req.id}`)
      .then((d) => {
        setDetail(d);
        setTicks(Object.fromEntries(d.receipts.map((r) => [r.RecieptCode, true])));
      })
      .catch((e) => toast(e.message));
  }, [req.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!detail) return null;
  const receipts = detail.receipts;
  const approved = receipts.filter((r) => ticks[r.RecieptCode]);
  const returned = receipts.length - approved.length;
  const approvedAmount = approved.reduce((s, r) => s + Number(r.RecievedAmount || 0), 0);
  const allTicked = receipts.length > 0 && approved.length === receipts.length;
  const someTicked = approved.length > 0 && !allTicked;
  const toggleAll = () => setTicks(allTicked ? {} : Object.fromEntries(receipts.map((r) => [r.RecieptCode, true])));

  const process = async (rejectAll) => {
    const approveCodes = rejectAll ? [] : approved.map((r) => r.RecieptCode);
    if ((rejectAll || returned > 0) && !comment.trim()) {
      toast('A rejection comment is required when returning receipts');
      return;
    }
    if (!(await confirm(rejectAll
      ? { title: 'Reject all receipts?', danger: true, confirmText: 'Reject all',
          message: `All ${receipts.length} receipts in ${req.request_no} will be returned to Open.` }
      : { title: 'Process approval?', confirmText: 'Process',
          message: `Approve ${approveCodes.length} receipt(s)${returned ? ` and return ${returned} to Open` : ''} in ${req.request_no}?` }))) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/receipt-requests/${req.id}/process`, { approveCodes, comment: comment.trim() });
      toast(r.status === 'Approved'
        ? `${req.request_no} approved — ${r.approved} locked${r.returned ? `, ${r.returned} returned to Open` : ''}`
        : `${req.request_no} rejected — all receipts returned to Open`);
      onProcessed();
    } catch (e) {
      toast(e.message);
      setBusy(false);
    }
  };

  return (
    <Panel
      title={`Receipt Request ${req.request_no}`}
      sub={`Booked by ${req.created_by_name || '—'} · ${fmtDateTimeOr0(req.created_at, req.request_date)}${req.note ? ` · ${req.note}` : ''} · ${receipts.length} receipts`}
      toolbar={
        <>
          <button className="btn sm" title="Preview selected receipt(s)" onClick={() => approved.length ? onView(approved.map((r) => r.RecieptCode)) : toast('Select at least one receipt to view')}><i className="ti ti-receipt" /> Receipt view</button>
          <button className="btn sm" title="Preview selected invoice(s)" onClick={() => approved.length ? onViewInvoice(approved.map((r) => r.RecieptCode)) : toast('Select at least one receipt to view its invoice')}><i className="ti ti-file-invoice" /> Invoice view</button>
          <Badge tone="warn">Pending approval</Badge>
          <span style={{ fontWeight: 700, marginLeft: 8, fontSize: 12.5 }}>
            Requested {receipts.length} · <b style={{ color: 'var(--green)' }}>Approved {approved.length}</b> · <b style={{ color: 'var(--red)' }}>Rejected {returned}</b>
          </span>
          <span style={{ fontWeight: 800, marginLeft: 8 }}>QAR {fmtMoney(approvedAmount)}</span>
        </>
      }
      bodyStyle={{ padding: 0 }}
    >
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 34 }} title="Approve all / none">
              <input
                type="checkbox" checked={allTicked}
                ref={(el) => { if (el) el.indeterminate = someTicked; }}
                onChange={toggleAll}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
              />
            </th>
            <th>Rec No</th><th>Customer</th><th>Built from</th><th>Mode</th><th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.RecieptCode} onClick={() => setTicks((t) => ({ ...t, [r.RecieptCode]: !t[r.RecieptCode] }))}>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox" checked={!!ticks[r.RecieptCode]}
                  onChange={() => setTicks((t) => ({ ...t, [r.RecieptCode]: !t[r.RecieptCode] }))}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                />
              </td>
              <td>{docNo('receipt', r.RecieptNo, r.RecieptDate)}</td>
              <td>{r.CustomerName}</td>
              <td>{r.PackageName || (r.InvoiceNo ? `Invoice ${docNo('invoice', r.InvoiceNo)}` : '—')}</td>
              <td>{r.PaymentMode}</td>
              <td className="num">{fmtMoney(r.RecievedAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 260 }}>
          <label>Rejection comment {returned > 0 && <span className="req">* required — {returned} receipt(s) will be returned</span>}</label>
          <textarea
            value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Required if you return any receipt" style={{ minHeight: 44 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, paddingTop: 18 }}>
          {canApprove ? (
            <>
              <button className="btn danger" onClick={() => process(true)} disabled={busy}>
                <i className="ti ti-x" /> Reject all
              </button>
              <button className="btn success" onClick={() => process(false)} disabled={busy || approved.length === 0}>
                <i className="ti ti-checks" /> Process approval
              </button>
            </>
          ) : (
            <span className="muted"><i className="ti ti-lock" /> You don't have approval permission</span>
          )}
        </div>
      </div>
    </Panel>
  );
}

export default function Approval() {
  const toast = useToast();
  const { can } = usePerms();
  useDocNo();
  const canApprove = can('Receipt Approval', 'Approve');
  const [pending, setPending] = useState(null);
  const [processed, setProcessed] = useState([]);
  const [revert, setRevert] = useState(null);       // the approved request being reverted
  const [revertReason, setRevertReason] = useState('');
  const [revertBusy, setRevertBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [receiptsModal, setReceiptsModal] = useState(null); // { request, receipts }
  const [preview, setPreview] = useState(null); // { no, loading, receipts, templates }
  const [invPreview, setInvPreview] = useState(null); // { no, loading, invoices, templates }

  const openReceipts = async (req) => {
    try {
      const d = await api.get(`/api/receipt-requests/${req.id}`);
      setReceiptsModal(d); // { request, receipts }
    } catch (e) {
      toast(e.message);
    }
  };

  // preview the receipt detail(s) — only the receipts ticked on the card (all, if none ticked)
  const openPreview = async (req, selectedCodes) => {
    setPreview({ no: req.request_no, loading: true });
    try {
      const det = await api.get(`/api/receipt-requests/${req.id}`);
      let rows = det.receipts || [];
      if (selectedCodes && selectedCodes.length) rows = rows.filter((r) => selectedCodes.includes(r.RecieptCode));
      const full = await Promise.all(rows.map((r) =>
        api.get(`/api/receipts/${r.RecieptCode}`).then((d) => d.receipt).catch(() => null)));
      setPreview({ no: req.request_no, receipts: full.filter(Boolean) });
    } catch (e) {
      toast(e.message);
      setPreview(null);
    }
  };

  // preview the linked invoice detail(s) — only for the receipts ticked on the card (all, if none ticked)
  const openInvoicePreview = async (req, selectedCodes) => {
    setInvPreview({ no: req.request_no, loading: true });
    try {
      const det = await api.get(`/api/receipt-requests/${req.id}`);
      let rows = det.receipts || [];
      if (selectedCodes && selectedCodes.length) rows = rows.filter((r) => selectedCodes.includes(r.RecieptCode));
      const codes = [...new Set(rows.map((r) => r.InvoiceCode).filter(Boolean))];
      const invoices = await Promise.all(codes.map((c) => api.get(`/api/invoices/${c}`).catch(() => null)));
      setInvPreview({ no: req.request_no, invoices: invoices.filter(Boolean) });
    } catch (e) {
      toast(e.message);
      setInvPreview(null);
    }
  };

  const needle = search.trim().toLowerCase();
  const shownProcessed = needle
    ? processed.filter((r) => [r.request_no, r.created_by_name, r.processed_by_name, r.reverted_by_name, r.status, r.revert_reason]
        .some((v) => String(v || '').toLowerCase().includes(needle)))
    : processed.slice(0, 15);

  const doRevert = async () => {
    if (!revertReason.trim()) { toast('A reason is required to revert'); return; }
    setRevertBusy(true);
    try {
      const r = await api.post(`/api/receipt-requests/${revert.id}/revert`, { reason: revertReason.trim() });
      toast(`${revert.request_no} reverted — ${r.reverted} receipt(s) returned to Open`);
      setRevert(null); setRevertReason('');
      load();
    } catch (e) {
      toast(e.message);
    } finally {
      setRevertBusy(false);
    }
  };

  const load = async () => {
    try {
      const [p, all] = await Promise.all([
        api.get('/api/receipt-requests?status=Pending'),
        api.get('/api/receipt-requests'),
      ]);
      setPending(p.rows || []);
      setProcessed((all.rows || []).filter((r) => r.status !== 'Pending'));
    } catch (e) {
      toast(e.message);
      setPending([]);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel
        title="Receipt Approval"
        sub="Check each request and the receipts inside it. Ticked receipts are approved & locked; unticked ones are returned to Open."
      />
      {!pending ? (
        <Loader />
      ) : pending.length === 0 ? (
        <Panel><Empty icon="ti-checks" text="No receipt requests waiting for approval." /></Panel>
      ) : (
        pending.map((q) => <RequestCard key={q.id} req={q} onProcessed={load} canApprove={canApprove} onView={(codes) => openPreview(q, codes)} onViewInvoice={(codes) => openInvoicePreview(q, codes)} />)
      )}

      <Panel
        title="Approved & locked"
        sub={search ? `${shownProcessed.length} match(es)` : 'Recently processed requests'}
        bodyStyle={{ padding: 0 }}
        toolbar={
          <div className="searchbox" style={{ maxWidth: 280 }}>
            <i className="ti ti-search" />
            <input
              placeholder="Search request no, name, status…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      >
        {processed.length === 0 ? (
          <Empty icon="ti-lock" text="Nothing processed yet." />
        ) : shownProcessed.length === 0 ? (
          <Empty icon="ti-search" text="No matching requests." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Request No</th><th>Requested on</th><th>Requested by</th><th>Approved by</th><th>Approved on</th>
                <th className="num">Receipts</th><th className="num">Approved</th><th className="num">Returned</th>
                <th className="num">Total</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shownProcessed.map((q) => (
                <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => openReceipts(q)} title="View receipts">
                  <td className="mono" style={{ fontWeight: 700 }}>{q.request_no}</td>
                  <td>{fmtDateTimeOr0(q.created_at, q.request_date)}</td>
                  <td>{q.created_by_name || '—'}</td>
                  <td>{q.processed_by_name || '—'}</td>
                  <td>{q.processed_at ? fmtDateTime(q.processed_at) : <span className="muted">—</span>}</td>
                  <td className="num">{q.receiptCount}</td>
                  <td className="num">{q.approvedCount}</td>
                  <td className="num">{q.rejectedCount}</td>
                  <td className="num">{fmtMoney(q.total)}</td>
                  <td>
                    {q.status === 'Approved' ? <Badge tone="green">🔒 Approved · Locked</Badge>
                      : q.status === 'Reverted' ? <Badge tone="warn">Reverted</Badge>
                      : <Badge tone="red">Rejected</Badge>}
                    {q.status === 'Reverted' && q.revert_reason && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 3, whiteSpace: 'normal' }}>{q.revert_reason}</div>
                    )}
                  </td>
                  <td>
                    {q.status === 'Approved' && canApprove ? (
                      <button className="btn sm" onClick={(e) => { e.stopPropagation(); setRevert(q); setRevertReason(''); }}>
                        <i className="ti ti-arrow-back-up" /> Revert
                      </button>
                    ) : q.status === 'Reverted' ? (
                      <span className="muted" style={{ whiteSpace: 'nowrap', fontSize: 11.5 }}>
                        by {q.reverted_by_name || '—'}<br />{q.reverted_at ? fmtDateTime(q.reverted_at) : '—'}
                      </span>
                    ) : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {preview && (
        <Modal
          title={`Receipt details — ${preview.no}`}
          onClose={() => setPreview(null)}
          width={640}
          footer={<button className="btn" onClick={() => setPreview(null)}>Close</button>}
        >
          {preview.loading ? (
            <Loader />
          ) : preview.receipts.length === 0 ? (
            <Empty icon="ti-receipt" text="No receipts to preview." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {preview.receipts.map((r, i) => <ReceiptCompact key={r.RecieptCode || i} r={r} />)}
            </div>
          )}
        </Modal>
      )}

      {invPreview && (
        <Modal
          title={`Invoice details — ${invPreview.no}`}
          onClose={() => setInvPreview(null)}
          width={640}
          footer={<button className="btn" onClick={() => setInvPreview(null)}>Close</button>}
        >
          {invPreview.loading ? (
            <Loader />
          ) : !invPreview.invoices || invPreview.invoices.length === 0 ? (
            <Empty icon="ti-file-invoice" text="No linked invoice to preview." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {invPreview.invoices.map((d, i) => <InvoiceCompact key={d.invoice?.InvoiceCode || i} d={d} />)}
            </div>
          )}
        </Modal>
      )}

      {receiptsModal && (
        <Drawer title={`${receiptsModal.request.request_no} — ${REQ_LABEL[receiptsModal.request.status] || receiptsModal.request.status}`} onClose={() => setReceiptsModal(null)}>
          <div className="pgrid" style={{ marginBottom: 14 }}>
            <div className="pitem"><small>Requested by</small><b>{receiptsModal.request.created_by_name || '—'}</b></div>
            <div className="pitem"><small>Requested on</small><b>{fmtDateTimeOr0(receiptsModal.request.created_at, receiptsModal.request.request_date)}</b></div>
            <div className="pitem"><small>Note</small><b>{receiptsModal.request.note || '—'}</b></div>
            <div className="pitem"><small>Status</small><b>{REQ_LABEL[receiptsModal.request.status] || receiptsModal.request.status}</b></div>
            {(receiptsModal.request.status === 'Approved' || receiptsModal.request.status === 'Rejected') && (
              <>
                <div className="pitem"><small>{receiptsModal.request.status === 'Approved' ? 'Approved by' : 'Rejected by'}</small><b>{receiptsModal.request.processed_by_name || '—'}</b></div>
                <div className="pitem"><small>{receiptsModal.request.status === 'Approved' ? 'Approved on' : 'Rejected on'}</small><b>{receiptsModal.request.processed_at ? fmtDateTime(receiptsModal.request.processed_at) : '—'}</b></div>
              </>
            )}
            {receiptsModal.request.comment && (
              <div className="pitem"><small>Comment</small><b>{receiptsModal.request.comment}</b></div>
            )}
            {receiptsModal.request.status === 'Reverted' && (
              <>
                <div className="pitem"><small>Reverted by</small><b>{receiptsModal.request.reverted_by_name || '—'}</b></div>
                <div className="pitem"><small>Reverted on</small><b>{receiptsModal.request.reverted_at ? fmtDateTime(receiptsModal.request.reverted_at) : '—'}</b></div>
                <div className="pitem"><small>Revert reason</small><b>{receiptsModal.request.revert_reason || '—'}</b></div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontWeight: 700, padding: '10px 12px', marginBottom: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--bg2)' }}>
            <span>Requested {receiptsModal.receipts.length}</span>
            <span style={{ color: 'var(--green)' }}>· Approved {receiptsModal.receipts.filter((r) => r.lineStatus === 'Approved').length}</span>
            <span style={{ color: 'var(--red)' }}>· Rejected {receiptsModal.receipts.filter((r) => r.lineStatus === 'Rejected').length}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 800 }}>QAR {fmtMoney(receiptsModal.receipts.reduce((s, r) => s + Number(r.RecievedAmount || 0), 0))}</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Rec No</th><th>Invoice No</th><th>Customer</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {receiptsModal.receipts.map((r) => (
                <tr key={r.RecieptCode} style={{ cursor: 'default' }}>
                  <td>{docNo('receipt', r.RecieptNo, r.RecieptDate, r.CreatedAt)}</td>
                  <td>{r.InvoiceNo ? docNo('invoice', r.InvoiceNo, r.InvoiceDate, r.InvoiceCreatedAt) : '—'}</td>
                  <td>{r.CustomerName}</td>
                  <td className="num">{fmtMoney(r.RecievedAmount)}</td>
                  <td><Badge tone={r.lineStatus === 'Approved' ? 'green' : r.lineStatus === 'Rejected' ? 'red' : 'warn'}>{r.lineStatus}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Drawer>
      )}

      {revert && (
        <Modal
          title={`Revert ${revert.request_no}`}
          onClose={() => setRevert(null)}
          width={460}
          footer={
            <>
              <button className="btn" onClick={() => setRevert(null)} disabled={revertBusy}>Cancel</button>
              <button className="btn danger" onClick={doRevert} disabled={revertBusy || !revertReason.trim()}>
                <i className="ti ti-arrow-back-up" /> Revert approval
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 22, color: 'var(--warn)' }} />
            <div>This unlocks the <b>{revert.approvedCount}</b> approved receipt(s) in <b>{revert.request_no}</b> and returns them to Open. The reason, your name and the time are recorded.</div>
          </div>
          <div className="field">
            <label>Reason <span className="req">*</span></label>
            <textarea
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
              placeholder="Why are you reverting this approval?"
              style={{ minHeight: 72 }}
              autoFocus
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
