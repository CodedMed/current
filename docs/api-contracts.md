# API contracts

Three surfaces: the browser talks only to Express, Express talks to the two backend services, and
the backend services never talk to the browser.

```
Browser ──► Express /api/copilot/*  ──►  ledger-service        (Java, authoritative financial state)
                                    └─►  intelligence-service  (Python, AI/ML + private documents)
```

Every internal call carries:

| Header | Meaning |
| --- | --- |
| `X-Internal-Service-Token` | Shared secret proving the caller is the BFF. Both services reject requests without it. |
| `X-Auth-Subject` | Stable authenticated subject (`google:<subject>`). The ledger service maps it to an application UUID. |

Error envelope, identical across all three:

```json
{ "error": { "code": "PERSONA_NOT_VERIFIED", "message": "Identity verification is required." } }
```

Service errors pass through Express with their status and code unchanged; the Python service adds
`retryable` (Express carries it in `details`). When a service cannot be reached Express answers
`503` with `LEDGER_UNAVAILABLE` or `INTELLIGENCE_UNAVAILABLE`. Codes: `UNAUTHENTICATED`,
`PERSONA_NOT_VERIFIED`, `NESSIE_SYNC_FAILED`, `DOCUMENT_UNSUPPORTED`, `DOCUMENT_EXTRACTION_FAILED`,
`INVALID_FINANCIAL_DATA`, `RISK_MODEL_UNAVAILABLE`, `ADVISOR_UNAVAILABLE`, `VOICE_UNAVAILABLE`,
`NOT_FOUND`, `NOT_IMPLEMENTED`.

---

## BFF routes (Express, `/api/copilot`)

Every route needs a signed-in session. Everything except `health` and `me` also needs a verified
identity (Express's `requireVerified`), and mirrors that decision to the ledger before forwarding.
Shapes are defined once in `shared/copilot.ts` and exposed to the client through `api.copilot` in
`client/src/lib/api.ts`.

| Method | Path | Calls |
| --- | --- | --- |
| GET | `/api/copilot/health` | `GET /health` on both services; reports the active adapters and each process's `service` name. `ok` is false when the process on the URL is not the expected service (another app on the port). |
| GET | `/api/copilot/me` | ledger `POST /v1/persona/status` (mirror) then the ledger's view of the user |
| GET | `/api/copilot/dashboard?horizonDays=` | ledger `GET /v1/dashboard` |
| GET | `/api/copilot/forecast?horizonDays=` | ledger `GET /v1/forecast` |
| POST | `/api/copilot/nessie/sync` | With a workspace: re-reads its Nessie snapshot and pushes it (ledger `POST /v1/bank/snapshot`). Without one: ledger `POST /v1/nessie/sync` (the demo customer from the fixture). |
| GET | `/api/copilot/accounts/summary` | ledger `GET /v1/accounts/summary` |
| GET | `/api/copilot/cash-events?from=&to=` | ledger `GET /v1/cash-events` |
| POST | `/api/copilot/cash-events/manual` | ledger `POST /v1/cash-events/manual` |
| GET | `/api/copilot/invoices` · `/invoices/:id` | ledger `GET /v1/invoices` (payment fingerprint stripped) |
| POST | `/api/copilot/invoices/:id/risk` | ledger history → intelligence `POST /v1/risk/invoice` → ledger `POST /v1/invoices/{id}/risk-result` |
| POST | `/api/copilot/documents` | intelligence `POST /v1/documents/extract` → ledger `POST /v1/invoices` → risk scoring → ledger `GET /v1/forecast` |
| POST | `/api/copilot/advisor` | `{ message, language?, history? }` → ledger `GET /v1/advisor/context` → intelligence `POST /v1/advisor/chat`. Any `context` in the body is ignored. Never writes a task. |
| POST | `/api/copilot/voice/session` | intelligence `POST /v1/voice/session` (signed URL + client tool name, or `available: false`) |
| POST | `/api/copilot/voice/message` | Same body as `/advisor`, called by the browser's ElevenLabs client tool: ledger `GET /v1/advisor/context` → intelligence `POST /v1/voice/message` |
| GET · POST | `/api/copilot/todos` | ledger `/v1/todos` |
| PATCH · DELETE | `/api/copilot/todos/:id` | ledger `/v1/todos/{id}` |

Before any of these routes reaches the ledger, Express mirrors the Persona decision, pushes the
user's workspace bank snapshot once per process (re-pushed whenever the dashboard reads a changed
snapshot from Nessie), and in demo mode seeds what is still missing: the whole fixture business
for a user without a workspace, only the vendor invoice history for one with. If the ledger no
longer knows the user (it restarted without a database), all three steps are redone
automatically.

