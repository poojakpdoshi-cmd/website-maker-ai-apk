# Termux local API

This version includes a Node-based API adapter that runs on Android/Termux. It reuses the same backend routes as the Cloudflare Worker, but does not install `workerd` or Wrangler on the phone.

## Install

From the project root:

```bash
npm install --no-audit --no-fund
```

## Configure the backend

```bash
cp apps/api-node/.env.example apps/api-node/.env
nano apps/api-node/.env
```

Add your Supabase URL, Supabase service-role key, Gemini key, and a 64-character hexadecimal encryption key.

Generate the encryption key with:

```bash
openssl rand -hex 32
```

## Run the API

```bash
npm run dev:api
```

Expected message:

```text
Website Maker AI API running at http://127.0.0.1:8787
```

Open another Termux session for the mobile interface:

```bash
npm run dev:mobile -- --host 0.0.0.0
```

The mobile interface uses `http://localhost:8787` by default, so it can talk to the Termux API on the same phone.

## Production

The original Cloudflare Worker remains in `apps/api`. Deploy that version from GitHub or a supported desktop/Linux environment. The Termux adapter is for local setup and testing.
