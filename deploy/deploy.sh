#!/usr/bin/env bash
#
# GTNH Factory Flow — home-server deploy script (portfolio-style).
#
# Copy this to /srv/gtnh-factory-flow/deploy.sh on the server (NOT tracked in the
# repo checkout, so `git reset --hard` can't rewrite it while it runs). The webhook
# daemon and manual `ssh homeserver /srv/gtnh-factory-flow/deploy.sh` both invoke it.
#
# See docs/SELFHOST.md for the full one-time server setup.

set -euo pipefail

# ── Config — edit to taste ─────────────────────────────────────────────
APP_DIR="/srv/gtnh-factory-flow"                          # repo checkout (admin-owned)
DATASET_VOLUME="/srv/data/gtnh-factory-flow/datasets/gtnh" # persistent dataset (self-host mode)
ENV_FILE="/etc/gtnh-factory-flow.env"                     # optional runtime/build env
SERVICE="gtnh-factory-flow"                               # systemd service name
BRANCH="main"                                             # branch to deploy
# ───────────────────────────────────────────────────────────────────────

cd "$APP_DIR"

git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

# Make build-time env (e.g. GTNH_DATASET_BACKEND_URL, NEXT_PUBLIC_UMAMI_*)
# visible to `next build`. EnvironmentFile in systemd only covers runtime.
if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi

export NODE_OPTIONS="--max-old-space-size=4096"
npm ci
npm run build

# Next standalone server expects .next/static and public next to server.js.
rsync -a --delete .next/static/ .next/standalone/.next/static/
rsync -a --delete public/ .next/standalone/public/

# Self-hosted dataset mode: point the served dataset dir at the persistent volume.
# The app reads datasets from <cwd>/public/datasets/gtnh, and the server runs with
# cwd = .next/standalone, so the symlink has to live inside standalone's public/.
# Skipped automatically in proxy mode (GTNH_DATASET_BACKEND_URL set, no volume).
if [ -d "$DATASET_VOLUME" ]; then
  rm -rf .next/standalone/public/datasets/gtnh
  mkdir -p .next/standalone/public/datasets
  ln -sfn "$DATASET_VOLUME" .next/standalone/public/datasets/gtnh
fi

sudo /usr/bin/systemctl restart "$SERVICE"
echo "Deployed $SERVICE from origin/$BRANCH @ $(git rev-parse --short HEAD)"
