# Keel — sign-up and onboarding for small-business cash flow

A production-style demo of the full onboarding journey for a cash-flow management product:

**Sign up → Google → Persona KYC/AML verification → Business type → Priorities → Nessie data → Cash-flow dashboard**

Everything runs from one repository: an Express 5 API (Node 24, TypeScript run natively) and a React 19 + Tailwind CSS 4 client built with Vite 8.

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
    identity/      Persona REST client, identity service, webhook verification
    onboarding/    Business-type and feature catalog (mock data) + routes
    nessie/        Nessie API client, in-memory twin, demo profiles, provisioner
    cashflow/      Snapshot → dashboard model builder + route
client/src/
  pages/           SignUp, VerifyIdentity, onboarding/*, Dashboard
  components/      UI primitives, onboarding shell + stepper, charts, dashboard modules
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
