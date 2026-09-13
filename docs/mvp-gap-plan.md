# Cash Flow Copilot — MVP gap audit and implementation plan

Audit date: 2026-09-12 · Baseline: `main` @ `69c3f2f` · Spec: `CLAUDE_CODE_IMPLEMENTATION_SPEC.md`

## 0. Status after the fix pass (2026-09-12, later the same day)

Fixed in the codebase, with tests (`npm test` 37/37, `npm run test:ledger` 66/66, pytest 116/116):

- **D1** — The ledger no longer asks the live API for the demo customer: `demo-customer-001` is
  always served from the fixture (`NessieSyncService.clientFor`), and the BFF now pushes each
  user's real workspace snapshot to a new `POST /v1/bank/snapshot` (`server/modules/copilot/bankSnapshot.ts`,
  `services/ledger-service/…/bank/`). Available cash is read from the new `bank_accounts` table
  (`db/migrations/V2__bank_accounts.sql`, `spring.flyway.out-of-order` enabled so V2 applies after
  V1001/V1002) instead of a live call. `RealNessieClient` reads the API's snake_case fields, parses
  calendar dates, honours `status`, fetches withdrawals and resolves merchants; 404 is an empty list.
- **D2** — `INTELLIGENCE_SERVICE_PORT` drives `npm run dev:intelligence`; `.env` on this machine
  points at 8001. Express probes both services at startup and `GET /api/copilot/health` reports
  `ok: false` with the offending service name when a different application answers on a URL.
- **D3 (data)** — One bank feed. `NessieCashflowStore` hands every fresh Nessie snapshot to the
  copilot bridge, which pushes it when it changed; the advisor's figures and the current.surf dashboard's
  figures now come from the same records. Demo seeding for a workspace user adds only the vendor
  invoice history (`POST /v1/demo/seed { "includeBankData": false }`), never the fixture business.
  The current.surf dashboard's own analytics still live in Express (option C in §6 remains future work).
- **D6** — The bridge checks the ledger's view on every prepared request and re-mirrors,
  re-pushes and re-seeds when the ledger has lost the user.
- **D7** — `npm run test:ledger` pins `NESSIE_API_KEY` and `DATABASE_URL` empty.
- **Normalisation** — settled/pending/cancelled statuses, pending deposits as receivables,
  withdrawals with categories, recurring bills rolling to their next occurrence, internal
  transfers skipped (`NessieNormalizer`, `CategoryMapper`).

Still open: D3 (UI: the documents, invoices and tasks pages and the copilot panels), D4, D8,
D9, D10 (analytics route), and M1–M10. The phases below are unchanged except that Phase 0 and
Phase 1 are done.

## 0a. Status after the accessibility pass (2026-09-13)

`npm test` 57/57, pytest 125/125, typecheck clean. `npm run test:ledger` could not be run on this
machine: the embedded PostgreSQL that the Java suite starts fails at `initdb` with
`could not create shared memory segment: Cannot allocate memory`, which is macOS's default SysV
shared-memory limits (`kern.sysv.shmmni=32`, `shmseg=8`), not a code change — no Java file was
touched in this pass.

- **D5 — fixed.** `ADVISOR_LANGUAGES` in `shared/copilot.ts` is now the 13 languages the
  ElevenLabs agent speaks, with a `LANGUAGES` table carrying each one's native name and writing
  direction, and `.env.example` defaults `SUPPORTED_LANGUAGES` to the same list. A French question
  now reaches Gemini as French. The advisor's own hand-written `STRINGS` still cover en/es and
  fall back to English for the rest (`stringsFor`, `suggestionsFor`), which the interface
  translator then translates.
