# Connect the myflatpay database

1. Create a Supabase project in your Supabase account. Keep its database password private.
2. Open **SQL Editor** in that project and run the complete contents of `migrations/202610300001_flatpay.sql` once. For a project managed with the Supabase CLI, `supabase db push` applies the migration instead. Do not rerun the initial migration over an existing installation; later schema changes should use new migration files.
3. In **Authentication → Providers → Email**, enable email/password sign-in. Keep email confirmations enabled for a public deployment. In **Authentication → URL Configuration**, set Site URL to the final HTTPS app address and add the app's exact callback/redirect URL required by the app setup guide. Password recovery and confirmation links must return to that deployed app.
4. Put the project's URL and **publishable key** (or legacy `anon` key) into the app's public configuration. These identify the project; row-level security and the signed-in user's JWT protect the data. Never put the `service_role`, secret key, database password or access token in the browser or this repository.
5. Deploy the static app over HTTPS, create your account, confirm your email, and sign in on both phones with the same account. Saving a customer writes to your Supabase Postgres database. Refresh or resume the other phone to retrieve the saved data.

The migration creates `flatpay_accounts`, `flatpay_deals`, `flatpay_assistant` and `flatpay_backups`. Every table has row-level security. Signed-in clients can select only their own deal, assistant and backup rows. They cannot insert, update or delete these tables directly. All writes go through `flatpay_workspace`, which derives ownership from `auth.uid()` and validates the operation. Anonymous visitors cannot execute that RPC or read app records. Helper functions cannot be called by browser roles.

Supabase Auth owns passwords, email confirmation, sessions and account recovery. The application does not create its own password or session tables. If public signups are unwanted, create your account first and then disable new user signups in the Supabase Auth settings.

## Recovery points and independent backups

The database keeps the latest **60 recovery points per account**. It records a point before the first change each UTC day, before deleting a customer, before replacing a workspace from a backup, and when the user explicitly creates one. Restores are atomic: either the complete valid backup replaces that account's workspace or nothing changes. Restoring also saves the previous workspace as a recovery point. A legacy deals-only export preserves existing assistant settings/history.

These recovery points live in the same Supabase database as the current records. They recover accidental edits and deletions; they do not replace an independent database backup. Use the app's full JSON export to keep a separate copy, and configure/check the backup retention available on your Supabase plan. Supabase database backups and point-in-time recovery depend on the plan and must be configured in your Supabase account. This package does not claim they are already enabled.

Customer writes and assistant writes carry revision numbers. An update based on an older version fails with a conflict instead of replacing newer data from another phone. Revisions continue increasing after a restore, so old open editors cannot overwrite restored records.

Limits are 1 MB per customer, 2,000 customers and approximately 10 MB of canonical workspace JSON per account. RPC input allows 12 MB so exported backup metadata can round-trip. SQL validates required names/statuses, JSON structures, bounded numbers/text, date fields, offer/note lists, assistant actions and backups. The browser also preserves the original app's more detailed business validation. The included sales assistant runs locally from saved data; no external AI service is configured.

## Validate without connecting a real account

Run `npm test` from the project root. The SQL tests use a local PGlite PostgreSQL engine, create representative Supabase Auth roles/users, execute the actual migration and check tenant isolation, grants, conflicts and backup restore behavior. PGlite is a development dependency and is not shipped to app visitors. Passing these checks verifies the migration locally; the live Supabase project still needs the setup above.

## RPC contract

Call `supabase.rpc('flatpay_workspace', { operation, input })`. The result is the JSON value directly, not an HTTP-like envelope. Sign in first. Validation failures use messages beginning `400:`, missing records `404:`, stale revisions `409:`, and quota failures `413:`. The browser facade converts these to the status/error shape expected by the original app.

| Operation | Input | Result |
| --- | --- | --- |
| `deals.list` | `{}` | Customer array, each with `_revision` |
| `deals.save` | `{deal, id?}` | Saved customer. Existing ID requires the loaded `deal._revision`. Omit ID to create. |
| `deals.delete` | `{id, revision}` | `{ok:true}` |
| `assistant.get` | `{}` | Full version 1 assistant state, `_revision`, `mode`, `model`, `storage` |
| `assistant.set` | `{state}` | Saved assistant state; `state._revision` must match the loaded revision (initially zero). |
| `export` | `{}` | `{version:1,exportedAt,deals,assistant}` |
| `backups.list` | `{}` | `{backups:[{id,createdAt,reason,bytes}]}` |
| `backups.create` | `{}` | Recovery point metadata |
| `backups.get` | `{id}` | Full version 1 backup |
| `backups.preview` | `{backup}` | `dealCount`, `assistantMessages`, `preferences`, `assistantIncluded`, `replacesWorkspace` |
| `backups.restore` | `{backup,confirm:'REPLACE MY WORKSPACE'}` | `{ok:true,restored,recoveryBackup}` |

IDs are strings containing letters, numbers and hyphens, at most 100 characters. Original app-generated UUIDs are supported. Browser-supplied owner IDs, original creation/update metadata on ordinary writes, and imported revision values are ignored. Backup IDs are UUIDs. Exported account backups exclude authentication data and other accounts' records.
