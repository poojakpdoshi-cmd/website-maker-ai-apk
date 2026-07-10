# Supabase Setup

## 1. Create a free Supabase project

Copy these values from Project Settings → API:

- Project URL
- Anon/public key
- Service-role key

Never put the service-role key in the APK or admin frontend.

## 2. Run the database migrations

Open Supabase → SQL Editor and run these files in order:

```text
supabase/migrations/001_initial.sql
supabase/migrations/002_real_platform.sql
supabase/migrations/003_admin_password_login.sql
```

The third migration creates secure admin sessions and failed-login rate-limit storage.

## 3. Admin login

The admin dashboard no longer requires a Supabase admin Auth user or email OTP. Open `docs/ADMIN_LOGIN.md` for the configured owner username and security details.

Subscriber accounts still use real Supabase email OTP.

## 4. Approve subscribers

1. Open the admin dashboard.
2. Sign in with the owner username and password.
3. Enter the subscriber email, expiry date, device limit and daily website limit.
4. Press **Approve email**.

The backend creates the Supabase Auth user and activates the subscription record. Only approved emails can obtain app access.

## 5. Device limit

Every installation gets a persistent random installation ID. The backend registers it in `devices` and rejects extra active devices after the configured limit is reached.
