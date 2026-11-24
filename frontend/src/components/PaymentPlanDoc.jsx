import React from 'react';
// the paper form prints bare numbers (28000, not 28,000)
const num = (v) => String(Math.round(Number(v) || 0));
import { roomText, DocPrintMeta } from './DocParts';
import { mergeTemplate, mergePlanTemplate } from '../printTemplate';

/* The instalment schedule handed to the pilgrim — a copy of the office's paper
   form. Figures are LIVE, not a snapshot of when the plan was made, and that
   keeps the sheet self-consistent: the plan always covers exactly the balance,
   so "المتبقي" equals the instalments still unpaid, however many have been
   settled since. */

const ymd = (iso) => (iso ? String(iso).slice(0, 10).replace(/-/g, '/') : '');
const ym = (iso) => (iso ? String(iso).slice(0, 7).replace('-', '/') : '');

export default function PaymentPlanDoc({ invoice, plan, printTemplate, planTemplate }) {
  if (!plan) return null;
  const t = mergeTemplate(printTemplate);
  const p = mergePlanTemplate(planTemplate);

  const received = Number(plan.received) || 0;
  const remaining = Math.max(0, Number(plan.balance) || 0);
  const first = plan.instalments[0];
  const last = plan.instalments[plan.instalments.length - 1];
  // the paper's "الدفعة الشهرية : N ريال" line only states one figure, so it is
  // only honest while every instalment is that figure
  const even = plan.instalments.length > 1
    && plan.instalments.every((i) => i.amount === first.amount);

  const Row = ({ label, children }) => (
    <tr>
      <td className="pd-l">{label}</td>
      <td className="pd-v">{children}</td>
    </tr>
  );

  return (
    <div className="rcv pd">
      {/* same masthead as the reports: logo left, centred titles, accent bar */}
      <div className="pd-head-wrap">
        {t.headerImage ? (
          <img src={t.headerImage} alt="" style={{ display: 'block', width: '100%', marginBottom: 10 }} />
        ) : (
          <div className="rpt-head">
            {t.showLogo && <img className="rpt-logo" src={t.logoImage || '/alrawda-logo.jpg'} alt="" />}
            <div className="rpt-titles">
              <div className="rpt-ar">{t.headerLine2}</div>
              <div className="rpt-en">{t.headerLine1}</div>
              <div className="rpt-contact">{t.headerContact}</div>
              <div className="rpt-contact">{t.headerContact2}</div>
            </div>
            {t.showLogo && <div style={{ width: 62 }} />}
          </div>
        )}
        <div className="rpt-accentbar" />
      </div>

      <table className="pd-tbl">
        <tbody>
          <Row label={p.labelName}>{invoice.CustomerName}</Row>
          <Row label={p.labelRoom}>{(invoice.RoomDetails || '').trim() || roomText(invoice.RoomType, '')}</Row>
          <Row label={p.labelTotal}>{num(invoice.NetAmount)}</Row>
          <Row label={p.labelPaid}>{num(received)}</Row>
          <Row label={p.labelRemaining}>{num(remaining)}</Row>
        </tbody>
      </table>

      {even && (
        <p className="pd-monthly">
          الدفعة الشهرية : {num(first.amount)} ريال ابتداً من تاريخ {ymd(first.dueDate)} الى
          تاريخ {ymd(last.dueDate)}
        </p>
      )}

      <table className="pd-tbl pd-sched">
        <tbody>
          {plan.instalments.map((it) => (
            <tr key={it.seq} className={it.status === 'Paid' ? 'pd-paid' : it.paid > 0 ? 'pd-part' : undefined}>
              <td className="pd-l">دفعة شهر {ym(it.dueDate)}</td>
              <td className="pd-v">
                {num(it.amount)}
                {it.status === 'Paid' && <span className="pd-mark"> ✔ {p.paidMark}</span>}
                {it.status !== 'Paid' && it.paid > 0 && (
                  <span className="pd-mark part"> {p.partMark} {num(it.paid)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="pd-note">{p.transferNote}</p>

      <table className="pd-bank">
        <tbody>
          <tr><td className="pd-l">{p.labelFawran} :</td><td className="pd-v">{p.fawranNo}</td></tr>
          <tr><td className="pd-l">{p.labelIban} :</td><td className="pd-v">{p.iban}</td></tr>
          <tr><td className="pd-l">{p.labelAccount} :</td><td className="pd-v">{p.accountName}</td></tr>
        </tbody>
      </table>

      <div className="pd-rule" />
      <DocPrintMeta createdBy={invoice.CreatedByName} createdAt={invoice.CreatedAt} />
    </div>
  );
}
