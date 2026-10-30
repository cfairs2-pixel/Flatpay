# Connect Supabase and install myflatpay

You need a Supabase account, a project for this app, and an HTTPS static host. GitHub Pages is one hosting option. This guide does not create a paid service or publish the app automatically.

## 1. Create the Supabase project

1. Sign into [Supabase](https://supabase.com/dashboard) and create a project in your chosen organisation and region.
2. Keep its database password in your password manager. It does **not** go into this app.
3. Wait for the database to finish starting.
4. Open **SQL Editor**, create a query, and paste the complete contents of:

   ```text
   supabase/migrations/202610300001_flatpay.sql
   ```

5. Run the query once. It creates the `flatpay_accounts`, `flatpay_deals`, `flatpay_assistant` and `flatpay_backups` tables, row-level policies, validation helpers and the `flatpay_workspace` RPC.

Use a fresh project or review an existing project's schema first. This initial migration creates named objects and is intended to run once, rather than being pasted again after each frontend update. Keep the migration file with the source for future database changes. Do not remove the row-level policies or grant anonymous writes to make the app work.

The public schema must remain available through the Supabase Data API, as it is in a new project's default configuration. App operations use the signed-in user's identity. The browser receives no administrator credential.

## 2. Add the public connection settings

In the Supabase dashboard, find your **Project URL** and **publishable key** under the project's connection/API settings. A legacy **anon** key is also supported.

Edit `public/config.js`:

```js
export const config = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabasePublishableKey: 'YOUR-PUBLIC-PUBLISHABLE-KEY',
};
```

These values are included in browser files and may be committed with the app. **Never paste an `sb_secret_...` key, a `service_role` key, a database password, or an account access token here.** A public key identifies the project; signed-in identity and the included database policies control access.

If an administrator credential has already been published, remove it and rotate it in Supabase before continuing. Changing only the frontend file does not invalidate a leaked credential.

## 3. Configure email authentication and redirects

Enable the **Email** provider in **Authentication → Sign In / Providers**. Choose whether new signups require email confirmation. The app supports confirmation being enabled and shows the next step after signup. Set Supabase's minimum password length to 12 to match the app's new-password form.

In **Authentication → URL Configuration**, set both **Site URL** and an entry in **Redirect URLs** to the exact deployed app URL, including its trailing slash and repository path.

| Hosting example | Site URL and redirect entry |
| --- | --- |
| Site at a domain root | `https://app.example.com/` |
| GitHub project Pages | `https://YOUR-GITHUB-USER.github.io/Flatpay/` |
| GitHub user Pages | `https://YOUR-GITHUB-USER.github.io/` |

The examples are placeholders. Use the real hostname and the exact case of the path. A custom domain normally uses its root URL. Add each address you actually use separately; changing the host or repository path also requires updating these settings. Avoid a broad wildcard when an exact app address is sufficient.

For local testing, you may add `http://localhost:8000/` as an additional redirect URL while keeping the production Site URL set to your hosted address.

Under Supabase Auth's email/SMTP settings, configure a suitable SMTP provider and sender if needed. Built-in email delivery has provider limits and may restrict recipients. Check the settings and send a real confirmation and password-reset email before relying on them. Supabase's email rate limits and your SMTP provider's limits still apply.

The app uses **PKCE** for email authentication. Request a confirmation/reset and open its link in the same browser and device. Forwarding a link to another phone or opening it in a different browser can lose the matching verifier. A home-screen app can have storage separate from Safari or Chrome: for a reset, use the ordinary browser to request and complete the reset, then sign back into the installed app with your new password. If a link expires or opens in the wrong browser, request a fresh one in the browser you intend to use.

## 4. Build and check the app

Install Node.js **24 or newer**. From this project folder, run:

```sh
npm ci
npm test
npm run check
npm run build
```

`npm ci` installs the exact locked dependency versions. The build bundles the official Supabase browser SDK locally and copies the public app files to `dist/`.

The checks cover code syntax, PWA paths, the API adapter and database migration behavior using a local PostgreSQL-compatible test engine. They do not prove that your live Supabase project, redirect URLs or email provider have been configured.

Publish **only the contents of `dist/`**. Do not publish `node_modules`, the project root, the migration folder or local development files. When using `public/config.js`, edit that source file and build again; editing only the generated `dist/config.js` is overwritten by the next build.

If Python 3 is installed, you can test the built static app locally:

```sh
python3 -m http.server 8000 --directory dist
```

On Windows the command may be `py -m http.server 8000 --directory dist`. Open `http://localhost:8000/`, not a `file:///` URL. Localhost supports browser installation development features, but a phone needs the real hosted HTTPS address. An HTTP LAN address on your computer is not a substitute for HTTPS installation.

## 5. Publish with GitHub Pages

1. Add these files to the GitHub repository that should host the app, preserving the `.github/workflows/` folder. Commit `public/config.js` with only its public settings.
2. Open the repository's **Settings → Pages** and choose **GitHub Actions** as the build/deployment source. Your account and repository plan must support Pages.
3. Open **Actions → Deploy myflatpay to GitHub Pages → Run workflow**. Select the branch containing these files and run it.
4. Wait for the build and deployment jobs to complete. Open the URL from the deployment's `github-pages` environment.
5. Make sure that exact URL appears in Supabase Auth's Site URL and redirect allowlist.

The workflow runs on **`workflow_dispatch` only**. Pushing a commit does not publish it; run the workflow again when you want to release an update. It checks the source, tests it, builds `dist/`, uploads only that directory and deploys the Pages artifact. The app supports both a domain root and a project path such as `/Flatpay/` without hardcoding the repository name.

GitHub Pages serves public static files. The public connection key is expected to be visible, while records stay protected by Supabase authentication and row-level policies. Do not add customer JSON backups or database credentials to the repository.

For another static host, upload `dist/` and use its HTTPS address in Supabase Auth settings. No custom Node backend is required.

## 6. Check the live setup

Before importing your records:

1. Create your account and confirm its email if requested. Sign in.
2. Create a test customer, refresh the page and confirm it remains.
3. Open the same app URL on a second device, sign into the same account and confirm the customer is there.
4. Download a full backup from **Account & backups**, create a recovery point, and check that both appear as expected.
5. Test **Forgot password?** in an ordinary browser and complete its email flow in that same browser.
6. Sign out and sign into a separate test account to confirm it has its own empty workspace.

If the setup screen appears, check `public/config.js` and rebuild. If the app reports an unavailable RPC or permission error, check that the migration ran successfully in the project matching the URL. If confirmation/reset returns to the wrong address, correct the Supabase URL configuration and request a fresh email.

## 7. Install on iPhone and Android

- **iPhone:** open the hosted address in Safari, tap **Share → Add to Home Screen**, then enable **Open as Web App** if offered.
- **Android:** open the hosted address in Chrome, then select **Install app** or **Add to Home screen** from the browser menu or the app's account panel when available.

Open the new home-screen icon and sign into the same account. The installed app and normal browser may require separate sign-ins. This package provides a home-screen web app; publishing native binaries in the App Store or Google Play is a separate process and is not included.

## 8. Move existing data and keep backups

Your uploaded application ZIP contains no saved customers. On the computer/browser that holds your current records, open the old app and use **Export** to get a JSON file.

In the new app, open **Account & backups → Import a backup**. Choose the file, review its filename and customer count, then explicitly confirm replacement. Import replaces the current account's customers and creates a recovery point first. A full backup also restores assistant history, preferences and targets. A legacy customers-only file preserves the current assistant settings.

The database keeps the most recent **60 recovery points per account**. These are created before the first change of a UTC day, before deletes/restores, and on request. They are stored in the same database and are not an offsite backup.

Regularly choose **Download full backup** and store that JSON somewhere separate from the Supabase project. Keep it private because it contains customer data. Supabase's own database backups, retention and point-in-time recovery depend on your plan and configuration. Check your project's backup settings and enable the protection you need; this package does not configure a backup service, SMTP account or paid subscription for you.

The app currently limits each account to 2,000 customers and a 10 MB normalized workspace. It accepts a bounded JSON import and validates it again in the database. Customer and assistant revision checks stop stale writes from silently replacing newer device changes. If a conflict occurs, keep a copy of unsaved text, refresh and reopen before editing again.
