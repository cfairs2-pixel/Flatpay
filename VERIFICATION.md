# Verification and remaining setup

Checked on 30 October 2026.

- Nine PostgreSQL tests passed using PGlite, applying the actual migration. They cover authenticated access, row-level isolation, denied direct writes/helper access, stale customer and assistant revisions, transactional recovery and restore, malformed imports, legacy meeting notes, and the 10 MB quota/export boundary.
- Browser checks passed in two separate phone-sized Chromium contexts using the official Supabase browser SDK, simulated Supabase HTTP endpoints and the actual PostgreSQL migration. They cover sign-up, customer creation, shared records, the mobile account button, recovery points, backup download/preview/restore, and retaining unsaved edits after session expiry. This fixture did not write test records to your live project.
- Service-worker checks passed at the site root and under `/Flatpay/`: API/auth bypass, no cached customer records, offline fallback, scoped assets and logout cache clearing.
- Application syntax, installation paths and the static production build passed.
- A read-only request to your live Supabase project confirmed that the public key is accepted and email sign-up/confirmation is enabled. The project's API reported that `public.flatpay_deals` is absent.

The migration has **not** been applied to the live project. No live user accounts or customer records were created. Email delivery, physical iPhone/Android installation and live hosting remain unverified. Supabase-managed backup retention and any SMTP provider remain settings for the project owner to confirm.

To complete: run the included migration in Supabase or connect the Supabase app so it can be applied; configure the hosted app URL in Supabase Auth; publish `dist/`; then sign up, confirm the email and install from Safari/Chrome.
