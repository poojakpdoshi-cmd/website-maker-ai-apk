# V2.1 Build Audit

Checks performed on the packaged source:

```text
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Results:

- Mobile TypeScript: passed
- Admin TypeScript: passed
- API TypeScript: passed
- Mobile Vite build: passed
- Admin Vite build: passed
- Cloudflare Worker dry-run build: passed
- Built-in brain test: passed
- Built-in editor test: passed
- Multi-file project generation test: passed
- Generated React/Vite project `npm run build`: passed
- Dependency audit: zero known vulnerabilities
- Requested admin password matched the stored PBKDF2-SHA256 hash
- Plaintext admin password was not present in the packaged source
- Wrong admin password returned HTTP 401
- Correct admin credentials created a server-side session
- Authenticated admin summary returned HTTP 200
- Logout revoked the session
- Reusing the revoked token returned HTTP 401

The admin API test used a local mock of the required Supabase tables. A real deployment still requires all three SQL migrations and the owner’s Supabase configuration.

Local Gradle assembly may require access to Gradle's distribution server. The included GitHub Actions workflow performs the Android build online.

GitHub OAuth, Vercel OAuth and live deployment require real owner credentials and must be tested after configuration. No provider passwords are collected by the app.