The advisor context is always fetched server-side. A browser cannot choose the facts the model
reasons over. `history` is at most 12 prior turns of `{ role: "user" | "advisor", content }`, used for
continuity only; the figures are re-fetched from the ledger on every turn.

### `POST /api/copilot/documents`

Multipart with a `file` field: PDF, PNG or JPEG up to 10 MB. Returns
`{ documentType, extraction, warnings, persisted: true, invoice, risk, forecast }`. `risk` and
`forecast` are `null` when that step failed after the invoice was saved; a warning says so, and the
invoice is not re-uploaded.

With `Accept: application/x-ndjson` the same endpoint streams one JSON object per line:
`{"stage":"extracting"}`, `{"stage":"validating"}`, `{"stage":"scoring"}`, then
`{"stage":"saved","result":{…}}` or `{"stage":"error","error":{…}}`. Failures before the stream
starts (an unsupported type, say) use normal HTTP error responses.

---

## Interface translation (Express, `/api/i18n`)

| Method | Path | Calls |
| --- | --- | --- |
| POST | `/api/i18n/translate` | intelligence `POST /v1/i18n/translate` |

**Deliberately open to signed-out visitors.** Sign-up and identity verification are the pages a
person who does not read English most needs translated, and they are reached before a session
exists. The cost is bounded three ways: at most 200 strings of at most 600 characters each, 60
requests per IP per minute, and `language: "en"` is answered in Express without a round trip at
all. A language outside `ADVISOR_LANGUAGES` is a 400.

## Ledger service (Java, `http://localhost:8080`)

Every `/v1/**` endpoint requires the internal token. Every endpoint except `/v1/me` and the
Persona routes additionally requires `persona_status = 'approved'`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Unauthenticated liveness check. |
| GET | `/v1/me` | Identity and verification state. Readable before approval. |
| POST | `/v1/persona/status` | Mirrors the BFF's Persona decision: `{ "status": "approved" \| "pending" \| "declined" \| "failed" \| "unverified", "inquiryId"? }`. Readable before approval; this is the call that opens or closes the ledger. |
| POST | `/v1/persona/dev/verify` | Demo only. Marks the caller approved. Refused when `DEMO_MODE=false`. |
| POST | `/v1/persona/inquiry` | `NOT_IMPLEMENTED`: inquiries are created by the BFF. |
| POST | `/webhooks/persona` | Public, inert (`501`). Persona webhooks are handled by Express at `/api/identity/webhook`. |
| POST | `/v1/demo/seed` | Demo only, idempotent per part. Optional body `{ "includeBankData": false }` seeds only the vendor invoice history (for a user whose bank data is their own workspace); the default seeds the fixture bank feed, receivables, obligations, invoices and tasks. Returns `{ seeded, bankEvents, ledgerEvents, invoices, todos }`. |
| POST | `/v1/bank/snapshot` | The BFF pushes the Nessie records it holds for the user's workspace (see below). The ledger normalises them, upserts by record id, stores the balances and records the sync. Returns `{ insertedEvents, updatedEvents, syncedAt }`. |
| POST | `/v1/nessie/sync` | Pull-path ingest through the ledger's own Nessie client. Optional body `{ "customerId": "…" }`; the id is remembered for later syncs. The demo customer is always read from the fixture, whatever key is configured. Returns `{ insertedEvents, updatedEvents, syncedAt }`. |
| GET | `/v1/accounts/summary` | Balances from the last ingested snapshot (`bank_accounts`); zero until something was ingested. Cards are negative (amount owed). |
| GET | `/v1/cash-events?from=&to=` | Defaults to −30/+60 days. |
| POST | `/v1/cash-events/manual` | Manual entry. |
| GET | `/v1/invoices` · `/v1/invoices/{id}` | Invoices with their latest risk result. Includes `paymentDestinationFingerprint` (a hash) for the risk engine. |
| POST | `/v1/invoices` | Persists a sanitized extraction and creates the expected CashEvent server-side, in one transaction. |
| POST | `/v1/invoices/{id}/risk-result` | Stores the risk engine's output (`riskScore`, `severity`, `rulesScore`, `mlScore`, `reasons`, `modelVersion`); the latest row wins. `404` for another user's invoice. |
| GET | `/v1/forecast?horizonDays=60` | Deterministic projection and first gap. |
| GET | `/v1/dashboard?horizonDays=60` | The dashboard read model, including the chart series and high-risk invoices. |
| GET | `/v1/advisor/context?horizonDays=60` | Allowlisted facts for the reasoning layer. |
| GET · POST | `/v1/todos` | |
| PATCH · DELETE | `/v1/todos/{id}` | Enforces the status transitions (`PROPOSED → APPROVED/DECLINED → IN_PROGRESS → COMPLETED`). |

