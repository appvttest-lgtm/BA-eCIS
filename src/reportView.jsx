// Rule-by-rule report view. Each validation row expands into three panes:
// the input data scraped from the label, the validation rule (plain English
// plus the executable JSON rule logic), and the outcome. Designed for the
// ECIS in-browser report; see docs/checklists for the rule catalogue.
import React, { useMemo, useState } from 'react';

const STATUS_LABELS = {
  pass: 'PASS',
  fail: 'FAIL',
  warning: 'WARNING',
  manual_review: 'MANUAL REVIEW',
  not_applicable: 'N/A'
};

function statusKey(status) {
  return STATUS_LABELS[status] ? status : 'not_applicable';
}

function RuleStatusBadge({ status }) {
  const key = statusKey(status);
  return <span className={`badge badge-${key}`}>{STATUS_LABELS[key]}</span>;
}

function formatInputValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) return value.join('\n');
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function RuleRow({ v, standardFor, showPayload, renderPayload }) {
  const [open, setOpen] = useState(v.status === 'fail');
  const [showLogic, setShowLogic] = useState(false);
  const rule = v.rule || null;
  const source = rule?.source || null;
  const sourceText = source
    ? [source.doc, source.page ? `p${source.page}` : null, source.ref || null].filter(Boolean).join(' · ')
    : '';
  const description = rule?.description || (standardFor ? standardFor(v) : '') || '';
  const inputValue = formatInputValue(v.input?.value);
  const observed = v.actual || inputValue;
  const logic = rule?.logic
    ? {
        id: rule.id,
        obligation: rule.obligation,
        ...Object.fromEntries(Object.entries(rule.logic).filter(([, val]) => val !== undefined && val !== null))
      }
    : null;

  return (
    <div className={`rule-row tone-${statusKey(v.status)}`} id={`rule-${v.id}`}>
      <button type="button" className="rule-row-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={`rule-status-dot dot-${statusKey(v.status)}`} aria-hidden="true" />
        <code className="rule-id">{rule?.id || v.id}</code>
        <span className="rule-title">{v.title}</span>
        {isIssue(v) && (
          <span className={`badge rule-head-tag badge-${statusKey(v.status)}`}>
            {v.status === 'fail' ? 'FAIL' : v.status === 'warning' ? 'WARNING' : 'REVIEW'}
          </span>
        )}
        {observed && (
          <span className="rule-observed" title={observed}>
            {observed}
          </span>
        )}
        <span className="rule-chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="rule-row-body">
          <div className="rule-panes">
            <div className="rule-pane">
              <p className="rule-pane-title">Input data</p>
              {v.input?.path && (
                <p className="rule-kv">
                  <span className="rule-kv-label">Source</span>
                  <code>{v.input.path}</code>
                </p>
              )}
              {inputValue && <pre className="rule-input-value">{inputValue}</pre>}
              {(v.input?.evidence || []).map(e => (
                <div key={e.path} className="rule-kv-block">
                  <span className="rule-kv-label">{e.path}</span>
                  <pre>{formatInputValue(e.value)}</pre>
                </div>
              ))}
              {!inputValue && !(v.input?.evidence || []).length && !v.evidence && (
                <p className="muted small">No input data was captured for this rule.</p>
              )}
              {v.evidence && (
                <details className="rule-evidence">
                  <summary>Evidence</summary>
                  <pre>{v.evidence}</pre>
                </details>
              )}
            </div>
            <div className="rule-pane">
              <p className="rule-pane-title">Validation rule</p>
              {description && <p className="rule-description">{description}</p>}
              {sourceText && <p className="rule-source">{sourceText}</p>}
              {logic && (
                <button type="button" className="rule-logic-toggle" onClick={() => setShowLogic(s => !s)}>
                  {showLogic ? 'Hide rule logic' : 'View rule logic'}
                </button>
              )}
              {logic && showLogic && <pre className="rule-logic">{JSON.stringify(logic, null, 2)}</pre>}
            </div>
            <div className="rule-pane">
              <p className="rule-pane-title">Outcome</p>
              {isIssue(v) ? (
                <p>
                  <RuleStatusBadge status={v.status} />
                </p>
              ) : (
                <p className="rule-outcome-quiet">{v.status === 'pass' ? 'Passed' : 'Not applicable'}</p>
              )}
              {v.expected && (
                <p className="rule-kv">
                  <span className="rule-kv-label">Expected</span>
                  <code>{v.expected}</code>
                </p>
              )}
              {v.actual && (
                <p className="rule-kv">
                  <span className="rule-kv-label">Actual</span>
                  <code>{v.actual}</code>
                </p>
              )}
              <p className="rule-message">{v.message}</p>
              {showPayload && v.apiPayloadMatch && renderPayload && (
                <div className="rule-payload">{renderPayload(v.apiPayloadMatch)}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isIssue(v) {
  return v.status === 'fail' || v.status === 'warning' || v.status === 'manual_review';
}

/** Rule-by-rule report: filter chips plus one expandable row per validation result. */
export function RuleReport({ items, standardFor, showPayload, renderPayload }) {
  const [filter, setFilter] = useState('all');
  const counts = useMemo(
    () => ({
      issues: items.filter(isIssue).length,
      all: items.length,
      pass: items.filter(v => v.status === 'pass').length
    }),
    [items]
  );
  const filtered = items.filter(
    v => filter === 'all' || (filter === 'issues' && isIssue(v)) || (filter === 'pass' && v.status === 'pass')
  );
  return (
    <div className="rule-report">
      <div className="rule-filters" role="group" aria-label="Filter rules by status">
        {[
          ['issues', 'Warnings & fails'],
          ['all', 'All'],
          ['pass', 'Passed']
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`rule-filter-chip ${filter === key ? 'is-active' : ''}`}
            onClick={() => setFilter(key)}
            disabled={key !== 'all' && counts[key] === 0}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>
      {filtered.length ? (
        filtered.map((v, idx) => (
          <RuleRow
            key={`${v.id}-${idx}`}
            v={v}
            standardFor={standardFor}
            showPayload={showPayload}
            renderPayload={renderPayload}
          />
        ))
      ) : filter === 'issues' ? (
        <p className="muted small">
          No warnings or failures in this section — {counts.pass} rule{counts.pass === 1 ? '' : 's'} passed.
        </p>
      ) : (
        <p className="muted small">No rules match this filter.</p>
      )}
    </div>
  );
}
