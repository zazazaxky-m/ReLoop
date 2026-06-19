# ReLoop

Digital waste management platform for users, organizations, collectors, and system operators. ReLoop supports machine-based deposits, rewards, environmental programs, material pickups, regional management, and operational reporting in one system.

> This repository currently implements the **MVP foundation vertical slice** (Phases 0-3): scaffold, green UI kit, auth + server-side RBAC/tenant/partnership scoping, machine management with dynamic QR, scan-to-deposit flow, append-only reward ledger gated on a hardware "acceptance point" event, and a Python machine simulator. Later phases (admin/campaign, pickup/partnership, payout/redemption, trash-bag, reporting) ship with the full database schema and stubbed routes to iterate on next.

## Tech stack

- **Next.js 16** (App Router, React 19) + **TypeScript**
- **Tailwind CSS v4** (CSS-first `@theme`, no `tailwind.config.js`)
- **Prisma 6.x** + **PostgreSQL** (stable classic client; see note below)
- Auth: custom credentials with `jose` JWT in an httpOnly cookie + `bcryptjs`
- Validation: `zod`
- Tests: `vitest`
- Machine simulator: **Python 3.11+**

> **Prisma version note:** the plan referenced Prisma 7, but Prisma 7 requires mandatory driver adapters, custom client output paths, and a `prisma.config.ts`, which conflicts with smooth `tsx` seed scripts. To keep the MVP frictionless we use the stable **Prisma 6.x** classic setup (`prisma-client-js`, `new PrismaClient()`, `@prisma/client` import). Upgrading to 7 later is a localized change.

## Prerequisites

- Node.js 20+ (tested on Node 22)
- Docker (for the local PostgreSQL instance) — or your own PostgreSQL
- Python 3.11+ (only for the machine simulator)

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

# 3. Set up env (defaults already match docker-compose / setup-local-db.sql)
#    PowerShell: Copy-Item .env.example .env
#    macOS/Linux: cp .env.example .env

# 4. Create the schema and generate the client
npm run db:migrate

# 5. Seed regions, demo accounts, waste types, rates, machines, config
npm run db:seed

# 6. Run the app
npm run dev
# open http://localhost:3000

# 7. Run the lightweight realtime gateway in a second terminal
npm run realtime
```

> If you have a local PostgreSQL whose `postgres` password you know but do not
> want to create a new role, just set `DATABASE_URL` in `.env` to that instance,
> e.g. `postgresql://postgres:YOURPASSWORD@localhost:5432/reloop` (create the
> `reloop` database first).

### Run the machine simulator

```bash
cd simulator
pip install -r requirements.txt
python simulator.py --machine <MACHINE_CODE> --secret <INGEST_SECRET>
```

Recommended long-running machine process:

```bash
python simulator.py -m RLP-001 --secret <SECRET> --daemon
```

The simulator queues events locally and sends compact batches (up to 20 by
default), so intermittent cellular connections do not lose sensor reports.
Fraud and vandalism examples:

```bash
python simulator.py -m RLP-001 --secret <SECRET> --session <SESSION_ID> --deposit botol --fraud string-pull
python simulator.py -m RLP-001 --secret <SECRET> --vandalism panel-open
python simulator.py -m RLP-001 --secret <SECRET> --vandalism impact
```

### Realtime architecture

- Machine telemetry remains persisted through signed HTTP POST requests.
- Multiple sensor events are batched to reduce headers, TLS, and cellular use.
- The realtime gateway broadcasts only tiny update notifications over WebSocket.
- Dashboards refresh canonical data from PostgreSQL after a notification.
- If the gateway is offline, data remains safe and UI polling/future refreshes
  still retrieve it.

Set `REALTIME_INTERNAL_SECRET` to the same value for the Next.js process and
the realtime process. For remote clients, set `NEXT_PUBLIC_REALTIME_WS_URL` to
the reachable gateway URL (use `wss://` behind HTTPS).

### Chromium machine kiosk

The kiosk UI and sensor daemon are separate processes. See
[`kiosk/README.md`](kiosk/README.md). The kiosk route is:

