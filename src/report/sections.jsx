// Carrier-dispatching report structure: getAuditSections maps one audit to
// its ordered section groups, and the article/barcode data section picks the
// carrier-appropriate breakdown.
import React from 'react';
import { groupValidations } from '../auditEngine.js';
import { SectionStatus, SectionTitle, StandardLine, ValidationTable } from './common.jsx';
import { auditHasSsccOnly } from './auditInfo.js';
import { ServiceCodeMatrix } from '../carriers/eparcel/sections.jsx';
import { StarTrackProductArticleSection } from '../carriers/startrack/sections.jsx';

export function getAuditSections(audit) {
  const grouped = audit ? groupValidations(audit.validations || []) : {};
  if (audit?.carrier === 'startrack') {
    const used = new Set([
      'audit-mode',
      'StarTrack QR barcode',
      'StarTrack routing barcode',
      'StarTrack ATL barcode',
      'StarTrack freight item barcode',
      'StarTrack product/article data',
      'label-layout',
      'address-format'
    ]);
    return {
      mode: grouped['audit-mode'] || [],
      label: grouped['label-layout'] || [],
      datamatrix: grouped['StarTrack QR barcode'] || [],
      routing: grouped['StarTrack routing barcode'] || [],
      atl: grouped['StarTrack ATL barcode'] || [],
      freight: grouped['StarTrack freight item barcode'] || [],
      linear: [
        ...(grouped['StarTrack routing barcode'] || []),
        ...(grouped['StarTrack ATL barcode'] || []),
        ...(grouped['StarTrack freight item barcode'] || [])
      ],
      service: grouped['StarTrack product/article data'] || [],
      text: grouped['address-format'] || [],
      other: Object.entries(grouped)
        .filter(([key]) => !used.has(key))
        .flatMap(([, items]) => items)
    };
  }
  const used = new Set([
    'audit-mode',
    'DataMatrix barcode analysis',
    'linear barcode analysis',
    'service-code',
    'sscc',
    'label-layout',
    'address-format'
  ]);
  return {
    mode: grouped['audit-mode'] || [],
    label: grouped['label-layout'] || [],
    datamatrix: grouped['DataMatrix barcode analysis'] || [],
    linear: grouped['linear barcode analysis'] || [],
    service: [...(grouped['service-code'] || []), ...(grouped['sscc'] || [])],
    text: grouped['address-format'] || [],
    other: Object.entries(grouped)
      .filter(([key]) => !used.has(key))
      .flatMap(([, items]) => items)
  };
}
export function ServiceArticleBreakdownSection({ audit, items }) {
  if (audit?.carrier === 'startrack') return <StarTrackProductArticleSection audit={audit} items={items} />;
  const ssccOnly = auditHasSsccOnly(audit);
  return (
    <section className="card audit-section" id="service-article-section">
      <div className="section-heading">
        <SectionTitle id="service-article-section-title">Article and barcode data</SectionTitle>
        <SectionStatus items={items} />
      </div>
      {ssccOnly && (
        <div className="info-panel sscc-panel">
          <strong>SSCC label detected.</strong>
          <p>
            Product code and service code are not evaluated for SSCC labels because SSCC barcodes encode AI 00 SSCC
            data, not the eParcel article product/service fields. The audit still reports barcode readability,
            sender/receiver blocks, weight, DG declaration and other visible label requirements where extractable.
          </p>
        </div>
      )}
      {audit.articles?.length > 0 ? (
        audit.articles.map(a => (
          <div className="article-summary" key={a.articleId || a.sscc}>
            {a.type === 'sscc' ? (
              <div className="fact-cards fact-cards-wide">
                <div>
                  <span>barcode_type</span>
                  <strong>SSCC / AI 00</strong>
                </div>
                <div>
                  <span>article_id</span>
                  <strong>
                    <code>{a.sscc}</code>
                  </strong>
                </div>
                <div>
                  <span>product_code</span>
                  <strong>Not encoded in SSCC</strong>
                </div>
                <div>
                  <span>service_code</span>
                  <strong>Not encoded in SSCC</strong>
                </div>
              </div>
            ) : (
              <div className="fact-cards fact-cards-wide">
                <div>
                  <span>article_id</span>
                  <strong>
                    <code>{a.articleId}</code>
                  </strong>
                </div>
                <div>
                  <span>mlid</span>
                  <strong>{a.mlid}</strong>
                </div>
                <div>
                  <span>consignment_id</span>
                  <strong>{a.consignmentId}</strong>
                </div>
                <div>
                  <span>article_count</span>
                  <strong>{a.articleCount}</strong>
                </div>
                <div>
                  <span>product_code</span>
                  <strong>
                    {a.productCode} — {a.productDescription}
                  </strong>
                </div>
                <div>
                  <span>service_code</span>
                  <strong>
                    {a.serviceCode} — {a.serviceDescription}
                  </strong>
                </div>
                <div>
                  <span>postage_paid_indicator</span>
                  <strong>{a.postagePaidIndicator}</strong>
                </div>
                <div>
                  <span>check_digit</span>
                  <strong>{a.checkDigit}</strong>
                </div>
              </div>
            )}
          </div>
        ))
      ) : (
        <p className="muted">No article details parsed from a decoded barcode.</p>
      )}
      {ssccOnly ? (
        <StandardLine>
          SSCC label = AI 00 + 18 digit serial shipping container code. eParcel product and service-code matrix checks
          are intentionally skipped.
        </StandardLine>
      ) : (
        <StandardLine>
          Standard article ID = MLID + 7 digit consignment suffix + article count + product code + service code +
          postage paid indicator + check digit.
        </StandardLine>
      )}
      <ValidationTable items={items} />
      {/* The service/product matrix stays permanently expanded: it is the key visual reference. */}
      {!ssccOnly && <ServiceCodeMatrix audit={audit} />}
    </section>
  );
}
