import React, { useEffect, useState } from 'react';
import { api, fmtMoney, fmtDate, fmtDateTime, todayStr } from '../api';
import { docNo, useDocNo } from '../docNumber';
import { useToast, Badge, Panel, Field, Empty, PrintStyle, Loader, Select } from '../components/ui';
import ReportDoc from '../components/ReportDoc';
import CustomerLedger from './CustomerLedger';

/* ---- column definitions: { key, label, num (sum in footer), date } ---- */
const INCOME_SUMMARY_COLS = [
  { key: 'InvoiceNo', label: 'Invoice No', doc: 'invoice', dateKey: 'InvoiceDate', createdKey: 'CreatedAt' },
  { key: 'InvoiceDate', label: 'Date', date: true },
  { key: 'CustomerName', label: 'Customer' },
  { key: 'DepartureDate', label: 'Departure', date: true },
  { key: 'InvoiceAmount', label: 'Invoice Amt', num: true },
  { key: 'ReceivedAmount', label: 'Received', num: true },
  { key: 'RefundAmount', label: 'Refund', num: true },
  { key: 'AdjustmentAmount', label: 'Adjustment', num: true },
  { key: 'Income', label: 'Income', num: true },
  { key: 'Balance', label: 'Balance', num: true },
  // receipt-approval progress: approved receipts / total receipts (e.g. 1/2, 2/2)
  { key: 'ReceiptApproval', label: 'Rcpt. Approved',
    render: (r) => Number(r.ReceiptCount) > 0 ? `${Number(r.ApprovedReceiptCount)}/${Number(r.ReceiptCount)}` : '—' },
  { key: 'InvoiceStatus', label: 'Status', badge: true },
];

