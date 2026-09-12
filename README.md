# Keel — sign-up and onboarding for small-business cash flow

A production-style demo of the full onboarding journey for a cash-flow management product:

**Sign up → Google → Persona KYC/AML verification → Cash-flow dashboard**

Everything runs from one repository: an Express 5 API (Node 24, TypeScript run natively) and a React 19 + Tailwind CSS 4 client built with Vite 8.

> **Current state.** Persona verification is live (set `IDENTITY_BYPASS` to `true` in `server/services.ts` to skip it while developing). Once verified, the journey lands on the dashboard, which is powered by a mock cash-flow API that runs entirely in Node (`server/modules/cashflow/mock/`); the business-type, priorities, and Nessie workspace steps are parked in `server/flow.ts` and can be restored by uncommenting three lines. See [Cash-flow dashboard](#cash-flow-dashboard-mock-api) below.

## Quick start

```bash
npm install
cp .env.example .env      # add keys as they become available (see below)
npm run dev               # API on :3000, app on http://localhost:5173
```

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
  store/           UserRepository interface + in-memory implementation
  modules/
    auth/          Google OAuth (PKCE) provider, sandbox provider, routes
    identity/      Persona REST client, identity service, webhook verification, bypass service
    onboarding/    Business-type and feature catalog (mock data) + routes (parked)
    nessie/        Nessie API client, in-memory twin, demo profiles, provisioner (parked)
    cashflow/      Nessie snapshot → dashboard builder (parked)
    cashflow/mock/ Company profiles, ledger generator, analytics, bill review, lending, store, and the /api/cashflow routes
client/src/
  pages/           SignUp, VerifyIdentity, onboarding/*, Dashboard
  components/      UI primitives, onboarding shell + stepper, charts, cashflow/ (dashboard panels, top bar, drawer, dialog)
  lib/             API client, session context, formatting
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

Secrets never reach the client: API keys are read once in `server/config.ts`, and every third-party call is made from the server.
