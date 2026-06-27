import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime, getUser, clearSession } from '../api';
import { Select, useToast, Badge, Panel, Field, Empty, Loader } from '../components/ui';
import { TEMPLATE_DEFAULTS, mergeReceiptTemplate, mergeReportTemplate, mergeInvoiceTemplate, mergePaymentTemplate } from '../printTemplate';
import ReceiptVoucher from '../components/ReceiptVoucher';
import ReportDoc from '../components/ReportDoc';
import InvoiceDoc from '../components/InvoiceDoc';
import PaymentVoucher from '../components/PaymentVoucher';
import { COUNTRIES, setAppTimeZone } from '../countries';
import QRCode from 'qrcode';

const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

/* ---------- shared switch ---------- */
const Swt = ({ on, onChange }) => (
  <button type="button" className={`swt${on ? ' on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />
);
const SwtRow = ({ label, sub, on, onChange }) => (
  <div className="swtrow">
    <div className="swl">{label}{sub && <small>{sub}</small>}</div>
    <Swt on={on} onChange={onChange} />
  </div>
);

/* =================== Company Info =================== */
function CompanyTab() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({ companyName: '', nameArabic: '', address: '', phone: '', email: '', currencyCode: '' });
  const [logo, setLogo] = useState(null);
  const [region, setRegion] = useState({ country: '', timeZone: '' });

  useEffect(() => {
    (async () => {
      try {
        const [data, cur, prefsRes] = await Promise.all([
          api.get('/api/settings/company'),
          api.get('/api/settings/currencies'),
          api.get('/api/settings/prefs').catch(() => null),
        ]);
        setCurrencies(cur.rows || []);
        const c = data.company || {};
        const b = data.branch || {};
        const qar = (cur.rows || []).find((x) => x.shortName === 'QAR');
        setForm({
          companyName: c.CompanyName || '',
          nameArabic: b.BranchNameinArabic || '',
          address: c.Address || b.Address1 || '',
          phone: c.Phone1 || b.Phone1 || '',
          email: c.EMail || b.EMailID || '',
          currencyCode: c.HCurrencyCode || (qar ? qar.CurrencyCode : ''),
        });
        setLogo(data.logo || null);
        const r = prefsRes?.prefs?.region;
        if (r?.timeZone) setRegion({ country: r.country || '', timeZone: r.timeZone });
      } catch (e) {
        toast(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSave = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings/company', {
        companyName: form.companyName.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        nameArabic: form.nameArabic.trim(),
        currencyCode: form.currencyCode ? Number(form.currencyCode) : null,
        logo: logo || '',
      });
      // region / time zone is a UI preference (drives the header clock)
      await api.put('/api/settings/prefs', { region });
      setAppTimeZone(region.timeZone || null);
      window.dispatchEvent(new Event('app-timezone-changed'));
      toast('Company info saved');
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Company Info"
      sub="Shown on invoices, receipts and reports"
      toolbar={
        <button className="btn primary" onClick={onSave} disabled={saving || loading}>
          <i className="ti ti-device-floppy" /> Save company info
        </button>
      }
    >
      {loading ? (
        <Loader />
      ) : (
        <div className="fgrid">
          <Field label="Company Name (English)">
            <input value={form.companyName} onChange={set('companyName')} />
          </Field>
          <Field label="Company Name (Arabic)">
            <input className="ar" placeholder="اسم الشركة" value={form.nameArabic} onChange={set('nameArabic')} />
          </Field>
          <Field label="Currency">
            <Select value={form.currencyCode} onChange={(v) => setForm((f) => ({ ...f, currencyCode: v }))}
              options={currencies.map((c) => ({ value: c.CurrencyCode, label: `${c.shortName} — ${c.name}${c.symbol ? ` (${c.symbol})` : ''}` }))} />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Country / Time zone">
            <Select value={region.timeZone} placeholder="Select country…"
              onChange={(v) => { const c = COUNTRIES.find((x) => x.tz === v); setRegion({ country: c ? c.name : '', timeZone: v }); }}
              options={COUNTRIES.map((c) => ({ value: c.tz, label: c.name }))} />
          </Field>
          <Field label="Address" className="full">
            <input value={form.address} onChange={set('address')} />
          </Field>
          <ImageUpload
            label="Company logo" sub="Used on emails and as the app logo — PNG / JPG, up to ~600 KB"
            value={logo} onChange={setLogo} toast={toast}
          />
        </div>
      )}
    </Panel>
  );
}

/* =================== Invoice Template (print) =================== */
const MAX_IMG_BYTES = 900 * 1024; // ~900 KB per image after base64 encoding

function ImageUpload({ label, sub, value, onChange, toast }) {
  const pick = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose an image file (PNG / JPG)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result.length > MAX_IMG_BYTES) {
        toast(`${label}: image is too large — keep it under ~600 KB`);
        return;
      }
      onChange(reader.result);
    };
    reader.readAsDataURL(file);
  };
  return (
    <div className="field upfield">
      <label>{label}</label>
      {value ? (
        <div className="upthumb">
          <img src={value} alt={label} />
          <button type="button" className="uprm" title="Remove image" onClick={() => onChange(null)}>
            <i className="ti ti-x" />
          </button>
        </div>
      ) : (
        <label className="upbox" style={{ display: 'block' }}>
          <i className="ti ti-photo-up" />
          Upload image
          <small>{sub || 'PNG / JPG, up to ~600 KB'}</small>
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
        </label>
      )}
    </div>
  );
}

const SAMPLE_INVOICE = {
  InvoiceNo: 8457, InvoiceDate: '2026-06-01', DepartureDate: '2026-06-10',
  CustomerName: 'MOHAMMAD JAHIRUL ISLAM', Nationality: 'Bangladeshi',
  Mobile1: '66224568', Mobile2: '', PackageName: '5 Days Umrah With Visa', RoomType: 'Normal',
  PassengerCount: 2, SeatCount: 2, VisaCount: 2,
  Amount: 6550, DiscountAmount: 100, NetAmount: 6450, received: 5000, balance: 1450,
  status: 'Partially Paid', Remarks: '',
};
const SAMPLE_INVOICE_PAX = [
  { SlNo: 1, PassengerName: 'MOHAMMAD JAHIRUL ISLAM', VisaType: 'Umrah Visa', VisaRequiredCode: 1 },
  { SlNo: 2, PassengerName: 'RAHIMA BEGUM', VisaType: 'Umrah Visa', VisaRequiredCode: 1 },
];
const SAMPLE_INVOICE_RCPTS = [
  { RecieptNo: 12738, RecieptDate: '2026-06-01', PaymentMode: 'Cash', RecievedAmount: 5000 },
];

function TemplateTab({ prefs, savePrefs }) {
  const toast = useToast();
  const [t, setT] = useState({ ...TEMPLATE_DEFAULTS, ...(prefs.printTemplate || {}) });
  const [it, setIt] = useState(mergeInvoiceTemplate(prefs.invoiceTemplate));
  const [saving, setSaving] = useState(false);
  const set = (key) => (v) => setT((x) => ({ ...x, [key]: v }));
  const setE = (key) => (e) => setT((x) => ({ ...x, [key]: e.target.value }));
  const setI = (key) => (v) => setIt((x) => ({ ...x, [key]: v }));
  const setIE = (key) => (e) => setIt((x) => ({ ...x, [key]: e.target.value }));

  const onSave = async () => {
    setSaving(true);
    try {
      await savePrefs({ printTemplate: t, invoiceTemplate: it });
      toast('Invoice template saved');
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid2" style={{ alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Panel title="Print header" sub="Top of every printed invoice / receipt">
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <ImageUpload
              label="Header image — full-width banner" sub="Replaces the text header when set"
              value={t.headerImage} onChange={set('headerImage')} toast={toast}
            />
            <ImageUpload
              label="Or company logo" sub="Shown above the header lines"
              value={t.logoImage} onChange={set('logoImage')} toast={toast}
            />
            <Field label="Header alignment">
              <Select value={t.headerAlign} onChange={set('headerAlign')}
                options={[{ value: 'center', label: 'Center' }, { value: 'left', label: 'Left' }]} />
            </Field>
            <Field label="Header line 1 (Company)">
              <input value={t.headerLine1} onChange={setE('headerLine1')} />
            </Field>
            <Field label="Header line 2 (Arabic)">
              <input className="ar" value={t.headerLine2} onChange={setE('headerLine2')} />
            </Field>
            <Field label="Header contact line (Tel / Mob)">
              <input value={t.headerContact} onChange={setE('headerContact')} />
            </Field>
            <Field label="Header address line">
              <input value={t.headerContact2} onChange={setE('headerContact2')} />
            </Field>
          </div>
          <SwtRow label="Show logo on print" on={t.showLogo} onChange={set('showLogo')} />

          <div className="msec" style={{ marginTop: 14 }}>Branded masthead (two-colour, logo style)</div>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Header style">
              <Select value={t.headerStyle} onChange={set('headerStyle')}
                options={[{ value: 'branded', label: 'Branded two-colour' }, { value: 'lines', label: 'Plain text lines' }]} />
            </Field>
            <Field label="Secondary (gold) colour">
              <input type="color" value={t.goldColor} onChange={setE('goldColor')} style={{ height: 38, padding: 3, cursor: 'pointer' }} />
            </Field>
            <Field label="English — maroon part">
              <input value={t.brandEnMaroon} onChange={setE('brandEnMaroon')} placeholder="AL RAWDA" />
            </Field>
            <Field label="English — gold part">
              <input value={t.brandEnGold} onChange={setE('brandEnGold')} placeholder="GROUP" />
            </Field>
            <Field label="English — sub line (gold)" className="full">
              <input value={t.brandEnSub} onChange={setE('brandEnSub')} placeholder="HAJJ & UMRAH SERVICES" />
            </Field>
            <Field label="Arabic — maroon line">
              <input className="ar" value={t.brandArMaroon} onChange={setE('brandArMaroon')} placeholder="حملة الروضة" />
            </Field>
            <Field label="Arabic — gold line">
              <input className="ar" value={t.brandArGold} onChange={setE('brandArGold')} placeholder="للحج والعمرة" />
            </Field>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            The maroon colour follows the invoice accent colour. Currently applied to the invoice — say the word to extend it to receipts &amp; payments.
          </div>
        </Panel>


        <Panel title="Print footer">
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <ImageUpload
              label="Footer image — full-width banner" sub="Replaces the footer text when set"
              value={t.footerImage} onChange={set('footerImage')} toast={toast}
            />
            <Field label="Footer text (if no image)">
              <textarea value={t.footerText} onChange={setE('footerText')} />
            </Field>
          </div>
          <SwtRow label="Show page numbers" sub={'"Page 1 of 2"'} on={t.showPageNumbers} onChange={set('showPageNumbers')} />
          <SwtRow label="Show signature lines" sub="Manager · Customer · Receiver" on={t.showSignatures} onChange={set('showSignatures')} />
        </Panel>

        <Panel title="Watermark">
          <SwtRow label="Enable watermark" on={t.wmEnabled} onChange={set('wmEnabled')} />
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <ImageUpload
              label="Watermark image (optional)" sub="Used instead of the text when set — e.g. a faded logo"
              value={t.wmImage} onChange={set('wmImage')} toast={toast}
            />
            <Field label="Watermark text (if no image)">
              <input value={t.wmText} onChange={setE('wmText')} disabled={!t.wmEnabled} />
            </Field>
            <Field label="Style">
              <Select value={t.wmStyle} onChange={set('wmStyle')} disabled={!t.wmEnabled}
                options={[{ value: 'diagonal', label: 'Diagonal' }, { value: 'center', label: 'Centered' }, { value: 'tiled', label: 'Tiled' }]} />
            </Field>
            <Field label={`Opacity — ${t.wmOpacity}%`}>
              <input
                type="range" min="3" max="30" value={t.wmOpacity}
                onChange={(e) => set('wmOpacity')(Number(e.target.value))}
                disabled={!t.wmEnabled} style={{ padding: 0, accentColor: 'var(--accent)' }}
              />
            </Field>
            <Field label="Colour">
              <Select value={t.wmColor} onChange={set('wmColor')} disabled={!t.wmEnabled}
                options={[{ value: 'violet', label: 'Brand violet' }, { value: 'grey', label: 'Grey' }, { value: 'blue', label: 'Light blue' }]} />
            </Field>
          </div>
        </Panel>

        <Panel title="Invoice voucher options" sub="Design of the printed invoice — preview on the right">
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <Field label="Accent colour">
              <input
                type="color" value={it.accentColor} onChange={setIE('accentColor')}
                style={{ height: 38, padding: 3, cursor: 'pointer' }}
              />
            </Field>
            <Field label="Title (English)">
              <input value={it.titleEn} onChange={setIE('titleEn')} />
            </Field>
            <Field label="Title (Arabic)">
              <input className="ar" value={it.titleAr} onChange={setIE('titleAr')} />
            </Field>
          </div>
          <div style={{ marginTop: 8 }}>
            <SwtRow label="Show passengers table" on={it.showPassengers} onChange={setI('showPassengers')} />
            <SwtRow label="Show receipts (paid history)" on={it.showReceipts} onChange={setI('showReceipts')} />
            <SwtRow label="Show signature lines" on={it.showSignatures} onChange={setI('showSignatures')} />
          </div>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
            <Field label="Footer band (Arabic)">
              <input className="ar" value={it.footerBandText} onChange={setIE('footerBandText')} />
            </Field>
            <Field label="Footer cases line (Arabic)">
              <input className="ar" value={it.footerCasesText} onChange={setIE('footerCasesText')} />
            </Field>
          </div>
        </Panel>

        <div>
          <button className="btn primary" onClick={onSave} disabled={saving}>
            <i className="ti ti-device-floppy" /> Save invoice template
          </button>
        </div>
      </div>

      <div className="lp-wrap">
        <Panel title="Live preview" sub="Sample invoice rendered with the current settings">
          <div style={{ transform: 'scale(0.82)', transformOrigin: 'top left', width: '122%' }}>
            <InvoiceDoc
              invoice={SAMPLE_INVOICE}
              passengers={SAMPLE_INVOICE_PAX}
              receipts={SAMPLE_INVOICE_RCPTS}
              printTemplate={t}
              invoiceTemplate={it}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* =================== Receipt Template =================== */
const SAMPLE_RECEIPT = {
  RecieptNo: 12752, RecieptDate: '2026-06-10', InvoiceNo: 8450, PaymentMode: 'Cash',
  RecievedAmount: 300, InvoiceAmount: 1300, CurrentBalanceAmount: 0,
  CustomerName: 'AKHTER HOSSAIN', Nationality: 'Bangladeshi',
  Mobile1: '66224568', Mobile2: '', PackageName: '10 Days Umrah With Visa',
  DepartureDate: '2026-06-10', RoomDetails: 'Normal',
  PassengerCount: 1, SeatCount: 1, VisaCount: 1,
  PassengerDetails: '1. AKHTER HOSSAIN (Tourist Visa)', InvRemarks: '',
};

function ReceiptTemplateTab({ prefs, savePrefs }) {
  const toast = useToast();
  const [rt, setRt] = useState(mergeReceiptTemplate(prefs.printTemplate, prefs.receiptTemplate));
  const [saving, setSaving] = useState(false);
  const set = (key) => (v) => setRt((x) => ({ ...x, [key]: v }));
  const setE = (key) => (e) => setRt((x) => ({ ...x, [key]: e.target.value }));

  const onSave = async () => {
    setSaving(true);
    try {
      await savePrefs({ receiptTemplate: rt });
      toast('Receipt template saved');
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid2" style={{ alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Panel
          title="Voucher options"
          sub="Header, logo and watermark come from the Invoice Template tab"
          toolbar={
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <i className="ti ti-device-floppy" /> Save receipt template
            </button>
          }
        >
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <Field label="Accent colour">
              <input
                type="color" value={rt.accentColor}
                onChange={setE('accentColor')}
                style={{ height: 38, padding: 3, cursor: 'pointer' }}
              />
            </Field>
            <Field label="Title (English)">
              <input value={rt.titleEn} onChange={setE('titleEn')} />
            </Field>
            <Field label="Title (Arabic)">
              <input className="ar" value={rt.titleAr} onChange={setE('titleAr')} />
            </Field>
            <Field label="Currency label">
              <input value={rt.currencyLabel} onChange={setE('currencyLabel')} />
            </Field>
          </div>
          <div style={{ marginTop: 8 }}>
            <SwtRow label="Show counts strip" sub="Passengers · Seat · Visa" on={rt.showCounts} onChange={set('showCounts')} />
            <SwtRow label="Show passenger details" on={rt.showPassengers} onChange={set('showPassengers')} />
            <SwtRow label="Show Arabic notes / terms" on={rt.showNotes} onChange={set('showNotes')} />
            <SwtRow label="Show signature lines" sub="Manager · Customer · Receiver" on={rt.showSignatures} onChange={set('showSignatures')} />
          </div>
        </Panel>

        <Panel title="Voucher text">
          <Field label="Notes / terms (Arabic) — one per line">
            <textarea className="ar" rows={5} value={rt.notesArabic} onChange={setE('notesArabic')} />
          </Field>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
            <Field label="Footer band (Arabic)">
              <input className="ar" value={rt.footerBandText} onChange={setE('footerBandText')} />
            </Field>
            <Field label="Footer cases line (Arabic)">
              <input className="ar" value={rt.footerCasesText} onChange={setE('footerCasesText')} />
            </Field>
          </div>
        </Panel>
      </div>

      <div className="lp-wrap">
        <Panel title="Live preview" sub="Sample receipt rendered with the current settings">
          <div style={{ transform: 'scale(0.82)', transformOrigin: 'top left', width: '122%' }}>
            <ReceiptVoucher r={SAMPLE_RECEIPT} printTemplate={prefs.printTemplate} receiptTemplate={rt} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* =================== Payment Template =================== */
const SAMPLE_PAYMENT = {
  PaymentNo: 3675, PaymentDate: '2026-06-08', TypeOfPayment: 'Expense',
  PaidTo: 'QATAR AIRWAYS', MobileNo: '', Narration: 'Ticket charges for group booking',
  Remark: '', PaymentAmount: 1500, InvoiceAmount: 0, CollectedAmount: 0, IsInvoiceCancel: 'N',
};

function PaymentTemplateTab({ prefs, savePrefs }) {
  const toast = useToast();
  const [pt, setPt] = useState(mergePaymentTemplate(prefs.paymentTemplate));
  const [saving, setSaving] = useState(false);
  const set = (key) => (v) => setPt((x) => ({ ...x, [key]: v }));
  const setE = (key) => (e) => setPt((x) => ({ ...x, [key]: e.target.value }));

  const onSave = async () => {
    setSaving(true);
    try {
      await savePrefs({ paymentTemplate: pt });
      toast('Payment template saved');
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid2" style={{ alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Panel
          title="Voucher options"
          sub="Header, logo and watermark come from the Invoice Template tab"
          toolbar={
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <i className="ti ti-device-floppy" /> Save payment template
            </button>
          }
        >
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <Field label="Accent colour">
              <input
                type="color" value={pt.accentColor} onChange={setE('accentColor')}
                style={{ height: 38, padding: 3, cursor: 'pointer' }}
              />
            </Field>
            <Field label="Title (English)">
              <input value={pt.titleEn} onChange={setE('titleEn')} />
            </Field>
            <Field label="Title (Arabic)">
              <input className="ar" value={pt.titleAr} onChange={setE('titleAr')} />
            </Field>
            <Field label="Currency label">
              <input value={pt.currencyLabel} onChange={setE('currencyLabel')} />
            </Field>
          </div>
          <div style={{ marginTop: 8 }}>
            <SwtRow label="Show signature lines" sub="Prepared by · Approved by · Received by" on={pt.showSignatures} onChange={set('showSignatures')} />
          </div>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
            <Field label="Footer band (Arabic, optional)">
              <input className="ar" value={pt.footerBandText} onChange={setE('footerBandText')} />
            </Field>
            <Field label="Footer cases line (Arabic, optional)">
              <input className="ar" value={pt.footerCasesText} onChange={setE('footerCasesText')} />
            </Field>
          </div>
        </Panel>
      </div>

      <div className="lp-wrap">
        <Panel title="Live preview" sub="Sample payment voucher rendered with the current settings">
          <div style={{ transform: 'scale(0.82)', transformOrigin: 'top left', width: '122%' }}>
            <PaymentVoucher p={SAMPLE_PAYMENT} printTemplate={prefs.printTemplate} paymentTemplate={pt} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* =================== Report Template =================== */
const SAMPLE_REPORT_ROWS = [
  { no: 8457, date: '01/06/2026', customer: 'MOHAMMAD JAHIRUL ISLAM', amount: 6450, received: 5000, balance: 1450 },
  { no: 8460, date: '02/06/2026', customer: 'SUMAN MEAH', amount: 2600, received: 0, balance: 2600 },
  { no: 8462, date: '02/06/2026', customer: 'HABIB ALI', amount: 350, received: 350, balance: 0 },
];

function ReportTemplateTab({ prefs, savePrefs }) {
  const toast = useToast();
  const [rt, setRt] = useState(mergeReportTemplate(prefs.reportTemplate));
  const [saving, setSaving] = useState(false);
  const set = (key) => (v) => setRt((x) => ({ ...x, [key]: v }));
  const setE = (key) => (e) => setRt((x) => ({ ...x, [key]: e.target.value }));

  const onSave = async () => {
    setSaving(true);
    try {
      await savePrefs({ reportTemplate: rt });
      toast('Report template saved');
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid2" style={{ alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Panel
          title="Report options"
          sub="Applies to every report under All Report — header branding comes from the Invoice Template tab"
          toolbar={
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <i className="ti ti-device-floppy" /> Save report template
            </button>
          }
        >
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 2fr' }}>
            <Field label="Accent colour">
              <input
                type="color" value={rt.accentColor} onChange={setE('accentColor')}
                style={{ height: 38, padding: 3, cursor: 'pointer' }}
              />
            </Field>
            <Field label="Footer note">
              <input value={rt.footerNote} onChange={setE('footerNote')} />
            </Field>
          </div>
          <div style={{ marginTop: 8 }}>
            <SwtRow label="Show company header" sub="Logo and company lines from the Invoice Template" on={rt.showHeader} onChange={set('showHeader')} />
            <SwtRow label="Show period chip" sub="Date range next to the report title" on={rt.showPeriod} onChange={set('showPeriod')} />
            <SwtRow label="Zebra rows" sub="Alternate row shading for readability" on={rt.zebraRows} onChange={set('zebraRows')} />
            <SwtRow label="Show totals row" on={rt.showTotals} onChange={set('showTotals')} />
            <SwtRow label="Show 'Printed by' line" sub="User name, date and time at the bottom" on={rt.showGeneratedBy} onChange={set('showGeneratedBy')} />
          </div>
        </Panel>
      </div>

      <div className="lp-wrap">
        <Panel title="Live preview" sub="Sample report rendered with the current settings">
          <div style={{ transform: 'scale(0.9)', transformOrigin: 'top left', width: '111%' }}>
            <ReportDoc title="Income Summary" from="2026-06-01" to="2026-06-12" printTemplate={prefs.printTemplate} reportTemplate={rt}>
              <table className="tbl">
                <thead>
                  <tr><th>Invoice No</th><th>Date</th><th>Customer</th><th className="num">Invoice Amt</th><th className="num">Received</th><th className="num">Balance</th></tr>
                </thead>
                <tbody>
                  {SAMPLE_REPORT_ROWS.map((r) => (
                    <tr key={r.no}>
                      <td>{r.no}</td><td>{r.date}</td><td>{r.customer}</td>
                      <td className="num">{r.amount.toLocaleString()}</td>
                      <td className="num">{r.received.toLocaleString()}</td>
                      <td className="num">{r.balance.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total (3)</td><td /><td />
                    <td className="num">9,400</td><td className="num">5,350</td><td className="num">4,050</td>
                  </tr>
                </tfoot>
              </table>
            </ReportDoc>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* =================== Invoice Prefix (numbering) =================== */
const NUMBERING_DEFAULTS = {
  invoice: { format: 'INV-{YYYY}-{SEQ}', reset: 'yearly' },
  receipt: { format: 'RCT-{YYYY}-{SEQ}', reset: 'yearly' },
  payment: { format: 'PAY-{YYYY}-{SEQ}', reset: 'yearly' },
  request: { format: 'REQ-{YYYY}-{SEQ}', reset: 'yearly' },
  autoCreateNextYear: true,
  carryCustomPrefix: true,
};
const DOC_LABELS = { invoice: 'Invoice', receipt: 'Receipt', payment: 'Payment', request: 'Receipt Request' };

const renderFormat = (format, no, year = new Date().getFullYear()) =>
  String(format || '{SEQ}')
    .replaceAll('{PREFIX}', '')
    .replaceAll('{YYYY}', String(year))
    .replaceAll('{YY}', String(year).slice(-2))
    .replaceAll('{MM}', String(new Date().getMonth() + 1).padStart(2, '0'))
    .replaceAll('{SEQ}', String(no).padStart(4, '0'));

function PrefixTab({ prefs, savePrefs }) {
  const toast = useToast();
  const [n, setN] = useState({ ...NUMBERING_DEFAULTS, ...(prefs.numbering || {}) });
  const [doc, setDoc] = useState('invoice');
  const [stats, setStats] = useState(null);
  const [saving, setSaving] = useState(false);
  const [setNo, setSetNo] = useState('');
  const [chk, setChk] = useState(null);          // { ok, msg }
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.get('/api/settings/numbering-stats').then(setStats).catch((e) => toast(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSetNo(''); setChk(null); }, [doc]);

  const cur = n[doc];
  const setCur = (patch) => setN((x) => ({ ...x, [doc]: { ...x[doc], ...patch } }));
  const blocks = (stats && stats[doc]) || [];
  const thisYear = new Date().getFullYear();
  const lastBlock = blocks[blocks.length - 1];
  const nextOf = (d) => (stats && stats.next && stats.next[d]) || (((stats && stats[d] && stats[d][stats[d].length - 1]) ? Number(stats[d][stats[d].length - 1].last) + 1 : 1));
  const nextNo = nextOf(doc);

  const checkNumber = async () => {
    const no = Math.floor(Number(setNo));
    if (!no || no <= 0) { setChk({ ok: false, msg: 'Enter a valid number' }); return; }
    setChecking(true);
    try {
      const r = await api.post('/api/settings/numbering-set', { type: doc, no });
      setChk({ ok: true, msg: `Done — next ${DOC_LABELS[doc].toLowerCase()} will be #${r.next} for ${r.year}.` });
      setSetNo('');
      api.get('/api/settings/numbering-stats').then(setStats).catch(() => {});
    } catch (e) {
      setChk({ ok: false, msg: e.message });
    } finally {
      setChecking(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await savePrefs({ numbering: n });
      toast('Numbering saved');
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel
        title="Document numbering"
        sub="Prefix format per document type"
        toolbar={
          <button className="btn primary" onClick={onSave} disabled={saving}>
            <i className="ti ti-device-floppy" /> Save numbering
          </button>
        }
      >
        <div className="fgrid">
          <Field label="Document type">
            <Select value={doc} onChange={setDoc}
              options={[{ value: 'invoice', label: 'Invoice' }, { value: 'receipt', label: 'Receipt' }, { value: 'payment', label: 'Payment' }, { value: 'request', label: 'Receipt Request' }]} />
          </Field>
          <Field label="Reset cycle">
            <Select value={cur.reset} onChange={(v) => setCur({ reset: v })}
              options={[{ value: 'yearly', label: 'Yearly — reset to 1 each year' }, { value: 'monthly', label: 'Monthly' }, { value: 'never', label: 'Never — continuous' }]} />
          </Field>
          <Field label="Format">
            <input className="mono" value={cur.format} onChange={(e) => setCur({ format: e.target.value })} />
          </Field>
        </div>
        <div className="tokrow">
          {['{YYYY}', '{YY}', '{MM}', '{SEQ}'].map((tok) => (
            <span key={tok} className="tok" onClick={() => setCur({ format: cur.format + tok })}>+ {tok}</span>
          ))}
          <span className="tok" onClick={() => setCur({ format: '' })} style={{ borderColor: 'var(--red)', color: 'var(--red)', background: 'var(--red-soft)' }}>
            clear
          </span>
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.keys(DOC_LABELS).map((d) => {
            const b = (stats && stats[d] && stats[d][stats[d].length - 1]) || null;
            return (
              <span key={d} className="expill">
                {DOC_LABELS[d]} → <span className="mono">{renderFormat(n[d].format, nextOf(d))}</span>
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 12 }}>
          <SwtRow label="Auto-create next year block" sub="A new numbering block opens automatically each January"
            on={n.autoCreateNextYear} onChange={(v) => setN((x) => ({ ...x, autoCreateNextYear: v }))} />
          <SwtRow label="Carry custom prefix per year" sub="Keep the custom prefix text when the year rolls over"
            on={n.carryCustomPrefix} onChange={(v) => setN((x) => ({ ...x, carryCustomPrefix: v }))} />
        </div>

        {doc !== 'request' && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <Field label="Set next number — start this year's counter (e.g. 1 for 0001)">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="number" min="1" value={setNo} onChange={(e) => { setSetNo(e.target.value); setChk(null); }}
                  placeholder={`current next: ${nextNo}`} style={{ width: 180 }} />
                <button className="btn" onClick={checkNumber} disabled={checking || !setNo}>
                  <i className="ti ti-device-floppy" /> Set &amp; apply
                </button>
                {chk && (
                  <span style={{ color: chk.ok ? 'var(--green)' : 'var(--red)', fontWeight: 700, fontSize: 12.5 }}>
                    <i className={`ti ${chk.ok ? 'ti-check' : 'ti-alert-circle'}`} /> {chk.msg}
                  </span>
                )}
              </div>
              <small className="muted">Applies immediately. Rejected if that number already exists for this year. Old documents are never changed.</small>
            </Field>
          </div>
        )}
      </Panel>

      <Panel title={`Yearly prefix blocks — ${DOC_LABELS[doc]}`} sub="Computed from actual issued documents">
        {!stats ? (
          <Loader />
        ) : blocks.length === 0 ? (
          <Empty icon="ti-database-off" text="No documents issued yet" />
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Year</th><th>Prefix block</th><th className="num">Start</th><th className="num">Last issued</th><th className="num">Issued</th><th>Status</th></tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.yr} style={{ cursor: 'default' }}>
                  <td>{b.yr}</td>
                  <td className="mono">{renderFormat(cur.format, b.start, b.yr).replace(/\d+$/, '')}</td>
                  <td className="num mono">{renderFormat(cur.format, b.start, b.yr)}</td>
                  <td className="num mono">{renderFormat(cur.format, b.last, b.yr)}</td>
                  <td className="num">{Number(b.issued).toLocaleString()}</td>
                  <td>{b.yr === thisYear ? <Badge tone="green">Active</Badge> : <Badge tone="blue">Closed</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {lastBlock && (
          <div className="tip" style={{ marginTop: 12, marginBottom: 0 }}>
            <i className="ti ti-arrow-right" /> Next {DOC_LABELS[doc].toLowerCase()} → <b className="mono">{renderFormat(cur.format, nextNo)}</b>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* =================== Email Settings =================== */
const EMAIL_DEFAULTS = {
  host: '',
  port: 587,
  security: 'tls',
  username: '',
  password: '',
  fromName: 'AL RAWDA GROUP',
  fromEmail: '',
  replyTo: '',
  notifyRecipient: '',
  summaryRecipients: '',
  summaryHour: 20,
  notifyWelcome: true,
  notifyReceipt: false,
  notifyInvoice: false,
  notifyDailySummary: false,
};

// chip-style multi-email input — value is a comma-separated string
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function EmailChips({ value, onChange, placeholder, toast }) {
  const [draft, setDraft] = useState('');
  const list = String(value || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const commit = (raw) => {
    const parts = String(raw).split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const bad = parts.filter((p) => !isEmail(p));
    if (bad.length && toast) toast(`Not a valid email: ${bad[0]}`);
    const next = [...new Set([...list, ...parts.filter(isEmail)])];
    onChange(next.join(','));
    setDraft('');
  };
  const remove = (em) => onChange(list.filter((x) => x !== em).join(','));
  return (
    <div className="field">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 36, padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--input-bg, #fff)' }}>
        {list.map((em) => (
          <span key={em} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--accent, #8a1538)', color: '#fff', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}>
            {em}
            <i className="ti ti-x" style={{ cursor: 'pointer' }} onClick={() => remove(em)} />
          </span>
        ))}
        <input
          style={{ flex: 1, minWidth: 140, border: 0, outline: 'none', background: 'transparent', padding: 0, height: 24 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); if (draft.trim()) commit(draft); }
            else if (e.key === 'Backspace' && !draft && list.length) remove(list[list.length - 1]);
          }}
          onBlur={() => { if (draft.trim()) commit(draft); }}
          placeholder={list.length ? 'Add another…' : placeholder}
        />
      </div>
    </div>
  );
}

function EmailTab({ prefs, savePrefs }) {
  const toast = useToast();
  const [m, setM] = useState({ ...EMAIL_DEFAULTS, ...(prefs.email || {}) });
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const set = (key) => (v) => setM((x) => ({ ...x, [key]: v }));
  const setE = (key) => (e) => setM((x) => ({ ...x, [key]: e.target.value }));

  const onSave = async () => {
    if (m.host && !m.fromEmail) { toast('From email is required when SMTP is configured'); return; }
    setSaving(true);
    try {
      await savePrefs({ email: m });
      toast('Email settings saved');
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onSummaryNow = async () => {
    setSummarizing(true);
    try {
      await savePrefs({ email: m }); // use what's on screen
      const r = await api.post('/api/settings/summary-now', {});
      toast(`Daily summary sent ✔ (${r.messageId || 'accepted by server'})`);
    } catch (e) {
      toast(e.message);
    } finally {
      setSummarizing(false);
    }
  };

  const onTest = async () => {
    if (!testTo.trim()) { toast('Enter a recipient address for the test'); return; }
    setTesting(true);
    try {
      await savePrefs({ email: m }); // make sure the test uses what is on screen
      const r = await api.post('/api/settings/email-test', { to: testTo.trim() });
      toast(`Test email sent ✔ (${r.messageId || 'accepted by server'})`);
    } catch (e) {
      toast(e.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="grid2eq" style={{ alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Panel
          title="SMTP server"
          sub="Outgoing mail server used for all system emails"
          toolbar={
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <i className="ti ti-device-floppy" /> Save email settings
            </button>
          }
        >
          <div className="fgrid" style={{ gridTemplateColumns: '2fr 1fr' }}>
            <Field label="SMTP host" required>
              <input value={m.host} onChange={setE('host')} placeholder="e.g. smtp.office365.com" />
            </Field>
            <Field label="Port">
              <input type="number" value={m.port} onChange={(e) => set('port')(Number(e.target.value))} />
            </Field>
            <Field label="Security">
              <Select value={m.security} onChange={set('security')}
                options={[{ value: 'tls', label: 'STARTTLS (port 587)' }, { value: 'ssl', label: 'SSL (port 465)' }, { value: 'none', label: 'None' }]} />
            </Field>
            <Field label="Username">
              <input value={m.username} onChange={setE('username')} placeholder="mailbox or app user" autoComplete="off" />
            </Field>
            <Field label="Password" className="full">
              <input type="password" value={m.password} onChange={setE('password')} autoComplete="new-password" />
            </Field>
          </div>
          <div className="tip" style={{ marginTop: 12, marginBottom: 0 }}>
            <i className="ti ti-shield-lock" />
            The password is stored in the local database for the mail server connection — use a dedicated app password, not a personal one.
          </div>
        </Panel>

        <Panel title="Sender identity">
          <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="From name">
              <input value={m.fromName} onChange={setE('fromName')} />
            </Field>
            <Field label="From email" required>
              <input type="email" value={m.fromEmail} onChange={setE('fromEmail')} placeholder="noreply@alrawda.qa" />
            </Field>
            <Field label="Reply-to (optional)" className="full">
              <input type="email" value={m.replyTo} onChange={setE('replyTo')} placeholder="info@alrawda.qa" />
            </Field>
          </div>
        </Panel>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Panel title="Email notifications" sub="Which events send an email automatically">
          <div className="fgrid" style={{ gridTemplateColumns: '2fr 1fr', marginBottom: 8 }}>
            <Field label="Notifications recipient (management)">
              <input type="email" value={m.notifyRecipient} onChange={setE('notifyRecipient')}
                placeholder="ops@alrawda.qa — defaults to Reply-to / From" />
            </Field>
            <Field label="Daily summary time">
              <Select value={m.summaryHour} onChange={(v) => set('summaryHour')(Number(v))}
                options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))} />
            </Field>
          </div>
          <Field label="Daily summary recipients" sub="One or more addresses — type an email and press Enter. Leave empty to use the management recipient above.">
            <EmailChips value={m.summaryRecipients} onChange={set('summaryRecipients')} placeholder="finance@alrawda.qa" toast={toast} />
          </Field>
          <div className="tip" style={{ marginTop: 8, marginBottom: 10 }}>
            <i className="ti ti-info-circle" />
            Customer email addresses aren't stored in the migrated data, so event and summary emails are sent to the management recipient above.
          </div>
          <SwtRow label="Welcome email on user invite" sub="Send credentials / invite link to new users"
            on={m.notifyWelcome} onChange={set('notifyWelcome')} />
          <SwtRow label="Receipt notification" sub="Email management (with PDF) when a receipt is recorded"
            on={m.notifyReceipt} onChange={set('notifyReceipt')} />
          <SwtRow label="Invoice notification" sub="Email management (with PDF) when an invoice is created"
            on={m.notifyInvoice} onChange={set('notifyInvoice')} />
          <SwtRow label="Daily summary to management" sub="Collections and pending balance, every evening"
            on={m.notifyDailySummary} onChange={set('notifyDailySummary')} />
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={onSummaryNow} disabled={summarizing}>
              <i className="ti ti-mail-fast" /> {summarizing ? 'Sending…' : 'Send summary now'}
            </button>
          </div>
        </Panel>

        <Panel title="Send test email" sub="Saves the settings above, then sends a test message">
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <input
                type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@alrawda.qa"
              />
            </div>
            <button className="btn success" onClick={onTest} disabled={testing} style={{ height: 36 }}>
              <i className="ti ti-send" /> {testing ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* =================== My Account =================== */
const STATUS_TONE = { Active: 'green', 'Invite pending': 'warn', Suspended: 'red', Inactive: 'blue' };

const uaLabel = (ua) => {
  if (!ua) return 'Unknown device';
  const os = /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
  const br = /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
};

/* The signed-in user's own active devices — with per-device revoke */
function MySessions() {
  const toast = useToast();
  const me = getUser() || {};
  const [data, setData] = useState(null);
  const load = () => api.get(`/api/users/${me.id}/sessions`).then(setData).catch(() => setData({ rows: [], currentJti: null }));
  useEffect(() => { if (me.id) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const revoke = async (jti, isCurrent) => {
    try {
      await api.post(`/api/users/sessions/${jti}/revoke`, {});
      if (isCurrent) { clearSession(); window.location.href = '/login'; return; }
      toast('Device signed out'); load();
    } catch (e) { toast(e.message); }
  };

  return (
    <Panel title="My active sessions" sub="Devices currently signed in to your account" bodyStyle={{ padding: 0 }}>
      {!data ? <Loader /> : data.rows.length === 0 ? (
        <Empty icon="ti-devices" text="No active sessions." />
      ) : (
        <table className="tbl">
          <thead><tr><th>Device / Browser</th><th>IP address</th><th>Last active</th><th /></tr></thead>
          <tbody>
            {data.rows.map((x) => {
              const cur = x.jti === data.currentJti;
              return (
                <tr key={x.jti} style={{ cursor: 'default' }}>
                  <td>{uaLabel(x.user_agent)} {cur && <Badge tone="green">This device</Badge>}</td>
                  <td className="mono">{x.ip || '—'}</td>
                  <td>{fmtDateTime(x.last_seen || x.created_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm danger" onClick={() => revoke(x.jti, cur)}>
                      <i className="ti ti-logout" /> {cur ? 'Sign out' : 'Revoke'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* Two-factor authentication (TOTP) — self-service enrol / disable */
function TwoFactorPanel() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(null);
  const [setup, setSetup] = useState(null); // { secret, otpauth, qr }
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/api/auth/2fa/status').then((d) => setEnabled(!!d.enabled)).catch(() => setEnabled(false)); }, []);

  const startSetup = async () => {
    setBusy(true);
    try {
      const d = await api.post('/api/auth/2fa/setup', {});
      const qr = await QRCode.toDataURL(d.otpauth, { margin: 1, width: 180 });
      setSetup({ ...d, qr }); setCode('');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const enable = async () => {
    setBusy(true);
    try { await api.post('/api/auth/2fa/enable', { code: code.trim() }); setEnabled(true); setSetup(null); toast('Two-factor authentication enabled'); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const disable = async () => {
    if (!pw) { toast('Enter your password to turn off 2FA'); return; }
    setBusy(true);
    try { await api.post('/api/auth/2fa/disable', { password: pw }); setEnabled(false); setPw(''); toast('Two-factor authentication disabled'); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  return (
    <Panel title="Two-factor authentication" sub="A second step at sign-in using Google Authenticator / Authy">
      {enabled === null ? <Loader /> : enabled ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Badge tone="green"><i className="ti ti-shield-check" /> Enabled</Badge>
            <span className="muted">A 6-digit code is required when you sign in.</span>
          </div>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
            <Field label="Your password (to disable)"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <button className="btn danger" onClick={disable} disabled={busy} style={{ height: 38 }}><i className="ti ti-shield-off" /> Disable</button>
          </div>
        </div>
      ) : setup ? (
        <div>
          <div className="muted" style={{ marginBottom: 10 }}>1. Scan this QR with your authenticator app (or type the key in manually).</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <img src={setup.qr} alt="2FA QR code" style={{ width: 160, height: 160, border: '1px solid var(--line)', borderRadius: 8 }} />
            <div>
              <small className="muted">Manual setup key</small>
              <div className="mono" style={{ fontWeight: 700, wordBreak: 'break-all', maxWidth: 220 }}>{setup.secret}</div>
            </div>
          </div>
          <div className="muted" style={{ margin: '12px 0 6px' }}>2. Enter the 6-digit code it shows.</div>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
            <Field label="Authentication code"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" style={{ letterSpacing: '0.3em', fontWeight: 700 }} /></Field>
            <button className="btn primary" onClick={enable} disabled={busy || code.length !== 6} style={{ height: 38 }}><i className="ti ti-shield-check" /> Verify &amp; enable</button>
          </div>
          <button className="btn" onClick={() => setSetup(null)} style={{ marginTop: 10 }}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div><Badge tone="warn">Off</Badge> <span className="muted">Protect your account with a second step at login.</span></div>
          <button className="btn primary" onClick={startSetup} disabled={busy}><i className="ti ti-shield-plus" /> Enable 2FA</button>
        </div>
      )}
    </Panel>
  );
}

function AccountTab() {
  const toast = useToast();
  const me = getUser() || {};
  const [profile, setProfile] = useState(null);
  const [activity, setActivity] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  useEffect(() => {
    (async () => {
      try {
        const d = await api.get('/api/users/me');
        const mine = d.user || null;
        setProfile(mine);
        if (mine) {
          const a = await api.get(`/api/users/${mine.id}/activity`);
          setActivity(a);
        }
      } catch {
        setProfile(null);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => setPw((p) => ({ ...p, [key]: e.target.value }));

  const onChangePassword = async () => {
    if (!pw.current) { toast('Current password is required'); return; }
    if (!pw.next) { toast('New password is required'); return; }
    if (pw.next !== pw.confirm) { toast('New passwords do not match'); return; }
    setSaving(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: pw.current, newPassword: pw.next });
      toast('Password changed');
      setPw({ current: '', next: '', confirm: '' });
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const p = profile || {};
  const userIdStr = p.id ? `USR-${String(p.id).padStart(3, '0')}` : '—';

  return (
    <div className="grid2" style={{ alignItems: 'flex-start' }}>
      <Panel title="My Profile" sub="Your account details — contact an administrator to change them">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
          <span style={{
            width: 64, height: 64, borderRadius: '50%', background: 'var(--grad)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 22,
            flex: '0 0 64px', overflow: 'hidden',
          }}>
            {p.photo
              ? <img src={p.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initials(p.display_name || me.name || me.username)}
          </span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{p.display_name || me.name || '—'}</div>
            <div className="muted" style={{ margin: '2px 0 7px' }}>
              {[p.designation, p.department].filter(Boolean).join(' · ') || '—'}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Badge tone={STATUS_TONE[p.status] || 'green'}>{p.status || 'Active'}</Badge>
              <Badge tone="violet">{p.role || me.role}</Badge>
            </div>
          </div>
        </div>

        <div className="msec">Contact</div>
        <div className="pgrid">
          <div className="pitem"><small>Full name</small><b>{p.display_name || '—'}</b></div>
          <div className="pitem"><small>Email</small><b>{p.email || '—'}</b></div>
          <div className="pitem"><small>Mobile</small><b>{p.mobile || '—'}</b></div>
          <div className="pitem"><small>Department</small><b>{p.department || '—'}</b></div>
          <div className="pitem"><small>Designation</small><b>{p.designation || '—'}</b></div>
          <div className="pitem"><small>Reporting to</small><b>{p.reporting_to || '—'}</b></div>
        </div>

        <div className="msec" style={{ marginTop: 18 }}>Account</div>
        <div className="pgrid">
          <div className="pitem"><small>User ID</small><b>{userIdStr}</b></div>
          <div className="pitem"><small>Username</small><b>{p.username || me.username || '—'}</b></div>
          <div className="pitem"><small>Created</small><b>{p.created_at ? fmtDate(p.created_at) : '—'}</b></div>
          <div className="pitem"><small>Last login</small><b>{p.last_login ? fmtDate(p.last_login) : '—'}</b></div>
          <div className="pitem"><small>MFA</small><b>{p.mfa ? 'Enabled' : 'Disabled'}</b></div>
          <div className="pitem"><small>Role</small><b>{p.role || me.role || '—'}</b></div>
        </div>

        <div className="msec" style={{ marginTop: 18 }}>
          My activity{activity && activity.totalActions > 0 ? ` · ${activity.totalActions.toLocaleString()} actions` : ''}
        </div>
        {!activity ? (
          <Loader />
        ) : activity.rows.length === 0 ? (
          <div className="muted">No recorded activity yet.</div>
        ) : (
          <div className="activity-list" style={{ maxHeight: 240 }}>
            {activity.rows.map((a, i) => (
              <div key={i} className="activity-row">
                <span style={{ fontWeight: 600 }}>
                  <i className={`ti ${a.Action === 'D' ? 'ti-trash' : a.Action === 'A' ? 'ti-plus' : 'ti-pencil'}`}
                     style={{ color: 'var(--accent)', marginRight: 7 }} />
                  {a.Narration}
                </span>
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.AuditDate)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Panel
          title="Change Password"
          toolbar={
            <button className="btn primary" onClick={onChangePassword} disabled={saving}>
              <i className="ti ti-key" /> Change password
            </button>
          }
        >
          <div className="fgrid" style={{ gridTemplateColumns: '1fr' }}>
            <Field label="Current password" required>
              <input type="password" value={pw.current} onChange={set('current')} autoComplete="current-password" />
            </Field>
            <Field label="New password" required>
              <input type="password" value={pw.next} onChange={set('next')} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password" required>
              <input type="password" value={pw.confirm} onChange={set('confirm')} autoComplete="new-password" />
            </Field>
          </div>
        </Panel>

        <TwoFactorPanel />
        <MySessions />
      </div>
    </div>
  );
}

/* =================== Email Template builder (drag-and-drop) =================== */
const DEFAULT_ACCENT = '#8a1538';
let _blockUid = 0;
const blockUid = () => `b${++_blockUid}`;

// Palette shown in the "Add block" rail. Order = insertion menu order.
const EMAIL_BLOCKS = [
  { type: 'logo', label: 'Logo', icon: 'ti-photo' },
  { type: 'companyName', label: 'Company name', icon: 'ti-building' },
  { type: 'tagline', label: 'Tagline', icon: 'ti-text-caption' },
  { type: 'heading', label: 'Heading', icon: 'ti-heading' },
  { type: 'text', label: 'Text', icon: 'ti-align-left' },
  { type: 'body', label: 'Message body', icon: 'ti-mail-opened' },
  { type: 'button', label: 'Button', icon: 'ti-rectangle' },
  { type: 'image', label: 'Image', icon: 'ti-photo-up' },
  { type: 'columns', label: 'Two columns', icon: 'ti-columns-2' },
  { type: 'social', label: 'Links row', icon: 'ti-share' },
  { type: 'divider', label: 'Divider', icon: 'ti-separator-horizontal' },
  { type: 'spacer', label: 'Spacer', icon: 'ti-arrow-autofit-height' },
  { type: 'companyInfo', label: 'Company info', icon: 'ti-address-book' },
  { type: 'footer', label: 'Footer', icon: 'ti-layout-bottombar' },
  { type: 'html', label: 'Custom HTML', icon: 'ti-code' },
];
const BLOCK_META = Object.fromEntries(EMAIL_BLOCKS.map((b) => [b.type, b]));

// A fresh block with sensible defaults (mirrors the backend renderer).
function newBlock(type) {
  const base = { _id: blockUid(), type };
  switch (type) {
    case 'logo': return { ...base, align: 'center', size: 54, bg: 'accent' };
    case 'companyName': return { ...base, bg: 'accent', color: '#ffffff' };
    case 'tagline': return { ...base, bg: 'accent', color: '#f1d4dc', text: '' };
    case 'heading': return { ...base, text: 'Heading', color: '#222222', fontSize: 17, align: 'left', bg: 'white' };
    case 'text': return { ...base, text: 'Write your text here…', color: '#444444', align: 'left', bg: 'white' };
    case 'body': return { ...base };
    case 'button': return { ...base, text: 'Open', url: '#', color: '', align: 'center', bg: 'white' };
    case 'image': return { ...base, src: '', width: 240, radius: 0, align: 'center', url: '', bg: 'white' };
    case 'columns': return { ...base, left: 'Left column', right: 'Right column', color: '#444444', bg: 'white' };
    case 'social': return { ...base, links: [{ label: 'Website', url: '{website}' }], color: '', align: 'center', bg: 'white' };
    case 'divider': return { ...base, color: '#ececec', bg: 'white' };
    case 'spacer': return { ...base, height: 16, bg: 'white' };
    case 'companyInfo': return { ...base, showAddress: true, showPhone: true, showEmail: true, showWebsite: false, color: '#888888', align: 'center', bg: 'white' };
    case 'footer': return { ...base, text: 'Automated message from {company}\nPlease do not reply to this email.', bg: 'light' };
    case 'html': return { ...base, html: '<b>Custom</b> block — you can use {company}, {phone}, {email}, {website}, {year}.', bg: 'white' };
    default: return base;
  }
}

// The classic branded layout, used for "Reset to default".
function defaultEmailBlocks() {
  return [
    { ...newBlock('logo') },
    { ...newBlock('companyName') },
    { ...newBlock('tagline') },
    { ...newBlock('body') },
    { ...newBlock('divider') },
    { ...newBlock('companyInfo') },
    { ...newBlock('footer') },
  ];
}

/* ---- client-side preview renderer (mirrors backend emailTemplate.js) ---- */
const escP = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textToHtmlP = (t) => escP(t).split(/\n{2,}/).filter(Boolean)
  .map((p) => `<p style="margin:0 0 12px;">${p.replace(/\n/g, '<br>')}</p>`).join('') || '<p></p>';
const fillP = (s, ctx) => String(s == null ? '' : s)
  .replace(/\{company\}/gi, ctx.company.name).replace(/\{companyAr\}/gi, ctx.company.nameAr)
  .replace(/\{address\}/gi, ctx.company.address).replace(/\{phone\}/gi, ctx.company.phone)
  .replace(/\{email\}/gi, ctx.company.email).replace(/\{website\}/gi, ctx.company.website)
  .replace(/\{year\}/gi, ctx.year);
const alignP = (a) => (a === 'left' || a === 'right' ? a : 'center');
const bgColorP = (bg, accent) => (bg === 'accent' ? accent : bg === 'light' ? '#faf7f8' : '#ffffff');

function renderBlockPreview(b, ctx) {
  const accent = ctx.accent;
  const bg = bgColorP(b.bg, accent);
  const align = alignP(b.align);
  const pad = b.bg === 'accent' ? '20px 24px' : '14px 28px';
  const cell = (inner, padding = pad) => `<tr><td align="${align}" style="background:${bg};padding:${padding};">${inner}</td></tr>`;
  switch (b.type) {
    case 'logo':
      return cell(ctx.logo
        ? `<img src="${ctx.logo}" width="${Math.max(28, Math.min(120, Number(b.size) || 54))}" style="display:block;${align === 'center' ? 'margin:0 auto;' : ''}border-radius:8px;background:#fff;" />`
        : `<div style="width:${Math.max(28, Math.min(120, Number(b.size) || 54))}px;height:${Math.max(28, Math.min(120, Number(b.size) || 54))}px;${align === 'center' ? 'margin:0 auto;' : ''}border-radius:8px;background:#fff;color:${accent};font-weight:800;font-size:20px;line-height:${Math.max(28, Math.min(120, Number(b.size) || 54))}px;text-align:center;">${escP((ctx.company.name[0] || 'A').toUpperCase())}</div>`,
        '18px 24px 8px');
    case 'companyName':
      return cell(`<div style="color:${b.color || '#ffffff'};font-size:${Number(b.fontSize) || 18}px;font-weight:bold;letter-spacing:.3px;">${escP(ctx.company.name)}</div>`, '0 24px 6px');
    case 'tagline':
      return cell(`<div style="color:${b.color || '#f1d4dc'};font-size:12px;">${escP(fillP(b.text || ctx.company.nameAr, ctx))}</div>`, '0 24px 18px');
    case 'heading':
      return cell(`<div style="color:${b.color || '#222222'};font-size:${Number(b.fontSize) || 17}px;font-weight:bold;">${escP(fillP(b.text, ctx))}</div>`);
    case 'text':
      return cell(`<div style="color:${b.color || '#444444'};font-size:14px;line-height:1.65;">${textToHtmlP(fillP(b.text, ctx))}</div>`);
    case 'body':
      return cell(`<div style="color:#333333;font-size:14px;line-height:1.65;text-align:left;">${ctx.content}</div>`, '6px 28px');
    case 'button':
      return cell(`<a href="#" style="display:inline-block;background:${b.color || accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:11px 26px;border-radius:6px;">${escP(fillP(b.text || 'Open', ctx))}</a>`);
    case 'image': {
      if (!b.src) return cell(`<div style="border:1px dashed #ccc;border-radius:6px;padding:18px;color:#aaa;font-size:12px;">No image selected</div>`);
      const w = Math.max(40, Math.min(600, Number(b.width) || 240));
      const m = align === 'center' ? 'margin:0 auto;' : align === 'right' ? 'margin-left:auto;' : '';
      return cell(`<img src="${b.src}" width="${w}" style="display:block;${m}max-width:100%;height:auto;border-radius:${Math.max(0, Number(b.radius) || 0)}px;" />`);
    }
    case 'columns': {
      const col = (t) => `<div style="color:${b.color || '#444444'};font-size:14px;line-height:1.6;">${textToHtmlP(fillP(t, ctx))}</div>`;
      return `<tr><td style="background:${bg};padding:${pad};"><table width="100%"><tr><td valign="top" width="50%" style="padding-right:10px;">${col(b.left || '')}</td><td valign="top" width="50%" style="padding-left:10px;">${col(b.right || '')}</td></tr></table></td></tr>`;
    }
    case 'social': {
      const links = (Array.isArray(b.links) ? b.links : []).filter((l) => l && l.url);
      if (!links.length) return cell(`<span style="color:#bbb;font-size:12px;">No links</span>`);
      return cell(links.map((l) => `<a href="#" style="display:inline-block;margin:0 8px;color:${b.color || accent};text-decoration:none;font-size:13px;font-weight:bold;">${escP(fillP(l.label || l.url, ctx))}</a>`).join(''));
    }
    case 'divider':
      return `<tr><td style="background:${bg};padding:4px 28px;"><div style="border-top:1px solid ${b.color || '#ececec'};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
    case 'spacer':
      return `<tr><td style="background:${bg};font-size:0;line-height:0;height:${Math.max(4, Math.min(80, Number(b.height) || 16))}px;">&nbsp;</td></tr>`;
    case 'companyInfo': {
      const parts = [];
      if (b.showAddress !== false && ctx.company.address) parts.push(escP(ctx.company.address));
      const contact = [];
      if (b.showPhone !== false && ctx.company.phone) contact.push('Tel: ' + escP(ctx.company.phone));
      if (b.showEmail !== false && ctx.company.email) contact.push(escP(ctx.company.email));
      if (contact.length) parts.push(contact.join(' &nbsp;·&nbsp; '));
      if (b.showWebsite && ctx.company.website) parts.push(escP(ctx.company.website));
      if (!parts.length) return cell(`<span style="color:#bbb;font-size:12px;">Company info (fills from Company settings)</span>`);
      return cell(`<div style="color:${b.color || '#888888'};font-size:12px;line-height:1.6;">${parts.join('<br>')}</div>`);
    }
    case 'footer':
      return `<tr><td align="center" style="background:${bgColorP(b.bg || 'light', accent)};border-top:1px solid #efe6e9;padding:16px 24px;color:#9a9a9a;font-size:11px;line-height:1.5;">${escP(fillP(b.text || '', ctx)).replace(/\n/g, '<br/>')}</td></tr>`;
    case 'html':
      return cell(`<div style="font-size:14px;line-height:1.6;color:#333333;">${fillP(b.html || '', ctx)}</div>`);
    default:
      return '';
  }
}

function emailPreviewHtml(blocks, accent, ctx) {
  const rows = blocks.map((b) => renderBlockPreview(b, ctx)).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #ececec;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">${rows}</table>`;
}

/* ---- small inspector controls ---- */
const InspRow = ({ label, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
    <label className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</label>
    <div>{children}</div>
  </div>
);
const AlignPick = ({ value, onChange }) => (
  <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
    {['left', 'center', 'right'].map((a) => (
      <button key={a} type="button" className={`btn sm${(value || 'center') === a ? ' primary' : ''}`} style={{ borderRadius: 0, border: 0 }}
        onClick={() => onChange(a)}><i className={`ti ti-align-${a === 'center' ? 'center' : a}`} /></button>
    ))}
  </div>
);
const BgPick = ({ value, onChange }) => (
  <Select value={value || 'white'} onChange={onChange}
    options={[{ value: 'white', label: 'White' }, { value: 'light', label: 'Light tint' }, { value: 'accent', label: 'Accent band' }]} />
);

function BlockInspector({ block, onChange, toast }) {
  const set = (patch) => onChange({ ...block, ...patch });
  const t = block.type;
  const hasBg = t !== 'divider' && t !== 'spacer';
  const hasAlign = ['logo', 'heading', 'text', 'button', 'image', 'social', 'companyInfo'].includes(t);
  return (
    <div>
      {t === 'body' && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>This is where each email's actual message is injected (test mail, password-reset, alerts…). It has no settings — just position it where you want the content to appear.</div>}

      {(t === 'heading' || t === 'text' || t === 'tagline' || t === 'footer') && (
        <InspRow label="Text">
          <textarea value={block.text || ''} onChange={(e) => set({ text: e.target.value })} rows={t === 'footer' || t === 'text' ? 3 : 2} style={{ width: '100%', resize: 'vertical' }} />
        </InspRow>
      )}
      {t === 'html' && (
        <InspRow label="HTML">
          <textarea value={block.html || ''} onChange={(e) => set({ html: e.target.value })} rows={5} style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
        </InspRow>
      )}
      {t === 'button' && (<>
        <InspRow label="Label"><input value={block.text || ''} onChange={(e) => set({ text: e.target.value })} /></InspRow>
        <InspRow label="Link URL"><input value={block.url || ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" /></InspRow>
      </>)}
      {t === 'image' && (<>
        <ImageUpload label="Image" sub="PNG / JPG, up to ~600 KB" value={block.src || null} onChange={(v) => set({ src: v || '' })} toast={toast} />
        <InspRow label="Width (px)"><input type="number" value={block.width || 240} onChange={(e) => set({ width: Number(e.target.value) })} /></InspRow>
        <InspRow label="Corner radius"><input type="number" value={block.radius || 0} onChange={(e) => set({ radius: Number(e.target.value) })} /></InspRow>
        <InspRow label="Link URL"><input value={block.url || ''} onChange={(e) => set({ url: e.target.value })} placeholder="optional" /></InspRow>
      </>)}
      {t === 'columns' && (<>
        <InspRow label="Left"><textarea value={block.left || ''} onChange={(e) => set({ left: e.target.value })} rows={3} style={{ width: '100%' }} /></InspRow>
        <InspRow label="Right"><textarea value={block.right || ''} onChange={(e) => set({ right: e.target.value })} rows={3} style={{ width: '100%' }} /></InspRow>
      </>)}
      {t === 'social' && (
        <div style={{ marginBottom: 8 }}>
          <label className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Links</label>
          {(block.links || []).map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input value={l.label || ''} placeholder="Label" style={{ width: 120 }} onChange={(e) => { const links = [...block.links]; links[i] = { ...l, label: e.target.value }; set({ links }); }} />
              <input value={l.url || ''} placeholder="URL or {website}" style={{ flex: 1 }} onChange={(e) => { const links = [...block.links]; links[i] = { ...l, url: e.target.value }; set({ links }); }} />
              <button type="button" className="btn sm" onClick={() => set({ links: block.links.filter((_, j) => j !== i) })}><i className="ti ti-x" /></button>
            </div>
          ))}
          <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => set({ links: [...(block.links || []), { label: '', url: '' }] })}><i className="ti ti-plus" /> Add link</button>
        </div>
      )}
      {t === 'logo' && <InspRow label="Size (px)"><input type="number" value={block.size || 54} onChange={(e) => set({ size: Number(e.target.value) })} /></InspRow>}
      {t === 'spacer' && <InspRow label="Height (px)"><input type="number" value={block.height || 16} onChange={(e) => set({ height: Number(e.target.value) })} /></InspRow>}
      {t === 'heading' && <InspRow label="Font size"><input type="number" value={block.fontSize || 17} onChange={(e) => set({ fontSize: Number(e.target.value) })} /></InspRow>}
      {t === 'companyInfo' && (
        <div style={{ marginBottom: 8 }}>
          {[['showAddress', 'Address'], ['showPhone', 'Phone'], ['showEmail', 'Email'], ['showWebsite', 'Website']].map(([k, lbl]) => {
            const cur = block[k] === undefined ? k !== 'showWebsite' : block[k]; // address/phone/email default on, website off
            return <SwtRow key={k} label={lbl} on={cur} onChange={(v) => set({ [k]: v })} />;
          })}
        </div>
      )}

      {['companyName', 'tagline', 'heading', 'text', 'columns', 'companyInfo', 'divider'].includes(t) && (
        <InspRow label="Colour"><input type="color" value={block.color || '#444444'} onChange={(e) => set({ color: e.target.value })} style={{ height: 34, width: 56, padding: 2 }} /></InspRow>
      )}
      {(t === 'button' || t === 'social') && (
        <InspRow label="Colour"><input type="color" value={block.color || '#8a1538'} onChange={(e) => set({ color: e.target.value })} style={{ height: 34, width: 56, padding: 2 }} /></InspRow>
      )}
      {hasAlign && <InspRow label="Align"><AlignPick value={block.align} onChange={(v) => set({ align: v })} /></InspRow>}
      {hasBg && <InspRow label="Background"><BgPick value={block.bg} onChange={(v) => set({ bg: v })} /></InspRow>}
    </div>
  );
}

function EmailTemplateTab({ prefs, savePrefs }) {
  const toast = useToast();
  const tmpl = prefs.emailTemplate || {};
  const [accent, setAccent] = useState(tmpl.accentColor || DEFAULT_ACCENT);
  const [blocks, setBlocks] = useState(() => {
    const src = Array.isArray(tmpl.blocks) && tmpl.blocks.length ? tmpl.blocks : defaultEmailBlocks();
    return src.map((b) => ({ ...b, _id: b._id || blockUid() }));
  });
  const [selId, setSelId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [company, setCompany] = useState({ name: 'AL RAWDA GROUP', nameAr: '', address: '', phone: '', email: '', website: '' });
  const [coLogo, setCoLogo] = useState('');

  // accurate preview: pull live company identity + logo (same source the emails use)
  useEffect(() => {
    api.get('/api/settings/company').then((d) => {
      const c = d.company || {}, b = d.branch || {};
      setCompany({
        name: (c.CompanyName || '').trim() || 'AL RAWDA GROUP',
        nameAr: (b.BranchNameinArabic || '').trim() || '',
        address: (c.Address || b.Address1 || '').trim(),
        phone: (c.Phone1 || b.Phone1 || '').trim(),
        email: (c.EMail || b.EMailID || '').trim(),
        website: (c.WebSite || '').trim(),
      });
      setCoLogo(d.logo || '');
    }).catch(() => {});
  }, []);

  const logo = coLogo || (prefs.printTemplate || {}).logoImage || '';
  const previewCtx = {
    accent, company, logo,
    content: '<p style="margin:0 0 12px;">This is a <b>sample message</b> — each email\'s real content appears here.</p><p style="margin:0;">SMTP working &#10004;</p>',
    year: String(new Date().getFullYear()),
  };

  const selected = blocks.find((b) => b._id === selId) || null;
  const updateBlock = (nb) => setBlocks((bs) => bs.map((b) => (b._id === nb._id ? nb : b)));
  const addBlock = (type) => {
    const nb = newBlock(type);
    setBlocks((bs) => [...bs, nb]);
    setSelId(nb._id);
  };
  const removeBlock = (id) => { setBlocks((bs) => bs.filter((b) => b._id !== id)); if (selId === id) setSelId(null); };
  const dupBlock = (id) => setBlocks((bs) => {
    const i = bs.findIndex((b) => b._id === id);
    if (i < 0) return bs;
    const copy = { ...bs[i], _id: blockUid() };
    return [...bs.slice(0, i + 1), copy, ...bs.slice(i + 1)];
  });
  const moveBlock = (from, to) => setBlocks((bs) => {
    if (to < 0 || to >= bs.length || from === to) return bs;
    const next = [...bs];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    return next;
  });

  const onSave = async () => {
    setSaving(true);
    try {
      const clean = blocks.map(({ _id, ...rest }) => rest); // drop UI-only ids
      await savePrefs({ emailTemplate: { ...tmpl, accentColor: accent, blocks: clean, showLogo: clean.some((b) => b.type === 'logo') } });
      toast('Email template saved');
    } catch (e) { toast(e.message); } finally { setSaving(false); }
  };
  const onReset = () => { setBlocks(defaultEmailBlocks()); setSelId(null); };

  const hasBody = blocks.some((b) => b.type === 'body');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 440px', gap: 14, alignItems: 'flex-start' }}>

      {/* ===== LEFT: builder ===== */}
      <Panel
        title="Email builder"
        sub="Drag blocks to design every outgoing email — test mail, password reset, welcome, alerts and notifications"
        toolbar={
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} title="Accent colour" style={{ height: 34, width: 44, padding: 2, cursor: 'pointer' }} />
            <button className="btn" onClick={onReset}><i className="ti ti-rotate" /> Reset</button>
            <button className="btn primary" onClick={onSave} disabled={saving}><i className="ti ti-device-floppy" /> Save</button>
          </div>
        }
      >
        {!hasBody && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>
            <i className="ti ti-alert-triangle" /> No <b>Message body</b> block — the email's actual content will be appended at the end. Add one to control where it appears.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: 14, alignItems: 'flex-start' }}>

          {/* palette */}
          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>ADD BLOCK</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {EMAIL_BLOCKS.map((b) => (
                <button key={b.type} type="button" className="btn sm" style={{ justifyContent: 'flex-start' }} onClick={() => addBlock(b.type)}>
                  <i className={`ti ${b.icon}`} style={{ marginRight: 6 }} /> {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* canvas */}
          <div style={{ background: '#f4f4f7', borderRadius: 10, padding: 12, minWidth: 0 }}>
            {blocks.length === 0 && <Empty>Add blocks from the left to start designing.</Empty>}
            {blocks.map((b, i) => {
              const sel = b._id === selId;
              return (
                <div
                  key={b._id}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragIdx !== null) moveBlock(dragIdx, i); setDragIdx(null); }}
                  onClick={() => setSelId(b._id)}
                  style={{
                    marginBottom: 8, borderRadius: 8, cursor: 'pointer', overflow: 'hidden', background: '#fff',
                    border: sel ? '2px solid var(--accent, #8a1538)' : '1px solid #e5e7eb',
                    boxShadow: dragIdx === i ? '0 0 0 2px #94a3b8' : 'none',
                  }}
                >
                  {/* header strip — sits above the block, never overlaps content */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: sel ? 'var(--accent, #8a1538)' : '#eef0f4', color: sel ? '#fff' : '#475569', padding: '3px 6px 3px 8px', fontSize: 11 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, letterSpacing: '.2px' }}>
                      <i className="ti ti-grip-vertical" style={{ cursor: 'grab', opacity: 0.7 }} />
                      <i className={`ti ${BLOCK_META[b.type]?.icon || 'ti-square'}`} /> {BLOCK_META[b.type]?.label || b.type}
                    </span>
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button type="button" className="btn sm ghost" title="Move up" onClick={(e) => { e.stopPropagation(); moveBlock(i, i - 1); }} style={{ padding: '2px 5px', color: 'inherit' }}><i className="ti ti-chevron-up" /></button>
                      <button type="button" className="btn sm ghost" title="Move down" onClick={(e) => { e.stopPropagation(); moveBlock(i, i + 1); }} style={{ padding: '2px 5px', color: 'inherit' }}><i className="ti ti-chevron-down" /></button>
                      <button type="button" className="btn sm ghost" title="Duplicate" onClick={(e) => { e.stopPropagation(); dupBlock(b._id); }} style={{ padding: '2px 5px', color: 'inherit' }}><i className="ti ti-copy" /></button>
                      <button type="button" className="btn sm ghost" title="Delete" onClick={(e) => { e.stopPropagation(); removeBlock(b._id); }} style={{ padding: '2px 5px', color: 'inherit' }}><i className="ti ti-trash" /></button>
                    </span>
                  </div>
                  <div dangerouslySetInnerHTML={{ __html: `<table width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;">${renderBlockPreview(b, previewCtx)}</table>` }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* inspector — below the canvas, full width of the builder column */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
            {selected ? <><i className="ti ti-adjustments" /> EDIT — {BLOCK_META[selected.type]?.label || selected.type}</> : <><i className="ti ti-adjustments" /> PROPERTIES</>}
          </div>
          {selected
            ? <div style={{ maxWidth: 520 }}><BlockInspector block={selected} onChange={updateBlock} toast={toast} /></div>
            : <div className="muted" style={{ fontSize: 13 }}>Select a block in the canvas to edit it, or add one from the left.<br /><br />Placeholders you can use in text: <code>{'{company}'}</code> <code>{'{phone}'}</code> <code>{'{email}'}</code> <code>{'{website}'}</code> <code>{'{address}'}</code> <code>{'{year}'}</code>.</div>}
        </div>
      </Panel>

      {/* ===== RIGHT: live preview (sticky) ===== */}
      <div style={{ position: 'sticky', top: 12 }}>
        <Panel title="Live preview" sub="Full email as recipients will see it">
          <div style={{ background: '#f4f4f7', padding: 16, borderRadius: 8 }}>
            <div dangerouslySetInnerHTML={{ __html: emailPreviewHtml(blocks, accent, previewCtx) }} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* =================== merged Templates tab =================== */
const TEMPLATE_KINDS = [
  { id: 'invoice', label: 'Invoice', icon: 'ti-file-invoice', desc: 'Branding + printed invoice' },
  { id: 'receipt', label: 'Receipt', icon: 'ti-receipt', desc: 'Receipt voucher' },
  { id: 'payment', label: 'Payment', icon: 'ti-businessplan', desc: 'Payment voucher' },
  { id: 'report', label: 'Report', icon: 'ti-chart-bar', desc: 'All reports' },
  { id: 'email', label: 'Email', icon: 'ti-mail', desc: 'Branded outgoing emails' },
];

function TemplatesTab({ prefs, savePrefs }) {
  const [kind, setKind] = useState('invoice');
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontWeight: 700, marginRight: 4 }}>
          <i className="ti ti-template" /> Edit template:
        </span>
        {TEMPLATE_KINDS.map((k) => (
          <button
            key={k.id}
            className={`btn sm${kind === k.id ? ' primary' : ''}`}
            title={k.desc}
            onClick={() => setKind(k.id)}
          >
            <i className={`ti ${k.icon}`} /> {k.label}
          </button>
        ))}
        {['receipt', 'payment', 'report'].includes(kind) && (
          <span className="muted" style={{ fontSize: 12 }}>
            Header, logo &amp; watermark are shared — edit them under <b>Invoice</b>.
          </span>
        )}
      </div>
      {kind === 'invoice' && <TemplateTab prefs={prefs} savePrefs={savePrefs} />}
      {kind === 'receipt' && <ReceiptTemplateTab prefs={prefs} savePrefs={savePrefs} />}
      {kind === 'payment' && <PaymentTemplateTab prefs={prefs} savePrefs={savePrefs} />}
      {kind === 'report' && <ReportTemplateTab prefs={prefs} savePrefs={savePrefs} />}
      {kind === 'email' && <EmailTemplateTab prefs={prefs} savePrefs={savePrefs} />}
    </div>
  );
}

/* =================== page =================== */
const TABS = [
  { id: 'company', label: 'Company Info', icon: 'ti-building' },
  { id: 'templates', label: 'Templates', icon: 'ti-template' },
  { id: 'prefix', label: 'Invoice Prefix', icon: 'ti-hash' },
  { id: 'email', label: 'Email Settings', icon: 'ti-mail-cog' },
  { id: 'account', label: 'My Account', icon: 'ti-user-circle' },
];

export default function Settings() {
  const toast = useToast();
  const [tab, setTab] = useState('company');
  const [prefs, setPrefs] = useState(null);

  useEffect(() => {
    api.get('/api/settings/prefs')
      .then((d) => setPrefs(d.prefs || {}))
      .catch((e) => { toast(e.message); setPrefs({}); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const savePrefs = async (patch) => {
    await api.put('/api/settings/prefs', patch);
    setPrefs((p) => ({ ...p, ...patch }));
  };

  return (
    <div>
      <div className="set-tabs" style={{ marginBottom: 14, borderRadius: 14, border: '1px solid var(--line)' }}>
        {TABS.map((t) => (
          <div key={t.id} className={`set-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <i className={`ti ${t.icon}`} style={{ marginRight: 6 }} />
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'company' && <CompanyTab />}
      {tab === 'templates' && (prefs ? <TemplatesTab prefs={prefs} savePrefs={savePrefs} /> : <Loader />)}
      {tab === 'prefix' && (prefs ? <PrefixTab prefs={prefs} savePrefs={savePrefs} /> : <Loader />)}
      {tab === 'email' && (prefs ? <EmailTab prefs={prefs} savePrefs={savePrefs} /> : <Loader />)}
      {tab === 'account' && <AccountTab />}
    </div>
  );
}
