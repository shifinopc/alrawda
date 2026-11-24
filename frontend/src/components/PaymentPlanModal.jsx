import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtMoney, fmtDate } from '../api';
import { Modal, Field, Badge, useToast, useConfirm, PrintStyle } from './ui';
import { usePerms } from '../permissions';
import PaymentPlanDoc from './PaymentPlanDoc';

/* Instalment (EMI) plan for one invoice.
   The schedule only — this never writes money. Which rows are paid is decided by
   the server from the receipts, so this modal never claims a row is settled. */

const MAX = 60;

/** Split `total` into `n` whole riyals; the remainder lands on the last one. */
function splitEqually(total, n) {
  const base = Math.floor(total / n);
  const parts = Array(n).fill(base);
  parts[n - 1] = total - base * (n - 1);
  return parts;
}

/** Same day of the month, `months` on, clamped to a short month (31 Jan -> 28 Feb). */
function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

const buildRows = (balance, count, firstDue) =>
  splitEqually(balance, count).map((amount, i) => ({ dueDate: addMonths(firstDue, i), amount: String(amount) }));

const toneOf = (status) => (status === 'Paid' ? 'green' : status === 'Overdue' ? 'red' : status === 'Part paid' ? 'warn' : undefined);

export default function PaymentPlanModal({ invoice, plan, onClose, onSaved, canEdit, printTemplate, planTemplate }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { can } = usePerms();
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [tailRows, setTailRows] = useState([]);

  const balance = Number(invoice.balance) || 0;
  const received = Number(invoice.received) || 0;
  const firstDefault = useMemo(() => addMonths(new Date().toLocaleDateString('en-CA'), 1), []);

  // kept as typed text, not a number: clamping on every keystroke rewrote the box to "1"
  // the moment it was cleared, so a second digit could never be typed.
  const [countText, setCountText] = useState('5');
  const [firstDue, setFirstDue] = useState(firstDefault);
  const [rows, setRows] = useState(() => (plan ? [] : buildRows(balance, 5, firstDefault)));

  // changing the count or the first date regenerates; editing a cell leaves the rest alone
  const usableCount = (text) => {
    const n = Number(text);
    return Number.isInteger(n) && n >= 1 && n <= MAX ? n : null;
  };
  const changeCount = (text) => {
    setCountText(text);
    const n = usableCount(text);
    if (n && firstDue) setRows(buildRows(balance, n, firstDue));
  };
  // an empty or silly box settles back to whatever the table actually holds
  const settleCount = () => { if (!usableCount(countText)) setCountText(String(rows.length)); };
  const changeFirstDue = (nextFirst) => {
    setFirstDue(nextFirst);
    const n = usableCount(countText) || rows.length;
    if (nextFirst && n) setRows(buildRows(balance, n, nextFirst));
  };
  const setCell = (i, key, value) =>
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, [key]: value } : r)));

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const diff = total - balance;
  // A wrong total is shown on the total bar, so only row-level faults go in the footer —
  // otherwise the same sentence appears twice.
  const rowProblem = useMemo(() => {
    if (!rows.length) return 'Add at least one instalment.';
    let prev = null;
    for (const [i, r] of rows.entries()) {
      const amount = Number(r.amount);
      if (!Number.isInteger(amount) || amount <= 0) return `Instalment ${i + 1}: enter a whole amount above zero.`;
      if (!r.dueDate) return `Instalment ${i + 1}: pick a due date.`;
      if (prev && r.dueDate <= prev) return `Instalment ${i + 1} is not after instalment ${i}.`;
      prev = r.dueDate;
    }
    return null;
  }, [rows]);

  // the office may knowingly schedule past the flight, so this warns rather than blocks
  const lastDue = rows.length ? rows[rows.length - 1].dueDate : null;
  const departure = invoice.DepartureDate ? String(invoice.DepartureDate).slice(0, 10) : null;
  const pastDeparture = departure && lastDue && lastDue > departure;
  // only meaningful while every instalment is the same — as on the office's paper sheet
  const monthly = rows.length > 1 && rows.every((r) => r.amount === rows[0].amount)
    ? Number(rows[0].amount) : null;

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/invoices/${invoice.InvoiceCode}/plan`,
        { lines: rows.map((x) => ({ dueDate: x.dueDate, amount: Number(x.amount) })) });
      toast(`Payment plan saved — ${rows.length} instalments`);
      if (r?.warning) toast(r.warning, 'warn');
      onSaved?.();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const cancelPlan = async () => {
    if (!(await confirm({
      title: 'Cancel this payment plan?',
      message: 'The schedule is removed from the invoice. Receipts and balances are not affected.',
      confirmText: 'Cancel plan', tone: 'danger',
    }))) return;
    setBusy(true);
    try {
      await api.del(`/api/invoices/${invoice.InvoiceCode}/plan`);
      toast('Payment plan cancelled');
      onSaved?.();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const title = `Payment plan · Invoice ${invoice.InvoiceNo}`;

  /* ---------- an existing plan: show it, don't re-edit it ---------- */
  if (plan) {
    // Money is credited oldest-first, so only the next instalment due can be taken —
    // offering "Receive" on a later row would credit this one instead and mislead.
    const nextDue = plan.instalments.find((i) => i.status !== 'Paid');
    const canReceive = can('Receipt', 'Create') && !plan.stale && !!nextDue;
    const receive = (it) => {
      onClose?.();
      navigate(`/receipts?invoice=${invoice.InvoiceCode}&amount=${it.amount - it.paid}`);
    };

    // Settled instalments stay exactly where they are; only the rest can move.
    const settled = plan.instalments.filter((i) => i.status === 'Paid');
    const openRows = plan.instalments.filter((i) => i.status !== 'Paid');
    const openTotal = openRows.reduce((t, i) => t + i.amount, 0);
    const canReschedule = canEdit && !plan.stale && openRows.length > 0;

    const startReschedule = () => {
      setTailRows(openRows.map((i) => ({ dueDate: i.dueDate, amount: String(i.amount) })));
      setRescheduling(true);
    };
    const tailTotal = tailRows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
    const tailDiff = tailTotal - openTotal;
    const lastSettled = settled.length ? settled[settled.length - 1].dueDate : null;
    const tailProblem = (() => {
      if (!tailRows.length) return 'Keep at least one instalment.';
      let prev = lastSettled;
      for (const [i, r] of tailRows.entries()) {
        const amount = Number(r.amount);
        if (!Number.isInteger(amount) || amount <= 0) return `Instalment ${settled.length + i + 1}: enter a whole amount above zero.`;
        if (!r.dueDate) return `Instalment ${settled.length + i + 1}: pick a due date.`;
        if (prev && r.dueDate <= prev) {
          return i === 0
            ? `The first rescheduled instalment must fall after ${fmtDate(lastSettled)}, the last one already paid.`
            : `Instalment ${settled.length + i + 1} is not after the one before it.`;
        }
        prev = r.dueDate;
      }
      return null;
    })();

    const saveReschedule = async () => {
      setBusy(true);
      try {
        const r = await api.put(`/api/invoices/${invoice.InvoiceCode}/plan`,
          { lines: tailRows.map((x) => ({ dueDate: x.dueDate, amount: Number(x.amount) })) });
        toast(`Rescheduled ${r.rescheduled} instalment${r.rescheduled === 1 ? '' : 's'}${r.kept ? `, kept ${r.kept} already paid` : ''}`);
        if (r?.warning) toast(r.warning, 'warn');
        setRescheduling(false);
        onSaved?.();
      } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
    };

    const shiftTail = (months) => setTailRows((rs) => rs.map((r) => ({ ...r, dueDate: addMonths(r.dueDate, months) })));
    return (
      <Modal
        title={title}
        onClose={onClose}
        width={560}
        footer={rescheduling ? (
          <>
            <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>
              {tailProblem
                ? <><i className="ti ti-alert-circle" /> {tailProblem}</>
                : tailDiff
                  ? <><i className="ti ti-alert-circle" /> {fmtMoney(Math.abs(tailDiff))} {tailDiff > 0 ? 'too much' : 'short'} of the {fmtMoney(openTotal)} still to collect</>
                  : null}
            </span>
            <button className="btn" disabled={busy} onClick={() => setRescheduling(false)}>Cancel</button>
            <button className="btn primary" disabled={busy || !!tailProblem || !!tailDiff} onClick={saveReschedule}>
              <i className="ti ti-device-floppy" /> Save new dates
            </button>
          </>
        ) : (
          <>
            {canEdit && (
              <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={cancelPlan}>
                <i className="ti ti-trash" /> Cancel plan
              </button>
            )}
            {canReschedule && (
              <button className="btn" onClick={startReschedule}>
                <i className="ti ti-calendar-cog" /> Reschedule
              </button>
            )}
            <button className="btn" onClick={() => window.print()}>
              <i className="ti ti-printer" /> Print schedule
            </button>
            <button className="btn" onClick={onClose}>Close</button>
          </>
        )}
      >
        {plan.stale && (
          <div className="plan-warn">
            <i className="ti ti-alert-triangle" />
            <div>This invoice changed after the plan was made, so the schedule no longer adds up to what is
              owed. Cancel it and issue a new one — it will not re-split itself.</div>
          </div>
        )}
        <div className="plan-sum">
          <div><small>Invoice Amount</small><b>{fmtMoney(invoice.NetAmount)}</b></div>
          <div><small>Plan covers</small><b>{fmtMoney(plan.plannedAmount)}</b></div>
          <div className="acc"><small>Settled</small><b>{plan.paidCount} of {plan.count}</b></div>
        </div>
        {rescheduling && (
          <div className="plan-warn" style={{ background: 'var(--accent-soft)' }}>
            <i className="ti ti-calendar-cog" style={{ color: 'var(--accent)' }} />
            <div>
              {settled.length
                ? <>The {settled.length} instalment{settled.length === 1 ? '' : 's'} already paid stay as {settled.length === 1 ? 'it is' : 'they are'}. Move the rest below — the total must still come to {fmtMoney(openTotal)}.</>
                : <>Nothing has been paid yet, so every instalment can move. The total must still come to {fmtMoney(openTotal)}.</>}
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <button className="btn sm" onClick={() => shiftTail(1)}>+1 month</button>
                <button className="btn sm" onClick={() => shiftTail(2)}>+2 months</button>
                <button className="btn sm" onClick={() => shiftTail(-1)}>−1 month</button>
              </div>
            </div>
          </div>
        )}
        <div className="plan-rows">
          <table>
            <thead>
              <tr>
                <th />
                <th>Due date</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                {!rescheduling && <th style={{ textAlign: 'right' }}>Paid</th>}
                {!rescheduling && <th style={{ width: 92 }}>Status</th>}
                {!rescheduling && canReceive && <th style={{ width: 96 }} />}
              </tr>
            </thead>
            <tbody>
              {rescheduling ? (
                <>
                  {settled.map((it) => (
                    <tr key={`s${it.seq}`} style={{ opacity: 0.6 }}>
                      <td className="seq">{it.seq}</td>
                      <td>{fmtDate(it.dueDate)} <Badge tone="green">Paid</Badge></td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(it.amount)}</td>
                    </tr>
                  ))}
                  {tailRows.map((r, i) => (
                    <tr key={`t${i}`}>
                      <td className="seq">{settled.length + i + 1}</td>
                      <td>
                        <input type="date" value={r.dueDate}
                          onChange={(e) => setTailRows((rs) => rs.map((x, n) => (n === i ? { ...x, dueDate: e.target.value } : x)))} />
                      </td>
                      <td>
                        <input type="number" min="1" step="1" value={r.amount}
                          onChange={(e) => setTailRows((rs) => rs.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)))} />
                      </td>
                    </tr>
                  ))}
                </>
              ) : plan.instalments.map((it) => (
                <tr key={it.seq}>
                  <td className="seq">{it.seq}</td>
                  <td>{fmtDate(it.dueDate)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(it.amount)}</td>
                  <td style={{ textAlign: 'right', color: it.paid ? undefined : 'var(--faint)' }}>
                    {it.paid ? fmtMoney(it.paid) : '—'}
                  </td>
                  <td><Badge tone={toneOf(it.status)}>{it.status}</Badge></td>
                  {canReceive && (
                    <td style={{ textAlign: 'right' }}>
                      {it.seq === nextDue?.seq && (
                        <button className="btn sm" onClick={() => receive(it)}>
                          <i className="ti ti-cash" /> Receive
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PrintStyle id="plan-print" paper="a4" />
        {/* the Invoices page keeps its own PrintStyle, which un-hides #inv-print —
            without this the invoice prints underneath the schedule */}
        <style>{'@media print { #inv-print { display: none !important; } }'}</style>
        <div id="plan-print" className="print-only">
          <PaymentPlanDoc invoice={invoice} plan={plan} printTemplate={printTemplate} planTemplate={planTemplate} />
        </div>
        <div className={`plan-total${rescheduling ? (tailDiff ? ' bad' : ' good') : ''}`}>
          {rescheduling ? (
            <>
              <span>{tailRows.length} instalment{tailRows.length === 1 ? '' : 's'} to collect</span>
              <b>QAR {fmtMoney(tailTotal)} of {fmtMoney(openTotal)}</b>
            </>
          ) : (
            <>
              <span>Credited to the oldest unpaid instalment</span>
              <b>QAR {fmtMoney(plan.instalments.reduce((a2, i) => a2 + i.paid, 0))} of {fmtMoney(plan.plannedAmount)}</b>
            </>
          )}
        </div>
      </Modal>
    );
  }

  /* ---------- no plan yet: build one ---------- */
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={560}
      footer={
        <>
          {rowProblem && (
            <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>
              <i className="ti ti-alert-circle" /> {rowProblem}
            </span>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !!rowProblem || !!diff} onClick={save}>
            <i className="ti ti-device-floppy" /> Save plan
          </button>
        </>
      }
    >
      <div className="plan-sum">
        <div><small>Invoice Amount</small><b>{fmtMoney(invoice.NetAmount)}</b></div>
        <div><small>Already paid</small><b>{fmtMoney(received)}</b></div>
        <div className="acc"><small>Balance to plan</small><b>{fmtMoney(balance)}</b></div>
      </div>

      <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 12 }}>
        <Field label="Instalments" required>
          <input type="number" min="1" max={MAX} value={countText}
            onChange={(e) => changeCount(e.target.value)} onBlur={settleCount} />
        </Field>
        <Field label="First due date" required>
          <input type="date" value={firstDue} onChange={(e) => changeFirstDue(e.target.value)} />
        </Field>
      </div>

      {monthly && (
        <p className="plan-monthly">
          <b>QAR {fmtMoney(monthly)}</b> a month, {fmtDate(rows[0].dueDate)} to {fmtDate(lastDue)}
        </p>
      )}

      {pastDeparture && (
        <div className="plan-warn">
          <i className="ti ti-alert-triangle" />
          <div>The schedule runs past the departure date ({fmtDate(departure)}). You can still save it.</div>
        </div>
      )}

      <div className="plan-rows">
        <table>
          <thead>
            <tr><th /><th>Due date</th><th style={{ textAlign: 'right' }}>Amount (QAR)</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="seq">{i + 1}</td>
                <td className="due">
                  <input type="date" value={r.dueDate} onChange={(e) => setCell(i, 'dueDate', e.target.value)} />
                </td>
                <td className="amt">
                  <input type="number" min="1" step="1" value={r.amount}
                    onChange={(e) => setCell(i, 'amount', e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`plan-total ${diff ? 'bad' : 'good'}`}>
        <span>
          {rows.length} instalment{rows.length === 1 ? '' : 's'}
          {diff ? <> · <span className="plan-gap">{fmtMoney(Math.abs(diff))} {diff > 0 ? 'too much' : 'short'}</span></>
            : <> · matches the balance</>}
        </span>
        <b>QAR {fmtMoney(total)}</b>
      </div>
    </Modal>
  );
}