- **Interface translation — new.** `POST /api/i18n/translate` (Express, open to signed-out
  visitors, rate limited) over a new Python `TranslationService`, which batches 50 strings a call
  to Gemini, caches per language for the life of the process, and leaves a string untranslated
  rather than failing. The browser side (`client/src/lib/i18n/translator.ts`) walks the rendered
  DOM, swaps text and `placeholder`/`title`/`aria-label`/`alt`, keeps each node's source text so
  English is restored exactly, re-applies from cache through a `MutationObserver` when React
  re-renders, and remembers strings that came back untranslated so they are never requested twice.
  It covers text this codebase never wrote — category names, merchant names, advisor answers,
  task titles. `LanguageSwitcher` sits in all four headers; Arabic sets `dir="rtl"`.
- **Voice everywhere — new.** `VoiceDock` puts the advisor's microphone on every workspace page
  (hidden on `/advisor`, which owns its own session), with the orb, mute, the last question and
  the answer, and a link into the full advisor.
- **Persona sessions** — a stored inquiry id Persona has never seen (a sandbox id left over from
  before a real key) now starts a new inquiry instead of failing verification with a 404.

Known limits of the translation layer: the first switch to a language costs one Gemini round trip
per ~50 new strings; right-to-left languages set `dir` but the layout still uses physical
`ml-*`/`text-left` utilities, so Arabic reads correctly but is not mirrored; and a `<title>` or
anything outside `document.body` is not translated.

## 1. How this was checked

- Every source file was read: `server/`, `client/src/`, `shared/`, `services/ledger-service`,
  `services/intelligence-service`, `db/`, `samples/`, `docs/`, root config.
- Test runs on this machine:

  | Suite | Result |
  | --- | --- |
  | `npm run typecheck` | clean |
  | `npm test` (BFF + client logic) | 28 / 28 pass |
  | `npm run test:intelligence` (pytest) | 116 / 116 pass |
  | `npm run test:ledger` (JUnit, embedded PostgreSQL) | 52 / 53 — `AdvisorContextTest.carriesTheComputedFigures…` fails (see D1, D7) |

- Live probes against the services already running here: ledger `:8080` (TimescaleDB 2.30, demo
  mode, **live Nessie client selected**), intelligence `:8001` (Ollama / Gemini / ElevenLabs
  adapters selected). One Gemini turn and one ElevenLabs signed-URL mint succeeded. Ollama was
  unreachable, so extraction fell back to sample values with a warning.

## 2. Verdict

The backend implements the spec's loop faithfully and is well tested: **verify** (Persona in
Express, mirrored into Java and enforced there), **ingest** (document → Python → Java, temp files
deleted, only hashes stored), **normalize** (`cash_events`), **forecast** (BigDecimal calculator
with first-gap semantics and 10 unit tests), **detect** (six rules + Isolation Forest percentile),
**advise** (Gemini with an allowlisted context and a deterministic fallback), **act** (todo CRUD
with enforced transitions).

Two things keep it from being the product the spec describes:

1. **The browser cannot reach most of it.** There is no documents page, no invoices page and no
   tasks page, and the dashboard the user sees is a separate Express-computed "current.surf" dashboard
   that never reads the ledger. Steps 3–8 and 12 of the demo narrative only work with `curl`.
2. **In the configuration actually on this machine it is broken twice over.** With a live
   `NESSIE_API_KEY` the ledger reports **$0 available cash** for the demo business, and the BFF
   points at port **8000** while the intelligence service runs on **8001**, so uploads, advisor
   and voice calls from the browser fail.

## 3. Feature status against the spec

