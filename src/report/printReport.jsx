// Printed-report module: everything the Print / Save-as-PDF export needs lives
// here, away from the on-screen report code - the print-only header component,
// the print trigger, and print.css (the single stylesheet for the printed
// layout). The printed report is the same DOM the screen shows; print.css
// reshapes it into a professional A4 document.
import React from 'react';
import { InputQualityGauge } from './common.jsx';
import './print.css';

/**
 * Triggers the browser print flow with a clean document title. The title is
 * what the browser uses as the saved PDF's default filename (and as its header
 * text where the user has browser headers enabled), so it names the audit
 * rather than the app. Restored after printing.
 */
export function printAuditReport(articleNumber) {
  const previousTitle = document.title;
  const stamp = new Date().toISOString().slice(0, 10);
  // The article number is decoded from an uploaded label (untrusted); keep only
  // filename-safe characters so it cannot smuggle control/bidi codepoints into
  // the saved PDF's name.
  const safeArticle = String(articleNumber || '').replace(/[^\w\- .]/g, '').slice(0, 60);
  document.title = ['Barcode audit report', safeArticle, stamp].filter(Boolean).join(' - ');
  const restore = () => {
    document.title = previousTitle;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

/**
 * The printed report's page-1 header: branding line, article number, verdict,
 * audit metadata, the input-quality gauge and the scope disclaimer. Hidden on
 * screen (.print-only); it replaces the interactive label-header card, which
 * print.css hides.
 */
export function PrintReportHead({ appTitle, header, audit, specLine }) {
  const summary = audit?.summary || {};
  const verdict = String(summary.overallStatus || 'REVIEW').toUpperCase();
  const tone = verdict === 'PASS' ? 'pass' : verdict === 'FAIL' ? 'fail' : 'review';
  return (
    <header className="print-only print-report-head">
      <div className="print-head-brand">
        <strong>{appTitle}</strong>
        <span>Barcode audit report</span>
      </div>
      <div className="print-head-main">
        <span className="print-head-article">{header.articleNumber}</span>
        <span className={`print-head-verdict print-verdict-${tone}`}>{verdict}</span>
      </div>
      <dl className="print-head-meta">
        <div>
          <dt>Result</dt>
          <dd>
            {summary.passed ?? 0} passed · {summary.manualReview ?? 0} review · {summary.failed ?? 0} failed
          </dd>
        </div>
        <div>
          <dt>Product</dt>
          <dd>{header.productCode ? `${header.productCode} — ${header.productName}` : header.product}</dd>
        </div>
        <div>
          <dt>Service</dt>
          <dd>
            {header.serviceCode || 'not parsed'}
            {header.serviceName ? ` — ${header.serviceName}` : ''}
          </dd>
        </div>
        <div>
          <dt>Rule set</dt>
          <dd>{audit?.ruleSet?.name || 'carrier defaults'}</dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>{header.displayFile || header.filename}</dd>
        </div>
        <div>
          <dt>Printed</dt>
          <dd>{new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
        </div>
      </dl>
      <InputQualityGauge fileInfo={audit?.fileInfo} />
      <p className="print-head-disclaimer">
        Automated digital check against {specLine}. Does not replace carrier certification or physical barcode
        grading. On-screen text analysis is not included in this printed report.
      </p>
    </header>
  );
}
