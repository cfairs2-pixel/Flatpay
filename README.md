# myflatpay phone app

Your existing sales workspace, adapted for installation on **iPhone and Android**, with **Supabase email/password login**, a shared cloud database, and backup/import tools. Sign into the same account on either phone to use the same customers, notes, offers, commission records and assistant settings.

The app is prepared for setup. Its public connection settings point to your Supabase project. **The database migration has not been applied, and the app has not been published.** Follow [INSTALL.md](INSTALL.md) to finish setup and publish the app.

## Set it up

1. Create a Supabase project and run [the database migration](supabase/migrations/202610300001_flatpay.sql) once in its SQL Editor.
2. Copy the project's URL and **public publishable key** (or legacy **anon** key) into [public/config.js](public/config.js). Never use a service role key, secret key or database password in the app.
3. Set Supabase Auth's Site URL and redirect allowlist to the exact address where the app will be hosted, including a repository subpath such as `/Flatpay/` when applicable.
4. Install Node.js 24+, then run:

   ```sh
   npm ci
   npm test
   npm run check
   npm run build
   ```

5. Publish the contents of `dist/` to an HTTPS static host. The included [GitHub Pages workflow](.github/workflows/deploy-pages.yml) deploys only when you explicitly run it from GitHub's Actions tab.

GitHub Pages hosts the app files; Supabase provides authentication and the database. You do not need a separate application server. Full setup, email confirmation, password reset and hosting instructions are in [INSTALL.md](INSTALL.md).

## Install on your phone

After hosting:

- **iPhone:** open the app address in Safari, tap **Share → Add to Home Screen**, and enable **Open as Web App** if offered.
- **Android:** open it in Chrome and choose **Install app** or **Add to Home screen** from the menu.
- Create an account, confirm the email when requested, and sign into that same account on each device.

This is an installable web app. A signed App Store or Google Play binary is not included. Internet access is required to load and save records; the offline page offers a way to reconnect.

## Bring over existing records

The uploaded ZIP contains the app, **not the customer records stored in your old browser**.

1. Open your old app in the browser where you entered the records.
2. Use **Export** to download its JSON backup.
3. Open the new app, sign in, then open **Account & backups**.
4. Choose the JSON file, review it, and confirm the replacement.

Import replaces the current account's customers and creates a recovery point first. A legacy customers-only backup preserves the account's current assistant settings. A full new backup also restores assistant messages, preferences and targets.

## Saving and backups

Records are stored in Supabase with row-level policies that isolate each signed-in user's data. This version provides personal accounts, rather than a shared team workspace. Customer revisions prevent an older edit on one device from silently overwriting a newer save on another. When a conflict appears, copy your unsaved edits, close the editor, refresh, and reopen the customer.

The app creates recovery points before the first change of a UTC day, before deletes and restores, and when you choose **Create recovery point**. It retains the latest **60 recovery points per account**. These copies live in the same Supabase database: they are useful for undoing mistakes but do not protect against losing that database.

Use **Account & backups → Download full backup** regularly and keep a copy outside Supabase. Supabase-managed backups, their retention and point-in-time recovery depend on your selected plan and settings. Verify them in your dashboard; this project does not enable an offsite backup service automatically.

## Email and account access

Supabase handles sign-in, email confirmation and password reset. The app uses a 12-character minimum for new passwords. Supabase email delivery settings and limits apply; configure a suitable SMTP provider before relying on account emails in normal use.

Confirmation and password reset use PKCE. Open the email link in the **same browser and device** that requested it. A home-screen app and the ordinary browser may use separate browser storage; request and complete a reset in the ordinary browser, then sign into the home-screen app with the new password.

## Existing sales tools

The sales pipeline, meeting notes, offers, PDF statement reader, local OCR, commission calculations and deterministic assistant are retained from your upload. No paid AI API is configured. Documents continue to be processed in the browser. This app does not submit records to Flatpay systems or verify official commission rates.

The upload was a compiled React export. `public/workspace.js` preserves it with the integration changes. The new Supabase connection, account interface, migration and build files are editable source. Third-party reader and OCR notices remain under `public/statement-reader/` and `public/ocr/`.

## Project files

| File or folder | Purpose |
| --- | --- |
| `public/config.js` | Public Supabase connection settings |
| `public/cloud-client.js` | Account, installation and backup interface |
| `public/cloud-api.mjs` | Supabase adapter for the existing workspace |
| `supabase/migrations/` | Database schema, row-level policies and transactional API |
| `public/manifest.webmanifest` | Home-screen installation metadata |
| `public/service-worker.js` | Generic assets and offline page; no customer API cache |
| `scripts/build.mjs` | Bundles the official Supabase client and creates `dist/` |
| `.github/workflows/deploy-pages.yml` | Manually triggered Pages deployment |