### `POST /v1/bank/snapshot`

The workspace as the BFF fetched it from Nessie, with merchant names resolved. Calendar dates;
card balances positive (the amount owed), which the ledger signs so `totalBalance` matches the
current.surf dashboard's total cash.

```json
{
  "customerId": "68c4…",
  "accounts": [ { "id": "acc-op", "type": "Checking", "nickname": "Operating", "balance": 9000.00 } ],
  "deposits": [ { "id": "dep-1", "accountId": "acc-op", "date": "2026-09-09", "status": "completed", "amount": 6000.00, "description": "Client payment · Acme" } ],
  "withdrawals": [ { "id": "wd-1", "accountId": "acc-op", "date": "2026-09-07", "status": "completed", "amount": 5400.00, "description": "Payroll · Gusto" } ],
  "purchases": [ { "id": "pur-1", "accountId": "acc-card", "date": "2026-09-10", "status": "completed", "amount": 320.00, "description": "Weekly produce", "merchantName": "Sysco", "merchantCategory": "Food & Beverage" } ],
  "bills": [ { "id": "bill-1", "accountId": "acc-op", "payee": "Harbor Property Group", "nickname": "Office rent", "paymentDate": "2026-10-01", "status": "recurring", "amount": 2200.00, "recurring": true } ]
}
```

Normalisation: settled deposits, withdrawals and purchases become `ACTUAL`; a `pending` deposit
is an open receivable (`EXPECTED`, `OVERDUE` once its date passes, counterparty read from
"Invoice REF · Customer · net N"); a `pending` purchase is `EXPECTED`; `cancelled` records are
`CANCELLED`; a one-off bill whose date passed is `OVERDUE`, a recurring one rolls to its next
occurrence; deposits and withdrawals whose description starts with `Transfer · ` are internal
moves and are skipped. When the customer id differs from the one previously ingested, every event
that came from the old feed (or was seeded next to it) is dropped first; document-derived events
and manual entries are kept.

### `GET /v1/forecast`

```json
{
  "currentCash": 8000.00,
  "expectedInflow": 25000.00,
  "expectedOutflow": 16500.00,
  "timeline": [
    { "time": "2026-09-14T12:00:00Z", "delta": -2200.00, "projectedBalance": 5800.00, "cashEventId": "…", "label": "Office rent", "direction": "OUT", "status": "EXPECTED" }
  ],
  "firstGapDate": "2026-10-09T12:00:00Z",
  "firstGapAmount": 1200.00,
  "contributingEventIds": ["…"],
  "horizonDays": 60,
  "generatedAt": "2026-09-12T02:14:13Z"
}
```

`firstGapAmount` is how far below zero the balance is at the **first** crossing, not the deepest
later deficit, and a later inflow never clears the date.

### `GET /v1/dashboard`

```json
{
  "totals": { "availableCash": 8000, "expectedInflow30d": 6500, "expectedOutflow30d": 13500, "net30d": -7000 },
  "projectedGap": { "present": true, "date": "2026-10-09T12:00:00Z", "amount": 1200, "daysFromNow": 27 },
  "cashFlowSeries": [ { "date": "2026-09-12", "actualBalance": 8000, "projectedBalance": 12000, "inflow": 4000, "outflow": 0 } ],
  "upcomingObligations": [ { "cashEventId": "…", "dueDate": "…", "label": "Harbor Property Group", "category": "rent", "amount": 2200, "status": "EXPECTED" } ],
  "overdueReceivables": [ { "cashEventId": "…", "counterpartyLabel": "Client A", "amount": 4000, "dueDate": "…", "daysOverdue": 12 } ],
  "highRiskInvoices": [ { "invoiceId": "…", "vendorLabel": "Cloud Provider", "riskScore": 0.87, "severity": "HIGH", "reasons": ["…"] } ],
  "priorityTasks": [ { "id": "…", "title": "…", "status": "IN_PROGRESS", "priority": "HIGH", "dueDate": "2026-09-13", "source": "MANUAL" } ],
  "meta": { "horizonDays": 60, "generatedAt": "…", "lastSyncedAt": "…", "demoMode": true }
}
```

