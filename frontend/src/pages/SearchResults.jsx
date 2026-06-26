import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtMoney, fmtDate } from '../api';
import { docNo, useDocNo } from '../docNumber';
import { useToast, Badge, Panel, Empty } from '../components/ui';

const invoiceTone = (s) =>
  ({ Paid: 'green', 'Partially Paid': 'warn', 'Not Paid': 'red', Cancelled: 'red' }[s] || 'blue');

const paymentTone = (t) => (t === 'Refund' ? 'violet' : 'warn');

export default function SearchResults() {
  const navigate = useNavigate();
  const toast = useToast();
  useDocNo();
  const [params] = useSearchParams();
  const q = (params.get('q') || '').trim();

  const [data, setData] = useState({ invoices: [], receipts: [], payments: [], customers: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q) {
      setData({ invoices: [], receipts: [], payments: [], customers: [] });
      return;
    }
    let active = true;
    setLoading(true);
    api.get(`/api/search?q=${encodeURIComponent(q)}`)
      .then((d) => {
        if (!active) return;
        setData({
          invoices: d.invoices || [],
          receipts: d.receipts || [],
          payments: d.payments || [],
          customers: d.customers || [],
        });
      })
      .catch((e) => { if (active) toast(e.message || 'Search failed'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [q, toast]);

  if (!q) {
    return (
      <Panel title="Search">
        <Empty icon="ti-search" text="Type in the top search bar and press Enter." />
      </Panel>
    );
  }

  const { invoices, receipts, payments, customers } = data;
  const allEmpty =
    invoices.length === 0 && receipts.length === 0 && payments.length === 0 && customers.length === 0;

  return (
    <>
      <Panel title="Search" sub={`Results for "${q}"`}>
        {loading && <div className="muted">Searching…</div>}
        {!loading && allEmpty && (
          <Empty icon="ti-search-off" text={`No matches for "${q}".`} />
        )}
      </Panel>

      {!loading && invoices.length > 0 && (
        <Panel title={`Invoices (${invoices.length})`} bodyStyle={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Inv No</th>
                <th>Date</th>
                <th>Customer</th>
                <th className="num">Net</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((r) => (
                <tr
                  key={r.InvoiceCode}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/invoices?q=${encodeURIComponent(r.CustomerName)}`)}
                >
                  <td>{docNo('invoice', r.InvoiceNo, r.InvoiceDate)}</td>
                  <td>{fmtDate(r.InvoiceDate)}</td>
                  <td>{r.CustomerName}</td>
                  <td className="num">{fmtMoney(r.NetAmount)}</td>
                  <td><Badge tone={invoiceTone(r.status)}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {!loading && receipts.length > 0 && (
        <Panel title={`Receipts (${receipts.length})`} bodyStyle={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Receipt No</th>
                <th>Date</th>
                <th>Customer</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr
                  key={r.RecieptCode}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/receipts?customer=${encodeURIComponent(r.CustomerName || '')}`)}
                >
                  <td>{docNo('receipt', r.RecieptNo, r.RecieptDate)}</td>
                  <td>{fmtDate(r.RecieptDate)}</td>
                  <td>{r.CustomerName}</td>
                  <td className="num">{fmtMoney(r.RecievedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {!loading && payments.length > 0 && (
        <Panel title={`Payments (${payments.length})`} bodyStyle={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Pay No</th>
                <th>Date</th>
                <th>Payee</th>
                <th>Type</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((r) => (
                <tr
                  key={r.PaymentCode}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/payments?payee=${encodeURIComponent(r.PaidTo || '')}`)}
                >
                  <td>{docNo('payment', r.PaymentNo, r.PaymentDate)}</td>
                  <td>{fmtDate(r.PaymentDate)}</td>
                  <td>{r.PaidTo}</td>
                  <td><Badge tone={paymentTone(r.TypeOfPayment)}>{r.TypeOfPayment}</Badge></td>
                  <td className="num">{fmtMoney(r.PaymentAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {!loading && customers.length > 0 && (
        <Panel title={`Customers (${customers.length})`} bodyStyle={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Mobile</th>
                <th className="num">Invoices</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((r) => (
                <tr
                  key={r.CustomerName}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate('/reports')}
                >
                  <td>{r.CustomerName}</td>
                  <td>{r.Mobile1 || '—'}</td>
                  <td className="num">{fmtMoney(r.invoices)}</td>
                  <td className="num">
                    {Number(r.balance) > 0
                      ? <b style={{ color: 'var(--red, #d33)' }}>QAR {fmtMoney(r.balance)}</b>
                      : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
