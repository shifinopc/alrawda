/** Add indexes on the columns the app filters/joins on most. Idempotent (checks first). */
const mysql = require('mysql2/promise');

const INDEXES = [
  ['UmrahInvoice', 'idx_inv_date', 'InvoiceDate'],
  ['UmrahInvoice', 'idx_inv_departure', 'DepartureDate'],
  ['UmrahInvoice', 'idx_inv_customer', 'CustomerName'],
  ['UmrahInvoice', 'idx_inv_package', 'PackageCode'],
  ['UmrahInvoice', 'idx_inv_nationality', 'NatinalityCode'],
  ['UmrahInvoice', 'idx_inv_cancel', 'CancelYesNo'],
  ['UmrahReciept', 'idx_rec_invoice', 'InvoiceCode'],
  ['UmrahReciept', 'idx_rec_date', 'RecieptDate'],
  ['UmrahReciept', 'idx_rec_approved', 'ReceiptApproved'],
  ['UmrahPayment', 'idx_pay_invoice', 'InvoiceCode'],
  ['UmrahPayment', 'idx_pay_date', 'PaymentDate'],
  ['UmrahPayment', 'idx_pay_type', 'TypeOfPayment'],
  ['UmrahPassengers', 'idx_pax_invoice', 'InvoiceCode'],
  ['UmrahPassengers', 'idx_pax_visatype', 'VisaTypeCode'],
  ['adminUserAudit', 'idx_audit_user', 'UserCode'],
  ['sopCustomerInfo', 'idx_cust_name', 'CustomerName'],
  ['sopCustomerInfo', 'idx_cust_country', 'CountryCode'],
];

(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  let added = 0, skipped = 0, failed = [];
  for (const [table, idx, col] of INDEXES) {
    const [[{ n }]] = await c.query(
      `SELECT COUNT(*) AS n FROM information_schema.statistics
       WHERE table_schema='travels' AND table_name=? AND index_name=?`, [table, idx]);
    if (n > 0) { skipped++; continue; }
    try {
      // TEXT columns need a prefix length; detect and apply 50-char prefix where needed
      const [[colInfo]] = await c.query(
        `SELECT DATA_TYPE FROM information_schema.columns
         WHERE table_schema='travels' AND table_name=? AND column_name=?`, [table, col]);
      if (!colInfo) { failed.push(`${table}.${col} (no such column)`); continue; }
      const needsPrefix = ['text', 'mediumtext', 'longtext'].includes(colInfo.DATA_TYPE.toLowerCase());
      const colExpr = needsPrefix ? `\`${col}\`(50)` : `\`${col}\``;
      await c.query(`ALTER TABLE \`${table}\` ADD INDEX \`${idx}\` (${colExpr})`);
      added++;
    } catch (e) {
      failed.push(`${table}.${idx}: ${e.message}`);
    }
  }
  console.log(`indexes — added ${added}, already-present ${skipped}, failed ${failed.length}`);
  if (failed.length) console.log(failed.join('\n'));
  await c.end();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
