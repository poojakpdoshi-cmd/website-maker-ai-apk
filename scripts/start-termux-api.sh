#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ ! -f apps/api-node/.env ]; then
  echo 'Missing apps/api-node/.env. Run: bash scripts/configure-termux-api.sh'
  exit 1
fi
set -a
. apps/api-node/.env
set +a
exec npm run dev:api