`cashFlowSeries` carries one point per day from −30 days to the horizon. `actualBalance` is the
settled past, reconstructed by replaying settled events up to today's bank balance;
`projectedBalance` is the forecast. Both are present on today so the two lines meet. Overdue items
are dated in the past but belong to the projection, so they are plotted on today.

### `GET /v1/advisor/context`

The only financial shape allowed to reach a model. Built from an explicit allowlist: no raw
database rows, no document text, no account identifiers, no payment fingerprints, no metadata.
Every value is a deterministic result of this service (`asOfDate` is the ledger's today, the
60-day sums use the same rule as the 30-day ones, `projectedLowPoint` is the deepest point of the
forecast walk).

```json
{
  "asOfDate": "2026-09-12",
  "horizonDays": 60,
  "currentCash": 8000.00,
  "expectedInflow30d": 6500.00,
  "expectedOutflow30d": 13500.00,
  "net30d": -7000.00,
  "expectedInflow60d": 25000.00,
  "expectedOutflow60d": 16500.00,
  "net60d": 8500.00,
  "firstGapDate": "2026-10-09T12:00:00Z",
  "firstGapAmount": 1200.00,
  "daysUntilGap": 27,
  "projectedLowPoint": { "date": "2026-10-09", "balance": -1200.00, "label": "Quarterly estimated tax payment" },
  "projectedEndBalance": 16500.00,
  "overdueReceivables": [ { "counterpartyLabel": "Client A", "amount": 4000.00, "daysOverdue": 12 } ],
  "expectedReceivables": [ { "counterpartyLabel": "Client D", "amount": 2500.00, "dueDate": "2026-10-01", "daysUntilDue": 19 } ],
  "upcomingObligations": [ { "label": "Harbor Property Group", "category": "rent", "amount": 2200.00, "dueDate": "2026-09-14", "daysUntilDue": 2, "status": "EXPECTED" } ],
  "invoiceRisks": [ { "invoiceId": "…", "vendorLabel": "Cloud Provider", "riskScore": 0.87, "severity": "HIGH", "reasons": ["…"] } ],
  "openTodos": [ { "id": "…", "title": "…", "status": "PROPOSED", "priority": "MEDIUM", "dueDate": "…" } ]
}
```

Named lists are capped at eight items. `daysUntilDue` is negative for an obligation already
overdue.

---

## Intelligence service (Python, `http://localhost:8000`)

Every `/v1/**` endpoint requires the internal token. This service holds no authoritative state: it
returns structured results to the BFF, which persists them through the ledger service.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Reports which adapter is active for each integration. |
| POST | `/v1/documents/extract` | multipart. PyMuPDF text, Tesseract OCR fallback, Ollama extraction; deterministic sample values without `OLLAMA_MODEL`. |
| POST | `/v1/risk/invoice` | Rules plus Isolation Forest (from ten historical invoices). |
| POST | `/v1/advisor/chat` | Gemini with structured output; deterministic mock without `GEMINI_API_KEY`, and as the fallback in demo mode when Gemini fails. |
| POST | `/v1/voice/session` | Signed ElevenLabs URL plus the client tool name; reports `available: false` without both `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`. |
| POST | `/v1/voice/message` | Runs the same advisor logic as the text surface with `channel: "voice"` (a spoken-delivery hint only). |

### `POST /v1/documents/extract`

```json
{
  "documentType": "invoice",
  "extraction": {
    "vendorKey": "cloud_provider",
    "vendorDisplayName": "Cloud Provider",
    "amount": 1300.00,
    "previousAmount": 1000.00,
    "invoiceDate": "2026-09-11",
    "dueDate": "2026-09-28",
    "recurring": true,
    "category": "cloud_services",
    "direction": "OUT",
    "confidence": 0.96,
    "paymentDestinationFingerprint": "sha256:…"
  },
  "warnings": []
}
```

The uploaded bytes are written to a temp directory and deleted before the response is built. The
document text never appears in the response, the logs, or any outbound request.

### `POST /v1/risk/invoice`

Request `{ "invoice": { vendorKey, vendorDisplayName, amount, invoiceDate, dueDate, paymentDestinationFingerprint }, "history": [ { amount, invoiceDate, paidDate, paymentDestinationFingerprint } ] }`,
response:

