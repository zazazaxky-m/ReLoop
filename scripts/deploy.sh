#!/usr/bin/env bash
# Deploy script for VPS with Docker Compose.
# Usage:  DEPLOY_HOST=my.vps.ip DEPLOY_USER=root ./scripts/deploy.sh [--skip-build]
set -euo pipefail

HOST="${DEPLOY_HOST:?DEPLOY_HOST is required}"
USER="${DEPLOY_USER:?DEPLOY_USER is required}"
PORT="${DEPLOY_PORT:-22}"
REMOTE_PATH="${DEPLOY_PATH:-/opt}"
SSH_KEY="${DEPLOY_SSH_KEY:-${HOME}/.ssh/id_rsa}"
SKIP_BUILD="${1:+false}"
SKIP_BUILD=false

# ── Build ──────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo "=== Building application ==="
  npm ci
  npx prisma generate
  npm run build
fi

# ── Sync files ─────────────────────────────────────────────────
echo "=== Syncing files to ${HOST} ==="
rsync -avz --delete \
  -e "ssh -p ${PORT} -i ${SSH_KEY} -o StrictHostKeyChecking=no" \
  .next/ \
  public/ \
  node_modules/ \
  package.json \
  next.config.ts \
  Dockerfile \
  Dockerfile.realtime \
  docker-compose.yml \
  nginx.conf \
  realtime/ \
  .env.production \
  "${USER}@${HOST}:${REMOTE_PATH}/reloop/"

# ── Deploy ─────────────────────────────────────────────────────
echo "=== Running remote deployment ==="
ssh -p "${PORT}" -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${USER}@${HOST}" << 'REMOTE'
  set -e
  cd /opt/reloop

  # Use production env
  cp .env.production .env 2>/dev/null || true

  # Run migrations
  docker compose run --rm db-migrate

  # Rebuild and restart services
  docker compose up -d --build web realtime nginx

  # Clean up
  docker image prune -f

  # Health check
  sleep 8
  STATUS=$(curl -so /dev/null -w '%{http_code}' http://127.0.0.1:8111/api/auth/me || echo "000")
  if [ "$STATUS" != "000" ]; then
    echo "✅ Health check passed (HTTP ${STATUS})"
  else
    echo "⚠️  Health check returned no response — check logs: docker compose logs web"
  fi
REMOTE

echo "=== Deployment complete ==="