| Spec area | Backend | BFF route | UI | Status |
| --- | --- | --- | --- | --- |
| Persona gate (live, sandbox, webhook, mirrored to Java) | ✓ | ✓ | ✓ `/verify` | Works |
| Nessie → `cash_events` | ✓ fixture · ✗ live client | ✓ | ✗ nothing calls sync | **Broken with a live key** (D1) |
| Deterministic forecast + first gap | ✓ | ✓ | ✗ only the advisor side panel | Backend only |
| Dashboard read model (`/v1/dashboard`) | ✓ | ✓ | ✗ page uses the current.surf API instead | **Not as intended** (D3) |
| Document upload → local extraction | ✓ | ✓ NDJSON stages | ✗ no `/documents` page | Backend only (M1) |
| Invoice persistence + risk result | ✓ | ✓ | ✗ no `/invoices` page | Backend only (M2) |
| Advisor (text, Gemini, mock fallback) | ✓ verified live | ✓ | ✓ `/advisor` | Works |
| Advisor (voice, ElevenLabs client tool) | ✓ verified live | ✓ | ✓ | Works, en/es only (D5) |
| Financial to-do list | ✓ CRUD + transitions | ✓ | ✗ only "Add to tasks"; no `/tasks` page | Partial (M3) |
| Tiger Data analytics (`/v1/analytics/spend`) | ✓ | ✗ | ✗ | Built, unused (D10) |
| Languages configuration-driven | Python ✓ (13) | ✗ clamps to en/es | ✗ en/es | Not as intended (D5) |
| Gemini tool calling (spec P1) | ✗ | | | Not started (M8) |
| `/settings` page | ✗ | | | Not started (M9) |
| Web smoke / e2e tests | ✗ | | | Not started (M10) |

Deliberate deviations that are fine to keep: Vite + Express sessions instead of Next.js + Auth.js;
Express owns Persona and the Java inquiry/webhook endpoints stay inert (`501`); Java 17 instead of
21. These are documented in `docs/architecture.md` and need no work.

## 4. Defects — built, but not working as intended

### D1 · Live Nessie leaves the ledger with $0 cash and no bank events — **high**

**Evidence.** `.env` sets `NESSIE_API_KEY`, so `NessieConfig` selects `RealNessieClient`. On the
running ledger, `GET /v1/accounts/summary` for the demo user returned
`{"totalBalance":0,"accounts":[]}` and `GET /v1/dashboard` reported `availableCash: 0` with a gap
in 10 days (the seeded scenario expects $8,000 and a gap around day 27). The JUnit run logged
"Using live Nessie client" and "Demo seed … 0 bank events", and
`AdvisorContextTest.carriesTheComputedFiguresAndNamedItemsOfTheSeededBusiness` failed on
`currentCash > 0`.

**Root causes.**

1. `NessieSyncService.customerIdFor` falls back to `demo-customer-001`, which does not exist at
   `api.nessieisreal.com`. Nothing ever tells the ledger the customer the BFF provisioned: the
   client never calls `api.copilot.syncNessie()`, and the BFF does not sync after provisioning.
2. `RealNessieClient` reads camelCase fields (`transactionDate`, `paymentDate`, bill `amount`).
   The live API spells them `purchase_date`, `transaction_date`, `payment_date`,
   `payment_amount` (the shapes in `server/modules/nessie/types.ts` are exercised against the
   live API by the provisioner). `Instant.parse` also cannot parse Nessie's `YYYY-MM-DD` dates.
   A "successful" sync would therefore date every event *now* and ingest every bill as **$0**.
3. The Java client ignores transaction `status` (a pending purchase becomes `ACTUAL`), never
   fetches **withdrawals** or **transfers** (payroll, taxes and bill payments in the provisioned
   workspace are withdrawals), and never resolves merchant names or categories, so purchases land
   as `uncategorised`.
4. A 404 "no … found" from Nessie is an error in Java but an empty list in Express.

**Fix.** Phase 1.

### D2 · BFF targets port 8000; the intelligence service is on 8001 — **high (this machine)**

`.env` has `INTELLIGENCE_SERVICE_URL=http://127.0.0.1:8000`; `lsof` shows a Docker container from
another project on 8000, and the copilot `/health` answers on 8001. `package.json`
`dev:intelligence` hard-codes `--port 8000`. Every `/api/copilot/documents`, `/advisor` and
`/voice/*` call from the browser therefore fails with `INTELLIGENCE_UNAVAILABLE` or a non-JSON
reply from the wrong app. **Fix.** Phase 0.

### D3 · Two dashboards, two ledgers, two forecasts — **high**

