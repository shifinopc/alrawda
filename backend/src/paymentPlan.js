const { query } = require('./db');

/* ------------------------------------------------------------------ *
 * Instalment (EMI) plans.
 *
 * A plan is a SCHEDULE ONLY — it never stores money. Balances stay
 * derived from receipts exactly as before, and which instalments are
 * covered is worked out at read time from the receipts total.
 * ------------------------------------------------------------------ */

let ensured = null;
function ensureTables() {
  if (!ensured) {
    ensured = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS payment_plan (
        invoice_code INT NOT NULL,
        opening_paid DECIMAL(18,0) NOT NULL DEFAULT 0,
        planned_amount DECIMAL(18,0) NOT NULL,
        net_at_creation DECIMAL(18,0) NOT NULL,
        status VARCHAR(15) NOT NULL DEFAULT 'Active',
        created_by INT NULL,
        created_by_name VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        cancelled_by_name VARCHAR(100) NULL,
        cancelled_at DATETIME NULL,
        PRIMARY KEY (invoice_code), KEY idx_plan_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await query(`CREATE TABLE IF NOT EXISTS payment_plan_dtl (
        invoice_code INT NOT NULL,
        seq INT NOT NULL,
        due_date DATE NOT NULL,
        amount DECIMAL(18,0) NOT NULL,
        PRIMARY KEY (invoice_code, seq), KEY idx_due (due_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })();
  }
  return ensured;
}

const today = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD, as notify.js
const MAX_INSTALMENTS = 60;

/** Split `total` into `n` whole-riyal parts; the remainder lands on the last one. */
function splitEqually(total, n) {
  const base = Math.floor(total / n);
  const parts = Array(n).fill(base);
  parts[n - 1] = total - base * (n - 1);
  return parts;
}

/** Spread `allocated` over the schedule, oldest first, and label each row. */
function allocate(lines, allocated) {
  let left = allocated;
  const now = today();
  return lines.map((l) => {
    const amount = Number(l.amount);
    const paid = Math.min(left, amount);
    left -= paid;
    const status = paid >= amount ? 'Paid'
      : paid > 0 ? 'Part paid'
        : l.due_date < now ? 'Overdue' : 'Due';
    return { seq: Number(l.seq), dueDate: l.due_date, amount, paid, status };
  });
}

/**
 * Does the plan still describe reality?
 *
 * On a sound plan: balance + allocated == planned_amount. Anything that moves the
 * invoice out from under it breaks that identity — an edit or approved adjustment
 * changing NetAmount, or a receipt banked BEFORE the plan later being binned (which
 * the allocation floor hides, leaving the sheet understating what the pilgrim owes).
 * One check covers both; a plan that no longer adds up must say so, never re-split
 * itself.
 */
const isStale = (planned, balance, allocated) => balance + allocated !== planned;

/** Same day of the month, `months` later, clamped to the month's last day (31 Jan -> 28 Feb). */
function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = String(Math.min(d, lastDay)).padStart(2, '0');
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${day}`;
}

/**
 * The active plan for an invoice with each instalment's state, or null.
 * Allocation runs oldest-first over money received AFTER the plan was made.
 */
async function getPlan(invoiceCode) {
  await ensureTables();
  const [plan] = await query(
    `SELECT * FROM payment_plan WHERE invoice_code = ? AND status = 'Active'`, [invoiceCode]);
  if (!plan) return null;

  const [inv] = await query(
    `SELECT NetAmount, TRIM(IFNULL(CancelYesNo,'N')) AS CancelYesNo,
            IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept
                    WHERE InvoiceCode = i.InvoiceCode AND is_deleted = 0), 0) AS received
     FROM UmrahInvoice i WHERE i.InvoiceCode = ? AND i.is_deleted = 0`, [invoiceCode]);
  if (!inv || inv.CancelYesNo === 'Y') return null; // binned or cancelled invoice has no live plan

  const lines = await query(
    `SELECT seq, due_date, amount FROM payment_plan_dtl WHERE invoice_code = ? ORDER BY seq`, [invoiceCode]);

  // GREATEST(0, …): a receipt banked before the plan can later be binned, which
  // would otherwise drive this negative and "unpay" instalments.
  const allocated = Math.max(0, Number(inv.received) - Number(plan.opening_paid));
  const instalments = allocate(lines, allocated);

  const paidCount = instalments.filter((i) => i.status === 'Paid').length;
  const balance = Number(inv.NetAmount) - Number(inv.received);
  return {
    invoiceCode: Number(invoiceCode),
    openingPaid: Number(plan.opening_paid),
    plannedAmount: Number(plan.planned_amount),
    netAtCreation: Number(plan.net_at_creation),
    netAmount: Number(inv.NetAmount),
    received: Number(inv.received),
    balance,
    allocated,
    stale: isStale(Number(plan.planned_amount), balance, allocated),
    createdByName: plan.created_by_name,
    createdAt: plan.created_at,
    instalments,
    paidCount,
    count: instalments.length,
    overdue: instalments.some((i) => i.status === 'Overdue'),
    allEqual: instalments.length > 1
      && instalments.every((i) => i.amount === instalments[0].amount),
  };
}

/** Plan summaries for a page of invoices — one query, for list badges. */
async function getPlanSummaries(invoiceCodes) {
  if (!invoiceCodes.length) return {};
  await ensureTables();
  const rows = await query(
    `SELECT p.invoice_code, p.opening_paid, p.planned_amount, i.NetAmount,
            COUNT(d.seq) AS cnt,
            IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept
                    WHERE InvoiceCode = p.invoice_code AND is_deleted = 0), 0) AS received
     FROM payment_plan p
     JOIN UmrahInvoice i ON i.InvoiceCode = p.invoice_code
     LEFT JOIN payment_plan_dtl d ON d.invoice_code = p.invoice_code
     WHERE p.status = 'Active' AND i.is_deleted = 0
       AND TRIM(IFNULL(i.CancelYesNo,'N')) <> 'Y' AND p.invoice_code IN (?)
     GROUP BY p.invoice_code`, [invoiceCodes]);
  if (!rows.length) return {};

  const lines = await query(
    `SELECT invoice_code, seq, due_date, amount FROM payment_plan_dtl
     WHERE invoice_code IN (?) ORDER BY invoice_code, seq`, [rows.map((r) => r.invoice_code)]);
  const byInvoice = new Map();
  for (const l of lines) {
    if (!byInvoice.has(l.invoice_code)) byInvoice.set(l.invoice_code, []);
    byInvoice.get(l.invoice_code).push(l);
  }

  const now = today();
  const out = {};
  for (const r of rows) {
    const allocated = Math.max(0, Number(r.received) - Number(r.opening_paid));
    let left = allocated;
    let paidCount = 0, overdue = false;
    for (const l of byInvoice.get(r.invoice_code) || []) {
      const amount = Number(l.amount);
      const paid = Math.min(left, amount);
      left -= paid;
      if (paid >= amount) paidCount += 1;
      else if (paid === 0 && l.due_date < now) overdue = true;
    }
    out[r.invoice_code] = {
      paidCount,
      count: Number(r.cnt),
      overdue,
      stale: isStale(Number(r.planned_amount), Number(r.NetAmount) - Number(r.received), allocated),
    };
  }
  return out;
}

/**
 * Validate a proposed schedule against the invoice. Returns an error string, or
 * null when it is good. `balance` and `invoiceDate` come from a locked read.
 */
function validateLines(lines, balance, invoiceDate) {
  if (!Array.isArray(lines) || !lines.length) return 'Add at least one instalment.';
  if (lines.length > MAX_INSTALMENTS) return `A plan cannot have more than ${MAX_INSTALMENTS} instalments.`;

  let total = 0, prev = null;
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    const amount = Number(l.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return `Instalment ${n}: enter a whole amount above zero.`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.dueDate || ''))) {
      return `Instalment ${n}: pick a due date.`;
    }
    if (invoiceDate && l.dueDate < invoiceDate) {
      return `Instalment ${n} is due before the invoice date.`;
    }
    if (prev && l.dueDate <= prev) {
      return `Instalment ${n} is not after instalment ${n - 1}.`;
    }
    prev = l.dueDate;
    total += amount;
  }
  if (total !== balance) {
    const diff = Math.abs(total - balance);
    return `Instalments total ${total.toLocaleString()} — ${diff.toLocaleString()} ${total > balance ? 'too much' : 'short'} of the ${balance.toLocaleString()} balance.`;
  }
  return null;
}

module.exports = {
  ensureTables, getPlan, getPlanSummaries, validateLines, splitEqually, addMonths, allocate, isStale, MAX_INSTALMENTS,
};
