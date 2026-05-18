# Australia Post - eCommerce Integration Label Auditor

A local-only web application for auditing Australia Post eCommerce label outputs across **eParcel** and **StarTrack** label formats.

The application is designed for integration, QA, and implementation teams who need to verify that generated shipping labels contain the expected barcode data, visible label content, service/product indicators, article identifiers, consignment references, address information, weight/cube values, and optional Get Shipments API payload alignment.

This is a **local workstation tool**, not a hosted SaaS application.

---


## Supported label families

The app supports two separate audit paths:

1. **eParcel / Parcel Post / Express Post**
2. **StarTrack**

The UI provides separate upload zones for each carrier/product family. The selected upload zone determines which audit rule set is applied. This avoids ambiguous auto-classification and prevents eParcel rules from being incorrectly applied to StarTrack labels, or vice versa.

---

## Core use case

The auditor is used to compare generated digital label output against expected Australia Post / StarTrack label requirements.

Typical workflow:

1. User opens the local app.
2. User uploads one or more digital labels.
3. User selects the correct upload area:
   - eParcel upload area
   - StarTrack upload area
4. Optional: user pastes a Get Shipments API payload.
5. The app renders each PDF page or image locally.
6. The app scans the label barcodes.
7. The app extracts visible label text where available.
8. The app applies the correct audit rule set.
9. The user reviews on-screen results.
10. The user exports a single-label or consolidated HTML report.

---

## Key capabilities

- Local browser-based auditing
- Separate eParcel and StarTrack upload areas
- Drag-and-drop file upload
- PDF and image support
- Multi-file upload support
- Multi-page PDF support
- One audit result per uploaded label/page
- Full label preview
- Barcode crop evidence
- Barcode-specific audit sections
- Optional Get Shipments API payload comparison
- Downloadable single-label HTML reports
- Downloadable consolidated HTML reports
- Local feedback button that opens the user’s default email client

---

## eParcel audit coverage

The eParcel audit path focuses on Australia Post eParcel Parcel Post / Express Post digital labels.

The current eParcel checks include:

- GS1 DataMatrix barcode detection and decoding
- GS1-128 / Code 128 linear barcode detection and decoding
- Article ID parsing
- Article check digit validation where applicable
- Product code extraction
- Service code extraction
- Product/service-code matrix validation
- SSCC detection and SSCC-specific handling
- Delivery postcode comparison where encoded
- DPID comparison where encoded
- Barcode date/time data where encoded
- Receiver / delivery address context
- Sender / lodgement address context
- Weight context
- Dangerous Goods declaration context
- Visible AP Article ID / consignment text context
- Optional Get Shipments API payload comparison

### eParcel SSCC behaviour

If the uploaded label is identified as an SSCC label, eParcel product and service-code evaluation is skipped where that information is not encoded in the barcode.

SSCC labels are still checked for:

- barcode readability
- SSCC structure
- visible label content where available
- sender/receiver context
- weight context
- Dangerous Goods context
- report evidence

---

## StarTrack audit coverage

The StarTrack audit path is based on the StarTrack MOS label structure.

StarTrack labels typically contain three major barcode areas:

1. **StarTrack 2D QR Barcode**
2. **StarTrack Routing Barcode**
3. **StarTrack Freight Item Barcode**

These are audited and reported separately.

### StarTrack 2D QR Barcode

The StarTrack QR barcode is treated as a separate audit section.

It may contain fixed-width shipment data such as:

- receiver suburb
- receiver postcode
- consignment number
- freight item / article number
- product code
- payer account
- sender account
- consignment quantity
- consignment weight
- consignment cube
- despatch date
- receiver name
- receiver address
- receiver phone
- unit type
- destination depot
- Dangerous Goods indicator
- movement type indicator
- ATL number
- RA / return authorisation number

Where decoded successfully, the QR payload is used as structured evidence for the StarTrack audit.

### StarTrack Routing Barcode

The StarTrack routing barcode is audited separately from the freight item barcode.

The routing barcode is expected to represent routing/service information such as:

```text
SSS9999DDD
```

Where:

```text
SSS  = StarTrack label code / product label code
9999 = receiver postcode
DDD  = destination depot or routing code
```

For SSCC-based StarTrack labels, GS1 421 / 403 routing barcode support is also considered where applicable.

### StarTrack Freight Item Barcode

The StarTrack freight item barcode is audited as the primary article/freight identifier.

For standard StarTrack Code 128 labels, the expected format is:

```text
XXXZ99999999AAA99999
```

Where:

```text
XXXZ      = Despatch ID
99999999  = consignment sequence
AAA       = StarTrack product code
99999     = item/carton sequence
```

The app extracts and reports:

- freight item ID
- connote / consignment ID
- product code
- item sequence
- SSCC where applicable

### StarTrack SSCC behaviour

StarTrack SSCC labels are supported.

For SSCC labels, the app validates SSCC barcode evidence separately and does not incorrectly require the standard StarTrack Code 128 freight item format when SSCC is the intended identifier.

---

## Get Shipments API payload comparison

The app includes an optional text area where users can paste a short Get Shipments API response or relevant JSON/plain-text excerpt.

When a payload is supplied, comparable audit tables include a **Get Shipments match** column.

