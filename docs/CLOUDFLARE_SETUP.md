# Cloudflare Worker Setup

## Install and sign in

```bash
cd apps/api
npx wrangler login
```

## Add required secrets

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put PUBLIC_API_BASE_URL
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_REDIRECT_URI
npx wrangler secret put VERCEL_CLIENT_ID
npx wrangler secret put VERCEL_CLIENT_SECRET
npx wrangler secret put VERCEL_REDIRECT_URI
npx wrangler secret put VERCEL_INTEGRATION_SLUG
```

Generate the token-encryption key once:

```bash
openssl rand -hex 32
```

Keep that value safe. Changing it makes previously stored GitHub and Vercel tokens unreadable.

## Admin credentials

The requested owner username and password are already configured securely through a salted backend hash. `ADMIN_EMAIL` is no longer used.

Read:

```text
docs/ADMIN_LOGIN.md
```

Optional credential-rotation secrets:

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD_SALT
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put ADMIN_PASSWORD_ITERATIONS
```

Optional Gemini brain:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GEMINI_MODEL
```

## Deploy

```bash
npm run deploy
```

After deployment, set `PUBLIC_API_BASE_URL` to the final Worker URL and redeploy if necessary.

## Local development

```bash
cp .dev.vars.example .dev.vars
# Fill the Supabase and integration values
npm run dev
```