`DashboardPage.tsx` renders `api.cashflow.dashboard`, which Express computes in
`server/modules/cashflow/mock/analytics.ts`, `review.ts` and `lending.ts` (balances, projections,
bill-anomaly review, loan offers) from the Express-side Nessie workspace. The advisor's
`SnapshotPanel` renders `api.copilot.dashboard` from the Java ledger, which holds the seeded demo
fixture. The two never share data: without a key they are two different fictitious businesses;
with a key the ledger has nothing (D1). The advisor's numbers contradict the dashboard the user is
looking at, and the spec's dashboard cards (projected gap, high-risk invoices, priority tasks,
quick ask) never appear. `docs/architecture.md` says Express "never computes a balance or a risk
score itself"; today it does. **Fix.** Phase 1 (one data source) and Phase 2 (copilot panels).

### D4 · `EXPECTED` events never roll over to `OVERDUE` — **medium**

Only `NessieNormalizer.fromBill` (at sync time) and `InvoiceService.create` (at creation) ever set
`OVERDUE`. `DashboardService.overdueReceivables` filters on `status == OVERDUE`, and
`AdvisorContextService.expectedReceivables` clamps `daysUntilDue` to ≥ 0. The seeded "Client D"
receivable (due in 19 days) will still read "expected, due in 0 days" three weeks from now and
never enter the overdue list or the advisor's follow-up ranking. **Fix.** Phase 3.

### D5 · Languages are not configuration-driven end to end — **medium** — fixed 2026-09-13

`SUPPORTED_LANGUAGES=en,es,fr,de,…` in `.env` was honoured by Python (the voice session lists 13
languages), but `server/modules/copilot/routes.ts:40` clamped the language to
`ADVISOR_LANGUAGES = ['en','es']` with `.catch('en')`, and the client selector and `STRINGS` only
knew en/es. A French question silently became English. **Fixed:** see §0a.

### D6 · Identity-bridge caches go stale after a ledger restart — **medium (default demo path)**

`CopilotIdentityBridge` keeps `#mirrored` and `#seeded` per process; `invalidate()` exists but is
never called. With `DATABASE_URL` unset (the documented no-infrastructure demo), restarting the
ledger empties the embedded `app_users`. Express skips the mirror, the ledger recreates the user
as `UNVERIFIED`, and every copilot call returns `403 PERSONA_NOT_VERIFIED` until Express is also
restarted. Not triggered here because `DATABASE_URL` is set. **Fix.** Phase 5.

### D7 · Java tests inherit the developer's real `.env` — **medium**

`test:ledger` runs through `scripts/with-env.mjs`, so sponsor keys change test behaviour (that is
how the D1 failure surfaced). Tests must pin `app.nessie.api-key` and `app.database-url` empty.
**Fix.** Phase 0.

### D8 · Extraction silently substitutes sample values while health says "ollama" — **low/medium**

`/health` reports `localExtractor: "ollama"` because `OLLAMA_MODEL` is set, but Ollama was
unreachable and the upload returned the fixed demo invoice with a warning string. This is the
intended demo-mode fallback, but the UI will say "Processed locally" over numbers that did not
come from the document. Health should probe Ollama and the documents page must surface the
warning prominently. **Fix.** Phase 5.

### D9 · Duplicate uploads double the obligation; invoices cannot be paid or cancelled — **medium**

`InvoiceService.create` always inserts a new invoice plus an `EXPECTED` cash event. The risk
engine flags a re-upload by invoice-number hash, but the forecast still counts the obligation
twice. There is no `PATCH /v1/invoices/{id}`, so `DOCUMENT` cash events never become `ACTUAL` or
`CANCELLED` — the "act" step is incomplete on the ledger side. **Fix.** Phase 3.

### D10 · Smaller items

- `GET /v1/analytics/spend` (continuous-aggregate burn rate and runway) has no BFF route and no UI.
- `DashboardService.gapOf` can return a negative `daysFromNow` when the first gap is caused by an
  overdue, past-dated outflow. Clamp to 0 (the series already plots overdue items on today).
