# Termux Setup and APK Build

## Install tools

```bash
pkg update -y
pkg install nodejs-lts git unzip openssl -y
termux-setup-storage
```

## Extract

```bash
cd ~/storage/downloads
unzip website-maker-ai-v2.1-admin-login.zip -d ~/website-maker-ai-v2
cd ~/website-maker-ai-v2/website-maker-ai-v2.1-admin-login
npm ci
```

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Local mobile interface

Create `apps/mobile/.env`:

```env
VITE_API_BASE_URL=http://localhost:8787
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Start the Worker in one Termux session:

```bash
cd apps/api
cp .dev.vars.example .dev.vars
# Fill .dev.vars
npm run dev
```

Start mobile in a second session:

```bash
cd ~/website-maker-ai-v2/website-maker-ai-v2.1-admin-login
npm run dev:mobile
```

## Build APK with GitHub Actions

Before running the workflow, add these GitHub repository secrets:

```text
VITE_API_BASE_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Then open Actions → Build Android APK → Run workflow. Download the `Website-Maker-AI-debug-apk` artifact.

## Admin dashboard

Create `apps/admin/.env` with only the Worker URL:

```env
VITE_API_BASE_URL=http://localhost:8787
```

Then run:

```bash
npm run dev:admin
```

Use the owner credentials configured in `docs/ADMIN_LOGIN.md`.
