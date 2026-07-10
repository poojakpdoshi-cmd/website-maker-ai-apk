#!/data/data/com.termux/files/usr/bin/bash
set -a
[ -f "$(dirname "$0")/.env" ] && . "$(dirname "$0")/.env"
set +a
exec "$@"
