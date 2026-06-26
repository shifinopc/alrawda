import React from 'react';
import { WM_COLORS } from '../printTemplate';
import { getUser } from '../api';

/** Shared building blocks for printable documents (invoice / payment vouchers).
 *  `t` is the merged print template (Settings → Invoice Template branding). */

export function DocWatermark({ t }) {
  if (!t.wmEnabled) return null;
  return (
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
  );
}

export function DocHeader({ t, branded }) {
  if (t.headerImage) {
    return <img src={t.headerImage} alt="" className="rcv-headimg" />;
  }
  // branded two-colour masthead (logo style): English (maroon + gold) | logo | Arabic (maroon + gold)
  if (branded && t.headerStyle !== 'lines') {
    const gold = t.goldColor || '#a9842b';
    return (
      <div className="rcv-brandhead">
        <div className="bh-row">
          <div className="bh-en">
            <div className="bh-main">
              <span style={{ color: 'var(--acc)' }}>{t.brandEnMaroon}</span>
              {t.brandEnGold ? <> <span style={{ color: gold }}>{t.brandEnGold}</span></> : null}
            </div>
            <div className="bh-sub" style={{ color: gold }}>{t.brandEnSub}</div>
          </div>
          {t.showLogo && <img className="bh-logo" src={t.logoImage || '/alrawda-logo.jpg'} alt="" />}
          <div className="bh-ar">
            <div className="bh-main" style={{ color: 'var(--acc)' }}>{t.brandArMaroon}</div>
            <div className="bh-sub" style={{ color: gold }}>{t.brandArGold}</div>
          </div>
        </div>
        <div className="bh-contact">
          <span>{t.headerContact}</span>
          <span>{t.headerContact2}</span>
        </div>
      </div>
    );
  }
  return (
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
  );
}

export function DocFooter({ t, bandText, casesText }) {
  if (t.footerImage) {
    return <img src={t.footerImage} alt="" style={{ display: 'block', width: '100%' }} />;
  }
  return (
    <>
      {bandText && <div className="rcv-foot">{bandText}</div>}
      {casesText && <div className="rcv-cases">{casesText}</div>}
    </>
  );
}

/** Bottom meta line: who created the record + who printed it and when. */
export function DocPrintMeta({ createdBy, createdAt }) {
  const user = getUser();
  const fmt = (d) => new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return (
    <div className="rcv-printmeta">
      <span>
        Created by: <b>{createdBy || '—'}</b>{createdAt ? ` · ${fmt(createdAt)}` : ''}
      </span>
      <span>
        Printed by: <b>{user?.name || '—'}</b> · {fmt(new Date())}
      </span>
    </div>
  );
}

export const Cell = ({ en, ar, children, span }) => (
  <div className="rcv-cell" style={span ? { gridColumn: '1 / -1' } : undefined}>
    <div className="rcv-lbl"><span>{en}</span><span className="rcv-rtl">{ar}</span></div>
    <div className="rcv-val">{children ?? '—'}</div>
  </div>
);
