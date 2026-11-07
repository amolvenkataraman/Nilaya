#!/usr/bin/env bash
# Build the React app into ../static_files/static/app/ (Django serves its index.html for every page URL).
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
# Precompressed copies for nginx's gzip_static (served instead of compressing on every request).
find ../static_files/static/app -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.html' \) -exec gzip -9 -kf {} +
echo "Built into $(cd ../static_files/static/app && pwd)"
