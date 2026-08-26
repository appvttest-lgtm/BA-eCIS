// eParcel-specific report sections: service/product matrix, linear and
// DataMatrix barcode analysis.
import React from 'react';
import { FORMAT_KIND } from '../../scanner/barcodeTypes.js';
import {
  DecodedBarcodes,
  SectionStatus,
  SectionTitle,
  StandardLine,
  ValidationTable,
  imageBoxCaption,
  sectionHasIssues
} from '../../report/common.jsx';
import {
  auditHasSsccOnly,
  decodedBarcodeList,
  selectedProductCodes,
  selectedServiceCodes
} from '../../report/auditInfo.js';
import { PRODUCT_CODE_MAP, SERVICE_CODE_MAP, SERVICE_TO_PRODUCT_MAP } from './referenceData.js';

// The service matrix is derived from the audit reference data, so a service code can never be valid
// for the audit yet missing from this table. Only presentation-only detail lives here: the printed
// row order, the ticked columns, and the wine services' product-name override.
const SERVICE_FLAG_NAMES = ['safeDrop', 'signature', 'atl', 'partial', 'noSignature'];
const SERVICE_PAYLOAD_KEYS = ['authority_to_leave', 'allow_partial_delivery', 'safe_drop_enabled'];
const WINE_PRODUCT_NAMES = { '00093': 'Parcel Post Signature (Wine)' };

// [service code, ticked columns, display overrides], in the order the matrix is printed.
// Services 09 and 82 deliberately tick fewer columns than their payload flags imply — the printed
// matrix, not the Get Shipments payload, decides the ticks.
const SERVICE_ROW_TICKS = [
  ['03', ['signature']],
  ['08', ['atl']],
  ['45', ['signature', 'partial']],
  ['15', ['atl', 'partial']],
  ['50', ['safeDrop']],
  ['51', ['safeDrop', 'partial']],
  ['09', ['partial', 'noSignature']],
  ['49', ['signature'], { display: '49*', productNames: WINE_PRODUCT_NAMES }],
  ['81', ['signature'], { productNames: WINE_PRODUCT_NAMES }],
  ['82', ['atl'], { productNames: WINE_PRODUCT_NAMES }],
  ['83', ['safeDrop'], { productNames: WINE_PRODUCT_NAMES }]
];

/** Ticks implied by the payload flags, used only for a service code with no printed row yet. */
function inferredServiceTicks(service) {
  const ticks = [];
  if (service.safe_drop_enabled) ticks.push('safeDrop');
  if (!service.authority_to_leave && !service.safe_drop_enabled) ticks.push('signature');
  if (service.authority_to_leave) ticks.push('atl');
  if (service.allow_partial_delivery) ticks.push('partial');
  return ticks;
}

/** Builds one matrix row: ticks from the list above, everything else from the reference data. */
function buildServiceReferenceRow(code, ticks, { display, productNames } = {}) {
  const service = SERVICE_CODE_MAP[code] || {};
  return {
    serviceCode: display || code,
    matchCode: code,
    flags: Object.fromEntries(SERVICE_FLAG_NAMES.map(name => [name, ticks.includes(name)])),
    apiPayload: Object.fromEntries(SERVICE_PAYLOAD_KEYS.map(key => [key, service[key] === true])),
    apiNote: service.requires_identity_on_delivery
      ? `IDENTITY_ON_DELIVERY feature must be used with an id_capture_type value of “${service.id_capture_type}”.`
      : null,
    products: (SERVICE_TO_PRODUCT_MAP[code] || []).map(productCode => [
      productCode,
      productNames?.[productCode] || PRODUCT_CODE_MAP[productCode] || 'Unknown product code'
    ])
  };
}

const SERVICE_REFERENCE_ROWS = [
  ...SERVICE_ROW_TICKS.map(([code, ticks, overrides]) => buildServiceReferenceRow(code, ticks, overrides)),
  // A service code added to the audit rules without a printed row still gets a row here, so a decoded
  // service/product pair always has something to highlight. Give it explicit ticks above.
  ...Object.keys(SERVICE_TO_PRODUCT_MAP)
    .filter(code => !SERVICE_ROW_TICKS.some(([listed]) => listed === code))
    .map(code => buildServiceReferenceRow(code, inferredServiceTicks(SERVICE_CODE_MAP[code] || {})))
];

function xMark(value) {
  return value ? 'X' : '';
}

