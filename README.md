# ReLoop

Digital waste management platform for users, organizations, collectors, and system operators. ReLoop supports machine-based deposits, rewards, environmental programs, material pickups, regional management, and operational reporting in one system.

## Tech stack

- **Next.js 16** (App Router, React 19) + **TypeScript**
- **Tailwind CSS v4**
- **Prisma 6.x** + **PostgreSQL**
- Auth: Custom credentials with `jose` JWT in an httpOnly cookie + `bcryptjs`
- Validation: `zod`

## Prerequisites

- Node.js 20+
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

All demo accounts use the password **`password123`**.

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
