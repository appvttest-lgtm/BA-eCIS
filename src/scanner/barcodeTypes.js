// Scan kind names are shared by crop planning, decoder routing, and report grouping.
export const FORMAT_KIND = {
  linear: 'linear',
  datamatrix: 'datamatrix',
  qr: 'qr',
  mixed: 'mixed'
};

export function isDataMatrixBarcode(barcode) {
  const fmt = String(barcode?.format || barcode?.symbology || '').toLowerCase();
  const raw = String(barcode?.rawValue || '');
  return fmt.includes('data')
    || raw.includes('(420)')
    || raw.includes('(8008)')
    || raw.includes('8008')
    || raw.includes('|420');
}

export function isQrBarcode(barcode) {
  const fmt = String(barcode?.format || barcode?.symbology || '').toLowerCase();
  return fmt.includes('qr') || barcode?.kind === FORMAT_KIND.qr;
}

export function isLinearBarcode(barcode) {
  const fmt = String(barcode?.format || barcode?.symbology || '').toLowerCase();
  if (isQrBarcode(barcode) || isDataMatrixBarcode(barcode)) return false;
  return fmt.includes('128')
    || fmt.includes('code_128')
    || fmt.includes('code 128')
    || barcode?.kind === FORMAT_KIND.linear;
}
