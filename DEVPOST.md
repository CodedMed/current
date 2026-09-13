# current.surf

**A cash-flow copilot that reads invoices locally, forecasts cash gaps, and turns financial data into actionable advice.**

## Inspiration

A bank balance shows what a business has today. It does not show whether that balance will cover payroll before a customer pays, whether a vendor's latest invoice is unusual, or which obligation needs attention first.

Answering those questions means connecting bank activity, invoices, and upcoming payments. Adding AI introduces another concern: sensitive details in financial documents can end up in a cloud model.

We built current.surf around a simple idea: process raw invoices locally, calculate financial facts in code, and give the advisor a controlled summary it can explain.

## What it does

current.surf brings onboarding, banking data, invoice review, forecasting, and an AI advisor into one workspace.

- **Verifies users:** Google sign-in and Persona identity verification lead into business setup.
- **Organizes cash flow:** Nessie banking data feeds account balances, transaction history, spending breakdowns, and scenario forecasts.
- **Reads invoices locally:** Owners upload a PDF or image, and local AI extracts structured invoice fields without sending the source document to a hosted model.
- **Flags unusual invoices:** Rules and machine learning check for duplicate charges, changed payment details, unusual amounts, and irregular billing patterns.
- **Identifies cash gaps:** The Copilot forecast calculates when outstanding obligations could push available cash below zero.
- **Explains the numbers:** Owners can ask questions through text or voice and receive advice grounded in current ledger context.
- **Turns recommendations into tasks:** The owner reviews a proposed action before adding it to the task list.

For example, a business can have $8,000 available, owe $10,000 on Friday, and expect $5,000 on Monday. The forecast identifies Friday's $2,000 shortage even though Monday's receipt restores a positive balance.

## How we built it

### 1. Frontend and orchestration

The frontend uses **React, TypeScript, Vite, and Tailwind CSS**. It connects to an **Express API running on Node.js**, which manages sessions, Google OAuth, Persona verification, and backend requests. Internal service calls use a shared authentication token, and ledger requests carry the authenticated user's subject.

### 2. Financial ingestion and storage

Nessie bank snapshots flow into a **Java Spring Boot ledger service**. The service normalizes money movements and obligations into cash events and persists account balances, invoices, risk results, and tasks in **PostgreSQL**.

The database layer supports **Tiger Data's hosted PostgreSQL with TimescaleDB**, as well as local TimescaleDB or plain PostgreSQL. TimescaleDB adds time-series features for financial history, including time partitioning and daily aggregates. Flyway manages ledger schema migrations.

The workspace also has a TypeScript analytics path for charts, spending insights, and scenario forecasts. Bank snapshots feed both that path and the Java ledger.

### 3. Local AI for invoice privacy

Invoice uploads pass through **Python FastAPI**. PDF parsing and **Tesseract OCR** extract the text, then a local **Ollama** model converts it into structured invoice fields. **Pydantic** validates those fields before Java saves the invoice and its corresponding cash obligation.

We use local extraction to avoid sending private details in raw invoices to cloud models. Documents and OCR text stay within the configured processing environment, and temporary files are deleted after processing. Payment-destination identifiers are fingerprinted locally for comparison.

The hosted advisor receives an allowlisted financial summary alongside the user's question and recent conversation turns. Local processing refers to the backend environment; Gemini and ElevenLabs remain hosted services.

### 4. Forecasting and machine learning

Java calculates the Copilot's cash-flow projections using **BigDecimal** arithmetic. It starts from stored bank balances, applies outstanding cash events chronologically, and records the first projected shortage.

Python evaluates invoices using deterministic rules and **Isolation Forest**, an unsupervised machine-learning model for anomaly detection. When a vendor has at least ten historical invoices and the ML dependencies are installed, the combined risk score uses **60% rules and 40% anomaly percentile**. With less history, rules provide the score. The result indicates unusualness, not proof of fraud.