const REPORTS = {
  'income-summary': {
    label: 'Income Summary',
    path: '/api/reports/income-summary',
    cols: INCOME_SUMMARY_COLS,
  },
  pending: {
    label: 'Pending',
    path: '/api/reports/pending',
    cols: [
      { key: 'InvoiceNo', label: 'Invoice No', doc: 'invoice', dateKey: 'InvoiceDate', createdKey: 'CreatedAt' },
      { key: 'InvoiceDate', label: 'Date', date: true },
      { key: 'CustomerName', label: 'Customer' },
      { key: 'Mobile1', label: 'Mobile' },
      { key: 'InvoiceAmount', label: 'Invoice Amt', num: true },
      { key: 'ReceivedAmount', label: 'Received', num: true },
      { key: 'Balance', label: 'Balance', num: true },
    ],
  },
  'income-report': {
    label: 'Income Report',
    path: '/api/reports/income-report',
    sections: [
      { dataKey: 'invoices', title: 'Invoices', cols: INCOME_SUMMARY_COLS },
      {
        dataKey: 'receipts',
        title: 'Receipts',
        cols: [
          { key: 'RecieptNo', label: 'Receipt No', doc: 'receipt', dateKey: 'RecieptDate', createdKey: 'CreatedAt' },
          { key: 'RecieptDate', label: 'Date', date: true },
          { key: 'RecievedAmount', label: 'Amount', num: true },
          { key: 'InvoiceNo', label: 'Invoice No', doc: 'invoice', dateKey: 'InvoiceDate', createdKey: 'InvCreatedAt' },
        ],
      },
      {
        dataKey: 'refunds',
        title: 'Refunds',
        cols: [
          { key: 'PaymentNo', label: 'Payment No', doc: 'payment', dateKey: 'PaymentDate', createdKey: 'CreatedAt' },
          { key: 'PaymentDate', label: 'Date', date: true },
          { key: 'PaymentAmount', label: 'Amount', num: true },
          { key: 'InvoiceNo', label: 'Invoice No', doc: 'invoice', dateKey: 'InvoiceDate', createdKey: 'InvCreatedAt' },
        ],
      },
    ],
  },
  passengers: {
    label: 'Passengers List',
    path: '/api/reports/passengers',
    cols: [
      { key: 'DepartureDate', label: 'Departure', date: true },
      { key: 'InvoiceNo', label: 'Invoice No', doc: 'invoice', dateKey: 'InvoiceDate', createdKey: 'CreatedAt' },
      { key: 'CustomerName', label: 'Customer' },
      { key: 'SlNo', label: 'Sl No' },
      { key: 'PassengerName', label: 'Passenger' },
      { key: 'VisaType', label: 'Visa Type' },
    ],
  },
  'departure-wise': {
    label: 'Departure Date wise',
    path: '/api/reports/departure-wise',
    cols: INCOME_SUMMARY_COLS,
  },
  expense: {
    label: 'Expense',
    path: '/api/reports/expense',
    cols: [
      { key: 'PaymentNo', label: 'Payment No', doc: 'payment', dateKey: 'PaymentDate', createdKey: 'CreatedAt' },
      { key: 'PaymentDate', label: 'Date', date: true },
      { key: 'PaidTo', label: 'Paid To' },
      { key: 'Narration', label: 'Narration' },
      { key: 'PaymentAmount', label: 'Amount', num: true },
    ],
  },
  refund: {
    label: 'Refund',
    path: '/api/reports/refund',
    cols: [
      { key: 'PaymentNo', label: 'Payment No', doc: 'payment', dateKey: 'PaymentDate', createdKey: 'CreatedAt' },
      { key: 'PaymentDate', label: 'Date', date: true },
      { key: 'InvoiceNo', label: 'Invoice No', doc: 'invoice', dateKey: 'InvoiceDate', createdKey: 'InvCreatedAt' },
      { key: 'CustomerName', label: 'Customer' },
      { key: 'Reason', label: 'Reason' },
      { key: 'PaidAmount', label: 'Paid', num: true },
      { key: 'RefundAmount', label: 'Refund', num: true },
      { key: 'InvoiceCancelled', label: 'Cancelled' },
    ],
  },
  adjustment: {
    label: 'Invoice Adjustment',
    path: '/api/reports/adjustment',
    cols: [
      { key: 'created_at', label: 'Date', datetime: true },
      { key: 'InvoiceNo', label: 'Invoice No', doc: 'invoice', dateKey: 'InvoiceDate', createdKey: 'InvCreatedAt' },
      { key: 'CustomerName', label: 'Customer' },
      { key: 'reason', label: 'Reason' },
      { key: 'remarks', label: 'Remarks' },
      { key: 'Amount', label: 'Amount', num: true },
      { key: 'status', label: 'Status', badge: true },
      { key: 'created_by_name', label: 'Created By' },
      { key: 'approved_by_name', label: 'Approved By' },
    ],
  },
  'agent-wise': {
    label: 'Agent wise',
    path: '/api/reports/agent-wise',
    agentFilter: true,
    cols: [
      { key: 'AgentName', label: 'Agent' },
      { key: 'InvoiceNo', label: 'Invoice No', doc: 'invoice', dateKey: 'InvoiceDate', createdKey: 'CreatedAt' },
      { key: 'RecNo', label: 'Receipt No',
        render: (r) => (r.receipts || []).map((x) => docNo('receipt', x.RecieptNo, x.RecieptDate, x.CreatedAt)).join(', ') || '—' },
      { key: 'CustomerName', label: 'Customer' },
      { key: 'InvoiceAmount', label: 'Invoice Amt', num: true },
      { key: 'ReceivedAmount', label: 'Received', num: true },
      { key: 'AdjustmentAmount', label: 'Adjustment', num: true },
      { key: 'RefundAmount', label: 'Refund', num: true },
      { key: 'Balance', label: 'Balance', num: true },
      { key: 'InvoiceStatus', label: 'Status', badge: true },
    ],
  },
};

const statusTone = (s) =>
  ({ Paid: 'green', 'Partially Paid': 'warn', 'Not Paid': 'red', Cancelled: 'red',
     Approved: 'green', Rejected: 'red', Draft: 'warn' }[s] || 'blue');

const firstOfMonthStr = () => todayStr().slice(0, 8) + '01';

