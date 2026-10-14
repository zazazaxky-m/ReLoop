# ReLoop

Digital waste management platform for users, organizations, collectors, and system operators. ReLoop supports machine-based deposits, rewards, environmental programs, material pickups, regional management, and operational reporting in one system.

## Tech stack

- **Next.js 16** (App Router, React 19) + **TypeScript**
- **Tailwind CSS v4**
- **Prisma 6.x** + **PostgreSQL**
- Auth: Custom credentials with `jose` JWT in an httpOnly cookie + `bcryptjs`
- Validation: `zod`

## Struktur Proyek & Dokumentasi

Repositori ini adalah sebuah *monorepo* sederhana yang berisi Web Dashboard, Realtime Server, dan Mobile App. 
Silakan merujuk ke dokumen berikut untuk detail pada masing-masing komponen:
- 📱 [**Mobile App (Flutter)**](mobile/README.md) - Aplikasi pengguna, pengepul, dan admin.
- 📖 [**Panduan Alur Bisnis & Role**](docs/business_logic_and_roles.md) - Cara kerja sistem di lapangan.
- 📖 [**Manual Kepatuhan Wisata (Tourism MVP)**](docs/tourism-compliance-user-manual.md) - Panduan fitur agen perjalanan & Trash Bag QR.
- 📖 [**Mobile API & Sinkronisasi**](docs/mobile-api.md) - Kontrak integrasi API antara backend dan mobile.
- 📖 [**Panduan Setup Mesin Kiosk (RVM)**](docs/kiosk-setup-guide.md) - Alur operasional layar mesin cerdas.
- 📖 [**Panduan Buku Besar (Ledger)**](docs/database-ledger-guide.md) - Penjelasan teknis mengenai arus keluar-masuk poin.

## Prerequisites

- Node.js 22.12+ (the CI and the Docker images run Node 22 LTS)
- Docker (for the local PostgreSQL instance) — or your own PostgreSQL

## Getting started

```bash
# 1. Provide a PostgreSQL database (choose ONE):

#    Option A - Docker (reproducible, recommended):
docker compose up -d

#    Option B - Use an existing local PostgreSQL (no Docker). Create the
#    role+db that match the default DATABASE_URL (run as a superuser):
#      psql -U postgres -h localhost -f prisma/setup-local-db.sql

#    Option C - Use a free cloud Postgres (Neon/Supabase): just paste the
#    connection string into DATABASE_URL in .env.

# 2. Install dependencies
npm install

# 3. Set up env 
#    PowerShell: Copy-Item .env.example .env
#    macOS/Linux: cp .env.example .env

# 4. Create the schema and generate the client
npm run db:migrate

# 5. Seed regions, demo accounts, waste types, rates, machines, config
npm run db:seed

# 6. Run the app
npm run dev
# open http://localhost:3000

# 7. Run the realtime gateway in a second terminal
npm run realtime
```

## Seed accounts

All demo accounts use the password **`password1234`** (minimum 12 characters).

| Role       | Email                 | Notes                                            |
| ---------- | --------------------- | ------------------------------------------------ |
| Superadmin | superadmin@reloop.id  | Full platform access                             |
| Admin      | admin@reloop.id       | Bound to the seeded sample organization          |
| Pengepul   | pengepul@reloop.id    | ACTIVE collector partner of the sample org       |
| User       | user@reloop.id        | Deposits waste, earns/redeems rewards            |

## NPM scripts

- `npm run dev` / `build` / `start` - Next.js
- `npm run lint` / `typecheck` / `test` - quality checks
- `npm run db:migrate` / `db:push` / `db:seed` / `db:reset` - database
- `npm run prisma:generate` - regenerate the Prisma client

## Production deployment (Docker Compose)

`docker-compose.yml` runs the standalone Next.js server (`HOSTNAME=0.0.0.0`, port 3000) behind
nginx (`127.0.0.1:8111`). The deploy workflow copies `.env.production` to `.env`; besides the
secrets it must set `NEXT_PUBLIC_BASE_URL` to the public URL browsers use, e.g.
`https://reloop.example`:

- The request proxy accepts signed-in browser writes (POST/PUT/PATCH/DELETE carrying an `Origin`
  header) only when `Origin` equals that URL's origin. The server's bind address
  (`http://0.0.0.0:3000`) and the `Host` / `X-Forwarded-Host` headers are never trusted.
  Requests without `Origin` (the mobile app) are unaffected.
- Emailed links (password reset, account deletion, invitations, email verification) are built
  only from it.
- Without a valid http(s) value the app fails closed: browser writes answer 403, those email
  endpoints answer 503, and the web log shows `NEXT_PUBLIC_BASE_URL is not configured or invalid`.
  The compose file has no localhost default for it.
- Exactly one origin is accepted. Serve other host names (e.g. `www.` vs the apex) as redirects
  to it in nginx.
- Set it in the runtime environment. A `NEXT_PUBLIC_` value present during `next build` is
  inlined into the bundle and wins over the runtime one (the Docker build leaves it unset).

To run the whole stack locally through its nginx, set `NEXT_PUBLIC_BASE_URL=http://localhost:8111`.

## Regression harness (real services)

`npm test` stays fast and Docker-free (unit tests only). The suites below run through
`scripts/run-audit-tests.mjs`, which needs Docker Engine + Compose v2 for the database suites:

| Command | What runs |
| --- | --- |
| `npm run test:integration [-- <file> ...]` | Vitest `tests/integration/**` against real PostgreSQL 16 + Redis 7 and a real `next dev` server |
| `npm run test:realtime [-- <file> ...]` | Vitest `tests/realtime/**`: gateway child process + fake live verifier |
| `npm run test:browser [-- <playwright args>]` | Playwright `tests/browser/**/*.spec.ts` at 360/768/1280 px, light and dark (`npx playwright install chromium` once) |
| `npm run test:rvm [-- <unittest args>]` | RVM `tests/test_rvm*.py` in a fresh temporary venv with `rvm/requirements.txt` |
| `npm run test:flutter [-- <flutter test args>]` | `flutter test` from `mobile/` (needs Flutter 3.41.7; fails as "NOT RUN" when absent) |

For each run the runner starts a uniquely named Compose project from `docker-compose.audit.yml`
(no fixed names/ports, no persistent volumes), refuses any database that is not a loopback
`reloop_audit_test` owned by the run, generates fresh secrets, migrates, runs the tests and removes
the containers. It never reads `DATABASE_URL`/`REDIS_URL` from your shell or `.env`. Redacted logs
and screenshots land in `test-results/audit/<suite>-<run-id>/` (gitignored).

Writing a test: import `f` from `tests/support/audit-fixture.ts` (fresh seeded graph per test:
orgs A/B, users, admins with MFA on admin A, superadmin, collectors, payout account, online machine,
active money campaigns). Use `f.json(actor, method, path, body)` for real HTTP with production
session cookies, `f.connection()` for extra connections in race tests (see
`tests/support/race-probe.ts`), and `f.capturedTransport()` for mail/push sent through the fake
transport. Browser specs import `test`/`expect` from `tests/support/browser-fixture.ts`.
Cross-client DTO fixtures live in `tests/fixtures/contracts/` and are asserted by both
`tests/support/contracts.ts` and `mobile/test/contracts/`.
