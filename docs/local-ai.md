# Local invoice pipeline

Private invoices are read on this machine: text extraction, OCR and the local model all run in
the intelligence service, and only the validated structure leaves it. This page covers running the
real pipeline instead of the deterministic sample values used in demo mode.

## Run

From `services/intelligence-service`, create/activate a Python 3.12+ virtual environment and run:

```sh
pip install -e '.[documents,dev]'
# macOS, for scanned PDF / PNG / JPEG input:
brew install tesseract
# Install/start Ollama locally, then:
ollama pull llama3.2
export OLLAMA_MODEL=llama3.2
.venv/bin/python -m uvicorn app.main:app --port 8000
```

Start the ledger service and the current.surf app using the root README (`npm run dev:ledger`,
`npm run dev`). Sign in, complete verification, then upload
`samples/invoices/suspicious_vendor_invoice.pdf` through `POST /api/copilot/documents`
(`api.copilot.uploadDocument` in the client).

Leave `OLLAMA_MODEL` unset to use deterministic sample values, clearly labeled in the returned
warnings. If a configured Ollama cannot connect or times out, sample fallback is allowed only in
`DEMO_MODE=true`. Malformed model output is rejected, never repaired or silently replaced.
For real extraction, use `DEMO_MODE=false` on the Python service and set `OLLAMA_MODEL`.
The model must be installed locally; do not use a cloud-backed Ollama model.

`OLLAMA_BASE_URL` permits only loopback or `host.docker.internal` (Docker Desktop → host).
HTTP proxies and redirects are disabled. Containers install the document Python extra and
Tesseract. Set the container Ollama URL to `http://host.docker.internal:11434`.

## Behavior

- Embedded text is preferred. Scans render locally with a 50-page OCR limit, bounded image
  dimensions and a 30-second per-page OCR timeout.
- Temporary raw uploads and rendered images are removed on success and failure. Neither
  exception logs nor responses contain raw text.
- The strict extraction schema rejects unknown fields, invalid money, and raw payment
  identifiers. Vendor labels are short generic names without digits/contact details; machine
  keys/categories use snake_case. This is a constrained invoice MVP, not a general PII classifier.
- Labeled account/routing/IBAN lines are fingerprinted locally with SHA-256. Unsupported
  payment layouts produce null. A model-generated fingerprint is never trusted.
- Java validates the structured request, inserts the invoice and an EXPECTED / OUT / DOCUMENT
  cash event in one transaction, and links the event to the invoice ID. Missing due dates use
  today in UTC for the event; the invoice due date remains null. Recurrence is metadata only.
- Upload progress comes from server events, not timers: Express streams `extracting`,
  `validating`, `scoring` and `saved` as NDJSON. `saved` appears only after persistence, with the
  risk result and refreshed forecast inline.
- Reuploading is a new invoice. After an interrupted connection, check invoices before retrying.
  Invoice deduplication remains future work.

## Contracts

`POST /v1/invoices` accepts the camelCase `ExtractedInvoice` fields and returns `InvoiceDto`.
It requires the internal token, authenticated subject, and approved Persona state.

`POST /api/copilot/documents` returns `{ documentType, extraction, warnings, persisted: true,
invoice, risk, forecast }`. `risk` or `forecast` can be null if that step failed after a successful
save; a warning explains that the invoice was saved. For `Accept: application/x-ndjson`, the same
endpoint emits `{stage: "extracting"}`, `{stage: "validating"}`, `{stage: "scoring"}`, then
`{stage: "saved", result: ...}` or `{stage: "error", error: ...}`. Failures before streaming use
normal HTTP error responses.

## Checks

```sh
npm run test:intelligence
npm run test:ledger
npm run typecheck
```

Python tests cover embedded PDFs, rendered OCR cleanup on success/failure, model request shape,
invalid output, local URL restrictions, fingerprints and demo fallback. Java integration tests
use a fresh embedded PostgreSQL to verify persistence, increased forecast outflows, isolation,
request validation, access checks, and rollback when the cash event insert fails.