```text
/kiosk/<MACHINE_CODE>
```

For an actual machine, prefer the **offline local edge mode**:

```bash
python simulator/simulator.py -m RLP-001 --secret <SECRET> \
  --base-url https://server-reloop.example --daemon --local-kiosk
```

Chromium then opens `http://127.0.0.1:8765`, not the cloud URL. The display,
sensor state, fraud detection, vandalism detection, and disk-backed event queue
continue to run without internet. See `kiosk/README.md` for launch scripts.

Machine codes **and per-machine ingest secrets** are printed by the seed script, and
the secret is also shown in the superadmin machine detail page (Keamanan Mesin →
Tampilkan/Salin/Rotasi). Event ingestion is authenticated with a **per-machine
HMAC-SHA256 signature** (timestamp + nonce + body), so the secret never travels in
plaintext and a leaked key only affects one machine.

## Seed accounts

All demo accounts use the password **`password123`**.

| Role       | Email                 | Notes                                            |
| ---------- | --------------------- | ------------------------------------------------ |
| Superadmin | superadmin@reloop.id  | Full platform access                             |
| Admin      | admin@reloop.id       | Bound to the seeded sample organization          |
| Pengepul   | pengepul@reloop.id    | ACTIVE collector partner of the sample org       |
| User       | user@reloop.id        | Deposits waste, earns/redeems rewards            |

## Project structure

```
app/                 Next.js App Router (routes, API route handlers, dashboards)
  api/               Server endpoints (auth, machines, scan, sessions, machine-events, ...)
  machine/[code]/    Small-screen dynamic QR display route
components/          UI kit + role-aware app shell
lib/                 prisma client, auth, rbac, qr, ledger, reward, machine state, payout
prisma/              schema.prisma + seed.ts
simulator/           Python machine simulator
```

## Product decision baseline (do not re-litigate)

1. Machine QR is **dynamic**, shown on a small screen (not static).
2. Hardware is **simulated** first via a Python machine simulator.
3. Initial waste types: **botol** (bottle) and **kaleng** (can); admins can add more.
4. Machine reward is **per item**, validated by per-waste-type **weight thresholds**.
5. Initial reward values are reasonable human seeds, editable by superadmin.
6. Min/max weight thresholds are admin-configurable.
7. Rewards are funded/managed by the superadmin for now; collector commission/settlement is a later-phase pricing decision.
8. MVP payout is **manual transfer by superadmin** to a user e-wallet/account; a status/note like "sudah ditransfer" is enough (no proof upload required).
9. Phase-later e-wallet priority: **GoPay, OVO, ShopeePay** (if free/low-fee transfers are available).
10. No user KYC for the MVP.
11. Minimum redemption is configurable; default **Rp10.000**.
12. Collector partnerships require **superadmin approval**.
13. Collectors can pick service areas, but pickup assignment still requires an ACTIVE partnership.
14. Machine deposits are counted **per pcs**; weight is only a validation threshold. Manual/trash-bag use cases are re-weighed.
15. Machine reward is recorded **only after the item passes the acceptance point**, not merely after AI says valid.
16. Machine supports input chamber/gate, timeout, conveyor, internal press/compactor (after acceptance), internal camera, optional barcode, and an external anti-fraud/vandalism camera.
17. String-pull / retrieval fraud must trigger anomaly/review via direction sensors, acceptance sensor, one-way gate/flap, and external camera.
18. Trash bags have a unique QR.
19. Campaigns can be PUBLIC or PRIVATE; private campaigns can restrict by email domain.

## Open business TODOs (recorded, not blocking)

1. Final seed reward nominal per botol and per kaleng (after stakeholder validation).
2. Final min/max weight thresholds for botol and kaleng (after machine testing).
3. Collector commission/settlement scheme (business pricing agreement).
4. Final e-wallet priority order after checking actual transfer fees.

## NPM scripts

- `npm run dev` / `build` / `start` - Next.js
- `npm run lint` / `typecheck` / `test` - quality checks
- `npm run db:migrate` / `db:push` / `db:seed` / `db:reset` - database
- `npm run prisma:generate` - regenerate the Prisma client
