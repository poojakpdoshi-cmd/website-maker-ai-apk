# Owner Admin Login

The admin dashboard now uses a username and password instead of Supabase email OTP.

## Configured username

```text
Poojak@King
```

The password is the value requested by the owner. It is not stored as plaintext in the frontend or backend source. The backend contains only a salted PBKDF2-SHA256 verification hash.

## Security behaviour

- Password verification happens only inside the Cloudflare Worker.
- The admin browser never receives the password hash.
- A successful login creates a random server-side session valid for 12 hours.
- The browser keeps the session token only in `sessionStorage`.
- Logging out revokes the server session.
- Five failed attempts from one IP cause a 15-minute lock.
- Admin OTP and `ADMIN_EMAIL` are no longer required.

## Required migration

Run this migration after the first two migrations:

```text
supabase/migrations/003_admin_password_login.sql
```

## Optional credential rotation

The requested credentials work by default. For a production deployment, rotate them because credentials shared in a chat or repository should be considered exposed.

You can override the built-in values using Cloudflare Worker secrets:

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD_SALT
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put ADMIN_PASSWORD_ITERATIONS
```

Generate a new salt and PBKDF2 hash using a trusted offline script before setting those values. Never put a plaintext admin password in Vite variables or the admin frontend.
