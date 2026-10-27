# Dependency advisory triage (SEC-07)

Audit dates: 2026-10-13 (initial triage) and 2026-10-27 ([re-audit](#re-audit-2026-10-27)). Source of truth for the gate: [`dependency-triage.json`](dependency-triage.json) (this document is the readable form; `tests/dependency-gate.test.mjs` fails if a row in the JSON is missing here).

## Result

| | Before | After |
|---|---|---|
| `npm audit` (whole tree) | 28 entries: 4 critical, 19 high, 5 moderate (35 high/critical advisories, 19 moderate/low) | 5 entries, all high, backed by one advisory (`braces`, no fixed release exists) |
| `npm audit --omit=dev` (production tree) | 12 entries: 1 critical, 10 high, 1 moderate | 0 |
| Moderate/low advisories | 19 | 0 (the same upgrades cleared them) |
| Gate (`scripts/check-dependency-advisories.mjs`) | exit 1, 35 untriaged | exit 0, one dated exception |

The baseline `artifacts/reloop-dependency-audit-2026-10-13.json` was not reused as inventory. Fresh audits were run on this checkout, and the committed evidence is `artifacts/npm-audit-current.json` and `artifacts/npm-audit-runtime.json` (post-upgrade; they contain only advisory metadata, no tokens or paths outside `node_modules/`). Since the re-audit they hold the 2026-10-27 post-upgrade audits.

## Re-audit 2026-10-27

A fresh audit of `main` at cf6d667 reported advisories published after the initial triage: three in `next` 16.4.0 (2026-10-22), one in `zod` (2026-10-01) and two moderate ones in `@vitest/mocker` (2026-10-21). The gate failed with 4 untriaged high/critical advisories.

| | Before | After |
|---|---|---|
| `npm audit` (whole tree) | 5 entries: 1 critical (`next`), 1 high (`zod`), 3 moderate (`vitest`, `@vitest/mocker`, `@vitest/coverage-v8`) | 0 |
| `npm audit --omit=dev` (production tree) | 2 entries: `next` (critical), `zod` (high) | 0 |
| Gate | exit 1, 4 untriaged | exit 0, no exceptions |

The upgrades landed in two steps: `next` and `vitest` first, then `zod` 3 to 4 with request array bounds.

| Change | From | To | Why |
|---|---|---|---|
| `next` (exact pin) | 16.4.0 | 16.4.3 | GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r are fixed in 16.4.1. 16.4.2 and 16.4.3 are LTS backports only (Turbopack fixes, Google font URLs, `proxy.ts` no longer loading the app-page runtime, OpenTelemetry traces); 16.4.3 is the current 16.4 patch. |
| `eslint-config-next` (exact pin) | 16.4.0 | 16.4.3 | Moves with `next`. |
| `vitest` and `@vitest/coverage-v8` (exact pins, lockstep) | 4.1.11 | 4.1.12 | Moderate GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp in `@vitest/mocker` (dev server mock registration; fixed in 4.1.12). Moderate, so no gate row. Brings `vite` 8.3.5 and `rolldown` 1.2.15 inside the ranges their parents declare. |
| `zod` | ^3.24.0 (3.25.76) | ^4.6.7 (4.6.7) | GHSA-mrhx-c7xc-m3w5, fixed in 4.6.6 only (no 3.x release). 4.6.7 is the current 4.6 patch. `eslint-plugin-react-hooks` and `zod-validation-error` already accept `^4`, so one copy is installed. See the zod section below for the code changes. |

The lockfile was re-resolved with npm 11.21.0 as the lockfile note below requires; `npm ci` was re-verified with npm 10.9.9. No other package version changed.

| Package | Installed (was) | Advisory | Sev | Scope / chain | Reachable at runtime | Fixed in | Decision | Owner | Expires |
|---|---|---|---|---|---|---|---|---|---|
| `next` | 16.4.3 (16.4.0) | GHSA-2464-fhr4-w9xw | critical | production / runtime | no | 16.4.1 | patched | farhanlhsn | n/a (fixed) |
| `next` | 16.4.3 (16.4.0) | GHSA-673q-mjm6-r5xr | critical | production / runtime | no | 16.4.1 | patched | farhanlhsn | n/a (fixed) |
| `next` | 16.4.3 (16.4.0) | GHSA-p3m5-59mp-jv5r | high | production / runtime | no | 16.4.1 | patched | farhanlhsn | n/a (fixed) |
| `zod` | 4.6.7 (3.25.76) | GHSA-mrhx-c7xc-m3w5 | high | production / runtime | yes (before the fix) | 4.6.6 | patched | farhanlhsn | n/a (fixed) |

- GHSA-2464-fhr4-w9xw: Memory bug in the sharp/libvips build the image optimizer uses on glibc Linux; the vendor workaround is sharp >= 0.35.5. The lockfile already resolved sharp 0.35.5 before the upgrade, production runs node:22-alpine (musl), next.config.ts has no images config (no remotePatterns, SVG not rasterised), and no code imports next/image. Patched by upgrade.
- GHSA-673q-mjm6-r5xr: Needs a `use cache` function (Cache Components) that returns typed arrays. No `use cache` directive exists and next.config.ts does not enable cacheComponents. Patched by upgrade.
- GHSA-p3m5-59mp-jv5r: Vendor states apps without Server Actions are not vulnerable. The app defines none (no `'use server'` directive). Patched by upgrade.

`braces` GHSA-vfj7-8cjw-p6xm was withdrawn by GitHub on 2026-10-23 and is no longer reported, so its exception row was removed from the JSON as its exit criteria require. There are no open exceptions.

Verified after the `next`/`vitest` step: `npm run typecheck`, `npm run lint` (0 errors), `npm test` (168 files, 1859 tests), `npm run build`, `npm run test:browser -- tests/browser/render-qr-map.spec.ts tests/browser/smoke.spec.ts` (30 passed across 360/768/1280 px, light and dark) and `node --test tests/dependency-gate.test.mjs` (46 passed).

### zod 3 to 4 (GHSA-mrhx-c7xc-m3w5)

**Exposure before the fix.** zod 3 (and 4 before 4.6.6) walked every element of an array and built one issue per bad element, even when the array was over its `.max()`. 9 of the 11 `z.array()` request schemas had no bound at all, and nginx accepts bodies up to 20M. `POST /api/machine-events` parses its envelope before the HMAC check (it needs `machineCode` to find the secret), so an unauthenticated request reached it: 100,000 malformed events produced 100,001 issues.

**What the fix covers.** zod 4.6.6 checks `.max()`, `.length()` and `.size()` before parsing elements ([colinhacks/zod#6652](https://github.com/colinhacks/zod/pull/6652)). An array without a bound is still walked in full, so the upgrade alone was not enough. Every request array now has an upper bound:

| Schema | Bound | Basis |
|---|---|---|
| `POST /api/machine-events` `events` (no session, HMAC checked after parsing) | 50 (`MAX_EVENTS_PER_BATCH` in `lib/machine-events/protocol.ts`) | `rvm/config.py` and `simulator/simulator.py` clamp the batch to 1..50; on a whole-batch 422 the worker already falls back to one event per batch |
| `PATCH /api/notifications` `ids` (any signed-in user) | 100 | the bell lists and marks at most 30 |
| `campaigns` `allowedEmailDomains`, `partnerships` `serviceArea.regions`, `machines` `wasteTypeIds` (create and update; admin roles, checked before parsing) | 100, with an Indonesian message | well above any configured list |

`lib/session-policy.ts` keeps an unbounded array: it parses the snapshot the server itself stored, never request input. `tests/lib/request-array-bounds.test.ts` fails on any new `z.array()` in `app/` or `lib/` without `.max()`/`.length()` on the same line, except listed non-request schemas. `tests/api/machine-events.test.ts` checks that 50 events pass the envelope, that 51 are refused with 422 before the machine lookup, and that 100,000 malformed events yield one issue; on zod 4.6.5 the last test fails with 100,001 issues.

**API migration.** Only APIs that zod 4 removed were changed. Deprecated ones that still work (`.passthrough()`, `.strict()`, `z.nativeEnum`, `z.ZodIssueCode`, `.email()`, `.uuid()`, `.datetime()`, `message:` params) were left alone.

- `required_error` / `invalid_type_error` (12 schemas): replaced by `error: typeErrors({ required, invalidType })` (`lib/zod-errors.ts`), which keeps both messages and zod's default for the one not given. Where both messages were the same it is a plain `error: "..."`.
- `errorMap` on the two redemption action enums: `error: "Aksi pencairan tidak dikenal"`.
- `z.record(z.unknown())` (6): `z.record(z.string(), z.unknown())`.

Behaviour checked against `zod/v3`: `.email()` accepted and refused the same 35 addresses (login uses it). `.uuid()` now refuses an invalid version or variant nibble and `.datetime()` refuses a time without seconds; every sender produces RFC 4122 v4 UUIDs (`randomUUID()`, Python `uuid.uuid4()`) and timestamps with seconds (`toISOString()`, Python `isoformat()`, Dart `toUtc().toIso8601String()`). Messages for issues without a custom message changed wording (English either way); the only UI that displays `issues[0].message` (`RewardCaseResolveForm`) shows custom messages.

Not changed and already broken before this upgrade: the mobile admin campaign screen sends `startAt`/`endAt` as a bare date (`2026-10-27`), which `.datetime()` refuses in zod 3 and 4 alike.

Verified after the `zod` step: `npm run typecheck`, `npm run lint` (0 errors), `npm test` (170 files, 1868 tests), `npm run build`, `npm run test:integration` (20 files, 301 tests), `npm run test:realtime` (2 files, 16 tests), `npm run test:browser` (48 passed), `npm ci` with npm 10.9.9, `node --test tests/dependency-gate.test.mjs` (46 passed) and the gate on `artifacts/npm-audit-*.json` (exit 0).

## How exposure was classified

- **Scope** (what the gate checks against `npm audit --omit=dev`): `production` means the package is in the production dependency tree; `build` is a devDependency that runs while producing shipped artifacts; `dev` is lint, test or dev-server only. A `dev` or `build` label on anything the production audit reports is rejected by the gate.
- **Chain** (informational, not enforced): `runtime` is loaded by the running web or realtime process; `build` runs only while building or deploying images (Next/Tailwind build, Prisma CLI in the Dockerfile builder and the `db-migrate` service); `lint` and `test` are developer and CI only.
- **Reachable at runtime** records whether the advisory's precondition exists in this application. It was decided from the code and `next.config.ts`, not from the severity. Every `no` has its evidence below. `unresolved` is never acceptable for a `production` scope exception.
- **Decision**: `patched` rows stay as history; the gate blocks if the audit reports the advisory again. `exception` rows need an owner, a mitigation and an expiry at most 90 days out, and are never allowed when the advisory is reachable.

## Upgrades made (all from a fresh audit; no `npm audit fix --force`, no blanket `npm update`)

| Change | From | To | Why |
|---|---|---|---|
| `next` (exact pin) | 16.2.10 | 16.4.0 | Clears 3 critical and 5 high advisories (fixed by 16.3.8 at most). 16.4.0 is the current `latest`, and pins `postcss` 8.5.23 and `sharp ^0.35.4`. 16.3.8 was the minimal fully patched alternative. |
| `eslint-config-next` (exact pin) | 16.2.9 | 16.4.0 | Moves with `next` (it was already one patch behind). Renovate now groups the two. |
| `vitest` and `@vitest/coverage-v8` (exact pins, lockstep) | 2.1.9 | 4.1.11 | Critical `vitest` UI-server advisory (fixed in 3.2.6/4.1.0), moderate mocker advisory (fixed in 4.1.11), and 4.x drops `tinypool` (two critical advisories with no fix on 1.x). Brings `vite` 5.4.21 to 8.3.4, which clears the `vite` and `esbuild` advisories. Vitest 5.0.4 was not chosen: it is one day old and 4.1.11 already carries every fix with an 8-week soak. Renovate now groups the two. |
| `postcss` override and devDependency | ^8.5.10 (8.5.16) | ^8.5.23 (8.5.30) | Path-traversal advisory fixed in 8.5.18; `next` 16.4.0 pins 8.5.23. |
| `overrides.deepmerge-ts` (new) | 7.1.5 (pinned by `@prisma/config` 6.19.3) | ^8.0.0 (8.0.2) | The only fix is 8.0.0. Compatibility evidence is in the Prisma section. |
| Lockfile refresh of named transitives (`npm update <names>` only) | | | `@fastify/busboy` 3.2.0 to 3.2.3, `@grpc/grpc-js` 1.14.4 to 1.14.6, `fast-xml-parser` 5.9.3 to 5.11.2, `js-yaml` 4.2.0 to 4.3.2, `brace-expansion` to 1.1.21 and 5.0.12, `browserslist` 4.28.2 to 4.29.3, `baseline-browser-mapping` 2.10.37 to 2.11.28, `nanoid` 3.3.12 to 3.3.20, `source-map-js` 1.2.1 to 1.2.2, `sharp` 0.34.5 to 0.35.5 (through `next`). Each stays inside the range its parent already declared. |
| `engines.node` | >=20 | >=22.12.0 | See the Node decision. |

Not changed: Prisma (`prisma` and `@prisma/client` stay on 6.19.3, the last 6.x), React, Playwright, Tailwind, `firebase-admin`, `leaflet`, `qrcode`, `html5-qrcode`.

### Node decision

CI, `security-scan.yml`, `deploy.yml` and `compliance-check.yml` now run Node 22 (they were on 20, which reached end of life on 2026-04-30). Both Dockerfiles already used `node:22-alpine`, so CI, the images and local development are now on one release. Node 22 satisfies every pinned dependency (`vite` 8 needs `^20.19 || >=22.12`, `next` 16.4 needs `>=20.9`, `vitest` 4.1 accepts 22). Node 22 leaves maintenance support on 2027-04-30, so moving to Node 24 is a follow-up before then; it was not done here because it could not be verified on this host.

### Lockfile note

`package-lock.json` was regenerated with npm 11.21.0 because npm 10.9.8 (bundled with Node 22) crashes in its resolver (`Cannot read properties of null (reading 'edgesOut')`) while resolving the peer dependencies of `vitest` 4.1.11. `npm ci` was verified with npm 10.9.8, which is what CI uses. Re-resolving the tree (`npm install` after editing dependencies) may need npm 11 until the npm 10 bug is fixed; `npm ci` does not.

## Advisory decisions (every high/critical advisory reported before the upgrade)

| Package | Installed (was) | Advisory | Sev | Scope / chain | Reachable at runtime | Fixed in | Decision | Owner | Expires |
|---|---|---|---|---|---|---|---|---|---|
| `next` | 16.4.0 (16.2.10) | GHSA-2xp9-vwfh-vxw4 | critical | production / runtime | no | 16.3.3 | patched | farhanlhsn | n/a (fixed) |
| `next` | 16.4.0 (16.2.10) | GHSA-6gpp-xcg3-4w24 | high | production / runtime | no | 16.2.11 | patched | farhanlhsn | n/a (fixed) |
| `next` | 16.4.0 (16.2.10) | GHSA-89xv-2m56-2m9x | high | production / runtime | no | 16.2.11 | patched | farhanlhsn | n/a (fixed) |
| `next` | 16.4.0 (16.2.10) | GHSA-cjq9-62q9-8jv4 | high | production / runtime | no | 16.3.8 | patched | farhanlhsn | n/a (fixed) |
| `next` | 16.4.0 (16.2.10) | GHSA-m99w-x7hq-7vfj | high | production / runtime | no | 16.2.11 | patched | farhanlhsn | n/a (fixed) |
| `next` | 16.4.0 (16.2.10) | GHSA-p293-qw3h-jr36 | critical | production / runtime | no | 16.3.3 | patched | farhanlhsn | n/a (fixed) |
| `next` | 16.4.0 (16.2.10) | GHSA-p9j2-gv94-2wf4 | high | production / runtime | no | 16.2.11 | patched | farhanlhsn | n/a (fixed) |
| `next` | 16.4.0 (16.2.10) | GHSA-vcvr-r3jv-pc5j | critical | production / runtime | no | 16.3.6 | patched | farhanlhsn | n/a (fixed) |
| `sharp` | 0.35.5 (0.34.5) | GHSA-f88m-g3jw-g9cj | high | production / runtime | no | 0.35.0 | patched | farhanlhsn | n/a (fixed) |
| `sharp` | 0.35.5 (0.34.5) | GHSA-rgj7-g3m4-5g8c | high | production / runtime | no | 0.35.4 | patched | farhanlhsn | n/a (fixed) |
| `sharp` | 0.35.5 (0.34.5) | GHSA-wq5f-xc86-pv6w | high | production / runtime | no | 0.35.5 | patched | farhanlhsn | n/a (fixed) |
| `@fastify/busboy` | 3.2.3 (3.2.0) | GHSA-x8mw-p69m-v3mx | high | production / runtime | no | 3.2.1 | patched | farhanlhsn | n/a (fixed) |
| `@fastify/busboy` | 3.2.3 (3.2.0) | GHSA-xjh9-v7x6-24jw | high | production / runtime | no | 3.2.1 | patched | farhanlhsn | n/a (fixed) |
| `@grpc/grpc-js` | 1.14.6 (1.14.4) | GHSA-m9gg-hp2v-232j | high | production / runtime | no | 1.14.5 | patched | farhanlhsn | n/a (fixed) |
| `fast-xml-parser` | 5.11.2 (5.9.3) | GHSA-8r6m-32jq-jx6q | high | production / runtime | no | 5.10.1 | patched | farhanlhsn | n/a (fixed) |
| `deepmerge-ts` | 8.0.2 (7.1.5) | GHSA-ggr8-5vv4-36mx | high | production / build | no | 8.0.0 | patched | farhanlhsn | n/a (fixed) |
| `nanoid` | 3.3.20 (3.3.12) | GHSA-28wg-ghj8-5hjv | high | production / build | no | 3.3.16 | patched | farhanlhsn | n/a (fixed) |
| `nanoid` | 3.3.20 (3.3.12) | GHSA-2v37-7h3g-55p8 | high | production / build | no | 3.3.18 | patched | farhanlhsn | n/a (fixed) |
| `postcss` | 8.5.30 (8.5.16) | GHSA-r28c-9q8g-f849 | high | production / build | no | 8.5.18 | patched | farhanlhsn | n/a (fixed) |
| `source-map-js` | 1.2.2 (1.2.1) | GHSA-68fv-2mgg-jv7q | high | production / build | no | 1.2.2 | patched | farhanlhsn | n/a (fixed) |
| `brace-expansion` | 1.1.21, 5.0.12 (1.1.15, 2.1.1, 5.0.6, 5.0.7) | GHSA-3jxr-9vmj-r5cp | high | dev / lint/test | no | 1.1.16 (1.x), 5.0.7 (5.x) | patched | farhanlhsn | n/a (fixed) |
| `brace-expansion` | 1.1.21, 5.0.12 (1.1.15, 2.1.1, 5.0.6, 5.0.7) | GHSA-6j4f-fj2g-mc7p | high | dev / lint/test | no | 1.1.19 (1.x), 5.0.10 (5.x) | patched | farhanlhsn | n/a (fixed) |
| `brace-expansion` | 1.1.21, 5.0.12 (1.1.15, 2.1.1, 5.0.6, 5.0.7) | GHSA-mh99-v99m-4gvg | high | dev / lint/test | no | 1.1.17 (1.x), 5.0.8 (5.x) | patched | farhanlhsn | n/a (fixed) |
| `brace-expansion` | 1.1.21, 5.0.12 (1.1.15, 2.1.1, 5.0.6, 5.0.7) | GHSA-qhr7-859c-m2p7 | high | dev / lint/test | no | 1.1.20 (1.x), 5.0.11 (5.x) | patched | farhanlhsn | n/a (fixed) |
| `brace-expansion` | 1.1.21, 5.0.12 (1.1.15, 2.1.1, 5.0.6, 5.0.7) | GHSA-rgw5-rvv9-x895 | high | dev / lint/test | no | 1.1.18 (1.x), 5.0.9 (5.x) | patched | farhanlhsn | n/a (fixed) |
| `braces` | 3.0.3 (3.0.3) | GHSA-vfj7-8cjw-p6xm | high | dev / lint | no | none released | exception, closed 2026-10-27 (advisory withdrawn, row removed) | farhanlhsn | n/a (closed) |
| `browserslist` | 4.29.3 (4.28.2) | GHSA-73wf-gq98-2v4g | high | dev / lint | no | 4.28.7 | patched | farhanlhsn | n/a (fixed) |
| `browserslist` | 4.29.3 (4.28.2) | GHSA-c83g-rgw3-j3cx | high | dev / lint | no | 4.28.7 | patched | farhanlhsn | n/a (fixed) |
| `js-yaml` | 4.3.2 (4.2.0) | GHSA-2883-xcg3-v3hh | high | dev / lint | no | 4.3.2 | patched | farhanlhsn | n/a (fixed) |
| `js-yaml` | 4.3.2 (4.2.0) | GHSA-52cp-r559-cp3m | high | dev / lint | no | 4.3.0 | patched | farhanlhsn | n/a (fixed) |
| `js-yaml` | 4.3.2 (4.2.0) | GHSA-5p4m-2wfm-xmqj | high | dev / lint | no | 4.3.1 | patched | farhanlhsn | n/a (fixed) |
| `tinypool` | not installed (1.1.1) | GHSA-5gmw-xhrv-c9v3 | critical | dev / test | no | 2.1.1 | patched | farhanlhsn | n/a (fixed) |
| `tinypool` | not installed (1.1.1) | GHSA-85c8-ppgw-ccpr | critical | dev / test | no | 2.1.2 | patched | farhanlhsn | n/a (fixed) |
| `vite` | 8.3.4 (5.4.21) | GHSA-fx2h-pf6j-xcff | high | dev / test | no | 8.0.16 (8.x) | patched | farhanlhsn | n/a (fixed) |
| `vitest` | 4.1.11 (2.1.9) | GHSA-5xrq-8626-4rwp | critical | dev / test | no | 4.1.0 (4.x) | patched | farhanlhsn | n/a (fixed) |

### Exposure evidence by package

**`next`**
- GHSA-2xp9-vwfh-vxw4: Needs an attacker-supplied AVIF to reach the /_next/image optimizer. next.config.ts has no images config (default formats, no remotePatterns/localPatterns reach), public/ holds only jpg/png/svg/webp, and no code imports sharp. Patched by upgrade.
- GHSA-6gpp-xcg3-4w24: Needs exactly one entry in config.i18n.locales with Turbopack. next.config.ts has no i18n. proxy.ts auth is therefore not bypassable through this path. Patched by upgrade.
- GHSA-89xv-2m56-2m9x: Needs a Server Action behind an untrusted Host header. The app defines no Server Actions and runs the standalone server (host pinned since 14.2). Patched by upgrade.
- GHSA-cjq9-62q9-8jv4: Vendor workaround states apps with no images.remotePatterns are not affected. next.config.ts sets none. Patched by upgrade.
- GHSA-m99w-x7hq-7vfj: Vendor states apps without Server Actions are not vulnerable. The app defines none. Patched by upgrade.
- GHSA-p293-qw3h-jr36: Windows-filesystem hosts only. Production runs node:22-alpine (Dockerfile) on Linux. Developer Windows machines are covered by the upgrade.
- GHSA-p9j2-gv94-2wf4: Needs rewrites()/redirects() with a request-derived external hostname. next.config.ts defines neither. Patched by upgrade.
- GHSA-vcvr-r3jv-pc5j: Requires attacker-controlled values in ImageResponse SVG content. The only use is app/opengraph-image.tsx, which renders static fonts and the app icon, no request input. Patched by upgrade.

**`sharp`**
- GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w: sharp is only used by the Next.js image optimizer. Inputs are limited to the repository public/ assets (no AVIF/HEIC; SVG is not rasterised by default); no remotePatterns; app code never imports sharp. Patched by upgrade (next 16.4.0 requires sharp ^0.35.4).

**`@fastify/busboy`**
- GHSA-x8mw-p69m-v3mx, GHSA-xjh9-v7x6-24jw: Transitive of the optional firebase-admin; parses multipart responses inside its HTTP client (lib/utils/api-request.js), i.e. replies from Google endpoints, never request bodies of this app. Patched by lockfile refresh.

**`@grpc/grpc-js`**
- GHSA-m9gg-hp2v-232j: Transitive of firebase-admin via firestore/google-gax. The app only uses FCM messaging (HTTPS); it runs no gRPC server and no Firestore client. Patched by lockfile refresh.

**`fast-xml-parser`**
- GHSA-8r6m-32jq-jx6q: Transitive of firebase-admin via @google-cloud/storage, whose client the app never instantiates. Patched by lockfile refresh.

**`deepmerge-ts`**
- GHSA-ggr8-5vv4-36mx: Only called by @prisma/config when loading a developer-written prisma.config.* (none exists in the repository) from the Prisma CLI, which runs at build/deploy (Dockerfile builder, db-migrate), not in the standalone web image. Prisma 6.19.3 pins deepmerge-ts 7.1.5, so the fix is an npm override to ^8.0.0; compatibility evidence: prisma validate and generate through a TypeScript config file, plus prisma migrate deploy in npm run test:integration.

**`nanoid`**
- GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8: Used by postcss with fixed arguments during the Next/Tailwind build; no attacker-controlled size reaches it. Patched by lockfile refresh.

**`postcss`**
- GHSA-r28c-9q8g-f849: Needs attacker-controlled CSS with a sourceMappingURL; postcss only processes repository CSS at build time. next 16.4.0 pins postcss 8.5.23 and the override and devDependency were raised to ^8.5.23.

**`source-map-js`**
- GHSA-68fv-2mgg-jv7q: Used by postcss for build-time source maps over repository CSS; no untrusted source map reaches it. Patched by lockfile refresh.

**`brace-expansion`**
- GHSA-3jxr-9vmj-r5cp, GHSA-6j4f-fj2g-mc7p, GHSA-mh99-v99m-4gvg, GHSA-qhr7-859c-m2p7, GHSA-rgw5-rvv9-x895: Reached only through minimatch inside ESLint, typescript-estree and vitest coverage tooling over repository glob patterns; not present in the production dependency audit. Patched by lockfile refresh (installed 1.1.21 and 5.0.12).

**`braces`**
- GHSA-vfj7-8cjw-p6xm: No patched release exists (advisory range is every version through 3.0.3, which is the latest). Reached only via eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch while ESLint resolves its own fixed glob patterns. Not in npm audit --omit=dev. Withdrawn by GitHub on 2026-10-23; the exception was closed in the re-audit.

**`browserslist`**
- GHSA-73wf-gq98-2v4g, GHSA-c83g-rgw3-j3cx: Reached only through @babel/helper-compilation-targets under eslint-plugin-react-hooks (lint). Not in the production dependency audit and not used by next build (SWC). Patched by lockfile refresh.

**`js-yaml`**
- GHSA-2883-xcg3-v3hh, GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj: Reached only through @eslint/eslintrc parsing repository ESLint config. Not in the production dependency audit. Patched by lockfile refresh.

**`tinypool`**
- GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr: Vitest 2.1.9 worker pool dependency; worker options are set by the repository, never by an attacker. Removed from the tree: vitest 4.1.11 no longer depends on tinypool.

**`vite`**
- GHSA-fx2h-pf6j-xcff: Affects a running Vite dev server on Windows. Vitest uses Vite as a library; no dev server is started (no vitest --ui/--api). Patched by the vitest upgrade (vite 8.3.4).

**`vitest`**
- GHSA-5xrq-8626-4rwp: Needs the Vitest UI server listening; @vitest/ui is not installed and npm test runs vitest run. Patched by upgrade to 4.1.11.

## Open exceptions

None. The only exception, `braces` 3.0.3 GHSA-vfj7-8cjw-p6xm (dev / lint, owner farhanlhsn, valid through 2026-12-31, mitigated by ESLint running only on developer machines and in CI over repository glob patterns), was closed on 2026-10-27: GitHub withdrew the advisory on 2026-10-23 and `npm audit` stopped reporting it, which was its exit criterion, so the row was removed from the JSON.

## Prisma (stays on 6)

`prisma` and `@prisma/client` 6.19.3 are the latest 6.x. The audit flagged `prisma` and `@prisma/config` only because they depend on `deepmerge-ts` (GHSA-ggr8-5vv4-36mx, recursive-object stack exhaustion, fixed in 8.0.0). `@prisma/config` 6.19.3 pins 7.1.5, so no 6.x release carries the fix, and it is not reachable (see evidence), so no Prisma 7/8 migration task is opened. Instead `overrides.deepmerge-ts` forces `^8.0.0`. The Prisma 6 API (`$transaction`, `$queryRaw`) is untouched and no Prisma 8 documentation was followed.

Compatibility evidence for the override: with deepmerge-ts 8.0.2, the Prisma 6.19.3 CLI loads a TypeScript config file through `c12` plus the `deepmerge-ts` merger (the only code path that imports it) and passes `prisma validate` and `prisma generate`; `prisma migrate deploy` runs in `npm run test:integration`; and `npx prisma generate`, `npm run build` and the full unit suite pass. deepmerge-ts 8's breaking changes (Map merging, type renames, `deepmergeInto` no longer mutating inputs) do not touch the plain-object `deepmerge` call in `@prisma/config`. Remove the override when `@prisma/config` pins deepmerge-ts 8 or later.

## Python (RVM agent)

Checked: `rvm/requirements.txt` declares `opencv-python-headless>=4.10,<5`. A fresh virtual environment (Python 3.12.3) resolved `opencv-python-headless` 4.14.0.94 and `numpy` 2.5.4 (`pip freeze`); the RVM unit suite runs against that venv through `npm run test:rvm`. Both resolved versions, and the lower bound 4.10.0.84, were queried against the OSV database (PyPI ecosystem): no advisories. The RVM code imports only the standard library and `cv2` (loaded lazily in `rvm/camera.py`); `numpy` is `cv2`'s own dependency.

Not checked: the hardware packages that are commented out in `rvm/requirements.txt` (`gpiozero`, `lgpio`, an HX711 driver, `mpu6050-raspberrypi`) are installed only on the target machine and have no version pins, so they were not audited; Python itself and OS packages on the kiosk were not checked; `pip-audit` was not run (OSV was queried directly). The `<5` bound is deliberate: 5.0.0.93 exists and was not evaluated. No change to `rvm/requirements.txt` was needed.

## Flutter (mobile)

The Flutter SDK is not installed on this host, so `flutter pub get`, `flutter pub outdated` and `flutter analyze` were not run, and nothing was changed in `mobile/pubspec.yaml` or `mobile/pubspec.lock`.

Checked: all 195 packages in `mobile/pubspec.lock` (hosted and `sdk` sources) were queried against OSV's Pub ecosystem (batch query by name and locked version): 0 matches. As a cross-check the full OSV Pub dump was downloaded (13 advisories in total); six concern packages that are in the lockfile (`http`, `dio` x2, `archive` x2, `shared_preferences_android`) and every locked version is past the fixed version (`http` 1.6.0 vs 0.13.3, `dio` 5.9.2 vs 5.0.0, `archive` 4.0.9 vs 3.3.8, `shared_preferences_android` 2.4.23 vs 2.3.4).

Not checked, so the Flutter ecosystem is not claimed clean: OSV's Pub coverage is only a few GitHub-reviewed advisories, so an empty result is weak evidence; native dependencies that Flutter plugins pull in through Gradle and CocoaPods (Firebase SDKs, the scanner and image libraries) are not in `pubspec.lock` and were not audited; the Flutter and Dart SDK versions were not checked against release advisories; the `flutter` CI job and the `flutter-sast` job (Semgrep) remain the only automated Flutter checks.

## Other surfaces not covered here

Docker base images (`node:22-alpine`, `postgres:16-alpine`, `redis:7-alpine`), OS packages and GitHub Actions versions are not covered by `npm audit`; the Trivy and Checkov jobs in `security-scan.yml` remain responsible for them. This task did not run them locally.

## Operating the gate

`security-scan.yml` job `dependency-gate` runs `node --test tests/dependency-gate.test.mjs`, produces the two audits, then runs

```bash
node scripts/check-dependency-advisories.mjs reports/npm-audit-current.json docs/security/dependency-triage.json --runtime reports/npm-audit-runtime.json
```

Exit codes: 0 pass, 1 an advisory blocks (untriaged, still reported though marked patched, reachable and unfixed, unresolved reachability on a production scope, an exception that is missing an owner or mitigation, expired, or more than 90 days out, or an exception for which `npm audit` now reports an available fix), 2 the input cannot be trusted (npm audit error body, unsupported report version, malformed JSON or triage rows, duplicate rows, an entry that is not an object, a `via` item that is neither a package name nor an object, a missing severity, or a severity other than info, low, moderate, high or critical after trimming and lower-casing). Moderate and low advisories are counted but do not gate.

Available fix: an exception row is blocked when the audit entry carrying its advisory has `fixAvailable: true` (recorded as `npm-audit-fix`), a non-breaking fix object, or any fix object that upgrades the vulnerable package itself (recorded as `name@version`). A breaking change to another package, npm's usual parent downgrade suggestion, does not count. To defer a fix on purpose, re-triage and set the row's `reviewedFix` to exactly that string; a different fix blocks again, and the expiry still applies.

Row shape: `{package, installed, advisory, scope, runtimeReachable, fixedVersion, decision, owner, expiresAt}`, plus `mitigation` (required for exceptions), `reviewedFix` (optional, see above), `evidence`, `severity`, `chain` and `previousVersion` as documentation. To add an exception, add a row with `decision: "exception"`, a real owner, a mitigation, and an `expiresAt` within 90 days, and add the matching entry here; when the advisory is fixed, change it to `patched` and set `expiresAt` to `null`.
