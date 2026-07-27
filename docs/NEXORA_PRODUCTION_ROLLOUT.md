# Nexora production rollout

This change is intentionally not deployed automatically. Complete the steps
below after reviewing the branch.

## 1. Database migration

Apply the ordered migrations to the existing Supabase database. For a database
that already has migrations 001-010, apply 011, 012 and 013 in order:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/011_generation_live_sites_firebase_theme.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/012_conversations_timing_security.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/013_non_expiring_token_packages.sql
```

The migration adds terminal generation lifecycle fields, account appearance
preferences, published-site/deployment history, encrypted Firebase connection
metadata and provider-neutral backend provisioning/resource tables. All new
tables have RLS enabled and are accessed by the authenticated Worker through
the service-role connection; no public table policies are added.

Migration 012 adds durable owner-scoped conversations/messages, database-backed
per-user rate limits and authoritative generation duration. Conversation
deletion is deliberately soft: deleted rows disappear from all user history
queries but remain recoverable for offline-sync integrity and incident review.
Migration 013 retains legacy billing columns for compatibility, disables cycle
refills/expiry, and adds an append-only idempotent token transaction ledger.
Package grants do not happen automatically on login or restart.

## 2. Google/Firebase OAuth setup

Create a Google OAuth web application for the production Worker. Configure the
exact callback:

```text
https://YOUR-WORKER.workers.dev/integrations/firebase/callback
```

Enable the Firebase Management, Cloud Resource Manager, Firestore,
Identity Toolkit, Firebase Rules and Cloud Storage APIs for the operator
project. Storage-backed applications deploy owner-scoped Storage Rules and
must pass an authenticated upload/read/delete check in addition to the
Firestore write/read/delete check. Google may require verification of the
requested Firebase, Datastore and Cloud Platform scopes before external users
can grant access.

The Android application never accepts a service-account JSON file. OAuth access
and refresh tokens are AES-GCM encrypted by the Worker before storage.

## 3. Worker configuration

Set non-secret variables in `apps/api/wrangler.toml` or the Cloudflare
dashboard:

```text
PUBLIC_API_BASE_URL
QA_PROVIDER
ARCEE_QA_MODEL
GEMINI_MODEL
GROQ_CODER_MODEL
GROQ_REVIEWER_MODEL
CLOUDFLARE_REPAIR_MODEL
GITHUB_REDIRECT_URI
VERCEL_REDIRECT_URI
FIREBASE_REDIRECT_URI
OAUTH_ALLOWED_ORIGINS
```

`OAUTH_ALLOWED_ORIGINS` is a comma-separated list of exact HTTPS origins.
Include the production Android/web origin and every published origin that must
call a Nexora-managed public backend. Wildcards are not accepted.

Set secrets interactively; do not place their values in source control:

```bash
cd apps/api
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put ARCEE_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put VERCEL_CLIENT_ID
npx wrangler secret put VERCEL_CLIENT_SECRET
npx wrangler secret put FIREBASE_CLIENT_ID
npx wrangler secret put FIREBASE_CLIENT_SECRET
```

Generate `TOKEN_ENCRYPTION_KEY` as 32 random bytes encoded as 64 hexadecimal
characters. Rotating it requires a credential re-encryption procedure or users
must reconnect their providers.

For dedicated ordinary Q&A, set `QA_PROVIDER=arcee`, set
`ARCEE_QA_MODEL` to a model ID verified in the Arcee dashboard, and store the
key only as the `ARCEE_API_KEY` Worker secret. Explicit Arcee mode never falls
back to the generation providers. Arcee is not used for planning, coding,
review, validation, repair, Firebase provisioning or publishing.

The Capacitor client caches conversations in IndexedDB for fast/offline startup,
then synchronizes authenticated history from the Worker. IndexedDB is a cache,
not the cross-device authority; migration 012 must be applied before claiming
reinstall recovery.

## 4. Verification before deployment

From the repository root:

```bash
npm ci
npm run typecheck
npm run typecheck:api
npm test
npm run test:nexora-secure-flows
npm run build
npm --prefix apps/api run build
npm --prefix apps/mobile run cap:sync
cd apps/mobile/android
./gradlew assembleDebug
```

On Windows, use `gradlew.bat assembleDebug` for the last command.
Capacitor 7 requires JDK 21 for the Android compile. If the native platform is
absent in a clean checkout, follow the same sequence as CI:

```bash
cd apps/mobile
npx cap add android
npx cap sync android
```

## 5. Approved deployment commands

Only after the migration, OAuth configuration and checks pass:

```bash
cd apps/api
npx wrangler deploy
```

Build the signed Android release with the existing protected signing workflow.
Do not commit generated APK/AAB files or signing credentials.

## Operational checks

- Confirm the Worker cron is enabled; it closes and refunds stale generation
  jobs every five minutes.
- Connect Firebase with a test account, review a plan, create resources and
  confirm that the client-identity write/read/delete verification passes.
- Confirm Publish Live stays disabled until backend status is `verified`.
- Publish a test project and poll deployment status until Vercel reports
  `READY`; only then should it appear as live.
- Test owner isolation with two accounts before production traffic.
- Verify one Starter, Pro and Business administrative package grant and retry
  each request with the same idempotency key; the second request must not add
  tokens.
- Verify a forced Q&A provider failure restores the reserved tokens exactly
  once and saves a safe failed-message category.

## Enforced limitation

Cloud Functions are not reported as deployed by this branch because the
repository does not yet contain a trusted function build-artifact deployment
pipeline. When `appSpec` requests a secure server function, deterministic
validation requires real server files and Firebase provisioning ends in an
honest partial/failed state instead of enabling Publish Live. Add and
security-review that pipeline before supporting function-bearing Firebase
projects.

There is no verified payment integration in this branch. Token packages can be
granted only by a server-verified administrator. Do not interpret the package
catalogue as payment success until a separately reviewed, idempotent payment
webhook calls the package-grant function.