const cellText = (col, row) => {
  const v = row[col.key];
  if (col.render) return col.render(row);
  // format document numbers (invoice / receipt / payment) with the same prefix rules as
  // the rest of the app — migrated docs stay raw, new ones get the INV-/RCT-/PAY- prefix
  if (col.doc) return v == null || v === '' ? '' : docNo(col.doc, v, row[col.dateKey], row[col.createdKey]);
  if (col.datetime) return v ? fmtDateTime(v) : '';
  if (col.date) return v ? fmtDate(v) : '';
  if (col.num) return fmtMoney(v);
  return v == null ? '' : String(v);
};

function ReportTable({ cols, rows }) {
  if (!rows || !rows.length) return <Empty icon="ti-file-search" text="No records found for this period." />;
  const hasTotals = cols.some((c) => c.num);
  return (
    <table className="tbl">
      <thead>
        <tr>{cols.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c.key} className={c.num ? 'num' : ''}>
                {c.badge && r[c.key]
                  ? <Badge tone={statusTone(r[c.key])}>{r[c.key]}</Badge>
                  : cellText(c, r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {hasTotals && (
        <tfoot>
          <tr>
            {cols.map((c, i) => (
              <td key={c.key} className={c.num ? 'num' : ''}>
                {i === 0 ? `Total (${rows.length})` : c.num ? fmtMoney(rows.reduce((s, r) => s + Number(r[c.key] || 0), 0)) : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

// Agent-wise table: one row per RECEIPT, with the invoice-level cells (agent, invoice,
// amounts, status) merged (rowSpan) across that invoice's receipt rows.
function AgentWiseTable({ cols, rows }) {
  if (!rows || !rows.length) return <Empty icon="ti-file-search" text="No records found for this period." />;
  const hasTotals = cols.some((c) => c.num);
  return (
    <table className="tbl">
      <thead>
        <tr>{cols.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((inv, ri) => {
          const recs = inv.receipts && inv.receipts.length ? inv.receipts : [null];
          return recs.map((rec, i) => (
            <tr key={`${ri}-${i}`}>
              {cols.map((c) => {
                if (c.key === 'RecNo') {
                  return <td key={c.key}>{rec ? docNo('receipt', rec.RecieptNo, rec.RecieptDate, rec.CreatedAt) : '—'}</td>;
                }
                if (i > 0) return null; // merged from the first receipt row
                return (
                  <td key={c.key} className={c.num ? 'num' : ''} rowSpan={recs.length} style={{ verticalAlign: 'middle' }}>
                    {c.badge && inv[c.key] ? <Badge tone={statusTone(inv[c.key])}>{inv[c.key]}</Badge> : cellText(c, inv)}
                  </td>
                );
              })}
            </tr>
          ));
        })}
      </tbody>
      {hasTotals && (
        <tfoot>
          <tr>
            {cols.map((c, i) => (
              <td key={c.key} className={c.num ? 'num' : ''}>
                {i === 0 ? `Total (${rows.length})` : c.num ? fmtMoney(rows.reduce((s, r) => s + Number(r[c.key] || 0), 0)) : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/* ---- CSV helpers ---- */
const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

const tableToCsvLines = (cols, rows) => {
  const lines = [cols.map((c) => csvCell(c.label)).join(',')];
  (rows || []).forEach((r) => {
    lines.push(cols.map((c) => csvCell(c.doc || c.render ? cellText(c, r) : c.datetime ? (r[c.key] ? fmtDateTime(r[c.key]) : '') : c.date ? (r[c.key] ? fmtDate(r[c.key]) : '') : c.num ? Number(r[c.key] || 0) : r[c.key])).join(','));
  });
  if (cols.some((c) => c.num)) {
    lines.push(cols.map((c, i) => (i === 0 ? csvCell('Total') : c.num ? (rows || []).reduce((s, r) => s + Number(r[c.key] || 0), 0) : '')).join(','));
  }
  return lines;
};

export default function Reports() {
  const push = useToast();
  useDocNo(); // load the numbering config so invoice/receipt/payment numbers render with the right prefix
  const [tab, setTab] = useState('reports');
  const [type, setType] = useState('income-summary');
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  // result = { type, from, to, data } for the last fetched report
  const [result, setResult] = useState(null);
  const [templates, setTemplates] = useState({ print: null, report: null });
  const [agents, setAgents] = useState([]);
  const [agentCode, setAgentCode] = useState('');

  useEffect(() => {
    api.get('/api/settings/prefs')
      .then((d) => setTemplates({ print: d.prefs?.printTemplate || {}, report: d.prefs?.reportTemplate || {} }))
      .catch(() => setTemplates({ print: {}, report: {} }));
    api.get('/api/masters/agents').then((d) => setAgents(d.rows || [])).catch(() => {});
  }, []);

  const runFilter = async () => {
    setLoading(true);
    try {
      const def = REPORTS[type];
      const q = new URLSearchParams({ from, to });
      if (def.agentFilter && agentCode) q.set('agentCode', agentCode);
      const data = await api.get(`${def.path}?${q.toString()}`);
      setResult({ type, from, to, data });
    } catch (e) {
      // translate raw API errors (e.g. a 404 "Not found: GET /reports/…") into a clear message
      const raw = e.message || '';
      const msg = /not found/i.test(raw)
        ? `The "${def.label}" report isn't available on the server yet. Please make sure the app is fully updated, then try again.`
        : /session expired/i.test(raw)
          ? 'Your session has expired — please sign in again.'
          : `Couldn't load the ${def.label} report. Please try again${raw ? ` (${raw})` : ''}.`;
      push(msg);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!result) { push('Load a report first, then export.'); return; }
    const def = REPORTS[result.type];
    let lines = [];
    if (def.sections) {
      def.sections.forEach((s, i) => {
        if (i > 0) lines.push('');
        lines.push(csvCell(s.title));
        lines = lines.concat(tableToCsvLines(s.cols, result.data[s.dataKey] || []));
      });
    } else {
      lines = tableToCsvLines(def.cols, result.data.rows || []);
    }
    download(['﻿' + lines.join('\r\n')], 'text/csv;charset=utf-8;', 'report.csv');
  };

  // native Excel via an HTML-table workbook (.xls opens directly in Excel with formatting)
  const exportExcel = () => {
    if (!result) { push('Load a report first, then export.'); return; }
    const def = REPORTS[result.type];
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const tableHtml = (cols, rows) => {
      const head = `<tr>${cols.map((c) => `<th style="background:#8a1538;color:#fff;border:1px solid #ccc;padding:4px">${esc(c.label)}</th>`).join('')}</tr>`;
      const body = (rows || []).map((r) =>
        `<tr>${cols.map((c) => `<td style="border:1px solid #ccc;padding:4px"${c.num ? ' x:num' : ''}>${esc(c.doc || c.render ? cellText(c, r) : c.datetime ? (r[c.key] ? fmtDateTime(r[c.key]) : '') : c.date ? (r[c.key] ? fmtDate(r[c.key]) : '') : c.num ? Number(r[c.key] || 0) : r[c.key])}</td>`).join('')}</tr>`).join('');
      const totals = cols.some((c) => c.num)
        ? `<tr>${cols.map((c, i) => `<td style="border:1px solid #ccc;padding:4px;font-weight:bold">${i === 0 ? 'Total' : c.num ? (rows || []).reduce((s, r) => s + Number(r[c.key] || 0), 0) : ''}</td>`).join('')}</tr>`
        : '';
      return `<table>${head}${body}${totals}</table>`;
    };
    let inner = `<h3>${esc(def.label)} — ${fmtDate(result.from)} to ${fmtDate(result.to)}</h3>`;
    if (def.sections) {
      def.sections.forEach((s) => { inner += `<h4>${esc(s.title)}</h4>` + tableHtml(s.cols, result.data[s.dataKey] || []); });
    } else {
      inner += tableHtml(def.cols, result.data.rows || []);
    }
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${inner}</body></html>`;
    download([html], 'application/vnd.ms-excel;charset=utf-8;', `${result.type}.xls`);
  };

  const download = (parts, type, filename) => {
    const url = URL.createObjectURL(new Blob(parts, { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const def = result ? REPORTS[result.type] : null;

  if (tab === 'ledger') {
    return (
      <div>
        <div className="set-tabs" style={{ marginBottom: 14, borderRadius: 14, border: '1px solid var(--line)' }}>
          <div className="set-tab" onClick={() => setTab('reports')}>
            <i className="ti ti-chart-bar" style={{ marginRight: 6 }} /> All Reports
          </div>
          <div className="set-tab active">
            <i className="ti ti-book-2" style={{ marginRight: 6 }} /> Customer Ledger
          </div>
        </div>
        <CustomerLedger />
      </div>
    );
  }

  return (
    <div>
      <PrintStyle id="report-print" landscape />

      <div className="set-tabs" style={{ marginBottom: 14, borderRadius: 14, border: '1px solid var(--line)' }}>
        <div className="set-tab active">
          <i className="ti ti-chart-bar" style={{ marginRight: 6 }} /> All Reports
        </div>
        <div className="set-tab" onClick={() => setTab('ledger')}>
          <i className="ti ti-book-2" style={{ marginRight: 6 }} /> Customer Ledger
        </div>
      </div>

      <Panel title="All Report" sub="Choose a report type and a date range">
        <div className="radios" style={{ flexWrap: 'wrap' }}>
          {Object.entries(REPORTS).map(([key, r]) => (
            <label key={key}>
              <input
                type="radio"
                name="reporttype"
                checked={type === key}
                onChange={() => setType(key)}
              />
              {r.label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <Field label="Start Date">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="End Date">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {REPORTS[type].agentFilter && (
            <Field label="Agent">
              <div style={{ minWidth: 200 }}>
                <Select value={agentCode} onChange={setAgentCode} placeholder="All agents"
                  options={[{ value: '', label: 'All agents' }, ...agents.map((a) => ({ value: String(a.AgentCode), label: a.AgentName }))]} />
              </div>
            </Field>
          )}
          <div style={{ display: 'flex', gap: 6, paddingBottom: 2 }}>
            <button className="btn sm" onClick={() => { setFrom(todayStr()); setTo(todayStr()); }}>Today</button>
            <button className="btn sm" onClick={() => { setFrom(firstOfMonthStr()); setTo(todayStr()); }}>This month</button>
            <button
              className="btn sm"
              onClick={() => {
                const d = new Date(); d.setDate(1); d.setDate(0); // last day of previous month
                const end = d.toISOString().slice(0, 10);
                setFrom(end.slice(0, 8) + '01'); setTo(end);
              }}
            >
              Last month
            </button>
            <button
              className="btn sm"
              onClick={() => { setFrom(todayStr().slice(0, 4) + '-01-01'); setTo(todayStr()); }}
            >
              This year
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" onClick={runFilter} disabled={loading}>
              <i className="ti ti-filter" /> {loading ? 'Loading…' : 'Filter'}
            </button>
            <button className="btn" onClick={() => window.print()}>
              <i className="ti ti-printer" /> Print / Preview
            </button>
            <button className="btn success" onClick={exportExcel}>
              <i className="ti ti-file-spreadsheet" /> Export Excel
            </button>
            <button className="btn" onClick={exportCsv}>
              <i className="ti ti-file-text" /> CSV
            </button>
          </div>
        </div>
      </Panel>

      <div id="report-print" style={{ marginTop: 14 }}>
        {loading ? (
          <Loader text="Loading report…" />
        ) : !result ? (
          <Empty
            icon="ti-report-analytics"
            text="Choose a report type and date range, then click Filter to load the report."
          />
        ) : (
          <ReportDoc
            title={REPORTS[result.type].label}
            from={result.from}
            to={result.to}
            printTemplate={templates.print}
            reportTemplate={templates.report}
          >
            {def.sections ? (
              def.sections.map((s) => (
                <div key={s.dataKey} style={{ marginBottom: 16 }}>
                  <div className="rpt-section">{s.title}</div>
                  <ReportTable cols={s.cols} rows={result.data[s.dataKey]} />
                </div>
              ))
            ) : result.type === 'agent-wise' ? (
              <AgentWiseTable cols={def.cols} rows={result.data.rows} />
            ) : (
              <ReportTable cols={def.cols} rows={result.data.rows} />
            )}
          </ReportDoc>
        )}
      </div>
    </div>
  );
}