- `AdvisorContextService.build` runs the forecast twice and, with a live client, calls Nessie for
  balances on every request. Storing balances at sync time (Phase 1) removes both.
- `.env.example` lacks `SUPPORTED_LANGUAGES` and `INTELLIGENCE_SERVICE_PORT`.
- README says `npm test` runs 25 tests; it runs 28.

## 5. Missing features against the spec

| # | Feature | Spec ref | Priority |
| --- | --- | --- | --- |
| M1 | `/documents` page: drag/drop, staged progress, extracted-field preview, privacy copy | §18 | P0 |
| M2 | `/invoices` page: Vendor · Amount · Due · Status · Risk · Reason, score action | §18 | P0 |
| M3 | `/tasks` page: Proposed / Active / Completed, approve/decline/complete, manual add | §15, §18 | P0 |
| M4 | Copilot panels on the dashboard: four top cards, gap marker, high-risk invoices, priority tasks, overdue receivables, quick ask | §18 | P0 |
| M5 | Bank sync trigger after provisioning; account balances stored in the ledger | §9, §11 | P0 |
| M6 | Invoice lifecycle: mark paid / cancel / dedupe → cash-event status | §6.1, §11 | P1 |
| M7 | HIGH-risk result → `PROPOSED` task with source `RISK` (never auto-executed) | §15 | P1 |
| M8 | Gemini function calling (`get_cashflow_forecast`, `get_overdue_invoices`, `get_invoice_risk`, `get_open_todos`) | §13.5 | P1 |
| M9 | `/settings` page | §18 | P2 |
| M10 | Web page-render smoke tests and a Playwright run of the demo narrative | §28 | P2 |

## 6. Architecture decision: one bank snapshot, one ledger

Three ways to make the dashboard and the advisor agree:

- **A. Push the snapshot from the BFF (recommended now).** Express already fetches the workspace
  snapshot for its dashboard (`fetchSnapshot`). Add `POST /v1/bank/snapshot` to the ledger that
  accepts the Nessie-shaped records (accounts, deposits, withdrawals, purchases with merchant
  name/category, bills, transfers). Java validates, normalizes (`NessieNormalizer` stays the
  authority), upserts by source id and stores account balances. Works identically in sandbox and
  live mode, removes the field-name drift between two clients, and needs no new network topology.
- **B. Fix the Java pull client and, in sandbox mode, expose Express's in-memory Nessie twin over
  HTTP as a stand-in.** More moving parts; keep the pull-client fix anyway for standalone
  deployments of the ledger.
- **C. Rebuild the current.surf dashboard on ledger reads.** The spec-pure end state (no financial logic
  in Express), but the current.surf dashboard's scenarios, breakdowns, bill review and financing are large
  and out of the spec's scope. Do this after the demo, module by module.

Plan below assumes **A**, with the pull client repaired as a fallback.

## 7. Implementation plan

Effort figures are rough, for one engineer familiar with the repo.

### Phase 0 — Unblock this machine and the tests (≈ 1 hour)

| Step | Change | Files |
| --- | --- | --- |
| 0.1 | Add `INTELLIGENCE_SERVICE_PORT` (default 8000). `dev:intelligence` becomes `node ../../scripts/with-env.mjs sh -c '.venv/bin/uvicorn app.main:app --reload --port "${INTELLIGENCE_SERVICE_PORT:-8000}"'`. Document both it and `SUPPORTED_LANGUAGES` in `.env.example`. Locally set the port to 8001 and `INTELLIGENCE_SERVICE_URL=http://127.0.0.1:8001`. | `package.json`, `.env.example`, `.env` |
| 0.2 | Boot check in Express: call both `/health` on startup and log a loud warning when `service` is not `ledger-service` / `intelligence-service` (catches "wrong app on that port"). Show the same in `GET /api/copilot/health`. | `server/index.ts`, `server/modules/copilot/routes.ts` |
| 0.3 | Test isolation: add `src/test/resources/application.yml` (or `@TestPropertySource`) pinning `app.nessie.api-key: ""` and `app.database-url: ""`, or run `test:ledger` with `NESSIE_API_KEY= DATABASE_URL=` exported before `mvnw`. | `services/ledger-service/src/test/resources/`, `package.json` |

