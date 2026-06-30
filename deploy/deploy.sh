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
HEALTH_URL="http://127.0.0.1:3001/health"                 # must match systemd HOSTNAME/PORT
HEALTH_TIMEOUT=45                                         # seconds to wait for the new build to serve
# DEPLOY_NOTIFY_URL: optional webhook (ntfy/Discord/Slack). Set it in $ENV_FILE to get
# a success/failure ping per deploy; unset = silent (logs only).
# ───────────────────────────────────────────────────────────────────────

# ── Notification + outcome reporting ───────────────────────────────────
# A single EXIT trap reports the outcome so EVERY failure path is covered: a failed
# build aborts under `set -e` (DEPLOY_OK stays 0 → failure), and the health gate below
# `exit 1`s on a build that boots broken. Success is reported only after /health is green.
SHA="(pre-checkout)"
DEPLOY_OK=0

notify() { # $1=success|failure  $2=message
  echo "$2"
  [ -n "${DEPLOY_NOTIFY_URL:-}" ] || return 0
  curl -fsS -m 10 -X POST "$DEPLOY_NOTIFY_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"service\":\"$SERVICE\",\"status\":\"$1\",\"sha\":\"$SHA\",\"message\":\"$2\"}" \
    >/dev/null 2>&1 || true
}

on_exit() {
  local code=$?
  if [ "$DEPLOY_OK" = "1" ]; then
    notify success "Deployed $SERVICE @ $SHA in ${SECONDS}s"
  else
    notify failure "Deploy FAILED for $SERVICE @ $SHA (exit $code after ${SECONDS}s)"
  fi
}
trap on_exit EXIT
# ───────────────────────────────────────────────────────────────────────

cd "$APP_DIR"

git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
SHA="$(git rev-parse --short HEAD)"

# Make build-time env (e.g. GTNH_DATASET_BACKEND_URL, NEXT_PUBLIC_UMAMI_*)
# visible to `next build`. EnvironmentFile in systemd only covers runtime.
if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi

export NODE_OPTIONS="--max-old-space-size=4096"
# Stamp the build with the deployed commit so /health can report it. NEXT_PUBLIC_* is
# inlined at build time, so the value freezes to exactly this build.
export NEXT_PUBLIC_GIT_SHA="$SHA"
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

# Fail-closed gate: declare success only once /health serves 200. A build that boots
# broken (or never binds) trips the timeout below and reports a failure — the old
# release is already gone, so this surfaces it loudly rather than silently shipping it.
echo "Waiting up to ${HEALTH_TIMEOUT}s for $HEALTH_URL ..."
deadline=$((SECONDS + HEALTH_TIMEOUT))
until curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Health check FAILED: $SERVICE did not serve $HEALTH_URL within ${HEALTH_TIMEOUT}s." >&2
    systemctl is-active "$SERVICE" >&2 || true
    journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
    exit 1
  fi
  sleep 2
done

DEPLOY_OK=1
echo "Deployed $SERVICE from origin/$BRANCH @ $SHA — /health is green."
