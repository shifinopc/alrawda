import React from 'react';
import { Empty, Loader } from './ui';

/** Visual mapping for each history event kind. */
const EVENT_META = {
  created: { icon: 'ti-file-plus', tone: 'blue' },
  edited: { icon: 'ti-pencil', tone: 'warn' },
  receipt: { icon: 'ti-receipt', tone: 'green' },
  refund: { icon: 'ti-arrow-back-up', tone: 'red' },
  adjusted: { icon: 'ti-adjustments-dollar', tone: 'warn' },
  booked: { icon: 'ti-cash', tone: 'warn' },
  approved: { icon: 'ti-checks', tone: 'green' },
  reverted: { icon: 'ti-arrow-back-up', tone: 'red' },
  cancelled: { icon: 'ti-ban', tone: 'red' },
};

const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Shared vertical history timeline for invoice / receipt / payment drawers. */
export default function DocTimeline({ events }) {
  if (events === null) return <Loader />;
  if (!events || !events.length) return <Empty icon="ti-history" text="No history recorded." />;
  return (
    <div className="timeline">
      {events.map((e, i) => {
        const m = EVENT_META[e.kind] || { icon: 'ti-point', tone: 'blue' };
        const meta = [e.user, e.role].filter(Boolean).join(' · ');
        return (
          <div key={i} className="tl-item">
            <span className={`badge ${m.tone} tl-dot`}><i className={`ti ${m.icon}`} /></span>
            <div className="tl-body">
              <div style={{ fontWeight: 700 }}>{e.title}</div>
              {e.note && <div className="muted" style={{ fontSize: 12.5 }}>{e.note}</div>}
              <small className="muted" style={{ display: 'block' }}>
                <i className="ti ti-user" /> By: {meta || 'Not recorded (legacy)'}
              </small>
              <small className="muted" style={{ display: 'block' }}>
                <i className="ti ti-clock" /> {fmtDateTime(e.date)}
              </small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