### 5. Advice, voice, and approval

For each advisor request, Express retrieves fresh, allowlisted context from the Java ledger. Python passes it to **Gemini**, requests a structured response, and validates the returned schema before displaying the answer and recommendations.

**ElevenLabs** supplies the voice conversation. Spoken financial questions route through the same ledger-context and advisor pipeline used by text chat.

Recommendations become persisted tasks after the owner selects **Add to tasks**. Task approval does not execute a bank payment.

### Pipeline at a glance

```text
React interface → Express API → Identity verification
                         ↓
          Nessie banking data + invoice uploads
                         ↓
        Local invoice extraction: OCR → Ollama → validation
                         ↓
          Java ledger → PostgreSQL / TimescaleDB
                         ↓
         Cash-flow forecasts + Python invoice checks
                         ↓
           Allowlisted financial context → Gemini
                         ↓
             Text or ElevenLabs voice response
                         ↓
                 Owner-approved tasks
```

The extraction step applies to documents; bank snapshots enter the ledger through their own normalization path. Express coordinates the service calls throughout the pipeline.

## Challenges we ran into

**Keeping calculations and generated explanations separate.** The financial service calculates balances and cash gaps before the advisor sees them. Gemini receives those facts as context, and its output is validated for structure. Schema validation alone does not verify every generated statement.

**Keeping document processing private while still using hosted reasoning.** We separated local extraction from hosted advice so the model interpreting a raw invoice runs locally, while Gemini receives a selected financial summary.

**Coordinating state across services.** Express mirrors identity decisions and pushes bank snapshots into Java. The same snapshot feeds the workspace, although its scenario forecasts and the Copilot's obligation-based forecast use different assumptions.

**Handling partial failures clearly.** An invoice may save successfully even if risk scoring or forecast refresh fails afterward. The upload flow preserves that successful save and returns a warning so the owner can retry the remaining step.

## Accomplishments that we're proud of

- Connecting verification, banking data, invoice ingestion, forecasting, advice, and task creation in one workflow.
- Building local document extraction into the architecture, with explicit boundaries around what reaches hosted AI.
- Combining understandable invoice rules with vendor-specific machine-learning anomaly detection.
- Reusing one advisor pipeline for both text and voice.
- Making the demo usable through sandbox adapters while retaining integration paths for configured services.

## What we learned

Useful financial AI depends on the data pipeline around the model: normalized records, accurate calculations, current context, and clear controls over actions.

We also learned that privacy needs to be designed into data movement. Processing a document locally and deciding which fields may leave that environment are separate responsibilities.

Finally, a coherent demo requires careful handling of service boundaries. Saved data, stale snapshots, and unavailable integrations need explicit behavior that the user can understand.

## What's next for current.surf

- Bring dashboard and Copilot projections into closer alignment, with clearer explanations of each forecast's assumptions.
- Add a review-and-correct step for extracted invoice fields before committing an obligation.
- Evaluate extraction and anomaly detection against a broader, labeled invoice dataset.
- Add background synchronization and notifications for upcoming cash gaps and invoice reviews.
- Harden deployment with stronger service authentication and network isolation.

## Built with

React, TypeScript, Vite, Tailwind CSS, Node.js, Express, Java, Spring Boot, Python, FastAPI, Pydantic, PostgreSQL, TimescaleDB, Tiger Data integration support, Flyway, Ollama, Tesseract OCR, scikit-learn, Isolation Forest, Google OAuth, Persona, Nessie, Gemini, ElevenLabs, Docker.

## Demo notes

Integrations use sandbox or mock implementations when the relevant configuration is absent. Actual local document extraction requires Ollama; without it, the app returns labeled sample invoice values. Hosted advice and voice require their corresponding credentials. Financing offers and applications are illustrative and are not submitted to lenders.

Local setup instructions are in the [project README](README.md). The [hackathon README](README.hackathon.md) includes the architecture diagram and a presentation script.