Acceptance: `npm run test:all` is green (53/53 Java); `GET /api/copilot/health` shows both services `ok` with the right names.

### Phase 1 — One bank snapshot, one ledger (fixes D1, D3-data, D10 perf; delivers M5) (≈ 1 day)

| Step | Change | Files |
| --- | --- | --- |
| 1.1 | Migration `V2__bank_accounts.sql`: `bank_accounts(user_id, account_id, type, nickname, balance NUMERIC(14,2), synced_at, PRIMARY KEY (user_id, account_id))`. | `db/migrations/` |
| 1.2 | New `bank` package: validated `BankSnapshotRequest` DTOs mirroring `NessieSnapshot`; `BankSnapshotService.ingest(user, snapshot)` → normalizer → `CashEventService.upsertBySourceRecord`; `BankAccountRepository.replaceAll`; `nessie_sync_state.recordSync`. Endpoint `POST /v1/bank/snapshot` (internal token + approved user). | `services/ledger-service/.../bank/` |
| 1.3 | Extend `NessieNormalizer`: deposit `completed` → IN/ACTUAL; deposit `pending` → IN/EXPECTED receivable (`counterpartyLabel` from the description, OVERDUE when dated in the past); withdrawal `completed` → OUT/ACTUAL with a deterministic category mapper (port `withdrawalCategory`/`billCategory` from `nessieLedger.ts`); purchase by status (`cancelled` → CANCELLED) with merchant name/category; bill `pending`/`recurring` → OUT/EXPECTED or OVERDUE; internal transfers (`Transfer ·` prefix) skipped. Unit-test each. | `nessie/NessieNormalizer.java`, tests |
| 1.4 | `NessieSyncService.currentCash` / `accounts` read `bank_accounts` (checking + savings; cards excluded) and only fall back to the client when the table is empty and a live key exists. | `nessie/NessieSyncService.java` |
| 1.5 | Repair the pull path for standalone deployments: snake_case field names, `LocalDate` parsing, `status`, `getWithdrawals`, `getTransfers`, `getMerchant`, empty-list on 404. | `nessie/RealNessieClient.java`, `NessieClient.java`, `MockNessieClient.java`, `dto/NessieDtos.java` |
| 1.6 | BFF: `LedgerClient.pushBankSnapshot(subject, snapshot)`; call it when `Provisioner#run` completes (inject a completion hook), from `POST /api/cashflow/sync`, and from `CopilotIdentityBridge.prepare` when the ledger's `lastSyncedAt` is null. Demo seeding: seed the fixture business only for users **without** a workspace; a current.surf user gets their own workspace pushed instead, so the $8,000 fixture never contradicts their dashboard. | `server/modules/copilot/ledgerClient.ts`, `identityBridge.ts`, `server/modules/nessie/provisioner.ts`, `server/services.ts` |
| 1.7 | Tests: normalizer per record type; BFF test that provisioning pushes once and sync pushes again; ledger test that `currentCash` equals the pushed checking + savings balances. | as above |

Acceptance: after onboarding, `/api/copilot/dashboard.totals.availableCash` equals the current.surf
`kpis.totalCash.book` (cards excluded) and the same upcoming bills appear in both.

### Phase 2 — Put the copilot in the browser (delivers M1–M4; fixes D3-UI) (≈ 1.5 days)

