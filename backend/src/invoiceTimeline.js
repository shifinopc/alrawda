const { query } = require('./db');

/**
 * Full chronological timeline for one invoice — used by both the invoice History
 * and the receipt History (so a receipt shows every related transaction, not just
 * its own steps). Includes: invoice create/edit/approve/cancel, every receipt
 * recorded → booked → approved/returned → reverted, refunds, and adjustments.
 * Returns { invoiceNo, events } or null if the invoice doesn't exist.
 */
async function invoiceTimeline(code) {
  const [inv] = await query(
    `SELECT i.InvoiceNo, i.InvoiceDate, i.created_at, i.created_by_name, i.ApprovedOn, i.ApprovedBy,
            TRIM(IFNULL(i.ApprovalStatus,'Pending')) AS ApprovalStatus, TRIM(IFNULL(i.CancelYesNo,'N')) AS CancelYesNo,
            TRIM(IFNULL(am.UserName, au.display_name)) AS ApproverName
     FROM UmrahInvoice i
     LEFT JOIN AdminUserMaster am ON am.UserCode = i.ApprovedBy
     LEFT JOIN app_users au ON au.legacy_user_code = i.ApprovedBy
     WHERE i.InvoiceCode = ?`, [code]);
  if (!inv) return null;

  const events = [];
  events.push({ kind: 'created', title: 'Invoice created', note: `Invoice #${inv.InvoiceNo}`, user: inv.created_by_name, date: inv.created_at || inv.InvoiceDate });

  const receipts = await query(
    `SELECT RecieptNo, RecieptDate, RecievedAmount, TRIM(IFNULL(PaymentMode,'Cash')) AS PaymentMode,
            created_by_name, created_at FROM UmrahReciept WHERE InvoiceCode = ? AND is_deleted = 0 ORDER BY RecieptCode`, [code]);
  receipts.forEach((r) => events.push({
    kind: 'receipt', title: `Receipt ${r.RecieptNo} recorded`,
    note: `QAR ${Number(r.RecievedAmount).toLocaleString()} · ${r.PaymentMode}`,
    user: r.created_by_name, date: r.created_at || r.RecieptDate,
  }));

  // receipt-request workflow for this invoice's receipts: booked → approved/returned → reverted
  const rrEvents = await query(
    `SELECT r.RecieptNo, rr.request_no, rr.created_by_name AS reqBy, rr.created_at AS reqAt,
            rr.processed_by_name, rr.processed_at, rr.status AS reqStatus, d.status AS lineStatus,
            rr.reverted_by_name, rr.reverted_at, rr.revert_reason
     FROM UmrahReciept r
     JOIN receipt_request_dtl d ON d.receipt_code = r.RecieptCode
     JOIN receipt_request rr ON rr.id = d.request_id
     WHERE r.InvoiceCode = ? AND r.is_deleted = 0 ORDER BY rr.id`, [code]
  ).catch(() => []);
  for (const r of rrEvents) {
    events.push({ kind: 'booked', title: `Receipt ${r.RecieptNo} booked into ${r.request_no}`, user: r.reqBy, date: r.reqAt });
    if (r.lineStatus === 'Approved') {
      events.push({ kind: 'approved', title: `Receipt ${r.RecieptNo} approved & locked`, user: r.processed_by_name, date: r.processed_at });
    } else if (r.lineStatus === 'Rejected') {
      events.push({ kind: 'cancelled', title: `Receipt ${r.RecieptNo} returned to Open (rejected)`, user: r.processed_by_name, date: r.processed_at });
    }
    if (r.reqStatus === 'Reverted' && r.lineStatus === 'Approved') {
      events.push({
        kind: 'reverted', title: `Receipt ${r.RecieptNo} approval reverted — returned to Open`,
        note: r.revert_reason ? `Reason: ${r.revert_reason}` : null,
        user: r.reverted_by_name, date: r.reverted_at,
      });
    }
  }

  const refunds = await query(
    `SELECT PaymentNo, PaymentDate, PaymentAmount, Narration, created_by_name, created_at
     FROM UmrahPayment WHERE InvoiceCode = ? AND TRIM(TypeOfPayment)='Refund' AND is_deleted=0 ORDER BY PaymentCode`, [code]);
  refunds.forEach((r) => events.push({
    kind: 'refund', title: `Refund ${r.PaymentNo}`,
    note: `QAR ${Number(r.PaymentAmount).toLocaleString()}${r.Narration ? ` · ${r.Narration}` : ''}`,
    user: r.created_by_name, date: r.created_at || r.PaymentDate,
  }));

  // adjustments (write-offs) applied to this invoice
  const adjustments = await query(
    `SELECT amount, reason, remarks, created_by_name, approved_at, created_at
     FROM invoice_adjustments WHERE invoice_code = ? AND status = 'Approved' ORDER BY id`, [code]
  ).catch(() => []);
  adjustments.forEach((a) => events.push({
    kind: 'adjusted', title: 'Invoice adjusted (write-off)',
    note: `QAR ${Number(a.amount).toLocaleString()}${a.reason ? ` · ${a.reason}` : ''}`,
    user: a.created_by_name, date: a.approved_at || a.created_at,
  }));

  // audit log entries for THIS invoice (edits, approve, cancel, adjust) — carry user + role + note
  const acts = await query(
    `SELECT method, path, detail, user_name, user_role, created_at FROM activity_log
     WHERE status < 400 AND (path = ? OR path LIKE ?) ORDER BY id`,
    [`/api/invoices/${code}`, `/api/invoices/${code}/%`]
  ).catch(() => []);
  let hasApprove = false;
  for (const a of acts) {
    const p = a.path || '';
    let ev = null;
    if (/\/adjust$/.test(p)) {
      let note = '';
      try { const d = JSON.parse(a.detail || '{}'); note = `QAR ${d.amount}${d.reason ? ` · ${d.reason}` : ''}`; } catch { /* ignore */ }
      ev = { kind: 'adjusted', title: 'Invoice adjusted (write-off)', note, user: a.user_name, role: a.user_role, date: a.created_at };
    } else if (/\/approve$/.test(p)) {
      hasApprove = true;
      ev = { kind: 'approved', title: 'Sent for approval / approved', user: a.user_name, role: a.user_role, date: a.created_at };
    } else if (/\/cancel$/.test(p)) {
      ev = { kind: 'cancelled', title: 'Invoice cancelled', user: a.user_name, role: a.user_role, date: a.created_at };
    } else if (a.method === 'PUT') {
      ev = { kind: 'edited', title: 'Invoice edited', user: a.user_name, role: a.user_role, date: a.created_at };
    }
    if (ev) events.push(ev);
  }

  // fall back to document fields for migrated/desktop-approved or cancelled invoices
  if (inv.ApprovalStatus === 'Approved' && !hasApprove) {
    events.push({ kind: 'approved', title: 'Invoice approved', user: inv.ApproverName || null, date: inv.ApprovedOn });
  }
  if (inv.CancelYesNo === 'Y' && !acts.some((a) => /\/cancel$/.test(a.path || ''))) {
    events.push({ kind: 'cancelled', title: 'Invoice cancelled', date: inv.ApprovedOn });
  }

  const ORDER = { created: 0, edited: 1, receipt: 2, booked: 3, refund: 4, adjusted: 5, approved: 6, reverted: 7, cancelled: 8 };
  events.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : null;
    const db = b.date ? new Date(b.date).getTime() : null;
    if (da != null && db != null && da !== db) return da - db;
    return (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9);
  });
  return { invoiceNo: inv.InvoiceNo, events };
}

module.exports = { invoiceTimeline };
