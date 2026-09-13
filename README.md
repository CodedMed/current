# Keel — sign-up and onboarding for small-business cash flow

A production-style demo of the full onboarding journey for a cash-flow management product:

**Sign up → Google → Persona KYC/AML verification → Cash-flow dashboard**

Everything runs from one repository: an Express 5 API (Node 24, TypeScript run natively), a React 19 + Tailwind CSS 4 client built with Vite 8, and the **Cash Flow Copilot backend** — a Java ledger service and a Python intelligence service that add private-document ingestion, invoice risk scoring, a deterministic cash-flow forecast, a CFO advisor, voice, and a financial to-do list behind the same API. See [Cash Flow Copilot backend](#cash-flow-copilot-backend).

> **Current state.** The full journey runs: Persona verification (live when `PERSONA_API_KEY`/`PERSONA_TEMPLATE_ID` are set; `IDENTITY_BYPASS` in `server/services.ts` skips it while developing) → business type → priorities → Nessie workspace provisioning → the cash-flow dashboard. The dashboard reads from the user's Nessie workspace by default: `server/modules/cashflow/nessie/nessieLedger.ts` converts Nessie accounts, deposits, purchases, withdrawals, and bills into the ledger the analytics, review queue, and financing modules consume, projecting recurring streams forward for the forecast. Manual entries are written back to Nessie; categories, notes, review decisions, and financing state are stored per user in `keel.workspace_overlays` when `DATABASE_URL` is set (in memory otherwise). Set `CASHFLOW_SOURCE=mock` to use the generated sample ledger instead. See [Cash-flow dashboard](#cash-flow-dashboard-mock-api) below.

## Quick start

```bash
npm install
cp .env.example .env         # add keys as they become available (see below)
npm run setup:intelligence   # once: Python venv for the intelligence service
npm run dev:all              # API :3000, app :5173, ledger :8080, intelligence :8000
```

`npm run dev` still runs only the API and the client; the copilot routes then answer `503` until the services are up (`npm run dev:services` starts just those two). Prerequisites for the services: a JDK (17 or newer) and Python 3.12+. No database is needed in demo mode.

Open http://localhost:5173. Without any keys the whole flow still runs end to end: each integration falls back to a clearly labelled sandbox, and the UI shows a **Sandbox** badge wherever that is the case. Add a key, restart, and that step switches to the live service with no other changes.

| Integration | Environment variables | Without them |
|---|---|---|
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | A demo Google account walks the same redirect → callback → session path |
| Persona KYC/AML | `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID` (optional: `PERSONA_WEBHOOK_SECRET`) | A sandbox panel lets you choose approve / review / decline / fail |
| Nessie banking API | `NESSIE_API_KEY` | An in-memory implementation of the same API surface |

`SESSION_SECRET` is required in production and generated at startup in development.

### Google OAuth setup

Create an OAuth 2.0 **Web application** client in Google Cloud Console and add `http://localhost:5173/api/auth/google/callback` (or `<APP_URL>/api/auth/google/callback`) as an authorized redirect URI. The token exchange, PKCE verifier, and ID-token verification all happen server-side; the browser only ever sees the redirect.

### Persona setup

1. Use a **sandbox** API key (`persona_sandbox_…`) and the inquiry template ID of your KYC/AML template (`itmpl_…`).
2. In the sandbox, Persona's embedded flow shows a "pass verifications" toggle so you can exercise approve and decline paths without real documents.
3. Optional: point a Persona webhook at `POST /api/identity/webhook` and set `PERSONA_WEBHOOK_SECRET`; signatures are verified with HMAC-SHA256 over `t.<raw body>`.
4. `PERSONA_ACCEPT_COMPLETED` (default `true`) treats `completed` inquiries as verified when a template has no automated decision step. Set it to `false` to require `approved`.

### Nessie setup

Get a key at http://api.nessieisreal.com and set `NESSIE_API_KEY`. During onboarding the app creates a customer, three accounts, merchants, and about 150 to 250 transactions, bills, and transfers shaped by the chosen business type, then reads them back to build the dashboard. Nothing else is required; no customer or account IDs need to be supplied.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Runs the API (`node --watch`) and the Vite dev server together |
| `npm run build` | Builds the client into `dist/client` |
| `npm start` | Serves the API and the built client from one process (`NODE_ENV=production`) |
| `npm run typecheck` | Type-checks server and client with TypeScript 7 |
| `npm run dev:all` | Everything above plus the ledger and intelligence services |
| `npm run dev:services` · `dev:ledger` · `dev:intelligence` | The copilot backend services, with the repo `.env` loaded (`scripts/with-env.mjs`) |
| `npm run setup:intelligence` | Creates `services/intelligence-service/.venv` and installs every extra (documents, ML, Gemini, ElevenLabs, tests) |
| `npm test` | Node's built-in test runner over the BFF and client logic (`*.test.ts`, no extra framework) |
| `npm run test:ledger` · `npm run test:intelligence` · `npm run test:all` | Java (JUnit, embedded PostgreSQL) and Python (pytest) suites, or everything |

## Cash-flow dashboard (mock API)

The dashboard answers four questions at a glance: how much cash there is right now, what is coming in and going out, what the next 30–90 days look like, and what needs attention. All of it is served by `GET /api/cashflow/dashboard`, which builds KPIs, a balance history, a scenario-based projection, monthly flows, upcoming cash, breakdowns, insights, and recent activity from a deterministic in-memory ledger. Two sample companies are included (Acme Inc., which is cash-flow positive, and Northwind Studio, which is burning cash), so both states of the runway tile and the low-balance insight can be seen.

| Endpoint | What it does |
|---|---|
| `GET /api/cashflow/companies` | Sample companies available in the company selector |
| `GET /api/cashflow/dashboard?company=&accounts=a,b&period=last30&horizon=90&scenario=expected` | Everything the dashboard page renders. `period` accepts `last30`, `last90`, or a month like `2026-08`; `horizon` is 30/60/90/180/365; `scenario` is `expected`, `conservative`, or `optimistic` |
| `GET /api/cashflow/transactions?company=&accounts=&q=&limit=&offset=&scope=` | Paged, searchable activity (`scope=activity`, `scheduled`, or `all`) |
| `GET /api/cashflow/transactions/:id` | One transaction (the detail drawer) |
| `POST /api/cashflow/transactions` | Add a posted transaction or schedule a future one; scheduled entries feed upcoming cash and the forecast |
| `PATCH /api/cashflow/transactions/:id` | Edit merchant, description, category, or note |
| `POST /api/cashflow/sync` | Marks accounts as synced and posts pending items that have settled |
| `POST /api/cashflow/transactions/:id/review` | Record a decision on a flagged vendor bill: `approve`, `dispute`, or `reopen` |
| `GET /api/cashflow/loan-offers?company=` | Financing offers underwritten from the ledger, with the credit profile behind them |
| `POST /api/cashflow/loan-offers/:id/apply` | Start an application for a chosen amount |
| `POST /api/cashflow/loan-offers/:id/save` | Save an offer for later (toggle) |

Each signed-in user gets their own copy of the ledger, and ledgers regenerate when the calendar day changes. The generator (`ledger.ts`) turns a monthly budget in `profiles.ts` into dated transactions: payroll, rent, cloud, marketing, taxes, customer invoices, processor payouts, and so on, with a growth trend and a deliberate cloud-spend spike so the insights have something real to find.

### Bill review

Every vendor charge is compared with what that vendor usually bills (`server/modules/cashflow/mock/review.ts`). The baseline is the median of the vendor's recent charges in the same category; the tolerance comes from the vendor's own variability (a robust standard deviation), with a floor of 20% so steady bills like rent are held to a tight band while naturally noisy spend is not flagged for normal swings. Near-identical charges from the same vendor within three days are flagged as possible duplicates. Travel and office supplies are never flagged for size. Flags appear in the **Bills to review** panel with the vendor's last eight bills, on transaction rows, and in the transaction drawer. "Looks right" folds the charge into the vendor's baseline; "Dispute" leaves it out. Both sample companies ship with deliberate irregularities (`billingAnomalies` in `profiles.ts`) so the queue has real cases.

### Financing offers

`server/modules/cashflow/mock/lending.ts` underwrites the business from its own ledger: trailing 12-month revenue, cash buffer, net cash flow, revenue trend, customer concentration, and existing debt service produce a credit profile (tier A/B/C with a score and the factors behind it). A catalog of products from banks and fintechs (lines of credit, SBA 7(a), term loans, revenue-based advances, business cards, equipment financing) is then sized and priced from that profile: term loans are capped so debt service stays under 12% of revenue, revenue-based advances scale with processor volume, and card limits scale with card spend or cash on hand. One offer is recommended based on the situation (a line of credit to bridge a projected dip for a cash-burning company, an SBA loan for a profitable, growing one). The loan math lives in `shared/lending.ts` so the client can re-price an offer instantly when the amount changes, and each offer shows its effect on runway or on the lowest projected cash. Applications and saved offers are kept in the ledger; terms are illustrative.

## Cash Flow Copilot backend

The product loop **verify → ingest → normalize → forecast/detect → advise → act** lives in two services that Express fronts under `/api/copilot/*`. The browser never talks to them; Express adds the caller's stable subject and a shared internal token to every call, and both services reject anything without that token.

```
Browser ──► Express /api/copilot/* ──► services/ledger-service        Java 17 + Spring Boot + Flyway   authoritative ledger, forecast, tasks
                                   └─► services/intelligence-service  Python 3.12 + FastAPI            documents, invoice risk, advisor, voice
```

| Capability | Where | Without credentials |
|---|---|---|
| Bank data → `cash_events` | Express pushes the user's Nessie workspace snapshot (`POST /v1/bank/snapshot`); Java normalises it and stores the balances. `POST /v1/nessie/sync` pulls through Java's own `NessieClient` for standalone use | The in-memory Nessie workspace is pushed the same way; a user without a workspace gets `samples/seed/nessie_mock.json` |
| Deterministic forecast and first cash gap | Java `CashFlowForecastCalculator`, `BigDecimal` only | — (no credentials involved) |
| Private invoice extraction | Python: PyMuPDF → Tesseract → Ollama → strict Pydantic schema; temp files deleted | Deterministic sample values, labelled in `warnings` |
| Invoice anomaly detection | Python rules + Isolation Forest (from 10 historical invoices); stored by Java | — |
| CFO advisor (`/advisor`) | Python `GeminiAdvisor` over the Java allowlisted context, validated structured output | `MockAdvisor` answers the same questions from the same context, labelled as demo |
| Voice advisor (English, Spanish) | ElevenLabs Conversational AI in the browser (signed URL from Python) + the same advisor logic through a client tool | Voice reports unavailable; text keeps working |
| Financial to-do list | Java `todo_items` with enforced transitions | — |
| Identity gate | Express Persona decision, mirrored to Java (`POST /v1/persona/status`) and enforced there too | Sandbox decision |

### Running it

`DEMO_MODE=true` (the development default) makes the whole thing a complete product with no keys: the ledger starts an embedded PostgreSQL and runs the Flyway migrations, every integration uses its mock adapter, and the first time a verified user calls a copilot route Express asks the ledger to seed the demo business for them (`POST /v1/demo/seed`, idempotent, refused outside demo mode). Sign in with the sandbox Google account, simulate an approval, and `/api/copilot/dashboard` shows $8,000 in cash, $25,000 in receivables, and a projected gap inside 60 days.

```bash
npm run dev:all                                  # or: npm run dev + npm run dev:services
# Real, persistent database (TimescaleDB in Docker, wrapped by scripts/db.sh):
scripts/db.sh up                                 # starts TimescaleDB and waits until healthy
DATABASE_URL=$(scripts/db.sh url) npm run dev:ledger
scripts/db.sh status                             # extension, hypertable, aggregate, policies, /health
# Or the containerised stack (db + both services), with the web app on the host:
docker compose -f docker-compose.dev.yml up --build && npm run dev
```

With the `timescaledb` extension present the ledger does three extra things: `cash_events` becomes
a hypertable, a second Flyway stream (`db/timescale`) adds chunk sizing, compression and the
`cash_daily` continuous aggregate, and `GET /v1/analytics/spend` (burn rate, runway, category
movers) is served from that rollup instead of scanning rows. Without the extension everything
degrades to the equivalent portable query. `GET :8080/health` reports which mode is live — and
whether the database answers at all. `scripts/db.sh reset` drops the volume for a clean re-seed.
See [docs/tigerdata.md](docs/tigerdata.md).

### Where state lives

The same `DATABASE_URL` serves both halves of the app, with a schema per owner:

| Schema | Owner | Holds | Without `DATABASE_URL` |
|---|---|---|---|
| `public.*` | Java ledger, via Flyway (`db/migrations`, `db/timescale`) | `app_users` (subject, email, display name, Persona status), `cash_events` hypertable, `bank_accounts` (last ingested balances), `invoices`, `invoice_risks`, `todo_items`, `nessie_sync_state`, `cash_daily` aggregate | throwaway embedded PostgreSQL |
| `keel.*` | Express, idempotent DDL at boot (`server/store/postgres.ts`) | `users` (sign-in profile, identity decision, onboarding choices, Nessie workspace), `sessions`, `workspace_overlays` (category/note edits, review decisions, financing) | in-memory maps + MemoryStore |

Both keep the user keyed by the auth subject (`google:<sub>`), so a returning Google sign-in finds its rows on either side. Express forwards the email and display name with each Persona decision (`POST /v1/persona/status`), so the ledger's `app_users` row is never anonymous. The sandbox Google provider deliberately mints a new subject per sign-in so onboarding can be replayed; returning-user behaviour needs real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. `SESSION_SECRET` must be set for sessions to outlive an API restart.

Adding a key is what switches a capability from mock to real; there is no other flag. `NESSIE_API_KEY` for live bank data (Express provisions the workspace and pushes its snapshot to the ledger, so both show the same business), `OLLAMA_MODEL` (after `ollama pull llama3.2`, see [docs/local-ai.md](docs/local-ai.md)) for real extraction, `GEMINI_API_KEY` for the advisor, `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` for voice. Keep `INTERNAL_SERVICE_TOKEN` identical everywhere; the `npm run dev:*` scripts load the repo `.env` for the services so that happens by itself. If port 8000 is taken on your machine, set `INTELLIGENCE_SERVICE_PORT` and `INTELLIGENCE_SERVICE_URL` together; the API checks both services at startup and warns when a different application answers on a configured URL, and `GET /api/copilot/health` reports the same.

### Demo walkthrough

1. Sign in and complete verification (sandbox: **Simulate approval**).
2. `GET /api/copilot/dashboard` — available cash, 30-day inflow/outflow, the first projected gap, overdue receivables, and priority tasks from the seeded business.
3. `POST /api/copilot/documents` with `samples/invoices/suspicious_vendor_invoice.pdf` (regenerate the sample PDFs relative to today first with `services/intelligence-service/.venv/bin/python samples/invoices/generate.py`) (`api.copilot.uploadDocument` in the client streams the stages: extracting locally → validating → scoring → saved). The invoice is persisted, an expected outflow enters the ledger, and the risk engine flags it **HIGH**: 30% above the vendor's previous charge, payment details changed, off the usual cadence. Upload it a second time and the duplicate is called out by invoice number — only a local hash of the number is ever kept.
4. The forecast worsens: expected outflow rises by the invoice amount and the gap moves.
5. Open **Advisor** (`/advisor`) and ask "What should I do first?" — or `POST /api/copilot/advisor` `{ "message": "What should I do first?", "language": "en" }`. The advisor explains the position, connects the overdue $4,000 to the projected gap and ranks actions; `language: "es"` answers in Spanish, and `POST /api/copilot/voice/session` reports whether voice is available.
6. `POST /api/copilot/todos` turns a proposed action into a `PROPOSED` task; `PATCH` approves, starts, or completes it. Nothing executes automatically.

The full route table, request and response shapes, and the service-level contracts are in [docs/api-contracts.md](docs/api-contracts.md); the design and privacy model in [docs/architecture.md](docs/architecture.md). Types are shared in `shared/copilot.ts`, and the client reaches everything through `api.copilot` in `client/src/lib/api.ts`.

### Tests

```bash
npm test                     # 37 tests: BFF advisor contract (context always from the ledger, no automatic tasks), bank-snapshot mapping, identity bridge (push once, seed right, recover from a ledger restart), voice state machine, recommendation → task mapping
npm run test:ledger          # 66 tests: forecast calculator, Nessie normalisation (statuses, receivables, withdrawals, recurring bills), bank snapshot ingest, Persona guard and mirroring, invoice ingestion and risk persistence, demo seeding, task transitions, advisor context
npm run test:intelligence    # 116 tests: extraction schemas and privacy, OCR cleanup, rules, features, Isolation Forest, advisor schemas, demo advisor, Gemini adapter and fallback, voice contracts
npm run typecheck
```

## Financial advisor (`/advisor`)

A text and voice advisor that explains the business's cash position from the figures the ledger
already computed: available cash, expected inflows and outflows over 30 and 60 days, expected
receivables, overdue receivables, upcoming obligations, the projected low point, the first
projected cash gap, invoice-risk results and open tasks. It answers questions such as "How much
cash do I have available?", "Which overdue invoice should I follow up on first?", "When might I
run into a cash-flow gap?" or "Can I afford this expense?", labels facts, projections and
recommendations separately, and turns a recommendation into a task only when you press
**Add to tasks**.

```
Advisor UI (/advisor)
   │  question + prior turns (never the numbers)          session cookie only
   ▼
Express BFF  POST /api/copilot/advisor ─► ledger GET /v1/advisor/context   (Java: authoritative figures)
                                       └► intelligence POST /v1/advisor/chat (Python: Gemini or the demo advisor)
                                                                 │ validated { answer, summary, risks[], proposedActions[], meta }
                                                                 ▼
Advisor UI ◄────────────────────────────────── recommendation cards ── Add to tasks ──► POST /api/copilot/todos
```

Voice uses the same pipeline. The browser opens an ElevenLabs Conversational AI session from a
signed URL minted server-side (`POST /api/copilot/voice/session`, so the API key never reaches the
page) and registers one **client tool**, `ask_cash_flow_advisor`. The agent handles speech and
turn-taking; for every financial question it calls that tool, the browser answers it through
`POST /api/copilot/voice/message` (ledger context → Python advisor → Gemini), and the agent speaks
the returned answer. ElevenLabs only ever receives microphone audio and that answer; documents,
OCR text and account details never leave the ledger and intelligence services.

### Environment variables

| Variable | Purpose | Without it |
|---|---|---|
| `GEMINI_API_KEY` | Gemini reasoning in the intelligence service | The deterministic demo advisor answers from the same ledger context (labelled **Demo advisor** in the UI) |
| `GEMINI_MODEL` | Gemini model id (default `gemini-3.6-flash`) | — |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | Voice sessions (both are required) | `/advisor` shows **Voice unavailable** with the reason and stays fully usable in text mode |
| `DEMO_MODE` | Seeds the demo business and lets a Gemini outage fall back to the demo advisor | Outside demo mode a Gemini failure is surfaced as a retryable error instead |

All of them live in the root `.env` (see `.env.example`); `npm run dev:intelligence` and
`docker-compose.dev.yml` pass them to the Python service. Never commit a `.env` with real values.

### Gemini setup

1. Create an API key in Google AI Studio and set `GEMINI_API_KEY` (optionally `GEMINI_MODEL`).
2. Restart the intelligence service. `GET /api/copilot/health` reports `adapters.advisor: "gemini"`
   and replies carry `meta.provider: "gemini"`.

The service sends Gemini the CFO system prompt (`services/intelligence-service/app/prompts/cfo_system.txt`),
the last ten conversation turns and the allowlisted ledger context, and requests JSON that must
validate against the response schema. Malformed or incomplete output is rejected, never repaired;
in demo mode the demo advisor then answers and the reply is labelled **Gemini unavailable · demo answer**.

### ElevenLabs setup

1. In the ElevenLabs dashboard create a Conversational AI agent. Copy its id into
   `ELEVENLABS_AGENT_ID` and an API key into `ELEVENLABS_API_KEY`.
2. Under the agent's **Tools**, add a **Client tool** named `ask_cash_flow_advisor` with one
   required string parameter, `question` ("The user's financial question, verbatim"). Mark it as
   waiting for a response.
3. Give the agent a system prompt along these lines:

   > You are the voice of Keel's cash-flow advisor. For every question about the user's money,
   > cash, invoices, payments, expenses, forecast, risks or tasks, call the `ask_cash_flow_advisor`
   > tool with the user's question and read its answer back to the user as-is. Never answer a
   > financial question from your own knowledge and never invent numbers, dates, clients or
   > vendors. Keep small talk to a sentence and steer back to the user's finances.

4. Under **Security**, enable the **language** override (the page sets the session language to
   English or Spanish to match the selector) and add your app origin (`http://localhost:5173` in
   development) to the allowlist. Add Spanish under **Languages** to allow that override.
5. Restart the intelligence service. `GET /api/copilot/health` reports `adapters.voice: "elevenlabs"`.

If the agent calls a tool with a different name, the page shows an error naming the expected
tool instead of guessing. Voice requires a microphone and a secure context (HTTPS or localhost).

### Using it

```bash
npm run dev:all          # API :3000, app :5173, ledger :8080, intelligence :8000
```

Sign in, complete verification (sandbox: **Simulate approval**), finish onboarding, then open
**Advisor** in the dashboard's top bar or go to http://localhost:5173/advisor.

* **Text**: type a question or pick a suggestion. Each reply shows the answer, a one-line
  headline, the risks to watch (projections) and recommended actions (proposals). Follow-up
  questions carry the previous turns; the figures are re-fetched from the ledger every time.
* **Voice**: switch the toggle, press **Start voice conversation** and allow the microphone. The
  orb shows the real state — listening, thinking (the advisor pipeline is running), speaking —
  driven by the SDK's events, never by timers. End the session, mute, or switch back to text at
  any time; a failed start offers a retry and a switch to text.
* **Language**: English or Spanish for both the interface and the advisor's answers.
* **Add to tasks** creates an `ADVISOR` task with status `APPROVED` through the ledger; nothing is
  created until you press it, and **Dismiss** keeps it out of your tasks.

The **Your numbers** panel next to the conversation shows the dashboard read model the answers are
grounded in. With `DEMO_MODE=true` and no keys the whole page works on the seeded demo business.

### Tests

```bash
npm test                 # Node test runner: BFF advisor contract, voice state machine, recommendation → task mapping
npm run test:intelligence# pytest: schema validation, context sanitisation, malformed Gemini output, demo advisor, fallback policy, voice contract
npm run test:ledger      # JUnit: advisor context contents and privacy, plus the existing suites
npm run test:all         # all three
```

## How the flow is enforced

The server is the single authority on where a user is in the journey. `GET /api/session` returns the user plus a `nextStep`, computed from identity status, onboarding answers, and whether a workspace exists. Client routes only translate that into redirects, so refreshing, deep-linking, or skipping ahead always lands on the right screen, and every API route is guarded by the same rules (`server/lib/guards.ts`).

## Project layout

```
shared/            Types and the flow definition shared by client and server
server/
  config.ts        Environment parsing; decides live vs sandbox per integration
  app.ts           Express app assembly (sessions, routers, static client)
  services.ts      Composition root — swap implementations here
  flow.ts          nextStep rules and session serialisation
  lib/             Errors, sessions, guards, HTTP + date helpers
  store/           UserRepository interface, in-memory and PostgreSQL implementations, session store, `keel` schema
  modules/
    auth/          Google OAuth (PKCE) provider, sandbox provider, routes
    identity/      Persona REST client, identity service, webhook verification, bypass service
    onboarding/    Business-type and feature catalog (mock data) + routes (parked)
    nessie/        Nessie API client, in-memory twin, demo profiles, provisioner (parked)
    cashflow/      Nessie snapshot → dashboard builder (parked)
    cashflow/mock/ Company profiles, ledger generator, analytics, bill review, lending, store, and the /api/cashflow routes
    copilot/       BFF for the copilot services: ledger + intelligence clients, identity bridge, /api/copilot routes
client/src/
  pages/           SignUp, VerifyIdentity, onboarding/*, Dashboard, Advisor
  components/      UI primitives, onboarding shell + stepper, charts, cashflow/ (dashboard panels, top bar, drawer, dialog), advisor/ (thread, cards, composer, voice orb + panel)
  hooks/           useVoiceAdvisor (ElevenLabs session → real voice state), useReducedMotion
  lib/             API client (incl. api.copilot), session context, formatting, advisor/ (conversation model, voice state machine, strings)
shared/copilot.ts  Wire shapes of the copilot services, shared by the BFF and the client
services/
  ledger-service/        Java 17 + Spring Boot: users, cash events, invoices, risk results, forecast, dashboard, advisor context, todos
  intelligence-service/  Python + FastAPI: document extraction (PyMuPDF/OCR/Ollama), invoice risk, Gemini advisor, ElevenLabs voice
db/migrations/     Flyway SQL, compiled into the ledger jar (Timescale hypertable when available)
samples/           Sample invoices and the demo business fixtures
docs/              Architecture, API contracts, local AI setup
scripts/           with-env.mjs — runs a service with the repo .env loaded
docker-compose.dev.yml   TimescaleDB + both services (the web app runs on the host)
```

### Extending the Nessie layer

`server/modules/nessie/types.ts` defines `NessieApi`. The provisioner and the dashboard builder only depend on that interface, so replacing demo seeding with real account linking means providing a workspace whose `nessieCustomerId` points at live data; `fetchSnapshot` and `buildDashboard` work unchanged. Demo content for each business type lives in `demoProfiles.ts`.

### API surface

| Route | Purpose |
|---|---|
| `GET /api/session` | Current user, integration modes, and `nextStep` |
| `GET /api/auth/google` → `/callback` | OAuth authorization code flow with PKCE |
| `POST /api/auth/logout` | Ends the session |
| `POST /api/identity/session` | Creates or resumes a Persona inquiry; returns a session token |
| `POST /api/identity/complete` · `GET /api/identity/status` | Re-reads the inquiry from Persona and updates the user |
| `POST /api/identity/webhook` | Signed Persona webhooks (live mode only) |
| `GET /api/onboarding/catalog` | Business types and features, with recommendations |
| `PUT /api/onboarding/business-type` · `PUT /api/onboarding/features` | Save answers (validated with zod) |
| `POST /api/onboarding/provision` · `GET /api/onboarding/provision/status` | Seed and poll the Nessie workspace |
| `GET /api/dashboard` | The cash-flow dashboard model built from Nessie data |
| `/api/cashflow/*` | The Keel dashboard API (see above) |
| `/api/copilot/*` | The Cash Flow Copilot backend: dashboard, forecast, documents, invoices and risk, advisor, voice, tasks (see [docs/api-contracts.md](docs/api-contracts.md)) |
| `/advisor` (client route) | The text and voice financial advisor (see [Financial advisor](#financial-advisor-advisor)) |

Secrets never reach the client: API keys are read once in `server/config.ts`, and every third-party call is made from the server.
