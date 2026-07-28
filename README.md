# Nexora.Ai — APK-first build

This version removes the localhost admin webpage. User login, owner login, subscriber approval, dashboard, website generation, editing, GitHub/Vercel connection, and settings are all inside the Android APK.

## What changed

- Admin panel is embedded in the APK.
- Owner button appears only when the login email is `poojakpdoshi@gmail.com`.
- Admin username/password login stays server-verified.
- First launch contains a one-time connection screen for:
  - Backend API URL
  - Supabase project URL
  - Supabase anon/public key
- No APK rebuild is required when these public connection values change.
- Gemini and the Supabase service-role key remain only in the backend.
- Local Termux backend can be used today; Cloudflare can replace it later.

## Verified checks

- Mobile TypeScript: passed
- Admin TypeScript: passed
- Node backend TypeScript: passed
- AI brain smoke test: passed
- Mobile production build: passed
- Admin production build: passed

## Fast local route

1. Create Supabase project.
2. Run the ordered SQL migrations in `supabase/migrations/`. Existing
   installations must also apply
   `011_generation_live_sites_firebase_theme.sql`,
   `012_conversations_timing_security.sql`, and
   `013_non_expiring_token_packages.sql`.
3. In Termux, run `bash scripts/configure-termux-api.sh`.
4. Start backend with `bash scripts/start-termux-api.sh`.
5. In the APK setup screen, enter:
   - API: `http://127.0.0.1:8787`
   - Supabase URL
   - Supabase anon/public key
6. Enter owner email `poojakpdoshi@gmail.com`, open Admin Login, and approve subscriber emails.

## APK build

Push this project to GitHub. The included workflow `.github/workflows/build-apk.yml` builds `app-debug.apk` and uploads it as an Actions artifact.

Production migration, Firebase OAuth and Worker rollout instructions are in
[`docs/NEXORA_PRODUCTION_ROLLOUT.md`](docs/NEXORA_PRODUCTION_ROLLOUT.md).
