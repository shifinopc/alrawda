const { query } = require('./db');

/**
 * Force-logout support for stateless JWTs.
 * Each user can have a `sessions_invalid_before` cutoff; any token issued
 * before it is rejected. We cache the cutoffs (refreshed every few seconds)
 * so the per-request check costs nothing in the common case.
 */
let cache = new Map(); // userId -> cutoff (epoch seconds)
let loadedAt = 0;
const TTL_MS = 8000;

async function refresh() {
  const rows = await query(
    "SELECT id, UNIX_TIMESTAMP(sessions_invalid_before) AS t FROM app_users WHERE sessions_invalid_before IS NOT NULL"
  ).catch(() => null);
  if (rows) {
    const m = new Map();
    for (const r of rows) if (r.t) m.set(Number(r.id), Number(r.t));
    cache = m;
  }
  loadedAt = Date.now();
}

async function ensureFresh() {
  if (Date.now() - loadedAt > TTL_MS) await refresh();
}

/** Reflect a force-logout in the cache immediately (don't wait for refresh). */
function markInvalid(userId, cutoffEpochSec) {
  cache.set(Number(userId), Number(cutoffEpochSec));
}

function cutoffFor(userId) {
  return cache.get(Number(userId)) || 0;
}

module.exports = { ensureFresh, markInvalid, cutoffFor, refresh };
