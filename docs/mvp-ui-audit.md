# MVP UI audit — September 13, 2026

Reviewed the merged local `main` at `cf1e387` against the functional MVP in the supplied implementation specification. The document was used as a feature reference; the existing React/Vite/Express/Java/Python architecture was preserved.

## Functional coverage

| Capability | Result |
| --- | --- |
| Sign-in, verification, business setup | Sandbox journey loaded in Chrome; API tests verified unauthenticated and declined users cannot read financial data. |
| Bank dashboard and transactions | Existing account, transaction, history, forecast, and review UI retained. New bank transactions now refresh the ledger before returning to the UI. |
| Uploaded invoices | Added `/documents` and `/invoices` redirect: file selection/drop, validation, processing stages, extracted details, warnings, invoice search, and risk rechecks. |
| Forecast and risk after upload | Added dashboard Cash commitments with 30/60/90-day ledger forecasts, cash-gap notices, upcoming obligations, overdue receivables, invoice risks, and task links. The separate bank-activity forecast is explicitly labeled. |
| Advisor and voice | Existing English/Spanish advisor and voice controls retained. Saved recommendations now link to Tasks. Demo advisor and text fallback verified through the API. |
| Financial tasks | Added `/tasks`: manual creation, editing, clearable due dates, approval, decline, progress, completion, deletion, and status filters. |
| Financing | Existing offer details, costs, amount selection, saving, and simulated applications are exposed through a Financing navigation item. Company changes reset the financing drawer. |

## Regressions fixed

- Concurrent initial dashboard/forecast requests could seed the same demo invoices twice; requests now share one seed operation.
- A saved bank transaction could leave advisor/ledger balances stale until the dashboard cache expired; downstream synchronization now runs after the write. A failed downstream refresh does not misreport the bank save as failed.
- A forced bank refresh could reuse an older in-flight snapshot; it now waits and reads the latest state.
- Clearing a task's due date was interpreted as omitting the field; PATCH now distinguishes these cases.
- Overdue uploaded invoices and their forecast events had inconsistent statuses.
- Negative opening cash and overdue obligations could produce missing or historical cash-gap dates.
- Document upload streams could lose the final saved event when it had no trailing newline.
- Onboarding text promised invoice sending, autonomous workflows, and a nonexistent settings screen; wording now matches available functionality.

## Verification

- TypeScript typecheck and production build passed. Vite still reports its existing large-chunk warning.
- **43 Node tests passed**, including persistence tests against an isolated local PostgreSQL database.
- **116 Python tests passed** in credential-free demo mode.
- **70 Java tests passed** in an isolated source copy using plain PostgreSQL. This Mac's embedded PostgreSQL failed at `initdb` with a shared-memory allocation error, so only the test database URL was substituted in the copy. Repository test assertions were preserved. The temporary database was created from `template0` to match the suite's explicit assumption that TimescaleDB is absent.
- **10 end-to-end API checks passed**: authentication gate, verification gate, concurrent seeding, fixture upload/risk/forecast, advisor-to-task lifecycle, manual task/date/deletion, Spanish/text fallback, bank provisioning, simulated financing persistence, and immediate bank-to-ledger balance refresh.
- The suspicious fixture produced a **HIGH** risk score; its $1,300 obligation increased forecast outflows by exactly $1,300 and produced a $300 first cash gap in the seeded scenario.
- Desktop browser checks covered sandbox sign-in, verification, onboarding, dashboard/commitments rendering, navigation, and Documents/Tasks page loading.

## Verification limits

Live Google, Persona, Nessie, Gemini, ElevenLabs, and real lender operations were not exercised; sponsor credentials and existing application data were not used for these tests. Financing applications remain simulations. Demo extraction deliberately returns labeled sample values.

Native file-picker automation did not finish, and concurrent user activity interrupted further browser action checks. Upload processing and mutation persistence were verified through the same browser-facing APIs, but a complete browser click-through and a mobile viewport check remain manual QA items. This is functional regression coverage, not a guarantee that every code path is defect-free.
