#!/usr/bin/env bash
# Build the new React UI into ../static_files/static/app/ (served by Django at /app/...).
# Reproducible: installs exactly what package-lock.json pins (npm ci), then typechecks and builds.
set -euo pipefail
cd "$(dirname "$0")"

if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
fi

node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<20||(a===20&&b<19)) { console.error("Node 20.19+ is needed (found "+process.versions.node+")"); process.exit(1) }'

npm ci --no-audit --no-fund
npm test --silent
npm run build
echo "Built into $(cd ../static_files/static/app && pwd)"
