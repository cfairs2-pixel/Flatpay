# Verification

The app is live at https://cfairs2-pixel.github.io/Flatpay/.

Current published build: `bc0a646d3de7d55b`. Static release: `df4da6c0687729ff73a1827df96c2c4708744d5d` on `gh-pages`. Editable source remains in the source PR.

## Current checks

- All 123 regression tests pass. Coverage includes account isolation and grants, stale revisions, atomic backup restore, fee metadata, annual parsing, 43 OCR-position cases, cache/startup failures, rate readiness and versioned module updates.
- An actual synthetic PNG upload without pound glyphs on its totals reproduces the previous layout check dropping both figures. With an explicit GBP cue elsewhere, the corrected reader retains turnover 123,456.78, charges 1,234.56 and a 12-month period, shows a 1.00% statement rate, then a 1.24% adjusted rate after separate monthly rental of 20 and annual PCI of 60. Applying and reopening retains the original totals and the fee review. This exercises the packaged OCR engine and phone-sized review screen, not just a parser mock.
- Real file-upload browser checks use the packaged OCR worker, WASM core and English model on flat, perspective-skewed and stacked synthetic annual summaries. They exercise upload through displayed totals, explicit replacement of existing figures, saved fee review and repeat application without double counting.
- A phone-sized rate check verifies the statement rate before any fee answer or period confirmation. Added or cleared fees affect only the separately adjusted rate. Saved reopening, true zero charges, zero turnover and missing-input explanations pass. The fee panel fits a 390-pixel viewport.
- Statement rates use the raw statement totals rather than rounded monthly figures. Fee answers alone do not imply a completed calculation when period, turnover or charges are missing. The adjusted-rate/apply safeguards remain in place.
- Production syntax and build checks pass. The complete generated module graph carries the same content-derived build ID. Account & backups shows it; an open app can offer an explicit save-then-reload update without forced reloads, sign-out or data clearing.
- Eight current hosted artifacts (HTML, version manifest, workspace, layout, summary, fees, cloud client and domain module) returned HTTP 200 and matched the validated output byte for byte.
- Earlier read-only live Supabase checks confirmed all four application tables and the workspace RPC exist and reject anonymous access with HTTP 401. Email authentication and email confirmation are enabled.
- Service-worker checks cover project scope, API/auth bypass, optional-storage failures, offline fallback and logout cache clearing. Customer API responses and documents are not cached by it.

## Limits

The original inline photo was reviewed visually but was not available as a local image file. Its exact failing recognised text was requested. Synthetic OCR fixtures reproduce and validate the column-association defect; they do not establish that every digit in the original photograph was recognised correctly. No customer photograph or actual statement amounts are published in the regression fixtures.

No live customer records or accounts were created or changed during these checks. Authenticated live account operations, email delivery and physical iPhone/Android installation remain user acceptance checks. The exact production URL must be allowed in Supabase Auth configuration. Provider backup retention and SMTP configuration remain project-owner settings.

Direct Chromium HTTPS navigation is limited by the execution environment's proxy certificate trust. Live rendering checks used the real hosted assets through the configured trusted HTTPS transport, with TLS verification enabled. Physical-device service-worker registration was not verified.

Keep downloaded full backups outside the database. The app's 60 recovery points are in the same Supabase database and do not replace independent disaster backups.
