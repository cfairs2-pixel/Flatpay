# myflatpay

A local, single-user myflatpay sales tracker for a Flatpay field salesperson. React/Vite frontend; Node HTTP API; SQLite persistence. Requires Node **24+** (the prepared cloud runtime is 24.19.0).

## Run

```sh
cd /workspace/Flatpay
npm ci
npm run dev
```

The server uses port 3000 and binds to loopback by default. Development runs the React frontend and API in the same process. For production assets, run `npm run build` followed by `npm start`.

This is a local workspace, with no authentication or multi-user isolation. Do not expose it publicly with customer data. A shared deployment needs authentication, access controls, a protected persistent database and appropriate backups. `HOST`, `PORT`, `DATA_DIR` and a comma-separated `ALLOWED_HOSTS` are optional deployment settings. Do not change these merely to make a public preview.

## Use

- The app opens your saved customers or an empty workspace. There is no demo mode or fictional customer data. Use New customer on a phone for quick entry; additional contact and meeting details are optional and collapsed.
- Merchant details include business/contact, meeting date, provider, status and next steps.
- Statement inputs use **one month and the same period**. Total transaction value and charges include Amex. The current effective rate is charges / transaction value × 100. Business, international and Amex shares use transaction **value**, not counts, and can overlap.
- Record each AC as a separate offer with rates, approving manager, date, link, hardware quantities and notes. Selecting an offer controls the displayed proposed rate. Preserve earlier offers when adding revisions.
- POS Premium and POS Pro bundles include a terminal. “Terminal only” records additional standalone terminals. Additional hardware quantities/price agreements can be recorded as text.
- Savings are **processing-only estimates** using the proposed non-Amex and Amex rates. They exclude rentals, hardware, extra fees and surcharge effects. Missing Amex pricing leaves the estimate incomplete.
- Changing status to **Won** opens sale details. Save the signature date, contract details and checklist progress. A win with incomplete checks is marked awaiting completion. Recording a win does not submit it to Flatpay or mark KYC as approved.
- Store supporting contracts, identity, address and bank documents in the authorised Flatpay systems. This app records completion and references only.
- Export downloads a JSON copy of the currently displayed workspace. Keep backups secure. The database is `.data/flatpay.sqlite` by default and is ignored by Git. A proper database backup must include SQLite WAL consistency (stop the app before copying its data directory).

## Commission

