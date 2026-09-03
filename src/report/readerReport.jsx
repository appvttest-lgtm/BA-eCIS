// Barcode Reader mode report: no verdict, no rule tables - the full label image with
// decode outlines, then one card per decoded barcode showing its raw content with FNC1
// evidence made visible. Data shaping lives in readerData.js (pure, Node-tested).
import React from 'react';
import { CopyButton, InputQualityGauge, SectionTitle } from './common.jsx';
import {
  leadingFnc1Info,
  rawContentOf,
  rawDisplaySegments,
  readerCopyAllText,
  readerSymbologyName
} from './readerData.js';

/** One decoded barcode: symbology + engine, leading-FNC1 evidence, raw content with
 *  control characters rendered visibly, and the readable text when it differs. */
function ReaderBarcodeCard({ barcode, ordinal }) {
  const { raw, fromBytes } = rawContentOf(barcode);
  const segments = rawDisplaySegments(raw);
  const fnc1 = leadingFnc1Info(barcode.symbologyIdentifier);
  const readable = String(barcode.rawValue || '');
  const readableDiffers = Boolean(readable) && readable !== raw;
  return (
    <li className="reader-barcode">
      <div className="barcode-meta reader-barcode-head">
        <strong>
          #{ordinal} · {readerSymbologyName(barcode)}
        </strong>
        <span className="muted small">
          {barcode.pageNumber ? `page ${barcode.pageNumber} · ` : ''}
          {barcode.source || 'unknown decoder'}
        </span>
      </div>
      <p className="reader-fnc1-line">
        <span className={`fnc1-chip fnc1-${fnc1.status}`}>{fnc1.label}</span>
        <span className="muted small">{fnc1.detail}</span>
      </p>
      <div className="reader-raw">
        <span className="reader-raw-label">Raw content {fromBytes ? '(byte stream)' : '(decoded text)'}</span>
        <div className="segmented-code-row">
          <code className="raw-code raw-code-block reader-raw-code">
            {fnc1.status === 'first' ? (
              <span
                className="ctrl-char ctrl-char-lead"
                title={`FNC1 in first position - signalled by symbology identifier ${fnc1.code}, not transmitted as data`}
              >
                ⟨FNC1⟩ {fnc1.code}
              </span>
            ) : null}
            {segments.map((seg, i) =>
              seg.ctrl ? (
                <span key={i} className="ctrl-char" title={seg.title}>
                  {seg.display}
                </span>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )}
          </code>
          <CopyButton value={raw} label="Copy raw content (control characters included)" text="Copy raw" />
          {!readableDiffers && readable ? (
            <CopyButton value={readable} label="Copy readable value" text="Copy readable" />
          ) : null}
        </div>
        {!fromBytes && (
          <p className="muted small">This decoder did not report the raw byte stream; showing its decoded text.</p>
        )}
      </div>
      {readableDiffers && (
        <div className="reader-raw">
          <span className="reader-raw-label">Readable (human-readable interpretation)</span>
          <div className="segmented-code-row">
            <code className="raw-code raw-code-block">{readable}</code>
            <CopyButton value={readable} label="Copy readable value" text="Copy readable" />
          </div>
        </div>
      )}
      <div className="muted small">
        {barcode.pageBoundingBox
          ? 'Barcode location verified on this label.'
          : 'Barcode decoded; exact location not mapped.'}
      </div>
    </li>
  );
}

/** The complete Barcode Reader report for one scanned label. */
export function ReaderReportView({ result, index = 0, onNewAudit, processing = false, onZoomLabel }) {
  const barcodes = result?.detectedBarcodes || [];
  const images = result?.labelImages || {};
  const fileInfo = result?.fileInfo || {};
  const fileLine = `${fileInfo.filename || `Label ${index + 1}`}${fileInfo.pageLabel ? ` — ${fileInfo.pageLabel}` : ''}`;
  return (
    <section className="single-audit-view reader-view">
      <section className="card compact-card selected-label-header reader-header">
        <button
          type="button"
          className="new-audit-btn"
          onClick={onNewAudit}
          disabled={processing}
          title="Start a new read or audit (keeps this report until a new label is uploaded)"
        >
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
            <path
              d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M14 3v6h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M12 11v6M9 14h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>New audit</span>
        </button>
        <span className="selected-label-eyebrow">Barcode reader</span>
        <div className="selected-label-number">
          <code>
            {barcodes.length} barcode{barcodes.length === 1 ? '' : 's'} decoded
          </code>
          <CopyButton
            value={readerCopyAllText(result)}
            label="Copy every decoded raw value, one per line"
            text="Copy all raw values"
          />
        </div>
        <div className="selected-label-meta">
          <span>
            <span className="meta-k">Mode</span>
            <span className="meta-v">Barcode Reader — no validation rules applied</span>
          </span>
          <span>
            <span className="meta-k">File</span>
            <span className="meta-v">{fileLine}</span>
          </span>
        </div>
        <InputQualityGauge fileInfo={fileInfo} />
      </section>

      <section className="card audit-section reader-section" id="full-label-image">
        <div className="section-heading">
          <SectionTitle id="full-label-image-title">Full label image</SectionTitle>
          <span className="section-status section-status-neutral">read only</span>
        </div>
        {images.labelPreview ? (
          <>
            <button
              className="label-preview-button"
              type="button"
              onClick={() => onZoomLabel?.({ src: images.labelPreview, alt: 'Full label preview' })}
              aria-label="Open full screen label image"
            >
              <img className="label-preview-large" src={images.labelPreview} alt="Full label preview" />
            </button>
            <p className="small muted preview-legend">
              Barcode outlines: <span className="legend-dot legend-valid" /> decoded barcode — every decode is shown; no
              expected/valid judgement is applied in reader mode
            </p>
          </>
        ) : (
          <p className="muted">No label preview captured.</p>
        )}
      </section>

      <section className="card audit-section reader-section" id="reader-barcodes">
        <div className="section-heading">
          <SectionTitle id="reader-barcodes-title">Decoded barcodes</SectionTitle>
          <span className="section-status section-status-neutral">{barcodes.length} decoded</span>
        </div>
        {barcodes.length === 0 ? (
          <p className="muted">
            No barcodes were decoded from this label. Low resolution is the most common cause — upload the original PDF
            or a 300 DPI export.
          </p>
        ) : (
          <ul className="barcode-list decoded-list reader-barcode-list">
            {barcodes.map((b, i) => (
              <ReaderBarcodeCard
                key={`${b.pageNumber || 0}-${b.format || ''}-${b.rawValue}-${i}`}
                barcode={b}
                ordinal={i + 1}
              />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
