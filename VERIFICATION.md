# Verification and remaining setup

Checked on 30 October 2026.

- Nine PostgreSQL tests passed using PGlite, applying the actual migration. They cover authenticated access, row-level isolation, denied direct writes/helper access, stale customer and assistant revisions, transactional recovery and restore, malformed imports, legacy meeting notes, and the 10 MB quota/export boundary.
- Browser checks passed in two separate phone-sized Chromium contexts using the official Supabase browser SDK, simulated Supabase HTTP endpoints and the actual PostgreSQL migration. They cover sign-up, customer creation, shared records, the mobile account button, recovery points, backup download/preview/restore, and retaining unsaved edits after session expiry. This fixture did not write test records to your live project.
- Service-worker checks passed at the site root and under `/Flatpay/`: API/auth bypass, no cached customer records, offline fallback, scoped assets and logout cache clearing.
- Application syntax, installation paths and the static production build passed.
- Read-only checks against the live Supabase project confirmed that the configured public key is accepted and email sign-up/confirmation is enabled. All four application tables (`flatpay_accounts`, `flatpay_deals`, `flatpay_assistant` and `flatpay_backups`) are now present and reject anonymous requests with HTTP 401. The `flatpay_workspace` RPC is present and rejects an anonymous call with HTTP 401.
- The live app at `https://cfairs2-pixel.github.io/Flatpay/` serves the new version. Ten representative hosted files returned HTTP 200 with the expected MIME types and SHA-256 fingerprints identical to the validated production build, including the HTML, workspace, Supabase adapter/client configuration, service worker, install manifest, SDK and app icons.
- The live page's sign-in and password-reset request screens render at a 390-pixel phone viewport without horizontal overflow. Manifest scope and icon URLs resolve under `/Flatpay/`. This browser check fetched the real live resources through the environment's trusted HTTPS transport; it created no accounts and sent no emails.

The live database migration is now confirmed present. No live user accounts or customer records were created by these checks. Authenticated live sign-up/sign-in, live record operations, actual email delivery and installation on physical iPhone/Android devices remain unverified. Supabase-managed backup retention and any SMTP provider remain settings for the project owner to confirm.

The static release is on `gh-pages` at commit `b295d18959bc0a2e87ee6c03e201c142f310a591`, and the live hosted files have been verified. Its existing **Publish myflatpay** workflow remains the publishing route; editable source remains in its source PR. Direct Chromium HTTPS navigation is limited by the execution environment's proxy certificate trust, so live service-worker registration and physical phone installation were not verified. TLS remained enabled for all HTTP verification.

To complete account setup: verify `https://cfairs2-pixel.github.io/Flatpay/` in Supabase Auth's Site URL and redirect allowlist, then sign up, confirm the email and install from Safari/Chrome. Keep a downloaded full backup outside the database.

## Statement reader and separate-fee update

- All 64 regression tests pass: OCR startup failure/timeout cleanup, optional cache failures, annual-summary parsing, fee calculation and review validation, existing database security, and save/export/restore of fee metadata.
- A phone-sized Chromium check runs the actual packaged OCR worker, WASM core and English model against a synthetic annual-summary image. It reproduces OCR replacing a thousands comma with a dot; the parser recovers the unambiguous value and shows a review warning. Startup phases, annual totals and monthly averages pass.
- The rendered phone review passes terminal/PCI inclusion prompts, monthly/annual normalization, applying adjusted costs, reopening saved answers, and repeated application without double counting. The fee panel fits a 390-pixel viewport.
- PostgreSQL round-trip testing confirms the existing schema preserves `statementAnalysis.feeReview` and the unadjusted statement totals. No database migration is needed for the added optional metadata.
- The example photo was reviewed visually and its labels tested as text. End-to-end image OCR used a synthetic document with the annual-summary layout, not the original attached photo. No customer statement image or real statement amounts are included in the public regression fixtures.

The reader and fee-review release is live: the HTML, workspace, domain validation, annual-summary parser, fee module, fee stylesheet and service worker each return HTTP 200 and match the production build byte for byte.
