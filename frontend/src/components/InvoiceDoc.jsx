import React from 'react';
import { fmtMoney, fmtDate } from '../api';
import { docNo } from '../docNumber';
import { mergeTemplate, mergeInvoiceTemplate } from '../printTemplate';
import { DocWatermark, DocHeader, DocFooter, DocPrintMeta, Cell } from './DocParts';

const STATUS_AR = { Paid: 'مدفوع', 'Partially Paid': 'مدفوع جزئياً', 'Not Paid': 'غير مدفوع', Cancelled: 'ملغى' };

/** Printable invoice — same design language as the receipt voucher.
 *  Branding from Settings → Invoice Template (header/logo/watermark/footer images);
 *  invoice options from the same tab's "Invoice voucher options". */
export default function InvoiceDoc({ invoice, passengers = [], receipts = [], refunds = [], printTemplate, invoiceTemplate }) {
  const t = mergeTemplate(printTemplate);
  const it = mergeInvoiceTemplate(invoiceTemplate);
  const cur = it.currencyLabel || 'QAR';
  const inv = invoice;
  const paid = Number(inv.received || 0);
  const balance = inv.balance != null ? Number(inv.balance) : Number(inv.NetAmount || 0) - paid;

  return (
    <div className="rcv rcv-inv" style={{ '--acc': it.accentColor || '#8a1538' }}>
      <DocWatermark t={t} />
      <DocHeader t={t} />
      <div className="rcv-accentbar" />

      {/* title band */}
      <div className="rcv-titleband">
        <span className="rcv-doc">{it.titleEn}</span>
        <span className="rcv-chip">No. {docNo('invoice', inv.InvoiceNo, inv.InvoiceDate, inv.CreatedAt)}</span>
        {inv.status && <span className="rcv-mode">{inv.status}{STATUS_AR[inv.status] ? ` · ${STATUS_AR[inv.status]}` : ''}</span>}
        <span className="rcv-meta">Date: <b>{fmtDate(inv.InvoiceDate)}</b> · Departure: <b>{fmtDate(inv.DepartureDate)}</b></span>
        <span className="rcv-doc rcv-rtl">{it.titleAr}</span>
      </div>

      {/* customer details */}
      <div className="rcv-grid">
        <Cell en="Customer" ar="العميل" span>
          <b>{inv.CustomerName}</b>{inv.Nationality ? ` (${inv.Nationality})` : ''}
        </Cell>
        <Cell en="Mobile No 1" ar="رقم الاتصال 1">{inv.Mobile1 || '—'}</Cell>
        <Cell en="Mobile No 2" ar="رقم الاتصال 2">{inv.Mobile2 || '—'}</Cell>
        <Cell en="Package" ar="باقة">{inv.PackageName || '—'}</Cell>
        {inv.ShowAgent && inv.AgentName && (
          <Cell en="Agent" ar="الوكيل">{inv.AgentName}{inv.AgentMobile ? ` (${inv.AgentMobile})` : ''}</Cell>
        )}
        <Cell en="Room Type" ar="نوع الغرفة">{inv.RoomType || '—'}</Cell>
        {inv.RoomDetails && <Cell en="Room Details" ar="تفاصيل الغرفة" span>{inv.RoomDetails}</Cell>}
      </div>

      {/* counts strip */}
      <div className="rcv-counts">
        <div><small>Passengers <span className="rcv-rtl">عدد الركاب</span></small><b>{inv.PassengerCount ?? 0}</b></div>
        <div><small>Seat <span className="rcv-rtl">عدد المقاعد</span></small><b>{inv.SeatCount ?? 0}</b></div>
        <div><small>Visa <span className="rcv-rtl">عدد تأشيرات</span></small><b>{inv.VisaCount ?? 0}</b></div>
      </div>

      {/* passengers */}
      {it.showPassengers && passengers.length > 0 && (
        <>
          <div className="rcv-sec">Passengers <span className="rcv-rtl">تفاصيل الركاب</span></div>
          <table className="rcv-table">
            <thead>
              <tr><th style={{ width: 36 }}>SL</th><th>Passenger Name</th><th>Visa Type</th><th>Visa Required</th></tr>
            </thead>
            <tbody>
              {passengers.map((p) => (
                <tr key={p.SlNo}>
                  <td>{p.SlNo}</td>
                  <td>{p.PassengerName}</td>
                  <td>{p.VisaType || '—'}</td>
                  <td>{p.VisaRequiredCode ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* amount summary */}
      <div className="rcv-sumrow">
        <div><small>Amount <span className="rcv-rtl">المبلغ</span></small><b>{fmtMoney(inv.Amount)} {cur}</b></div>
        <div><small>Discount <span className="rcv-rtl">الخصم</span></small><b>{fmtMoney(inv.DiscountAmount)} {cur}</b></div>
        <div className="acc"><small>Net Amount <span className="rcv-rtl">الصافي</span></small><b>{fmtMoney(inv.NetAmount)} {cur}</b></div>
        <div><small>Paid <span className="rcv-rtl">المدفوع</span></small><b>{fmtMoney(paid)} {cur}</b></div>
        <div className="acc"><small>Balance Due <span className="rcv-rtl">الرصيد المتبقي</span></small><b>{fmtMoney(balance)} {cur}</b></div>
      </div>

      {/* paid history */}
      {it.showReceipts && receipts.length > 0 && (
        <>
          <div className="rcv-sec">Receipts — paid history <span className="rcv-rtl">سندات القبض</span></div>
          <table className="rcv-table">
            <thead>
              <tr><th>Receipt No</th><th>Date</th><th>Mode</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {receipts.map((r, i) => (
                <tr key={i}>
                  <td>{docNo('receipt', r.RecieptNo, r.RecieptDate)}</td>
                  <td>{fmtDate(r.RecieptDate)}</td>
                  <td>{r.PaymentMode}</td>
                  <td className="num">{fmtMoney(r.RecievedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {refunds.length > 0 && (
        <>
          <div className="rcv-sec">Refunds <span className="rcv-rtl">المبالغ المستردة</span></div>
          <table className="rcv-table">
            <thead><tr><th>Payment No</th><th>Date</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {refunds.map((r, i) => (
                <tr key={i}>
                  <td>{docNo('payment', r.PaymentNo, r.PaymentDate)}</td>
                  <td>{fmtDate(r.PaymentDate)}</td>
                  <td className="num">{fmtMoney(r.PaymentAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* remarks */}
      {inv.Remarks && (
        <div className="rcv-cell" style={{ marginTop: 8 }}>
          <div className="rcv-lbl"><span>Remarks</span><span className="rcv-rtl">ملاحظات</span></div>
          <div className="rcv-val" style={{ whiteSpace: 'pre-wrap' }}>{inv.Remarks}</div>
        </div>
      )}

      {/* signatures */}
      {it.showSignatures && (
        <div className="rcv-sigs">
          <div>Manager <span className="rcv-rtl">مدير</span></div>
          <div>Customer <span className="rcv-rtl">عميل</span></div>
          <div>Prepared by <span className="rcv-rtl">المحاسب</span></div>
        </div>
      )}

      <DocFooter t={t} bandText={it.footerBandText} casesText={it.footerCasesText} />
      <DocPrintMeta createdBy={inv.CreatedByName} createdAt={inv.CreatedAt} />
    </div>
  );
}
