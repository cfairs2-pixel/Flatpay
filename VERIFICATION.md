# Verification

The app is live at https://cfairs2-pixel.github.io/Flatpay/.

Current build: `697dc948a22e8d27`. Static release: `23bcd3f72684b8da08511fb8493da0585bd45f8e` on `gh-pages`. Editable source remains in the source PR.

## Current checks

- All 118 regression tests pass. Coverage includes account isolation and grants, stale revisions, atomic backup restore, fee metadata, annual parsing, 38 OCR-position cases, cache/startup failures, rate readiness and versioned module updates.
- Real file-upload browser checks use the packaged OCR worker, WASM core and English model on flat, perspective-skewed and stacked synthetic annual summaries. They exercise upload through displayed totals, explicit replacement of existing figures, saved fee review and repeat application without double counting.
- A phone-sized rate check verifies the statement rate before any fee answer or period confirmation. Added or cleared fees affect only the separately adjusted rate. Saved reopening, true zero charges, zero turnover and missing-input explanations pass. The fee panel fits a 390-pixel viewport.
- Statement rates use the raw statement totals rather than rounded monthly figures. Fee answers alone do not imply a completed calculation when period, turnover or charges are missing. The adjusted-rate/apply safeguards remain in place.
- Production syntax and build checks pass. The complete generated module graph carries the same content-derived build ID. Account & backups shows it; an open app can offer an explicit save-then-reload update without forced reloads, sign-out or data clearing.
- Seven current hosted artifacts, including HTML, version manifest, workspace, fee calculator/style, cloud client and domain module, returned HTTP 200 and matched the validated build byte for byte.
- Earlier read-only live Supabase checks confirmed all four application tables and the workspace RPC exist and reject anonymous access with HTTP 401. Email authentication and email confirmation are enabled.
- Service-worker checks cover project scope, API/auth bypass, optional-storage failures, offline fallback and logout cache clearing. Customer API responses and documents are not cached by it.

## Limits

The original inline photo was reviewed visually but was not available as a local image file. Its exact failing recognised text was requested. Synthetic OCR fixtures reproduce and validate the column-association defect; they do not establish that every digit in the original photograph was recognised correctly. No customer photograph or actual statement amounts are published in the regression fixtures.

No live customer records or accounts were created or changed during these checks. Authenticated live account operations, email delivery and physical iPhone/Android installation remain user acceptance checks. The exact production URL must be allowed in Supabase Auth configuration. Provider backup retention and SMTP configuration remain project-owner settings.

Direct Chromium HTTPS navigation is limited by the execution environment's proxy certificate trust. Live rendering checks used the real hosted assets through the configured trusted HTTPS transport, with TLS verification enabled. Physical-device service-worker registration was not verified.

Keep downloaded full backups outside the database. The app's 60 recovery points are in the same Supabase database and do not replace independent disaster backups.
