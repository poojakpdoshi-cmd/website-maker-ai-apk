#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/apps/api-node/.env"

printf '\nNexora.Ai local backend setup\n'
printf 'This keeps Gemini and the Supabase service-role key outside the APK.\n\n'
read -r -p 'Supabase project URL (https://xxxxx.supabase.co): ' SUPABASE_URL
read -r -s -p 'Supabase service-role key: ' SUPABASE_SERVICE_ROLE_KEY
printf '\n'
read -r -s -p 'Fresh Gemini API key: ' GEMINI_API_KEY
printf '\n'
read -r -p 'Gemini model [gemini-2.5-flash]: ' GEMINI_MODEL
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"

cat > "$ENV_FILE" <<ENV
APP_NAME=Nexora.Ai
PUBLIC_API_BASE_URL=http://127.0.0.1:8787
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY=$GEMINI_API_KEY
GEMINI_MODEL=$GEMINI_MODEL
ADMIN_USERNAME=Poojak@King
ADMIN_PASSWORD_SALT=664ad767ddf31d232e775b07c4818233
ADMIN_PASSWORD_HASH=2fb427fbbbd6bb2731268a2bce3ead659cbc90586b3df7a562d13cb8bc47bf85
ADMIN_PASSWORD_ITERATIONS=60000
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
ENV
chmod 600 "$ENV_FILE"
printf '\nSaved securely to apps/api-node/.env\nRun: npm run dev:api\n'
