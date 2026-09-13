# Architecture

current.surf is the sign-up, identity, onboarding and dashboard experience for small-business cash flow.
The Cash Flow Copilot backend adds the product loop **verify → ingest → normalize → forecast/detect
→ advise → act**: private documents read on your own machine, a deterministic cash-flow forecast,
invoice anomaly detection, and a reasoning layer that explains what to do next.

## The four processes

| Process | Owns | Never does |
| --- | --- | --- |
| **Express API** (`server/`) | Sessions, Google sign-in, Persona KYC, onboarding, the Nessie-backed dashboard, and the BFF for the two services below (`/api/copilot/*`). The only thing the browser talks to. | Compute a balance or a risk score itself, or expose a sponsor key or the internal token to the browser. |
| **Vite client** (`client/`) | Every screen. | Call the services directly. |
| **ledger-service** (`services/ledger-service`, Java 17 + Spring Boot) | Authoritative financial state: users, mirrored Persona status, cash events, invoices, risk results, tasks, and every deterministic calculation. | Call an LLM. |
| **intelligence-service** (`services/intelligence-service`, Python + FastAPI) | Document understanding, invoice anomaly scoring, Gemini reasoning, ElevenLabs voice transport. | Write authoritative financial state, or compute a balance. |

The split exists so the numbers are deterministic and testable while the judgement is
probabilistic. Money arithmetic lives in Java in `BigDecimal`; models explain those numbers but
never produce them. Financial business logic is not duplicated across services.

## Request path

```
Browser
   │  session cookie only
   ▼
Express  /api/copilot/*  ──────────────────────────────────────────┐
   │  X-Auth-Subject + X-Internal-Service-Token                      │
   ├──────────► ledger-service ──► PostgreSQL / Tiger Data (TimescaleDB)
   └──────────► intelligence-service ──► local model (Ollama), Gemini, ElevenLabs
```

Both services reject any request that lacks the internal token, so the browser cannot reach them
even though they listen on localhost during development. The BFF lives in
`server/modules/copilot/`: one typed client per service, an identity bridge, and the router.

## Identity

Express owns sign-in and Persona. It creates inquiries, re-reads the decision from Persona
server-side (never from the browser callback alone), and processes signature-verified webhooks.
Before any financial call the identity bridge mirrors that decision to the ledger service through
`POST /v1/persona/status`, and the ledger enforces it again with its own `PersonaAccessGuard`. A
user is therefore gated twice, by two processes, from one server-derived decision.

The subject forwarded to the services is `<provider>:<provider subject>` (for example
`google:1043…`), which is stable across restarts of the in-memory user store.

The bridge also keeps the ledger's bank data in step (see *One bank snapshot* below) and, in demo
mode (`DEMO_MODE=true`, the development default), calls `POST /v1/demo/seed` the first time a
verified user appears: the whole fixture business for a user without a workspace, only the vendor
invoice history for a user whose bank data is their own workspace. The ledger refuses that call
outside demo mode. If the ledger has lost the user (a restart without a database), the bridge
notices on the next request and redoes the mirror, the push and the seed.

## Data model

`cash_events` is the spine: every ingest path — bank sync, uploaded document, manual entry,
system obligation — normalizes into the same record, and every projection reads from it. On a
Timescale deployment it becomes a hypertable partitioned on `event_time`; on plain PostgreSQL the
migration skips that step and everything else is unchanged. A second Flyway location,
`db/timescale`, is appended at startup only when the extension is present; it holds the chunk
sizing, the compression policy and the `cash_daily` continuous aggregate, none of which can be
guarded inline. `scripts/db.sh up` gives a local TimescaleDB for that path — see
[tigerdata.md](tigerdata.md).

Statuses drive behaviour rather than convention: `ACTUAL` is settled money, `EXPECTED` and
`OVERDUE` shape the projection, `CANCELLED` is ignored everywhere.

Because a hypertable only accepts unique indexes that contain its partitioning column, ingest
idempotency is enforced in the repository (look up by source record id, then insert or replace)
rather than by a unique constraint on `(user_id, source, source_record_id)`.

## The forecast

`CashFlowForecastCalculator` is a pure function: current bank balance, the outstanding events in
chronological order, a horizon. It walks them in `BigDecimal`, records a point per event, and
reports the **first** moment the running balance crosses below zero — not the deepest later
deficit. A later inflow never erases that date, which is the entire point: knowing you are short
on the 14th matters even if a client pays on the 20th.

Available cash is the signed sum of the balances last ingested from the bank (`bank_accounts`),
not a replay of ledger history and not a live call, so the projection starts from what is in the
account and a bank outage cannot turn it into $0 mid-request.

## Documents and risk

