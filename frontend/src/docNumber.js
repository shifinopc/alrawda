import { useEffect, useState } from 'react';
import { api } from './api';

/** Document-number prefix formats — mirrors Settings → Invoice Prefix (numbering). */
const DEFAULTS = {
  invoice: { format: 'INV-{YYYY}-{SEQ}' },
  receipt: { format: 'RCT-{YYYY}-{SEQ}' },
  payment: { format: 'PAY-{YYYY}-{SEQ}' },
  request: { format: 'REQ-{YYYY}-{SEQ}' },
};

let cache = null;
async function load() {
  if (cache) return cache;
  try {
    const d = await api.get('/api/settings/prefs');
    cache = { ...DEFAULTS, ...(d.prefs?.numbering || {}) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function applyFormat(format, no, date) {
  const d = date ? new Date(date) : new Date();
  const valid = !isNaN(d);
  const y = valid ? d.getFullYear() : new Date().getFullYear();
  const m = valid ? d.getMonth() + 1 : new Date().getMonth() + 1;
  return String(format || '{SEQ}')
    .replaceAll('{PREFIX}', '')
    .replaceAll('{YYYY}', String(y))
    .replaceAll('{YY}', String(y).slice(-2))
    .replaceAll('{MM}', String(m).padStart(2, '0'))
    .replaceAll('{SEQ}', String(no == null ? '' : no).padStart(4, '0'));
}

/** Format a raw document number with the configured prefix.
 *  Pass the row's createdAt as the 4th arg: migrated/old documents (no createdAt)
 *  keep their plain number; only newly-created documents get the prefix. */
export function docNo(type, no, date, createdAt) {
  if (no == null || no === '') return '';
  if (arguments.length >= 4 && !createdAt) return String(no); // old/migrated → raw number
  const cfg = cache || DEFAULTS;
  const fmt = (cfg[type] && cfg[type].format) || DEFAULTS[type]?.format || '{SEQ}';
  return applyFormat(fmt, no, date);
}

/** Hook: ensures the numbering config is loaded, re-rendering once it is. */
export function useDocNo() {
  const [, setReady] = useState(!!cache);
  useEffect(() => { if (!cache) load().then(() => setReady(true)); }, []);
  return docNo;
}
