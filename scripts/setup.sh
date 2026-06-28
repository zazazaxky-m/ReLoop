#!/usr/bin/env bash
set -euo pipefail

echo "=== ReLoop Development Environment Setup ==="

# ── Prerequisites ──────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required"; exit 1; }
command -v docker compose >/dev/null 2>&1 || { echo "❌ Docker Compose is required"; exit 1; }

echo "✅ Prerequisites satisfied (Node $(node -v), Docker $(docker -v))"

# ── Environment file ───────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ Created .env from .env.example"
  echo "⚠️  Edit .env with your own secrets before running in production"
else
  echo "✅ .env already exists"
fi

# ── Install dependencies ──────────────────────────────────────
npm ci
echo "✅ npm dependencies installed"

# ── Start database ────────────────────────────────────────────
docker compose up -d db
echo "✅ PostgreSQL started (waiting for health check)"
docker compose wait db 2>/dev/null || sleep 3

# ── Generate Prisma client & run migrations ───────────────────
npx prisma generate
npx prisma migrate dev --name init 2>/dev/null || npx prisma db push
echo "✅ Database schema applied"

# ── Seed data ─────────────────────────────────────────────────
npx tsx prisma/seed.ts
echo "✅ Seed data loaded"

# ── Generate encryption key (dev only) ────────────────────────
if ! grep -q ENCRYPTION_KEY .env 2>/dev/null; then
  KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "ENCRYPTION_KEY=$KEY" >> .env
  echo "✅ Development ENCRYPTION_KEY generated"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  npm run dev          Start Next.js dev server"
echo "  npm test             Run tests"
echo "  npm run typecheck    TypeScript check"
echo "  docker compose up    Start full stack (web + realtime)"
echo ""
echo "URL: http://localhost:3000"
