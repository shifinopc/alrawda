import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtMoney, fmtDate, todayStr, getUser } from '../api';
import { useToast, Badge, Panel, Empty, Loader } from '../components/ui';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
);

const PALETTE = ['#7c00ff', '#9a3cff', '#b06aff', '#c79aff', '#e0cdfa'];
const ACCENT = '#7c00ff';

const RANGES = [
  { key: 'week', label: 'Week', days: 7 },
  { key: 'month', label: 'Month', days: 30 },
  { key: 'year', label: 'Year', days: 365 },
];

const daysAgoStr = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const monthLabel = (m) => {
  const [y, mo] = String(m).split('-');
  const d = new Date(Number(y), Number(mo) - 1, 1);
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};

const statusTone = (s) =>
  ({ Paid: 'green', 'Partially Paid': 'warn', 'Not Paid': 'red', Cancelled: 'red' }[s] || 'blue');

const ChartBox = ({ height = 260, children }) => (
  <div style={{ height, position: 'relative' }}>{children}</div>
);

export default function Dashboard() {
  const push = useToast();
  const navigate = useNavigate();
  const user = getUser() || { name: 'there' };
  const [range, setRange] = useState('week');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const days = RANGES.find((r) => r.key === range)?.days || 30;
    const from = daysAgoStr(days);
    const to = todayStr();
    setLoading(true);
    api
      .get(`/api/dashboard?from=${from}&to=${to}`)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) push(e.message || 'Failed to load dashboard'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayLong = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const kpis = data?.kpis || {};
  const trend = data?.trend || [];
  const byPackage = data?.byPackage || [];
  const incomeExpense = data?.incomeExpense || [];
  const departures = data?.departures || [];
  const recentInvoices = data?.recentInvoices || [];
  const recentReceipts = data?.recentReceipts || [];

  const periodLabel = useMemo(() => {
    if (!data?.period) return '';
    return `${fmtDate(data.period.from)} – ${fmtDate(data.period.to)}`;
  }, [data]);

  /* ---- Collection overview (Line) ---- */
  const lineData = useMemo(() => ({
    labels: trend.map((t) => fmtDate(t.d)),
    datasets: [{
      label: 'Collection',
      data: trend.map((t) => Number(t.amount || 0)),
      borderColor: ACCENT,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.4,
      fill: true,
      backgroundColor: (ctx) => {
        const { chart } = ctx;
        const { ctx: c, chartArea } = chart;
        if (!chartArea) return 'rgba(124,0,255,0.12)';
        const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        g.addColorStop(0, 'rgba(124,0,255,0.28)');
        g.addColorStop(1, 'rgba(124,0,255,0.01)');
        return g;
      },
    }],
  }), [trend]);

  const lineOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
      y: { beginAtZero: true, ticks: { callback: (v) => fmtMoney(v) } },
    },
  };

  /* ---- Revenue by package (Doughnut) ---- */
  const topPackages = byPackage.slice(0, 5);
  const doughnutData = {
    labels: topPackages.map((p) => p.name),
    datasets: [{
      data: topPackages.map((p) => Number(p.amount || 0)),
      backgroundColor: PALETTE,
      borderWidth: 0,
    }],
  };
  const doughnutOpts = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '70%',
    plugins: { legend: { display: false } },
  };

  /* ---- Income vs Expense (grouped Bar) ---- */
  const ie6 = incomeExpense.slice(-6);
  const ieData = {
    labels: ie6.map((r) => monthLabel(r.m)),
    datasets: [
      { label: 'Income', data: ie6.map((r) => Number(r.income || 0)), backgroundColor: ACCENT, borderRadius: 5 },
      { label: 'Expense', data: ie6.map((r) => Number(r.expense || 0)), backgroundColor: '#c79aff', borderRadius: 5 },
    ],
  };
  const ieOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12 } } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, ticks: { callback: (v) => fmtMoney(v) } },
    },
  };

  /* ---- Upcoming departures (horizontal Bar) ---- */
  const depData = {
    labels: departures.map((r) => fmtDate(r.d)),
    datasets: [{
      label: 'Passengers',
      data: departures.map((r) => Number(r.pax || 0)),
      backgroundColor: '#9a3cff',
      borderRadius: 5,
    }],
  };
  const depOpts = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { precision: 0 } },
      y: { grid: { display: false } },
    },
  };

  if (loading && !data) {
    return <Loader text="Loading dashboard…" />;
  }

  return (
    <div>
      {/* Hero row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 700 }}>{greeting}, {user.name}</div>
          <div className="muted" style={{ fontSize: 13 }}>{todayLong}</div>
        </div>
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--line, #e3def0)', borderRadius: 10, overflow: 'hidden' }}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={`btn sm ${range === r.key ? 'primary' : ''}`}
              style={{ border: 'none', borderRadius: 0 }}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="kpis">
        <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => navigate('/receipts')}>
          <div className="klabel"><i className="ti ti-coins" /> Total collection</div>
          <div className="kval">QAR {fmtMoney(kpis.totalCollection)}</div>
          <div className="ktrend up">{periodLabel}</div>
        </div>
        <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => navigate('/reports')}>
          <div className="klabel"><i className="ti ti-clock-hour-4" /> Pending balance</div>
          <div className="kval">QAR {fmtMoney(kpis.pendingBalance)}</div>
          <div className="ktrend down">Outstanding from customers</div>
        </div>
        <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => navigate('/receipt-request')}>
          <div className="klabel"><i className="ti ti-receipt" /> Open receipts</div>
          <div className="kval">{fmtMoney(kpis.unbookedReceipts)}</div>
          <div className="ktrend">Not yet booked to invoices</div>
        </div>
        <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => navigate('/invoices')}>
          <div className="klabel"><i className="ti ti-circle-check" /> Invoices to approve</div>
          <div className="kval">{fmtMoney(kpis.invoicesToApprove)}</div>
          <div className="ktrend">Awaiting approval</div>
        </div>
      </div>

      {/* Collection trend + by package */}
      <div className="grid2">
        <Panel title="Collection overview" sub={periodLabel}>
          {trend.length ? (
            <ChartBox><Line data={lineData} options={lineOpts} /></ChartBox>
          ) : (
            <Empty icon="ti-chart-line" text="No collections in this period." />
          )}
        </Panel>
        <Panel title="Revenue by package">
          {topPackages.length ? (
            <>
              <ChartBox height={180}><Doughnut data={doughnutData} options={doughnutOpts} /></ChartBox>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {topPackages.map((p, i) => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[i % PALETTE.length], flex: '0 0 auto' }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <strong>{fmtMoney(p.amount)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty icon="ti-chart-donut" text="No package revenue yet." />
          )}
        </Panel>
      </div>

      {/* Income vs Expense + departures */}
      <div className="grid2eq">
        <Panel title="Income vs Expense" sub="Last 6 months">
          {ie6.length ? (
            <ChartBox><Bar data={ieData} options={ieOpts} /></ChartBox>
          ) : (
            <Empty icon="ti-chart-bar" text="No income / expense data." />
          )}
        </Panel>
        <Panel title="Upcoming departures" sub="Passengers by departure date">
          {departures.length ? (
            <ChartBox><Bar data={depData} options={depOpts} /></ChartBox>
          ) : (
            <Empty icon="ti-plane-departure" text="No upcoming departures." />
          )}
        </Panel>
      </div>

      {/* Recent invoices + receipts */}
      <div className="grid2eq">
        <Panel title="Recent invoices">
          {recentInvoices.length ? (
            <table className="tbl">
              <thead>
                <tr><th>Inv</th><th>Date</th><th>Customer</th><th className="num">Net</th><th>Status</th></tr>
              </thead>
              <tbody>
                {recentInvoices.map((r) => (
                  <tr key={r.InvoiceCode}>
                    <td>{r.InvoiceNo}</td>
                    <td>{fmtDate(r.InvoiceDate)}</td>
                    <td>{r.CustomerName}</td>
                    <td className="num">{fmtMoney(r.NetAmount)}</td>
                    <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon="ti-file-invoice" text="No recent invoices." />
          )}
        </Panel>
        <Panel title="Recent receipts">
          {recentReceipts.length ? (
            <table className="tbl">
              <thead>
                <tr><th>Rec No</th><th>Date</th><th>Customer</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {recentReceipts.map((r) => (
                  <tr key={r.RecieptCode}>
                    <td>{r.RecieptNo}</td>
                    <td>{fmtDate(r.RecieptDate)}</td>
                    <td>{r.CustomerName}</td>
                    <td className="num">{fmtMoney(r.RecievedAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon="ti-receipt" text="No recent receipts." />
          )}
        </Panel>
      </div>
    </div>
  );
}
