import React from 'react';
import { fmtMoney, fmtDate } from '../api';
import { docNo } from '../docNumber';
import { mergeTemplate, mergeReceiptTemplate, WM_COLORS } from '../printTemplate';
import { DocPrintMeta } from './DocParts';

/** Printable receipt voucher — modern design.
 *  Branding (header/logo/watermark) comes from Settings → Invoice Template;
 *  all receipt content options come from Settings → Receipt Template. */
export default function ReceiptVoucher({ r, invoiceAmount, passengers = [], invoiceRemarks = '', printTemplate, receiptTemplate }) {
  const t = mergeTemplate(printTemplate);
  const rt = mergeReceiptTemplate(printTemplate, receiptTemplate);
  const accent = rt.accentColor || '#8a1538';
  const cur = rt.currencyLabel || 'QAR';
  const totalAmount = r.InvoiceAmount ?? invoiceAmount;
  // invoice passengers -> { name, visa, required }; longest names first so "AHMED ALI" wins over "AHMED"
  const paxInfo = (passengers || [])
    .map((p) => ({
      name: (p.PassengerName || '').trim().toUpperCase(),
      visa: (p.VisaType || '').trim(),
      required: p.VisaRequiredCode == null ? null : Number(p.VisaRequiredCode) === 1,
    }))
    .filter((p) => p.name)
    .sort((a, b) => b.name.length - a.name.length);
  // each line -> { text: "Name — Visa Type", required: bool|null }.
  // Visa-required is shown on-screen (preview) but hidden in PRINT (see .rcv-visa-req rule).
  const paxLines = (r.PassengerDetails || '').split('\n').map((s) => s.trim()).filter(Boolean)
    .map((line) => {
      const nameOnly = line.split('—')[0].trim(); // strip any existing "— visa …" suffix
      const m = paxInfo.find((p) => nameOnly.toUpperCase().includes(p.name)); // tolerate "1." prefixes
      if (!m) return { text: line, required: null };
      return { text: m.visa ? `${nameOnly} — ${m.visa}` : nameOnly, required: m.required };
    });
  const notes = String(rt.notesArabic || '').split('\n').map((s) => s.trim()).filter(Boolean);

  // standard receipt money breakdown (fall back gracefully for migrated receipts
  // that don't have a stored previous/current balance)
  const received = Number(r.RecievedAmount) || 0;
  const hasCur = r.CurrentBalanceAmount != null && r.CurrentBalanceAmount !== '';
  const hasPre = r.PreBalanceAmount != null && r.PreBalanceAmount !== '';
  const curBalance = hasCur ? Number(r.CurrentBalanceAmount)
    : hasPre ? Number(r.PreBalanceAmount) - received
    : totalAmount != null ? Number(totalAmount) - received : null;
  const preBalance = hasPre ? Number(r.PreBalanceAmount)
    : hasCur ? Number(r.CurrentBalanceAmount) + received
    : totalAmount != null ? Number(totalAmount) : null;
  const fmtAmt = (v) => (v == null ? '—' : `${fmtMoney(v)} ${cur}`);

  const Cell = ({ en, ar, children, span }) => (
    <div className="rcv-cell" style={span ? { gridColumn: '1 / -1' } : undefined}>
      <div className="rcv-lbl"><span>{en}</span><span className="rcv-rtl">{ar}</span></div>
      <div className="rcv-val">{children ?? '—'}</div>
    </div>
  );

  return (
    <div className="rcv" style={{ '--acc': accent }}>
      {/* watermark (Invoice Template) */}
      {t.wmEnabled && (
        <div
          className="rcv-wm"
          style={{
            color: WM_COLORS[t.wmColor] || WM_COLORS.violet,
            opacity: (t.wmOpacity || 9) / 100,
            transform: t.wmStyle === 'diagonal' ? 'rotate(-28deg)' : 'none',
            flexWrap: t.wmStyle === 'tiled' ? 'wrap' : 'nowrap',
            gap: t.wmStyle === 'tiled' ? 40 : 0,
            fontSize: t.wmStyle === 'tiled' ? 26 : 46,
          }}
        >
          {t.wmImage ? (
            t.wmStyle === 'tiled'
              ? Array.from({ length: 6 }, (_, i) => <img key={i} src={t.wmImage} alt="" style={{ width: 110 }} />)
              : <img src={t.wmImage} alt="" style={{ width: 200 }} />
          ) : t.wmStyle === 'tiled' ? (
            Array.from({ length: 6 }, (_, i) => <span key={i}>{t.wmText}</span>)
          ) : (
            t.wmText
          )}
        </div>
      )}

      {/* header (Invoice Template uploads / lines) */}
      {t.headerImage ? (
        <img src={t.headerImage} alt="" className="rcv-headimg" />
      ) : (
        <div className="rcv-head">
          {t.showLogo && <img className="rcv-logo" src={t.logoImage || '/alrawda-logo.jpg'} alt="" />}
          <div className="rcv-titles" style={{ textAlign: t.headerAlign === 'left' ? 'left' : 'center' }}>
            <div className="rcv-ar-title">{t.headerLine2}</div>
            <div className="rcv-en-title">{t.headerLine1}</div>
            <div className="rcv-contact">{t.headerContact}</div>
            <div className="rcv-contact">{t.headerContact2}</div>
          </div>
          {t.headerAlign !== 'left' && t.showLogo && <div style={{ width: 74 }} />}
        </div>
      )}
      <div className="rcv-accentbar" />

      {/* document title band */}
      <div className="rcv-titleband">
        <span className="rcv-doc">{rt.titleEn}</span>
        <span className="rcv-chip-num">No. {docNo('receipt', r.RecieptNo, r.RecieptDate, r.CreatedAt)}</span>
        <span className="rcv-mode">{r.PaymentMode}{r.PaymentMode === 'Bank' && r.Bank ? ` — ${r.Bank}${r.ChequeNo ? ` / ${r.ChequeNo}` : ''}` : ''}</span>
        <span className="rcv-meta">Date: <b>{fmtDate(r.RecieptDate)}</b></span>
        {r.InvoiceNo && <span className="rcv-chip">Invoice {docNo('invoice', r.InvoiceNo)}</span>}
        <span className="rcv-doc rcv-rtl">{rt.titleAr}</span>
      </div>

      {/* amount banner */}
      <div className="rcv-amount">
        <span>Received Amount ({cur})</span>
        <b>{fmtMoney(r.RecievedAmount)}</b>
        <span className="rcv-rtl">المبلغ المستلم (ريال قطري)</span>
      </div>

      {/* details grid */}
      <div className="rcv-grid">
        <Cell en="Received from Mr./Messrs" ar="استلمت من السيد / السادة" span>
          <b>{r.CustomerName}</b>{r.Nationality ? ` (${r.Nationality})` : ''}
        </Cell>
        <Cell en="Contact No. 1" ar="رقم الاتصال 1">{r.Mobile1 || '—'}</Cell>
        <Cell en="Contact No. 2" ar="رقم الاتصال 2">{r.Mobile2 || '—'}</Cell>
        <Cell en="Room Type" ar="نوع الغرفة">{r.RoomDetails || r.RoomType || '—'}</Cell>
        <Cell en="Departure Date" ar="تاريخ المغادرة">{fmtDate(r.DepartureDate)}</Cell>
        <Cell en="Package" ar="باقة" span>{r.PackageName || '—'}</Cell>
        {r.ShowAgent && r.AgentName ? (
          <Cell en="Agent" ar="الوكيل" span>{r.AgentName}{r.AgentMobile ? ` (${r.AgentMobile})` : ''}</Cell>
        ) : null}
      </div>

      {/* counts strip */}
      {rt.showCounts && (
        <div className="rcv-counts">
          <div><small>Passengers <span className="rcv-rtl">عدد الركاب</span></small><b>{r.PassengerCount ?? 0}</b></div>
          <div><small>Seat <span className="rcv-rtl">عدد المقاعد</span></small><b>{r.SeatCount ?? 0}</b></div>
          <div><small>Visa <span className="rcv-rtl">عدد تأشيرات</span></small><b>{r.VisaCount ?? 0}</b></div>
        </div>
      )}

      {/* passengers + totals */}
      <div className="rcv-split">
        {rt.showPassengers && (
          <div className="rcv-pax">
            <div className="rcv-lbl"><span>Passengers Details</span><span className="rcv-rtl">تفاصيل الركاب</span></div>
            {paxLines.length
              ? paxLines.map((l, i) => (
                <div key={i} className="rcv-paxline">
                  {l.text}
                  {l.required != null && <span className="rcv-visa-req"> — Visa Required: {l.required ? 'Yes' : 'No'}</span>}
                </div>
              ))
              : <div className="rcv-paxline" style={{ color: '#999' }}>—</div>}
          </div>
        )}
        <div className="rcv-totals">
          <div className="row">
            <span>Invoice Amount <span className="rcv-rtl">قيمة الفاتورة</span></span>
            <b>{fmtAmt(totalAmount)}</b>
          </div>
          <div className="row rcv-prevbal">
            <span>Previous Balance <span className="rcv-rtl">الرصيد السابق</span></span>
            <b>{fmtAmt(preBalance)}</b>
          </div>
          <div className="row">
            <span>Received Amount <span className="rcv-rtl">المبلغ المستلم</span></span>
            <b>{fmtAmt(received)}</b>
          </div>
          <div className="row acc">
            <span>Current Balance <span className="rcv-rtl">الرصيد الحالي</span></span>
            <b>{fmtAmt(curBalance)}</b>
          </div>
        </div>
      </div>

      {/* remarks */}
      <div className="rcv-cell" style={{ marginTop: 8 }}>
        <div className="rcv-lbl"><span>Remarks</span><span className="rcv-rtl">ملاحظات</span></div>
        <div className="rcv-val" style={{ minHeight: 18 }}>{r.InvRemarks || invoiceRemarks || ''}</div>
      </div>

      {/* arabic notes (Receipt Template) */}
      {rt.showNotes && notes.length > 0 && (
        <div className="rcv-notes">
          {notes.map((n, i) => <div key={i}>• {n}</div>)}
        </div>
      )}

      {/* signatures */}
      {rt.showSignatures && (
        <div className="rcv-sigs">
          <div>Manager <span className="rcv-rtl">مدير</span></div>
          <div>Customer <span className="rcv-rtl">عميل</span></div>
          <div>Receiver's Signature <span className="rcv-rtl">توقيع المستلم</span></div>
        </div>
      )}

      {/* footer */}
      {t.footerImage ? (
        <img src={t.footerImage} alt="" style={{ display: 'block', width: '100%' }} />
      ) : (
        <>
          {rt.footerBandText && <div className="rcv-foot">{rt.footerBandText}</div>}
          {rt.footerCasesText && <div className="rcv-cases">{rt.footerCasesText}</div>}
        </>
      )}

      <DocPrintMeta createdBy={r.CreatedByName} createdAt={r.CreatedAt} />
    </div>
  );
}
