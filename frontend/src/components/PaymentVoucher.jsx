import React from 'react';
import { fmtMoney, fmtDate } from '../api';
import { docNo } from '../docNumber';
import { mergeTemplate, mergePaymentTemplate } from '../printTemplate';
import { DocWatermark, DocHeader, DocFooter, DocPrintMeta, Cell } from './DocParts';

/** Printable payment voucher (Expense / Refund) — same design language as the receipt.
 *  Branding from Settings → Invoice Template; options from Settings → Payment Template. */
export default function PaymentVoucher({ p, printTemplate, paymentTemplate }) {
  const t = mergeTemplate(printTemplate);
  const pt = mergePaymentTemplate(paymentTemplate);
  const cur = pt.currencyLabel || 'QAR';
  const isRefund = p.TypeOfPayment === 'Refund';

  return (
    <div className="rcv" style={{ '--acc': pt.accentColor || '#8a1538' }}>
      <DocWatermark t={t} />
      <DocHeader t={t} />
      <div className="rcv-accentbar" />

      {/* title band */}
      <div className="rcv-titleband">
        <span className="rcv-doc">{pt.titleEn}</span>
        <span className="rcv-chip">No. {docNo('payment', p.PaymentNo, p.PaymentDate, p.CreatedAt)}</span>
        <span className="rcv-mode">{isRefund ? 'Refund · استرداد' : 'Expense · مصروف'}</span>
        <span className="rcv-meta">Date: <b>{fmtDate(p.PaymentDate)}</b></span>
        <span className="rcv-doc rcv-rtl">{pt.titleAr}</span>
      </div>

      {/* amount banner */}
      <div className="rcv-amount">
        <span>Paid Amount ({cur})</span>
        <b>{fmtMoney(p.PaymentAmount)}</b>
        <span className="rcv-rtl">المبلغ المدفوع</span>
      </div>

      {/* details */}
      <div className="rcv-grid">
        <Cell en="Paid To" ar="دفع إلى" span>
          <b>{isRefund && p.CustomerName ? p.CustomerName : p.PaidTo || '—'}</b>
        </Cell>
        <Cell en="Mobile No" ar="رقم الاتصال">{p.MobileNo || '—'}</Cell>
        <Cell en={isRefund ? 'Against Invoice' : 'Payment Type'} ar={isRefund ? 'مقابل فاتورة' : 'نوع الدفع'}>
          {isRefund ? (p.InvoiceNo ? docNo('invoice', p.InvoiceNo) : '—') : 'Expense'}
        </Cell>
        {isRefund && (
          <>
            <Cell en="Invoice Amount" ar="قيمة الفاتورة">{fmtMoney(p.InvoiceAmount)} {cur}</Cell>
            <Cell en="Collected Amount" ar="المبلغ المحصل">{fmtMoney(p.CollectedAmount)} {cur}</Cell>
          </>
        )}
        <Cell en={isRefund ? 'Reason' : 'Narration'} ar={isRefund ? 'السبب' : 'البيان'} span>
          {p.Narration || '—'}
        </Cell>
        {p.Remark && <Cell en="Remarks" ar="ملاحظات" span>{p.Remark}</Cell>}
        {isRefund && String(p.IsInvoiceCancel).trim() === 'Y' && (
          <Cell en="Invoice Cancelled" ar="الفاتورة ملغاة" span>
            <b style={{ color: 'var(--acc)' }}>Yes — full refund, invoice cancelled</b>
          </Cell>
        )}
      </div>

      {/* signatures */}
      {pt.showSignatures && (
        <div className="rcv-sigs">
          <div>Prepared by <span className="rcv-rtl">المحاسب</span></div>
          <div>Approved by <span className="rcv-rtl">مدير</span></div>
          <div>Received by <span className="rcv-rtl">المستلم</span></div>
        </div>
      )}

      <DocFooter t={t} bandText={pt.footerBandText} casesText={pt.footerCasesText} />
      <DocPrintMeta createdBy={p.CreatedByName} createdAt={p.CreatedAt} />
    </div>
  );
}