Possible values:

```text
Match
Does not match
N/A
```

The comparison is identity-gated.

The pasted payload must first match the uploaded label using one or more identity fields, such as:

```text
article_id
freight_item_id
sscc
consignment_id
connote_id
```

If the payload does not match the uploaded label identity, secondary checks are suppressed as **N/A**. This prevents false matches when, for example, an eParcel payload is pasted while auditing an unrelated StarTrack label.

Comparable data points may include:

```text
article_id
freight_item_id
sscc
consignment_id
connote_id
product_code
service_code
delivery_postcode
receiver_address
lodgement_address
weight
cubic_volume
authority_to_leave
safe_drop
partial_delivery
signature_required
dangerous_goods
```

Non-comparable visual or layout rules are shown as **N/A** when no direct API data point exists.

---

## Solution architecture

The application uses a lightweight local web architecture.

```text
Windows launcher
      ↓
Local Node.js HTTP server
      ↓
Static React web app
      ↓
Browser-based PDF/image rendering
      ↓
Barcode scanning and audit engine
      ↓
On-screen audit results
      ↓
HTML report export
```

---

## Front-end architecture

The front end is a React-based single-page application.

Primary responsibilities:

- render the user interface
- manage eParcel and StarTrack upload flows
- handle drag-and-drop file selection
- render PDFs/images into browser canvas
- run barcode scan workflows
- display barcode crops and full-label previews
- run audit logic
- display validation tables
- handle optional Get Shipments payload comparison
- generate single-label and consolidated HTML reports

Most application logic runs client-side in the browser after the user uploads a file.

---

## Back-end architecture

The back end is intentionally minimal.

The app uses a small local Node.js HTTP server implemented in:

```text
server.mjs
```

The server is responsible for:

- serving the production web app from `dist/`
- exposing a local health-check endpoint
- running only on the local workstation
- binding to localhost by default

The local app is normally available at:

```text
http://127.0.0.1:3000
```

The server does **not**:

- upload labels to a remote system
- store label files in a database
- call external APIs
- require user authentication
- run as a Windows service
- require Docker
- require WSL
- modify the Windows registry

---

## Why a local HTTP server is used

The app is served through a local HTTP server instead of opening `index.html` directly from disk.

This avoids browser limitations around:

- JavaScript module loading
- PDF rendering workers
- WebAssembly scanner assets
- local file security restrictions
- asset path resolution

The server only serves local static files. It is not a traditional business API server.

---

## Local-only security model

The app is designed for controlled internal use.

Key security characteristics:

- local processing only
- no cloud upload by design
- no server-side label storage
- no database
- no admin rights required
- no Windows service install
- no registry changes
- no Docker or WSL required
- no normal-user `npm install` required when using a packaged release

Uploaded labels and generated reports may contain sensitive data such as:

- customer names
- receiver addresses
- sender/lodgement addresses
- article IDs
- SSCC values
- barcode strings
- account references
- dangerous-goods context

Generated reports should be treated as internal/customer data.

---

## Project structure

Typical repository structure:

```text
.
├── dist/
│   └── built production web app
├── src/
│   ├── main.jsx
│   ├── auditEngine.js
│   └── styles.css
├── server.mjs
├── start-auditer.bat
├── run-server.bat
├── package.json
├── package-lock.json
├── README.md
├── SECURITY.md
└── docs/
```

---

## Key source files

### `src/main.jsx`

Main application UI and workflow orchestration.

Handles:

- upload UI
- drag-and-drop behaviour
- eParcel / StarTrack upload routing
- file rendering flow
- barcode scan orchestration
- progress states
- result tabs
- report export

### `src/auditEngine.js`

Core audit and validation logic.

Handles:

- barcode parsing
- GS1 parsing
- SSCC detection
- eParcel rule evaluation
- StarTrack rule evaluation
- product/service mapping
- QR payload parsing
- payload comparison
- identity-gated API matching
- audit status calculation

### `src/styles.css`

Application and report styling.

Handles:

- layout
- carrier themes
- upload boxes
- tables
- status badges
- barcode crop display
- report formatting
- responsive layout

### `server.mjs`

Local static server.

Handles:

- serving files from `dist/`
- responding to `/healthz`
- safe static path resolution
- localhost runtime

### `start-auditer.bat`

End-user launcher.

Handles:

- starting the local server
- waiting for readiness
- opening the browser
- avoiding manual terminal commands for normal users

---

## Running the app

For normal users:

```bat
start-auditer.bat
```

The app opens locally at:

```text
http://127.0.0.1:3000
```

---

## Known limitations

This tool assists with digital label validation. It does not replace:

- formal Australia Post or StarTrack certification
- physical barcode verifier grading
- thermal printer calibration
- quiet-zone measurement with calibrated equipment
- physical print-quality testing
- label stock, gloss, adhesive, or parcel-placement checks

Physical and production-readiness checks should still be completed through the appropriate carrier approval and operational testing process.

---

## Feedback

The application includes a Feedback button that opens the user’s default email client addressed to:

```text
christian.rajaratnam@auspost.com.au
```

Do not include customer data, credentials, access tokens, or live production labels in feedback unless approved through the correct internal process.
