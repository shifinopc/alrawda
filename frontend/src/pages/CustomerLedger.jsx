import React, { useEffect, useState, useCallback } from 'react';
import { api, fmtMoney, fmtDate } from '../api';
import { Select, useToast, Badge, Panel, Field, Empty, Pager, PrintStyle, Loader } from '../components/ui';
import ReportDoc from '../components/ReportDoc';

const PAGE_SIZE = 50;

const STATUS_TONE = {
  Paid: 'green',
  'Partially Paid': 'warn',
  'Not Paid': 'red',
  Cancelled: 'red',
};

const STATUS_FILTERS = [
  { value: '', label: 'All customers' },
  { value: 'pending', label: 'Has pending balance' },
  { value: 'notpaid', label: 'Not paid' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'paid', label: 'Fully paid' },
];

export default function CustomerLedger() {
  const push = useToast();

  // ---- customer list state ----
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ rows: [], page: 1, pageSize: PAGE_SIZE, total: 0 });
  const [listLoading, setListLoading] = useState(false);

  // ---- selected customer / ledger state ----
  const [selected, setSelected] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // ---- print/report templates (shared branding) ----
  const [templates, setTemplates] = useState({ print: null, report: null });
  useEffect(() => {
    api.get('/api/settings/prefs')
      .then((d) => setTemplates({ print: d.prefs?.printTemplate || {}, report: d.prefs?.reportTemplate || {} }))
      .catch(() => setTemplates({ print: {}, report: {} }));
  }, []);

  const [debSearch, setDebSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setDebSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [status]);

  const loadCustomers = useCallback(async (q, p, st) => {
    setListLoading(true);
    try {
      const data = await api.get(
        `/api/customers?q=${encodeURIComponent(q)}&status=${st}&page=${p}&pageSize=${PAGE_SIZE}`
      );
      setList(data);
    } catch (e) {
      push(e.message || 'Failed to load customers');
    } finally {
      setListLoading(false);
    }
  }, [push]);

  useEffect(() => {
    loadCustomers(debSearch, page, status);
  }, [debSearch, page, status, loadCustomers]);

  const selectCustomer = async (name) => {
    setSelected(name);
    setLedger(null);
    setLedgerLoading(true);
    try {
      const data = await api.get(`/api/customers/ledger?name=${encodeURIComponent(name)}`);
      setLedger(data);
    } catch (e) {
      push(e.message || 'Failed to load statement');
      setSelected(null);
    } finally {
      setLedgerLoading(false);
    }
  };

  const sum = (arr, fn) => arr.reduce((acc, x) => acc + Number(fn(x) || 0), 0);

  return (
    <div className="split">
      {/* ---------- LEFT: customer list ---------- */}
      <div className="col-list">
        <Panel title="Customers" bodyStyle={{ padding: 0 }}>
          <div className="filterbar">
            <Field label="Search">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or mobile…"
              />
            </Field>
            <Field label="Status">
              <Select value={status} onChange={setStatus} options={STATUS_FILTERS} />
            </Field>
          </div>
          <div className="scroller">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => {
                  const pending = Number(c.balance) > 0;
                  const rowTone = c.status === 'Partially Paid' ? 'partial-row' : (pending ? 'pending-row' : '');
                  return (
                    <tr
                      key={c.CustomerName}
                      className={`${selected === c.CustomerName ? 'sel' : ''} ${rowTone}`}
                      onClick={() => selectCustomer(c.CustomerName)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div style={{ fontWeight: 600 }}>{c.CustomerName}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                          <Badge tone={STATUS_TONE[c.status] || 'blue'}>{c.status}</Badge>
                          {c.Mobile1 && <span className="muted" style={{ fontSize: 11 }}>{c.Mobile1}</span>}
                        </div>
                      </td>
                      <td className="num">
                        {pending
                          ? <b style={{ color: 'var(--red)' }}>QAR {fmtMoney(c.balance)}</b>
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {!listLoading && list.rows.length === 0 && (
                  <tr><td colSpan={2}><Empty icon="ti-users" text="No customers found." /></td></tr>
                )}
                {listLoading && (
                  <tr><td colSpan={2}><Loader /></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={list.page} pageSize={list.pageSize} total={list.total} onPage={setPage} />
        </Panel>
      </div>

      {/* ---------- RIGHT: statement (branded report style) ---------- */}
      <div className="col-detail">
        {!selected ? (
          <Empty icon="ti-user-search" text="Select a customer to view their statement." />
        ) : ledgerLoading ? (
          <Panel title={`Statement — ${selected}`}>
            <Loader text="Loading statement…" />
          </Panel>
        ) : ledger ? (
          <Panel
            title="Customer Statement"
            sub={ledger.customer}
            toolbar={<button className="btn sm" onClick={() => window.print()}><i className="ti ti-printer" /> Print</button>}
          >
            <PrintStyle id="ledger-print" />
            <div id="ledger-print">
              <ReportDoc
                title={`Customer Statement — ${ledger.customer}`}
                printTemplate={templates.print}
                reportTemplate={templates.report}
              >
                {/* summary */}
                <div className="rpt-summary">
                  <div><small>Total Invoiced</small><b>QAR {fmtMoney(ledger.summary.totalInvoiced)}</b></div>
                  <div><small>Total Received</small><b>QAR {fmtMoney(ledger.summary.totalReceived)}</b></div>
                  <div><small>Refunds</small><b>QAR {fmtMoney(ledger.summary.totalRefunded)}</b></div>
                  <div className="acc"><small>Balance Due</small><b>QAR {fmtMoney(ledger.summary.balance)}</b></div>
                </div>

                <div className="rpt-section">Invoices</div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Inv No</th><th>Date</th><th>Departure</th><th>Package</th>
                      <th className="num">Net</th><th className="num">Received</th><th className="num">Balance</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.invoices.map((inv) => (
                      <tr key={inv.InvoiceCode ?? inv.InvoiceNo} className={Number(inv.balance) > 0 && inv.status !== 'Cancelled' ? 'pending-row' : ''}>
                        <td>{inv.InvoiceNo}</td>
                        <td>{fmtDate(inv.InvoiceDate)}</td>
                        <td>{fmtDate(inv.DepartureDate)}</td>
                        <td>{inv.PackageName}</td>
                        <td className="num">{fmtMoney(inv.NetAmount)}</td>
                        <td className="num">{fmtMoney(inv.received)}</td>
                        <td className="num">{fmtMoney(inv.balance)}</td>
                        <td><Badge tone={STATUS_TONE[inv.status] || 'blue'}>{inv.status}</Badge></td>
                      </tr>
                    ))}
                    {ledger.invoices.length === 0 && (
                      <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>No invoices.</td></tr>
                    )}
                  </tbody>
                  {ledger.invoices.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={4}>Total</td>
                        <td className="num">{fmtMoney(sum(ledger.invoices, (i) => i.NetAmount))}</td>
                        <td className="num">{fmtMoney(sum(ledger.invoices, (i) => i.received))}</td>
                        <td className="num">{fmtMoney(sum(ledger.invoices, (i) => i.balance))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>

                <div className="rpt-section">Receipts</div>
                <table className="tbl">
                  <thead>
                    <tr><th>Receipt No</th><th>Date</th><th>Invoice</th><th>Mode</th><th className="num">Amount</th></tr>
                  </thead>
                  <tbody>
                    {ledger.receipts.map((r) => (
                      <tr key={r.RecieptNo}>
                        <td>{r.RecieptNo}</td>
                        <td>{fmtDate(r.RecieptDate)}</td>
                        <td>{r.InvoiceNo}</td>
                        <td>{r.PaymentMode}</td>
                        <td className="num">{fmtMoney(r.RecievedAmount)}</td>
                      </tr>
                    ))}
                    {ledger.receipts.length === 0 && (
                      <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>No receipts.</td></tr>
                    )}
                  </tbody>
                  {ledger.receipts.length > 0 && (
                    <tfoot>
                      <tr><td colSpan={4}>Total</td><td className="num">{fmtMoney(sum(ledger.receipts, (r) => r.RecievedAmount))}</td></tr>
                    </tfoot>
                  )}
                </table>

                {ledger.refunds.length > 0 && (
                  <>
                    <div className="rpt-section">Refunds</div>
                    <table className="tbl">
                      <thead>
                        <tr><th>Payment No</th><th>Date</th><th>Invoice</th><th className="num">Amount</th></tr>
                      </thead>
                      <tbody>
                        {ledger.refunds.map((rf) => (
                          <tr key={rf.PaymentNo}>
                            <td>{rf.PaymentNo}</td>
                            <td>{fmtDate(rf.PaymentDate)}</td>
                            <td>{rf.InvoiceNo}</td>
                            <td className="num">{fmtMoney(rf.PaymentAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr><td colSpan={3}>Total</td><td className="num">{fmtMoney(sum(ledger.refunds, (rf) => rf.PaymentAmount))}</td></tr>
                      </tfoot>
                    </table>
                  </>
                )}
              </ReportDoc>
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