```json
{
  "riskScore": 0.87,
  "severity": "HIGH",
  "rulesScore": 0.82,
  "mlScore": 0.94,
  "reasons": ["Amount is 30% above the vendor's previous charge", "Payment details changed since this vendor's last invoice"],
  "modelVersion": "invoice-risk-v1"
}
```

Severity bands: `0.00–0.39` LOW, `0.40–0.69` MEDIUM, `0.70–1.00` HIGH. `mlScore` stays `null`
until a vendor has at least 10 historical invoices, and it is an anomaly percentile — never a
fraud probability.

### `POST /v1/advisor/chat`

Request:

```json
{
  "message": "Which overdue invoice should I follow up on first?",
  "language": "en",
  "channel": "text",
  "history": [ { "role": "user", "content": "How am I doing?" }, { "role": "advisor", "content": "You hold $8,000…" } ],
  "context": { "…AdvisorContext" }
}
```

`language` is `en` or `es` (anything else falls back to `en`); `channel` is `text` or `voice`;
`history` keeps the last ten turns and may only carry `role` and `content`. Unknown keys inside
`context` are dropped before the prompt is built, so nothing outside the allowlist can reach the
model.

Response:

```json
{
  "answer": "Follow up with Client A first: $4,000 is 12 days overdue…",
  "summary": "Chase Client A first: $4,000, 12 days overdue.",
  "risks": [ { "title": "Upcoming cash gap", "severity": "HIGH", "explanation": "…" } ],
  "proposedActions": [ { "title": "Follow up with Client A", "rationale": "…", "priority": "HIGH", "dueDate": null, "estimatedImpact": 4000 } ],
  "meta": { "provider": "gemini", "model": "gemini-3.6-flash", "language": "en", "channel": "text", "fallbackReason": null }
}
```

Every reply is validated against this schema before it leaves the service: `answer` and `summary`
are required and non-empty, severities and priorities are `LOW | MEDIUM | HIGH`, `dueDate` is an
ISO date or null, and lists are trimmed to six items. A Gemini reply that does not validate is
rejected (`ADVISOR_UNAVAILABLE`), never repaired. In demo mode that error, or an unreachable
Gemini, makes the deterministic advisor answer instead, with `meta.provider: "mock"` and
`meta.fallbackReason` set; outside demo mode the error is returned. Proposed actions are proposals
only; they become tasks (`POST /v1/todos`, source `ADVISOR`) only when the owner adds them.

### `POST /v1/voice/session`

Request `{ "language": "<BCP-47 code>" }`, one of `SUPPORTED_LANGUAGES`. With credentials:

```json
{ "available": true, "mode": "voice", "language": "es", "signedUrl": "wss://…", "agentId": "agent_…", "supportedLanguages": ["en", "es"], "clientToolName": "ask_cash_flow_advisor" }
```

Without them `{ "available": false, "mode": "text", "language", "supportedLanguages", "reason" }`.
The browser registers `clientToolName` with the ElevenLabs client; the agent must expose a client
tool of that name with a `question` parameter. The API key never appears in the response.

### `POST /v1/i18n/translate`

Request `{ "language": "<BCP-47 code>", "strings": ["Available cash", "Add task"] }` (at most 200).

```json
{ "language": "es", "provider": "gemini", "translations": { "Available cash": "Efectivo disponible", "Add task": "Agregar tarea" } }
```

Rules that matter to the caller:

- **A string may be missing from `translations`.** That is not an error — it means the model did
  not return one, and the caller keeps the source text. The web app remembers which strings came
  back missing so it never asks a second time.
- **`provider` is `none`** when nothing was translated: `language` is `en`, or `GEMINI_API_KEY` is
  not set. The interface then stays English and says so, rather than blanking out.
- **`language` is clamped** to `SUPPORTED_LANGUAGES`, falling back to the first entry.
- Translations are cached per language for the life of the process, so a repeated string costs
  nothing. The web app asks only for strings its pre-built pack does not already cover
  (`client/public/i18n/<lang>.json`), so in practice this endpoint sees the user's own data —
  merchant names, categories, advisor answers — rather than the interface. Product names (current.surf, Persona, Gemini, Nessie, ElevenLabs, Capital One) are preserved
  verbatim, and figures, dates and currency symbols are never reformatted.

### `GET /v1/i18n/languages`

`{ "languages": [{ "code": "es", "name": "Spanish" }, …] }` — what this service will translate into.