The app incorporates the authenticated [official SM commission calculator](https://sm-commission.pages.dev/SM_4_Calculator) and its introduction/rules pages, retrieved on **27 October 2026**. The source labels itself **DRAFT v2 · May 2026**; it is an estimate under that published draft, not a guarantee of payroll or automatic synchronisation with later policy changes. No password, session cookie or raw authenticated page is stored in this repository.

The monthly calculator reproduces the executable calculator's matrix, interpolation, whole-pound rounding, product floors, upfront thresholds, POS volume ladder, bonuses, target-hit adjustment and **£2,120 gross monthly minimum guarantee**. Reference presets are On Budget **£8,117**, High Performer **£10,622** and Low Performer **£4,204**. Inputs are installed merchant deals and average declared **annual** TPV, not hardware unit counts. One merchant with several terminals or POS units still counts once, under the selected commission product. MPOS has its own upfront model and no POS volume ladder.

Per-merchant matrix estimates use the selected offer's rate, the declared annual TPV and the commission product. These estimates remain separate from manually confirmed commission. Monthly confirmed totals are commission recorded on sales won in the selected month; they are not an earned-month payroll ledger. The monthly scenario is a planning model using average inputs, so it need not equal a sum of individual deals with different rates or volumes.

Rules reflected in the source:

- **Activation:** from **1 July 2026**, merchants not already installed under the old rule activate after processing **0.5% of declared annual TPV**. Merchants already activated before that date retain the old rule. The older training's flat £125 threshold is superseded for current merchants; the newer source calls the old threshold £123.
- **Matrix payment:** 50% at activation; the other 50% when the declared monthly target (annual TPV ÷ 12) is reached across 30 consecutive days, within six months of installation. Each half is paid in the following month.
- **Rate floors:** Terminal 0.49%; POS and MPOS 0.89%. Below-floor matrix commission is zero; approval does not create matrix entitlement.
- **Upfront:** POS Premium/Pro pay 15% at £500 or above; MPOS pays 15% at £250 or above. Below the respective threshold, the executable calculator applies **−£100 per deal**. Upfront bonus payment requires the invoice to be settled in full.
- **POS volume:** 2–10 installs pay £200, £350, £600, £1,000, £1,500, £2,200, £2,800, £3,300 and £3,800; each above ten adds £300. Zero or one pays no ladder bonus; MPOS does not contribute.
- **Other bonuses:** own-generated sale £50; quick installation £50 within five days of receiving the link; IH quick sale £30 within 24 hours. Amex pays £40 at 3.89%, £20 at 2.99%, £10 at 2.49% and £0 at 1.99%, after £123 Amex TPV in the first month the merchant actually takes Amex. Amex rate reduction/removal reverses that bonus.
- **Clawbacks:** cancellation within six months, or very low usage across the first three months (subject to the seasonal exception), can reverse previously paid commission. TPV declarations are also subject to review. Scenario estimates do not automatically reconcile payroll, deductions or clawbacks.

The executable calculator deliberately governs numerical parity: its TPV lookup clamps at **£48,000–£500,000** and rounds the interpolated result to whole pounds per merchant. The introduction's larger illustrative matrix extends to £700,000 and shows marginal increments beyond that; those extrapolations are not implemented by the live calculator. Its half-payment examples may also round differently from a mathematically exact 50/50 split. Do not silently extend the executable model or infer extra entitlement from those presentation differences.

See [sales process source notes](docs/sales-process.md) for the document-based workflow, source conflicts and current commission rules.

## Validate

```sh
npm test
npm run build
npm run test:e2e
```

Unit tests cover effective rates, overlapping card categories, multi-offer calculations, commission rules, calculator reference scenarios and invalid data. API tests exercise SQLite persistence after restart, CRUD, export and validation. Browser tests use an isolated SQLite test directory and system Chromium (`/usr/bin/chromium`) to exercise the application. The managed tool sandbox may require elevated execution for local socket/browser operations.

## Cloud environment

Use the existing checkout at `/workspace/Flatpay`. Each cloud task is already isolated; do not create a Git worktree unless the user explicitly requests one. Dependencies and built assets can be retained in the published snapshot, but the server process must restart in each new task. Install/start instructions are saved in the environment draft; saving that draft does not publish or apply it.

## myflatpay sales tools

The workspace uses Flatpay black, white, pale pink and mint styling from the supplied training and product materials. Its personal app name is **myflatpay**.

- **Meeting notes:** choose a merchant in the Meeting notes page, add dated notes, agreed actions and a next follow-up date, then save the merchant. Notes are stored in the same SQLite record and survive restarts.
- **AC details:** each offer records declared annual TPV, current base rate, proposed base rate, business/international processing uplifts (percentage points), and the recorded share of turnover subject to surcharges, plus separate business and international card-value shares. Blank figures remain unconfirmed. These fields do not change the existing processing-only savings formula.
- **Bundle deals:** enable a bundle on an AC and record every business, including the main merchant, separately. Each row retains its own annual TPV, current/offered base rates, card processing uplifts and separate card/surcharge shares. Totals are summed TPV and TPV-weighted base rates; card shares are never added together. A bundle does not automatically create merchant records or multiply commission/install counts. Record each commission-eligible merchant separately using the existing commission workflow.
- **Offer sheets:** select an AC in the merchant's Offer sheet tab, add a personal message, terms, expiry and contact details. Open the printable customer proposal in a new tab, then choose **Print / save PDF**. It includes customer pricing and hardware; internal meeting notes, approval references and commission are excluded. Save the merchant to retain offer-sheet settings. Sheets use the current AC data when generated, so exported PDFs are the historical customer copy. All-in savings are not calculated from overlapping card shares.
- **Closing deals:** record the objection, concession, genuine expiry and manager approval. Creating a closing AC makes a new offer revision and preserves the original. The closing base rate applies to every business in a bundle; blank uplift fields retain the existing per-business uplifts. Review the terms before recording approval. The new AC still needs the merchant to be saved. The tool does not sign a contract or send anything to a customer.

## Sales assistant

The assistant works immediately in **local mode**, using deterministic sales/commission calculations and guided note/follow-up drafts. It tracks manually verified commission separately from estimated milestone payouts, targets, sales pace and outstanding follow-ups. Select a merchant before adding a proposed draft to its notes. Drafts require a button click to save; the app never sends messages to customers.

For conversational AI, configure `OPENAI_API_KEY` in the **server environment**, optionally set `OPENAI_MODEL` (default `gpt-6.1-sol`), and restart the server. No key is included in this app or browser code. Configured mode is shown in the UI; provider failures fall back to local calculations with a visible message. Live AI has not been verified without a configured credential.

AI requests send the selected merchant's relevant sales data, notes, offer details, workspace summaries and remembered preferences to the OpenAI API. Chat history, explicit preferences and recurring monthly targets are stored locally in SQLite. The assistant improves its context through records, chat history and preferences you choose to remember; it does **not** retrain a model. Review and remove preferences or clear chat in assistant settings. The assistant uses your saved workspace; client-supplied sample/demo records are rejected. The JSON merchant export contains merchant notes and offers; assistant memory/settings are included only in a full consistent database backup.

## Hosted myflatpay app

The existing GitHub Pages sales tracker is hosted at https://cfairs2-pixel.github.io/Flatpay/ and is separate from Flatpay Canvass. `npm run build:pages` creates a self-contained deployment in `work/pages-site/`. This edition keeps the existing `flatpay.sales-workspace.v1` browser-storage key so upgrading preserves saved merchants in the same browser. Notes, offers and local assistant settings persist there; use Export for regular merchant backups. The Pages edition uses local analytical/drafting tools. The Node server edition supports optional conversational AI with a server-side key.

## Account server and deployment

`npm run build:cloud` and `npm run start:cloud` run the shared account edition using `server-cloud.mjs`. The local single-user edition and GitHub Pages edition remain available separately. The account edition has invitation signup, secure server sessions, separate customer records and assistant memory per salesperson, and an owner team summary. Login on another device loads the same account records from the server.

Deploy the Dockerfile using a host such as Railway with a **persistent volume mounted at `/data`**; running an ephemeral container alone is insufficient for retained data. Set `PUBLIC_ORIGIN` to the exact HTTPS app URL, `SETUP_TOKEN` to a generated secret of at least32 characters, and `OPENAI_API_KEY` in the host's secret settings to enable advanced AI. Optional `OPENAI_MODEL` defaults to `gpt-6.1-sol`. Keep `COOKIE_SECURE=true` for HTTPS deployment. `COOKIE_SECURE=false` is only for loopback development. The setup token is used once to create the first owner; later accounts require owner-created, email-bound invitations. No customer accounts or credentials are created by the build.

The account database, uploaded head-office originals, content revisions, feature state and audit entries are stored under `/data/myflatpay.sqlite`; per-account assistant databases are under `/data/assistant/`. Configure the hosting provider's consistent volume backups before production use. Customer JSON exports cover merchant records; they do not replace backups of account databases and uploaded originals.

To migrate browser-saved customers, use Export in the existing Pages app, then sign in to the account edition and choose Import a browser backup. Import deduplicates prior source IDs for that account and keeps the browser copy intact. Data is never imported into another account automatically.

### Head-office updates and feature coding

Owners can upload TXT, Markdown, CSV, JSON, PDF and DOCX documents up to5MiB. PDF/DOCX text is extracted server-side where readable; scanned/unreadable files require a reviewed text extract. Documents start as drafts. Approval makes the current version available to the team and the advanced assistant, with title/version source citations. An uploaded document cannot silently change commission formulas or pricing rules; those need a reviewed code change.

The owner Feature studio edits HTML, CSS and JavaScript for custom tools, with draft preview and explicit publishing. Published tools are available to salespeople. Tools execute in an opaque sandbox iframe, have per-account saved state, and receive aggregate sales context only after opt-in. They cannot modify the app server or core source code. Core application changes still use the repository deployment workflow.

### Condukt website handoff

The supplied training refers to Condukt at https://condukt.co/. With the user's website-only access, the app supports a reviewed manual handoff: open Condukt, paste labelled details or a myflatpay interchange JSON file, select the customer/fields, then save. It records per-person document requirements and distinguishes required/rejected, submitted, approved and unknown. Last-checked timestamps identify snapshots; the app does not log in to Condukt or make live status checks. Submitted documents are not marked approved and the sale checklist is never completed automatically.

Approved API documentation at https://portal.condukt.co/docs and organisation-authorised API credentials would be needed for future live sync. Website passwords, identity scans and bank evidence are not collected by this handoff.

## Phone capture and quick entry

The phone interface has a persistent New customer action, customer cards, larger controls, bottom navigation and a sticky Save customer footer. The first customer screen contains business name, contact and current provider. Contact details and next steps expand when needed; AC, sale and commission details remain available in the editor tabs.

Scan documents supports camera capture and photo upload for passports, driving licences and bank statements. Tesseract.js runs on the device using worker, WebAssembly and English-language assets served from the app's own origin. No API key or AI service is required. The first scan downloads the reader/language assets; the language model is cached by the browser for later scans. PDF files should be photographed or converted to an image for this camera flow.

Passport/UK-licence names, licence home addresses and clearly labelled bank account-holder/business details become editable suggestions. You review and select fields before applying them. Existing values are not replaced by default. Personal correspondence addresses are kept separate from business/installation addresses. OCR can misread photos; use the recognised-text correction or manual fields where details are uncertain.

Document photos and recognised text stay in the scanner's transient memory, then clear when you leave/apply. Only the selected name/address fields become part of the customer draft. Passport/licence numbers, dates of birth, bank account numbers, sort codes and transaction data are not stored by this flow. Scanning does not verify identity, signing authority or document approval. Original evidence still belongs in the authorised onboarding system.

`node scripts/prepare-ocr.mjs` prepares generated OCR assets from locked npm packages under public/ocr. Normal builds and the dev command run this automatically. Include the generated OCR directory when deploying the Pages artifact; it is copied into work/pages-site/ocr by build:pages.