| Step | Change | Files |
| --- | --- | --- |
| 2.1 | Shared `WorkspaceNav` (Dashboard · Documents · Invoices · Tasks · Advisor) used by `TopBar` and `AdvisorHeader`; routes for `/documents`, `/invoices`, `/tasks` under `StepRoute step="dashboard"`. | `client/src/App.tsx`, `components/layout/WorkspaceNav.tsx` |
| 2.2 | `DocumentsPage`: dropzone (PDF/PNG/JPEG ≤ 10 MB); stage list driven by `uploadCopilotDocument` events (Uploading → Extracting locally → Validating → Scoring → Saved); result card with extracted fields, risk chip + reasons, and the forecast delta (gap before vs after, using the returned `forecast`); a warnings banner (demo extraction); privacy line "Processed locally; the raw document is never sent to Gemini or ElevenLabs"; links to the invoice. Handle `DOCUMENT_UNSUPPORTED`, `DUPLICATE_INVOICE` (Phase 3) and retryable errors. | `client/src/pages/DocumentsPage.tsx`, `components/documents/*`, `lib/documents/uploadState.ts` (+ test) |
| 2.3 | `InvoicesPage`: table Vendor · Amount · Invoice date · Due · Status · Risk · Reasons; row actions **Score** (`POST /invoices/:id/risk`), **Mark paid** / **Cancel** (Phase 3); upload CTA; severity colours. | `client/src/pages/InvoicesPage.tsx`, `components/invoices/*` |
| 2.4 | `TasksPage`: tabs Proposed / Active / Completed / Declined; cards with source badge (ADVISOR, RISK, FORECAST, MANUAL); actions by status (Approve/Decline, Start/Complete, Delete); "Add task" form (title, description, priority, due date → `MANUAL`, `APPROVED`). | `client/src/pages/TasksPage.tsx`, `components/tasks/*`, `lib/tasks/transitions.ts` (+ test) |
| 2.5 | Dashboard "Copilot" section fed by `api.copilot.dashboard`: four tiles (Available cash, 30-day inflow, 30-day outflow, Projected gap with date and amount or "none in 60 days"); `HighRiskInvoices`, `PriorityTasks` (approve inline), `OverdueReceivables`, `AdvisorQuickAsk` (navigates to `/advisor` with the question prefilled). Mark the gap on the current.surf cash-position chart. | `client/src/pages/DashboardPage.tsx`, `components/copilot/*` |
| 2.6 | Client unit tests for the pure helpers (upload stage reducer, task transitions, forecast delta). | `client/src/lib/**/*.test.ts` |

Acceptance: the 12-step demo narrative (spec §32) runs entirely in the browser.

### Phase 3 — Ledger lifecycle correctness (fixes D4, D9, D10 gap; delivers M6) (≈ 0.5 day)

| Step | Change | Files |
| --- | --- | --- |
| 3.1 | `CashEventStatus.effective(event, now)` (EXPECTED and past-dated ⇒ OVERDUE) used by `DashboardService`, `AdvisorContextService` and forecast labels; hourly `@Scheduled` `rolloverOverdue` that flips rows in the database. | `cashevent/`, `dashboard/DashboardService.java`, `advisor/AdvisorContextService.java` |
| 3.2 | `PATCH /v1/invoices/{id}` `{ status: PAID \| CANCELLED \| EXPECTED, paidDate? }` → linked cash event (source `DOCUMENT`, `source_record_id` = invoice id): PAID ⇒ `ACTUAL` at `paidDate`; CANCELLED ⇒ `CANCELLED`. BFF route + UI actions. | `invoice/InvoiceController.java`, `InvoiceService.java`, `CashEventRepository.java`, `server/modules/copilot/routes.ts`, `client/src/lib/api.ts` |
| 3.3 | Dedupe at `POST /v1/invoices`: same user + `vendorKey` + `invoiceNumberHash` ⇒ `409 DUPLICATE_INVOICE` with the existing id; the BFF forwards `?force=true` after the user confirms on the documents page. | `invoice/InvoiceService.java`, `error/ErrorCode.java`, BFF routes, `DocumentsPage` |
| 3.4 | Clamp `Gap.daysFromNow` to ≥ 0. | `dashboard/DashboardService.java` |
| 3.5 | Tests: transitions, dedupe, rollover, gap clamp. | JUnit |

### Phase 4 — Languages end to end (fixes D5) (≈ 0.5 day)

