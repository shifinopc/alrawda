/** Shared print-template defaults — managed in Settings → Invoice Template,
 *  consumed by the printable documents (receipt voucher, invoice). */

export const TEMPLATE_DEFAULTS = {
  // header
  headerAlign: 'center',
  headerImage: null,
  logoImage: null,
  showLogo: true,
  headerLine1: 'AL RAWDA GROUP HAJJ & UMRAH SERVICES',
  headerLine2: 'الروضة للحج والعمرة',
  headerContact: 'Tel: 44424434 - Mob: +974 50604031 / 50604032 / 66141245 / 66767829',
  headerContact2: 'Bank Street, Street No. 910 Doha - Qatar',
  // branded two-colour masthead (logo style) — used on the invoice header
  headerStyle: 'branded', // 'branded' | 'lines'
  goldColor: '#a9842b',
  brandEnMaroon: 'AL RAWDA',
  brandEnGold: 'GROUP',
  brandEnSub: 'HAJJ & UMRAH SERVICES',
  brandArMaroon: 'حملة الروضة',
  brandArGold: 'للحج والعمرة',
  // voucher text blocks
  notesArabic: [
    'في حالة قيام المعتمر بإلغاء الرحلة فلن نتمكن من إسترداد قيمة رسوم برنامج العمرة',
    'فقط يمكن مراجعة الخطوط الناقلة بخصوص تذكرة الطيران حسب شروط الحجز',
    'التسكين في فنادق مكة والمدينة بعد الساعة الثالثة عصراً',
    'على العميل متابعة تحديثات السفر والعودة فيما يخص الإجراءات الإحترازية والقوانين الإستثنائية',
    'يرجى مراجعة جميع البيانات قبل مغادرة مكتبنا',
  ].join('\n'),
  footerBandText: 'يرجى إحضار الفاتورة لأنها ضرورية في الحالات التالية',
  footerCasesText: '(١) عند إستلام الجواز   (٢) عند إسترداد أي مبالغ مستحقة   (٣) عند دفع المبالغ المتبقية',
  // footer
  footerImage: null,
  footerText: 'Thank you for choosing AL RAWDA — we wish you a blessed journey.',
  showPageNumbers: true,
  showSignatures: true,
  // watermark
  wmEnabled: true,
  wmText: 'AL RAWDA',
  wmImage: null,
  wmStyle: 'diagonal',
  wmOpacity: 9,
  wmColor: 'violet',
};

export const WM_COLORS = { violet: '#7c00ff', grey: '#888888', blue: '#7fa8ff' };

export const mergeTemplate = (saved) => ({ ...TEMPLATE_DEFAULTS, ...(saved || {}) });

/* ---- receipt voucher template (Settings → Receipt Template) ---- */
export const RECEIPT_DEFAULTS = {
  accentColor: '#8a1538',
  titleEn: 'Receipt Voucher',
  titleAr: 'سند قبض',
  currencyLabel: 'QAR',
  showNotes: true,
  showCounts: true,
  showPassengers: true,
  showSignatures: true,
  notesArabic: TEMPLATE_DEFAULTS.notesArabic,
  footerBandText: TEMPLATE_DEFAULTS.footerBandText,
  footerCasesText: TEMPLATE_DEFAULTS.footerCasesText,
};

/** Merge receipt template; falls back to values previously stored on printTemplate. */
export const mergeReceiptTemplate = (printSaved, receiptSaved) => {
  const legacy = {};
  for (const k of ['notesArabic', 'footerBandText', 'footerCasesText']) {
    if (printSaved && printSaved[k] != null) legacy[k] = printSaved[k];
  }
  return { ...RECEIPT_DEFAULTS, ...legacy, ...(receiptSaved || {}) };
};

/* ---- invoice voucher template (Settings → Invoice Template) ---- */
export const INVOICE_DEFAULTS = {
  accentColor: '#8a1538',
  titleEn: 'Invoice',
  titleAr: 'فاتورة',
  currencyLabel: 'QAR',
  showPassengers: true,
  showReceipts: true,
  showSignatures: true,
  footerBandText: TEMPLATE_DEFAULTS.footerBandText,
  footerCasesText: TEMPLATE_DEFAULTS.footerCasesText,
};
export const mergeInvoiceTemplate = (saved) => ({ ...INVOICE_DEFAULTS, ...(saved || {}) });

/* ---- payment voucher template (Settings → Payment Template) ---- */
export const PAYMENT_DEFAULTS = {
  accentColor: '#8a1538',
  titleEn: 'Payment Voucher',
  titleAr: 'سند صرف',
  currencyLabel: 'QAR',
  showSignatures: true,
  footerBandText: '',
  footerCasesText: '',
};
export const mergePaymentTemplate = (saved) => ({ ...PAYMENT_DEFAULTS, ...(saved || {}) });

/* ---- report template (Settings → Report Template) ---- */
export const REPORT_DEFAULTS = {
  accentColor: '#8a1538',
  showHeader: true,
  showPeriod: true,
  zebraRows: true,
  showTotals: true,
  showGeneratedBy: true,
  footerNote: 'This is a computer-generated report and does not require a signature.',
};

export const mergeReportTemplate = (saved) => ({ ...REPORT_DEFAULTS, ...(saved || {}) });