function servicePayloadText(row) {
  const payload = `"authority_to_leave": ${row.apiPayload.authority_to_leave},\n"allow_partial_delivery": ${row.apiPayload.allow_partial_delivery},\n"safe_drop_enabled": ${row.apiPayload.safe_drop_enabled}`;
  return row.apiNote ? `${payload}\n\n${row.apiNote}` : payload;
}
export function ServiceCodeMatrix({ audit }) {
  const selectedServices = selectedServiceCodes(audit);
  const selectedProducts = selectedProductCodes(audit);
  return (
    <section className="card compact-card service-matrix-card">
      <SectionTitle id="service-code-reference">Service code reference</SectionTitle>
      <p className="muted small">
        Australia Post service-code/product-code matrix. The service and product decoded from the label are highlighted.
      </p>
      <div className="table-wrap service-matrix-wrap">
        <table className="service-matrix-table">
          <thead>
            <tr>
              <th>Service Code</th>
              <th>Safe Drop</th>
              <th>Signature on Delivery required</th>
              <th>Authority To Leave (ATL)</th>
              <th>Partial delivery allowed</th>
              <th>No signature allowed</th>
              <th>API payload / manifest flags</th>
              <th>Product Code</th>
              <th>Product Name</th>
            </tr>
          </thead>
          <tbody>
            {SERVICE_REFERENCE_ROWS.map(row => {
              const matchedService = selectedServices.includes(row.matchCode);
              return row.products.map(([productCode, productName], productIndex) => {
                // Only the label's actual service+product combination is marked "selected":
                // the same product code appears under many service rows, so a product-only
                // match must not light up rows whose service code is not on the label.
                const matchedProduct = matchedService && selectedProducts.includes(productCode);
                return (
                  <tr
                    key={`${row.serviceCode}-${productCode}`}
                    className={`${matchedService ? 'selected-row service-selected-row' : ''} ${matchedService && matchedProduct ? 'selected-combination-row' : ''}`}
                  >
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="service-code-cell">
                        <strong>{row.serviceCode}</strong>
                        {matchedService && <span className="selected-pill">selected</span>}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.safeDrop)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.signature)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.atl)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.partial)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.noSignature)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="payload-cell">
                        <pre>{servicePayloadText(row)}</pre>
                      </td>
                    )}
                    <td className={matchedProduct ? 'product-selected-cell' : ''}>
                      <strong>{productCode}</strong>
                      {matchedProduct && <span className="selected-pill">selected</span>}
                    </td>
                    <td className={matchedProduct ? 'product-selected-cell' : ''}>{productName}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <StandardLine>
        Service code and product code must be a valid supported combination from the Australia Post eParcel service
        matrix. Example: service 09 supports product 00091 Parcel Post (Non-Signature) and 00087 Express Post
        (Non-Signature).
      </StandardLine>
    </section>
  );
}
export function DataMatrixSection({ audit, items }) {
  const images = audit?.labelImages || {};
  const dataMatrixBarcodes = decodedBarcodeList(audit, 'datamatrix');
  return (
    <section className="card audit-section" id="datamatrix-section">
      <div className="section-heading">
        <SectionTitle id="datamatrix-section-title">GS1 DataMatrix Barcode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="two-col">
        <div>
          {images.dataMatrixFocusedCrop || images.dataMatrixCrop ? (
            <figure className="category-crop">
              <img src={images.dataMatrixFocusedCrop || images.dataMatrixCrop} alt="GS1 DataMatrix crop" />
              <figcaption>{imageBoxCaption(images, FORMAT_KIND.datamatrix)}</figcaption>
            </figure>
          ) : (
            <p className="muted">No GS1 DataMatrix crop captured.</p>
          )}
        </div>
        <div>
          {sectionHasIssues(items) &&
            (auditHasSsccOnly(audit) ? (
              <StandardLine>
                SSCC labels use AI 00. eParcel AI 91/product/service evaluation is not applicable to an SSCC barcode.
              </StandardLine>
            ) : (
              <StandardLine>
                GS1 DataMatrix should include AI 01, AI 91, AI 420 postcode and AI 8008 date/time. AI 92 DPID is
                optional.
              </StandardLine>
            ))}

          <div className="decoded-panel">
            <h3>Raw decoded GS1 DataMatrix string (colour-coded by AI)</h3>
            <DecodedBarcodes
              barcodes={dataMatrixBarcodes}
              kind="datamatrix"
              label="DataMatrix"
              emptyText="No GS1 DataMatrix value decoded from the uploaded file."
            />
          </div>

          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

export function LinearBarcodeSection({ audit, items }) {
  const images = audit?.labelImages || {};
  const linearBarcodes = (audit?.detectedBarcodes || []).filter(
    b =>
      String(b.format || '')
        .toLowerCase()
        .includes('128') || b.kind === 'linear'
  );
  return (
    <section className="card audit-section" id="linear-section">
      <div className="section-heading">
        <SectionTitle id="linear-section-title">GS1-128 Linear Barcode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="two-col">
        <div>
          {images.linearBarcodeCrop || images.rightLinearBarcodeCrop ? (
            <figure className="category-crop wide">
              <img src={images.linearBarcodeCrop || images.rightLinearBarcodeCrop} alt="Linear barcode crop" />
              <figcaption>{imageBoxCaption(images, FORMAT_KIND.linear)}</figcaption>
            </figure>
          ) : (
            <p className="muted">No linear barcode crop captured.</p>
          )}
        </div>
        <div>
          <h3>Decoded linear barcode values (colour-coded by field)</h3>
          <DecodedBarcodes
            barcodes={linearBarcodes}
            kind={audit?.selectedAuditMode?.labelFormat === 'sscc' ? 'eparcel-linear-sscc' : 'eparcel-linear'}
            label="Linear barcode"
            emptyText="No Code128/GS1-128 value decoded."
          />
          {sectionHasIssues(items) &&
            (auditHasSsccOnly(audit) ? (
              <StandardLine>
                SSCC linear barcodes use AI 00 and should decode to a valid SSCC value. eParcel
                product/service/check-digit fields are not encoded in the SSCC value.
              </StandardLine>
            ) : (
              <StandardLine>
                Linear GS1-128 should encode AI 01 + AusPost GTIN, AI 91 + article component, with a valid eParcel check
                digit.
              </StandardLine>
            ))}
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}
