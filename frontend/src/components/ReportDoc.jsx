import React from 'react';
import { fmtDate, getUser } from '../api';
import { mergeTemplate, mergeReportTemplate } from '../printTemplate';

/** Standardized, printable report document.
 *  Branding (header image / logo / company lines) comes from Settings → Invoice Template;
 *  report styling options come from Settings → Report Template. */
export default function ReportDoc({ title, from, to, printTemplate, reportTemplate, children }) {
  const t = mergeTemplate(printTemplate);
  const rt = mergeReportTemplate(reportTemplate);
  const user = getUser();

  return (
    <div
      className={`rpt${rt.zebraRows ? ' zebra' : ''}${rt.showTotals ? '' : ' nototals'}`}
      style={{ '--acc': rt.accentColor || '#8a1538' }}
    >
      {rt.showHeader && (
        t.headerImage ? (
          <img src={t.headerImage} alt="" style={{ display: 'block', width: '100%', marginBottom: 10 }} />
        ) : (
          <div className="rpt-head">
            {t.showLogo && <img className="rpt-logo" src={t.logoImage || '/alrawda-logo.jpg'} alt="" />}
            <div className="rpt-titles">
              <div className="rpt-ar">{t.headerLine2}</div>
              <div className="rpt-en">{t.headerLine1}</div>
              <div className="rpt-contact">{t.headerContact}</div>
              <div className="rpt-contact">{t.headerContact2}</div>
            </div>
            {t.showLogo && <div style={{ width: 62 }} />}
          </div>
        )
      )}
      {rt.showHeader && <div className="rpt-accentbar" />}

      <div className="rpt-titlerow">
        <span className="rpt-title">{title}</span>
        {rt.showPeriod && from && (
          <span className="rpt-period">{fmtDate(from)} — {fmtDate(to)}</span>
        )}
      </div>

      <div className="rpt-body">{children}</div>

      {(rt.footerNote || rt.showGeneratedBy) && (
        <div className="rpt-footrow">
          <span>{rt.footerNote}</span>
          {rt.showGeneratedBy && (
            <span style={{ whiteSpace: 'nowrap' }}>
              Printed by {user?.name || '—'} · {new Date().toLocaleString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