`POST /api/copilot/documents` streams the upload through Express to the intelligence service
without touching disk. The service extracts text (PyMuPDF, then Tesseract for scans), asks a local
Ollama model for the structured invoice, validates it with a strict Pydantic schema, fingerprints
the payment destination locally, deletes the temp files, and returns only the structure. Express
then persists it through the ledger (which creates the expected cash event itself), scores it
against the vendor's history through `POST /v1/risk/invoice`, stores the result through
`POST /v1/invoices/{id}/risk-result`, and refreshes the forecast. With `Accept: application/x-ndjson`
the stages are streamed as they happen.

The risk engine answers "how unusual is this invoice for this vendor?", never "is this fraud?".
Deterministic rules carry the score; the Isolation Forest adds an anomaly percentile once a vendor
has ten or more historical invoices.

## Privacy model

1. Raw document bytes never reach a database. Express streams them through; the intelligence
   service keeps them in a temp directory and deletes them in a `finally` block.
2. Document and OCR text never leave the machine — not to Gemini, not to ElevenLabs. Only the
   validated, structured extraction does.
3. The reasoning layer receives an allowlist (`GET /v1/advisor/context`), never raw rows to be
   redacted afterwards. The browser cannot supply that context: Express always fetches it.
4. Only a non-reversible fingerprint of a payment destination is stored; account and routing
   numbers are never persisted. The fingerprint stays server-side and is stripped from browser
   responses.
5. Model output is schema-validated before it can affect anything.
6. Document text is treated as untrusted input, and the extractor prompt says so explicitly, to
   blunt prompt injection from a malicious invoice.
7. Every user-scoped query includes the resolved `user_id`, and all SQL is parameterized.
8. Sponsor keys and the internal token stay in Express and the services; the client bundle never
   sees them.

## Adapters

Every sponsor integration sits behind an interface with a mock implementation, chosen at startup
from the environment:

| Port | Live | Fallback | Selected when |
| --- | --- | --- | --- |
| Google sign-in (Express) | `GoogleAuthProvider` | `SandboxAuthProvider` | No `GOOGLE_CLIENT_ID` |
| Persona (Express) | `PersonaIdentityService` | `SandboxIdentityService` | No `PERSONA_API_KEY` |
| Nessie (Express dashboard) | live `NessieApi` | in-memory fixture | No `NESSIE_API_KEY` |
| `NessieClient` (ledger) | `RealNessieClient` | `MockNessieClient` | No `NESSIE_API_KEY`, or demo mode |
| `LocalExtractor` (intelligence) | `OllamaLocalExtractor` | `MockLocalExtractor` | No `OLLAMA_MODEL` |
| advisor (intelligence) | `GeminiAdvisor` | `MockAdvisor` (also the demo-mode fallback when Gemini fails) | No `GEMINI_API_KEY` |
| voice (intelligence) | `ElevenLabsVoiceAdapter` | text fallback | No `ELEVENLABS_API_KEY` or no `ELEVENLABS_AGENT_ID` |

That is what makes `DEMO_MODE=true` a complete product rather than a set of empty screens.

## The advisor

`/advisor` in the client is one conversation thread with two transports. A typed question goes to
`POST /api/copilot/advisor`; Express fetches `GET /v1/advisor/context` from the ledger and calls
`POST /v1/advisor/chat` on the intelligence service, which builds the prompt from the system
instructions, the last ten turns and that context, asks Gemini for schema-constrained JSON, and
validates the result. The browser only ever sends the question and prior turns — it cannot supply
or edit the figures.

A spoken question takes the same path with a different front end. The browser opens an ElevenLabs
Conversational AI session from a signed URL minted by the intelligence service and registers one
client tool, `ask_cash_flow_advisor`. The agent is configured to call it for every financial
question; the browser answers the call through `POST /api/copilot/voice/message`, which is the same
ledger-context → advisor pipeline with a spoken-delivery hint, and the agent reads the returned
answer aloud. There is no voice-only reasoning: ElevenLabs owns speech and turn-taking, Python
owns the answer. The UI's listening / thinking / speaking states come from the SDK's status, mode
and transcript events and from the tool call's own lifecycle, never from timers.

Recommendations are proposals. The advisor cannot write to the ledger; a proposal becomes a task
only when the owner presses **Add to tasks**, which creates an `ADVISOR` task with status
`APPROVED` through `POST /v1/todos`.

## One bank snapshot

Express provisions a Nessie workspace per user during onboarding and reads it for the current.surf
dashboard. The ledger service holds the same records: the copilot bridge pushes the workspace's
snapshot to `POST /v1/bank/snapshot` before the first financial call, and every fresh snapshot the
dashboard reads from Nessie is pushed again when it changed. The ledger normalises the records
(`NessieNormalizer`), upserts them by the bank's record ids and stores the balances, so the
advisor's figures and the dashboard's figures come from one feed, live or sandbox alike.

The ledger's own `NessieClient` remains for the pull path (`POST /v1/nessie/sync`, standalone
deployments). The demo customer in `samples/seed/nessie_mock.json` is always served from the
fixture, even with a live key, because it does not exist at the real API.