- BFF: read `SUPPORTED_LANGUAGES` into `config.copilot.languages`; build the zod `language` enum
  from it (`.catch(first)`); expose the list in `GET /api/session` or `GET /api/copilot/health`.
- Client: selector from the server list; `STRINGS` falls back to English UI text for languages
  without a bundle while the advisor still answers in the requested language; voice keeps
  `overrides.agent.language`. README: enable the same languages on the ElevenLabs agent.
- Python: already correct; add `fr` to `MockAdvisor` only if the demo needs a third language.

### Phase 5 — Robustness and honesty (fixes D6, D8, D10; delivers M7) (≈ 0.5 day)

- Identity bridge: on `403 PERSONA_NOT_VERIFIED` from the ledger, `invalidate(subject)`, re-mirror,
  re-check seeding, retry once.
- Intelligence `/health`: probe Ollama (`GET /api/tags`, 1 s timeout) and report
  `localExtractor: "ollama"` vs `"ollama-unreachable (demo fallback)"`; pass through the BFF; the
  documents page shows the banner whenever the extraction warnings mention the fallback.
- Expose `/v1/analytics/spend` as `GET /api/copilot/analytics/spend` and add Burn rate / Runway
  tiles to the copilot section (this is the Tiger Data story, currently invisible).
- Risk → task: when a stored risk is `HIGH`, the BFF creates a `PROPOSED` task (source `RISK`,
  "Confirm the … invoice with the vendor before paying"), idempotent per invoice via
  `metadata.invoiceId`. Proposals still require approval on `/tasks`.

### Phase 6 — Spec P1/P2 items (only after the phases above)

- **Gemini function calling (M8):** declare the four tools in `gemini_adapter.py` with
  `types.Tool(function_declarations=…)`. Cheapest execution: answer them in Python from the
  context already supplied (it carries all four datasets). Truer demo: forward the subject from
  the BFF and let Python call the ledger with the internal token. Loop until no function call,
  keep the JSON response schema for the final turn, report `meta.toolsUsed`.
- **`/settings` (M9):** integration modes, default language, "Sync bank now", "Reset demo data"
  (demo mode only).
- **Tests (M10):** Playwright over the sandbox path (requires `GOOGLE_CLIENT_ID` unset): sign in →
  approve → onboarding → copilot tiles visible → upload suspicious PDF → HIGH risk → gap moves →
  advisor answer → add task → task visible. Node smoke test of the BFF documents route against a
  stub intelligence server.
- **Later (option C):** move the current.surf dashboard's analytics, bill review and financing onto ledger
  reads so Express computes no money at all.

## 8. Verification runbook

Run after each phase; all of it after Phase 2.

1. `npm run test:all` green; `npm run typecheck` clean.
2. `GET /api/copilot/health`: both `ok`, correct service names, `adapters` as expected.
3. Sign in, simulate approval, finish onboarding. Dashboard copilot tiles show the same available
   cash as the current.surf KPI strip; `SnapshotPanel` on `/advisor` agrees.
4. `/documents`: upload `samples/invoices/suspicious_vendor_invoice.pdf` (regenerate with
   `samples/invoices/generate.py` first). Stages stream; result shows HIGH with "30% above",
   "payment details changed", "off the usual schedule"; the forecast delta shows the gap moving
   earlier or deeper. Upload it again: duplicate is refused (Phase 3) or flagged (before).
5. `/invoices`: the new row shows HIGH; **Score** re-runs; **Mark paid** turns the obligation
   `ACTUAL` and the gap recovers.
6. `/advisor`: "What should I do first?" cites Client A's $4,000 and the gap; `meta.provider` is
   `gemini`; switch to voice and repeat; switch to Spanish (and a third language after Phase 4).
7. Add the recommendation to tasks; `/tasks` shows it as APPROVED; complete it; the dashboard's
   priority list updates.
8. Restart only the ledger (no `DATABASE_URL`): the copilot keeps working (Phase 5).
