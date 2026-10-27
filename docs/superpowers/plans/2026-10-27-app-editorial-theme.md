# App-wide Editorial Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin every non-landing page so it reads as the same family as the editorial landing page. Dashboards use direction "B · Berkarakter"; auth and legal pages sit closer to the poster.

**Architecture:**
- Most of the change happens at the root. `app/globals.css` gets new palette tokens (light and dark), including warmed overrides of Tailwind's `red/amber/blue/slate` scales.
- DM Sans and Anton are loaded through `next/font/local`.
- The `components/ui` primitives and three layout shells (AppShell, auth, legal) are restyled.
- Kiosk, machine display and the trip print page are pinned to the old look by a `.legacy-theme` scope that re-declares the old variable values.
- The work ships as three PRs into one integration branch. That branch reaches `main` in a single merge.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS 4.3 (`@theme` tokens, `.dark` class via next-themes), Vitest (node env, `.test.ts`, `react-dom/server`), Playwright plus the audit runner (`npm run test:browser`, Docker).

**Spec:** `docs/superpowers/specs/2026-10-27-app-editorial-theme-design.md`. Read it first; this plan argues from it. Approved dashboard mockup: tab "B · Berkarakter" in `.superpowers/brainstorm/3175333-1793117367/content/satu-keluarga.html` (local only).

## Global Constraints

- **Branches.**
  - Integration branch `feat/app-editorial-theme`, created from `main`.
  - PR branches `theme/foundation`, `theme/public` and `theme/app` each target `feat/app-editorial-theme`, not `main` and not each other.
  - Never delete a branch that an open PR targets.
  - The final PR from `feat/app-editorial-theme` to `main` is opened only after the owner approves the full screenshot gallery.
- **CSP.** Production CSP is unchanged. No inline `style` attributes in any rendered markup. Decorative images use plain `<img>` (not `next/image`) with an `eslint-disable-next-line @next/next/no-img-element` comment, as `components/BrandLogo.tsx` does.
- **Landing untouched.** No edits under `components/landing/editorial/` except `AGENTS.md`. `tests/landing` must stay green and the landing baseline screenshot must match.
- **Legacy surfaces.** Out-of-scope surfaces render inside `.legacy-theme`: `/kiosk/[code]`, `/machine/[code]/display` and `/print/**`.
- **Token format.** Every token value in `app/globals.css` and `app/legacy-theme.css` is a 6-digit hex (`#rrggbb`), except the Tailwind-default restores in `app/legacy-theme.css`, which are copied verbatim (oklch) from `node_modules/tailwindcss/theme.css`.
- **Lime.**
  - `bg-lime` always carries ink text.
  - `text-lime` / `ring-lime` only on ink, sidebar or dark surfaces.
  - Lime never encodes a status.
- **Anton.** `font-display` is used only for `MetricCard` values, `QuickAction` numbers and the auth poster band.
- **Status badges.** Every status badge keeps its text label plus its icon.
- **No behavior, route or copy changes.** Two exceptions: the auth back link reads "Kembali ke beranda", and the auth secondary action becomes an outline pill with the same words.
- **Tests.** Tests are `*.test.ts` and build elements with `createElement` (no JSX), as in `tests/landing/editorial.test.ts`.
- **Commits.** Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **gh CLI.** The host's `gh` is 2.45. `gh pr create` works; use `gh api` REST instead of `gh pr edit`.
- **Checks per PR:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:browser -- tests/browser/theme-gallery.spec.ts tests/browser/smoke.spec.ts`.

## Palette (decided values)

All pairs below were checked: text at least 4.5:1, focus rings and input borders at least 3:1.

| Token (`--color-*`) | Light | Dark (`.dark`) |
|---|---|---|
| `background` | `#f0eee5` | `#08150f` |
| `surface` | `#f7f6ef` | `#0e1f17` |
| `surface-soft` | `#e9e7dc` | `#14291f` |
| `foreground` | `#082f22` | `#ecebe2` |
| `muted` | `#454c40` | `#aab3a3` |
| `muted-soft` | `#596053` | `#939c8d` |
| `border` | `#d6d7ca` | `#1f3529` |
| `rule-strong` | `#a4ac9a` | `#3a5244` |
| `input-border` | `#7c8372` | `#5f7666` |
| `ink` / `ink-hover` / `on-ink` | `#082f22` / `#225c3f` / `#f7f6ef` | same |
| `lime` | `#d2f437` | same |
| `accent` | `#d2f437` | same |
| `sidebar` / `sidebar-fg` | `#082f22` / `#f0eee5` | `#0c2219` / `#ecebe2` |
| `sidebar-muted` / `sidebar-label` | `#bfc6b8` / `#b5cf3f` | `#a9b3a5` / `#b5cf3f` |
| `mint` / `mint-soft` | `#e1e7cf` / `#eef0e2` | `#163322` / `#11281b` |
| `brand-50…950` | `#eef0e2 #e1e7cf #c9d4ae #a7b98a #55803f #3d6b3a #225c3f #174a32 #0f3b28 #082f22 #05200f` | 50 `#11281b`, 100 `#163322`, 200 `#1e4430`, 300 `#e2f79a`, 400 `#d2f437`, 500 `#b8d92a`, 950 `#071a11`; others inherit light |
| `red-50…950` | `#f7e6de #f1d4cb #e6b9ab #d7957f #c66a50 #b5462b #9e3420 #8b2314 #6f1c11 #561a10 #2e0c07` | 400 `#e58b70` |
| `amber-50…950` | `#f7edd4 #f2e1b8 #e8cf96 #dcb66a #cf9a3c #b7791f #8f5c0e #6e4500 #5a3906 #472d07 #2a1a03` | 400 `#e0b052` |
| `blue-50…950` | `#e9ecf1 #dde3ee #c5cfe2 #9fb0d0 #7489b8 #4f68a0 #3a5290 #253f78 #1f3461 #1b2b4d #0f182c` | 400 `#97a9d6` |
| `slate-50…950` | `#f5f4ee #e9e8de #dcdbcf #c3c4b5 #9a9e8e #62685a #51574a #40463a #2f352b #1e231c #11140f` | 400 `#a3a99a` |
| `status-online/full/maintenance/error/offline` | `#3d7a2a #b7791f #3a5290 #b5462b #62685a` | `#8fc46a #e0b052 #97a9d6 #e58b70 #a3a99a` |

Fonts:
- `--font-sans: var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif`
- `--font-display: var(--font-anton), Impact, "Arial Narrow", sans-serif`

## Review Focus

These inputs are not exercised by the task tests, so each one gets its own check:

1. **Long metric values at 360px.** Anton values like `Rp 12.345.678` must not cause horizontal overflow on mobile. The gallery seeds a 12,345,678 balance for `userA` and asserts zero overflow on `/dashboard/user` (Task 1).
2. **Keyboard focus on ink surfaces.** Focus on the sidebar, the bottom nav and the emphasis card must stay visible. Task 11 asserts `focus-visible:ring-lime` plus a sidebar-colored ring offset on sidebar and bottom-nav links.
3. **System dark mode on kiosk and print.** These must still render the old dark look. Task 3 asserts that `.dark .legacy-theme` restores the old effective dark values.
4. **Status without color.** After the reskin, every `StatusBadge` still renders an icon and a text label. Task 5 iterates every registered status.
5. **Zero "needs action" metric.** A zero value must not be emphasized. Task 13 renders the admin and superadmin dashboards with the counts at 0 and at a positive number.

## File map

| File | Responsibility | Task |
|---|---|---|
| `tests/browser/theme-gallery.spec.ts` (new) | Before/after screenshots, overflow and axe per page, landing baseline compare | 1, 7, 10, 14 |
| `app/globals.css` | New tokens (light/dark), fonts, texture, base rules | 2, 4 |
| `app/legacy-theme.css` (new) | Old values for `.legacy-theme` and `.dark .legacy-theme` | 3 |
| `app/kiosk/[code]/layout.tsx`, `app/machine/[code]/display/layout.tsx`, `app/print/layout.tsx` (new) | Wrap children in `.legacy-theme` | 3 |
| `tests/theme/css-tokens.ts` (new) | `readBlock`, `contrast` helpers for CSS tests | 2 |
| `tests/theme/palette.test.ts`, `tests/theme/legacy.test.ts`, `tests/theme/fonts.test.ts`, `tests/theme/raw-palette.test.ts` (new) | Token, legacy, font and raw-color guards | 2, 3, 4, 13 |
| `app/layout.tsx`, `public/manifest.webmanifest` | Font loading, theme color | 4 |
| `components/ui/*`, `components/BrandLogo.tsx` | Primitives restyle; `PageHeader.eyebrow`, `MetricCard.emphasis`, `QuickAction.index`, `BrandLogo.surface` | 5, 6 |
| `tests/ui/primitives.test.ts`, `tests/ui/dashboard-primitives.test.ts` (new) | Primitive contracts | 5, 6 |
| `app/(auth)/layout.tsx`, `components/auth/*` | Poster auth layout | 8 |
| `app/(legal)/layout.tsx`, `app/(legal)/**/page.tsx`, `components/legal/*` | Editorial legal pages | 9 |
| `tests/theme/layouts.test.ts` (new) | Auth/legal/AppShell markup contracts | 8, 9, 11 |
| `components/AppShell.tsx` | Style B shell | 11 |
| `components/map/*`, `components/scan/*` | Palette for map and scan | 12 |
| `lib/format.ts` (`formatDayHeading`), dashboard home pages, raw-color files | Eyebrow, emphasis, sweep | 13 |
| `components/landing/editorial/AGENTS.md`, `docs/frontend/editorial-landing.md` | New rule: the app shares the landing language | 2 |

---

## PR 1 — Foundation (`theme/foundation` → `feat/app-editorial-theme`)

### Task 1: Integration branch and theme gallery with baselines

**Files:**
- Create: `tests/browser/theme-gallery.spec.ts`
- Modify: `.gitignore` (add `/tests/browser/*-snapshots/`)
- Commit: `docs/superpowers/specs/2026-10-27-app-editorial-theme-design.md`, `docs/superpowers/plans/2026-10-27-app-editorial-theme.md`

**Interfaces:**
- Produces: `const RESTYLED: Set<string>`, the paths whose axe `color-contrast` result must be empty. Later PR tasks add paths to it.
- Produces: screenshots named `theme-<slug>-<project>.png` in the run's artifact dir.

- [ ] **Step 1: Create the branches.** `git switch -c feat/app-editorial-theme main`, then commit the spec and plan (`docs: app editorial theme design and plan`), then `git push -u origin feat/app-editorial-theme`, then `git switch -c theme/foundation`.

- [ ] **Step 2: Write `tests/browser/theme-gallery.spec.ts`.**
  - Use `test`/`expect` from `../support/browser-fixture` and `AxeBuilder` as in `smoke.spec.ts`.
  - Write one test per actor group, each of which, for every page:
    1. Logs in (`fixture.login(page, actor)`) and goes to the path.
    2. Waits for `page.locator("h1").first()` to be visible.
    3. Asserts `horizontalOverflow ≤ 0`.
    4. Runs axe (`wcag2a`, `wcag2aa`) and asserts no `critical` violations.
    5. When the path is in `RESTYLED`, also asserts `violations.filter(v => v.id === "color-contrast")` equals `[]`.
    6. Calls `artifacts.screenshot(page, "theme-" + slug)`.
  - Pages:
    - `guest`: `/login`, `/register`, `/forgot-password`, `/privacy`, `/terms`, and `/kiosk/${fixture.audit.ids.machineCode}` (screenshot only, no h1 wait).
    - `userA`: after `fixture.audit.seedBalance(12_345_678)` and `fixture.machinesForMap()`, visit `/dashboard/user`, `/dashboard/user/wallet`, `/map`, `/scan`.
    - `collectorA`: `/dashboard/pengepul`.
    - `adminA`: `/dashboard/admin`, `/dashboard/admin/machines`, and `/print/trips/${(await fixture.audit.trip({ bagCount: 2 })).id}` (screenshot only).
    - `superadmin`: `/dashboard/superadmin`, `/dashboard/superadmin/users`, `/dashboard/superadmin/config`, `/dashboard/superadmin/audit`.
  - `RESTYLED` starts empty.
  - Add a separate test `"landing hero is unchanged"`: `page.emulateMedia({ reducedMotion: "reduce" })`, go to `/`, then `await expect(page).toHaveScreenshot("landing-hero.png", { animations: "disabled" })`.

- [ ] **Step 3: Record the baselines on unchanged code.**
  Run: `npm run test:browser -- tests/browser/theme-gallery.spec.ts --update-snapshots`
  Expected: all 6 projects pass, and `tests/browser/theme-gallery.spec.ts-snapshots/landing-hero-*.png` exist.
  Then copy that run's `test-results/audit/browser-*/screenshots/` to `test-results/theme-before/`. These are the "before" images.

- [ ] **Step 4: Confirm the baseline is stable.**
  Run: `npm run test:browser -- tests/browser/theme-gallery.spec.ts`
  Expected: PASS without `--update-snapshots`. If the landing hero differs between two runs, add `mask` for the differing locator and re-record. Do not raise the diff tolerance.

- [ ] **Step 5: Commit** `.gitignore` and `tests/browser/theme-gallery.spec.ts`: `test(theme): gallery of restyled pages with landing baseline`.

### Task 2: Palette tokens and contrast guard

**Files:**
- Create: `tests/theme/css-tokens.ts`, `tests/theme/palette.test.ts`
- Modify: `app/globals.css`, `components/landing/editorial/AGENTS.md`, `docs/frontend/editorial-landing.md`

**Interfaces:**
- Produces: `readBlock(css: string, selector: string): Record<string, string>`. It returns the `--*` declarations of the first top-level block whose selector text equals `selector` exactly (`"@theme"`, `".dark"`, `".legacy-theme"`, `".dark .legacy-theme"`). Keys are without the leading `--`.
- Produces: `contrast(a: string, b: string): number`. WCAG 2 ratio for `#rrggbb`.
- Produces: Tailwind utilities `bg-ink`, `hover:bg-ink-hover`, `text-on-ink`, `bg-lime`, `text-lime`, `ring-lime`, `border-rule-strong`, `border-input-border`, `bg-sidebar`, `text-sidebar-fg`, `text-sidebar-muted`, `text-sidebar-label`, `ring-offset-sidebar`, `font-display` (the last one in Task 4).

- [ ] **Step 1: Write `tests/theme/palette.test.ts`.**
  - It reads `app/globals.css` and `light = readBlock(css, "@theme")`. `dark` is `light` merged with `readBlock(css, ".dark")`.
  - `it("pins the editorial anchors")`: `light.color-background === "#f0eee5"`, `light.color-foreground === "#082f22"`, `light.color-lime === "#d2f437"`, `light.color-ink === "#082f22"`.
  - `it.each` over these `[theme, fg, bg, min]` rows, asserting `contrast(T[fg], T[bg]) >= min`:
    - **Light:**
      - `foreground` on `background`, `surface`, `surface-soft`: 7
      - `muted` on `background`, `surface-soft`: 4.5
      - `muted-soft` on `surface`, `background`: 4.5
      - `input-border` on `surface`: 3
      - `brand-400` on `background`: 3
      - `on-ink` on `ink`, `ink-hover`: 4.5
      - `ink` on `lime`: 4.5
      - `sidebar-fg`, `sidebar-muted`, `sidebar-label` on `sidebar`: 4.5
      - `brand-600`, `brand-700` on `background`: 4.5
      - `brand-700` on `brand-50`: 4.5
      - `red-700` on `red-50`, `amber-700` on `amber-50`, `blue-700` on `blue-50`, `slate-600` on `slate-100`: 4.5
      - `slate-500` on `surface`: 4.5
      - `status-error` on `background`: 4.5
      - `status-online`, `status-full`, `status-maintenance`, `status-offline` on `background`: 3
    - **Dark:**
      - `foreground` on `background`, `surface-soft`: 7
      - `muted` on `background`, `surface-soft`: 4.5
      - `muted-soft` on `surface`: 4.5
      - `input-border` on `surface`: 3
      - `brand-400` and `brand-300` on `surface`: 4.5
      - `sidebar-muted`, `sidebar-label` on `sidebar`: 4.5
      - `red-400`, `amber-400`, `blue-400`, `slate-400`, `status-error` on `surface`: 4.5
  - `it("writes every token as #rrggbb")`: every value in both blocks whose key starts with `color-` matches `/^#[0-9a-f]{6}$/`.

- [ ] **Step 2: Run it.** `npx vitest run tests/theme/palette.test.ts`. Expected: FAIL, because `color-lime` is undefined.

- [ ] **Step 3: Rewrite the token blocks in `app/globals.css`** with the Palette table: `@theme` holds the light values and all new tokens; `.dark` holds the dark column.
  - Keep the existing scrollbar, `::selection` and `.reloop-landing h1…` rules.
  - Change `::selection` to `bg lime / color ink`.
  - Scrollbar thumb: `var(--color-rule-strong)` in light, `#2b4436` in dark.

- [ ] **Step 4: Run it.** Same command. Expected: PASS.

- [ ] **Step 5: Update the docs.**
  - Replace the "Do not weaken CSP or change the rest of the app's theme" sentence in `AGENTS.md` with: "The whole app shares this visual language (see `docs/superpowers/specs/2026-10-27-app-editorial-theme-design.md`); the landing composition itself stays fixed, and CSP must not be weakened."
  - In `docs/frontend/editorial-landing.md`, replace "auth/dashboard/legal surfaces retain their existing theme" with "auth, dashboard and legal surfaces share the landing palette through `app/globals.css` tokens".

- [ ] **Step 6: Commit** `feat(theme): editorial palette tokens with contrast guard`.

### Task 3: Legacy scope for kiosk, machine display and print

**Files:**
- Create: `app/legacy-theme.css`, `app/kiosk/[code]/layout.tsx`, `app/machine/[code]/display/layout.tsx`, `app/print/layout.tsx`, `tests/theme/legacy.test.ts`
- Modify: `app/globals.css` (add `@import "./legacy-theme.css";` after the Tailwind import)

**Interfaces:**
- Consumes: `readBlock` from Task 2.
- Produces: the class `legacy-theme` (old tokens, old font via `var(--font-jakarta)`, `min-h-screen`, old background).

- [ ] **Step 1: Write `tests/theme/legacy.test.ts`.**
  - `OLD_LIGHT` and `OLD_DARK` are literal objects copied from `git show main:app/globals.css`: every `--color-*` in `@theme`, and every `--color-*` in `.dark`.
  - `it("restores every app token the new theme sets")`: for each key in `readBlock(globals, "@theme")` that exists in `OLD_LIGHT`, `readBlock(legacy, ".legacy-theme")[key] === OLD_LIGHT[key]`.
  - `it("restores Tailwind defaults for the warmed scales")`: for each `color-(red|amber|blue|slate)-N` in the new `@theme`, the legacy value equals that key's value in `node_modules/tailwindcss/theme.css`.
  - `it("restores the old dark values")`: for each key in the new `.dark` block, `readBlock(legacy, ".dark .legacy-theme")[key]` equals `OLD_DARK[key] ?? OLD_LIGHT[key] ?? tailwindDefault[key]`.
  - `it("wraps every legacy route")`: `renderToStaticMarkup` each of the three layouts with a child `<p>x</p>` and expect `class="legacy-theme"` around it.

- [ ] **Step 2: Run it.** `npx vitest run tests/theme/legacy.test.ts`. Expected: FAIL (the files don't exist).

- [ ] **Step 3: Implement `app/legacy-theme.css` and the three layouts.**
  - The CSS sets `font-family: var(--font-jakarta), ui-sans-serif, system-ui, sans-serif`, `background-color: var(--color-background)`, `color: var(--color-foreground)` and `min-height: 100vh`.
  - Each layout returns `<div className="legacy-theme">{children}</div>`.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(theme): pin kiosk, machine display and print to the legacy look`.

### Task 4: Fonts, paper texture, theme color

**Files:**
- Modify: `app/layout.tsx`, `app/globals.css`, `public/manifest.webmanifest`
- Test: `tests/theme/fonts.test.ts`

**Interfaces:**
- Produces: CSS variables `--font-dm-sans` and `--font-anton` on `<html>`; `--font-jakarta` stays, with `preload: false`. Produces utility `font-display`.

- [ ] **Step 1: Write `tests/theme/fonts.test.ts`.**
  - `viewport.themeColor === "#082f22"` (import `viewport` from `@/app/layout`; mock `next/font/local` to return `{ variable: "v" }`).
  - The manifest JSON has `theme_color: "#082f22"` and `background_color: "#f0eee5"`.
  - `readBlock(globals, "@theme")["font-display"]` contains `var(--font-anton)`, and `font-sans` starts with `var(--font-dm-sans)`.
  - `globals.css` contains `/landing/paper-v2.webp`.
  - The `.dark` rules hide the texture: assert a rule matching `/\.dark\s+body::before\s*\{[^}]*display:\s*none/`.

- [ ] **Step 2: Run it.** `npx vitest run tests/theme/fonts.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`app/layout.tsx`:** add `localFont` instances `dmSans` (`../public/landing/fonts/dm-sans-400.ttf` weight 400, `dm-sans-700.ttf` weight 700, `variable: "--font-dm-sans"`) and `anton` (`anton.ttf`, `variable: "--font-anton"`). Put all three variables on `<html className>`, set `preload: false` on Jakarta, and set `themeColor: "#082f22"`.
  - **Texture in `globals.css`:** `body::before { content:""; position:fixed; inset:0; z-index:-1; pointer-events:none; background:url("/landing/paper-v2.webp") repeat; background-size:900px; mix-blend-mode:multiply; opacity:.42 }` and `.dark body::before { display:none }`. `.legacy-theme` already paints an opaque background over it.

- [ ] **Step 4: Run it.** Expected: PASS. Then run `npm run build`. Expected: success.

- [ ] **Step 5: Commit** `feat(theme): DM Sans and Anton, paper texture, forest theme color`.

### Task 5: Base primitives

**Files:**
- Modify: `components/ui/Button.tsx`, `Card.tsx`, `FormField.tsx`, `Badge.tsx`, `StatusBadge.tsx`, `EmptyState.tsx`, `Skeleton.tsx` (`Skeleton`, `TableSkeleton` only), `PagePagination.tsx`, `Timeline.tsx`, `ThemeToggle.tsx`, `components/BrandLogo.tsx`
- Test: `tests/ui/primitives.test.ts`

**Interfaces:**
- Produces: `BrandLogo` prop `surface?: "auto" | "dark"`, default `"auto"`. `"dark"` renders only `/reloop-logo-name-dark.svg` (one `<img>`, no `dark:hidden` pair).
- Produces: `StatusBadge` exports `STATUS_KEYS: readonly string[]`, the keys of its registry.

- [ ] **Step 1: Write `tests/ui/primitives.test.ts`.**
  - **Button:**
    - `buttonVariants()` contains `bg-ink`, `text-on-ink`, `hover:bg-ink-hover`, `rounded-full`, `dark:bg-lime` and `dark:text-ink`.
    - `buttonVariants({ variant: "outline" })` contains `border-input-border` and `rounded-full`.
    - `buttonVariants({ variant: "danger" })` contains `bg-status-error`.
  - **Card:** the `Card` markup contains `rounded-2xl` and no `shadow-[`.
  - **Input:** markup contains `border-input-border`, `focus:border-foreground` and `focus:ring-lime`.
  - **StatusBadge:** `it.each(STATUS_KEYS)` asserts the markup contains `<svg` and the registry label text.
  - **BrandLogo:** `surface: "dark"` renders exactly one `<img` with `src="/reloop-logo-name-dark.svg"`.
  - **CSP:** every rendered markup in this file `not.toMatch(/\sstyle=/)`.

- [ ] **Step 2: Run it.** `npx vitest run tests/ui/primitives.test.ts`. Expected: FAIL.

- [ ] **Step 3: Restyle the primitives** to the spec's "Logged-in app" bullets.
  - **Button:**
    - Pill shape.
    - primary: `bg-ink text-on-ink hover:bg-ink-hover dark:bg-lime dark:text-ink dark:hover:bg-brand-300`.
    - secondary: `border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100 dark:text-foreground`.
    - outline: `border-input-border bg-transparent`.
    - Focus ring: `focus-visible:ring-brand-400 ring-offset-background`.
  - **Card:** `rounded-2xl border-border bg-surface`, no shadow. `CardHeader` has a transparent background, and `CardTitle` gets `tracking-[-0.03em]`.
  - **Inputs:**
    - Controls: `rounded-[14px] border-input-border bg-surface focus:border-foreground focus:ring-4 focus:ring-lime`.
    - In dark, `focus:border-lime`.
    - `Label` is bold.
  - **Badge / StatusBadge:**
    - Shape becomes `rounded-full font-bold`.
    - `toneClasses` keeps its structure. `success` uses brand tints, and `neutral` uses `slate` with no `dark:` overrides beyond the existing ones.
  - **EmptyState:** `rounded-2xl border-rule-strong` dashed, with the icon chip `rounded-full`.
  - **Skeleton:** `Skeleton` and `TableSkeleton` match the new radius.
  - **PagePagination and ThemeToggle:** pills.
  - **Timeline:** raw colors replaced by tokens.

- [ ] **Step 4: Run it.** Expected: PASS. Then run `npm test`. Expected: all suites pass; update any existing assertion that pinned an old class, and name it in the commit body.

- [ ] **Step 5: Commit** `feat(ui): editorial base primitives`.

### Task 6: Dashboard primitives with new props

**Files:**
- Modify: `components/ui/PageHeader.tsx`, `MetricCard.tsx`, `QuickAction.tsx`, `DataTable.tsx`, `Skeleton.tsx` (`MetricCardSkeleton`, `PageHeaderSkeleton`), `components/machine/FillLevelBar.tsx`
- Modify (callers of `QuickAction`): `app/dashboard/{user,pengepul,admin,superadmin}/page.tsx`
- Test: `tests/ui/dashboard-primitives.test.ts`

**Interfaces:**
- Produces: `PageHeader({ title, description?, actions?, eyebrow?: ReactNode, className? })`.
- Produces: `MetricCard({ label, value, hint?, icon?, tone?, emphasis?: boolean, className? })`. `tone` is kept for compatibility and has no visual effect. `emphasis` renders `data-emphasis="true"` on the root.
- Produces: `QuickAction({ href, title, description, index: number })`. The `icon` and `tone` props are removed, and the number renders as `String(index).padStart(2, "0")`.

- [ ] **Step 1: Write `tests/ui/dashboard-primitives.test.ts`.**
  - **PageHeader:**
    - With `eyebrow: "Selasa, 27 Oktober"`, the markup contains that text inside an element with `bg-lime` and `-rotate-[1.5deg]`.
    - Without an eyebrow, there is no `bg-lime`.
    - Neither case contains `bg-brand-500` (the old accent bar).
  - **MetricCard:**
    - The value element has `font-display`.
    - Rendering with `tone: "green"` and with `tone: "amber"` (same label and value) yields identical markup.
    - `emphasis: true` adds `data-emphasis="true"`, `bg-ink` and `text-lime`. `emphasis: false` has none of those three.
  - **FillLevelBar:** `percent: 50` renders `fill-ink` and `dark:fill-lime`; `percent: 85` renders `fill-amber-500`.
  - **QuickAction:** `index: 3` renders `03` inside a `font-display` element, and the output has no icon chip, i.e. none of `bg-brand-600`, `bg-blue-600`, `bg-amber-500`, `bg-teal-600`.
  - **DataTable:** the header cells contain `text-foreground` and the row contains `border-rule-strong`. No shadow.
  - All of the above render without `style=`.

- [ ] **Step 2: Run it.** `npx vitest run tests/ui/dashboard-primitives.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **PageHeader:** no band or accent bar. Title `text-3xl sm:text-[2.75rem] font-bold leading-[1.04] tracking-[-0.06em]`.
  - **MetricCard:**
    - Neutral card with an uppercase label.
    - Value `font-display text-4xl sm:text-[2.75rem] leading-none break-words`.
    - Round neutral icon chip.
    - Emphasis: `bg-ink border-ink text-on-ink`, value `text-lime`, chip `bg-lime text-ink`, hint and label `text-sidebar-muted`. In dark, the emphasis card adds `dark:border-lime/50`.
  - **QuickAction:** bordered `rounded-2xl` tile. Number in `font-display text-3xl text-muted-soft` that turns `group-hover:text-foreground group-focus-visible:text-foreground`. Arrow on the right.
  - **Skeletons:** match the new shapes.
  - **FillLevelBar:** `fill-brand-500` becomes `fill-ink dark:fill-lime`. The amber threshold (≥ 80) is unchanged.
  - **Dashboard pages:** in the four pages, replace `icon`/`tone` on each `QuickAction` with `index={1…n}` in their current order. Drop icon imports that become unused.

- [ ] **Step 4: Run it.** Expected: PASS. Then run `npm run typecheck && npm test`. Expected: PASS (`tests/dashboard/superadmin-page.test.ts` still green).

- [ ] **Step 5: Commit** `feat(ui): editorial page header, metric emphasis, numbered quick actions`.

### Task 7: PR 1 verification and pull request

- [ ] **Step 1: Run the checks.** `npm run typecheck && npm run lint && npm test && npm run build`. Expected: all green; lint has only the 3 known `BrandLogo.tsx` warnings or fewer.
- [ ] **Step 2: Run the browser tests.** `npm run test:browser -- tests/browser/theme-gallery.spec.ts tests/browser/smoke.spec.ts`. Expected: PASS, including `landing hero is unchanged`.
- [ ] **Step 3: Compare screenshots.** Put `test-results/theme-before/` next to the new screenshots for login, the four dashboard homes, kiosk and print, in light and dark. Kiosk and print must look identical; anything else is a defect to fix before continuing. Present the pairs to the owner in the visual companion.
- [ ] **Step 4: Open the PR.** `git push -u origin theme/foundation`, then `gh pr create --base feat/app-editorial-theme --title "feat(theme): editorial foundation" --body …`. The body lists the token decisions and points to the screenshot review, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Merge only after the owner approves.

## PR 2 — Public pages (`theme/public` from `feat/app-editorial-theme` after PR 1 merges)

### Task 8: Poster auth layout

**Files:**
- Modify: `app/(auth)/layout.tsx`, `components/auth/AuthForm.tsx`, `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`, `EmailTokenAction.tsx`; the auth pages only where they carry their own color classes.
- Test: `tests/theme/layouts.test.ts` (create)

**Interfaces:**
- Consumes: `buttonVariants`, `Input`, `FormField` (Task 5); `BrandLogo` (Task 5).

- [ ] **Step 1: Write the `describe("auth layout")` block** in `tests/theme/layouts.test.ts`. Render `AuthLayout({ children: createElement("h1", null, "Masuk ke ReLoop") })`.
  - The markup contains `/landing/heading-v2.webp`, `/landing/slogan-v2.webp`, `/landing/bottle-v2.webp`, `/landing/mark.svg` and `SETOR. PUTAR. ULANG.`
  - The poster container has `aria-hidden="true"`, and every `<img` inside it has `alt=""`.
  - Exactly one `<h1`.
  - A link `href="/"` with text `Kembali ke beranda`.
  - The poster band uses `font-display`.
  - No `style=`.
  - None of `bg-brand-950`, `lime-300` or `shadow-[0_24px`.

- [ ] **Step 2: Run it.** `npx vitest run tests/theme/layouts.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the spec's "Public pages → Auth" section.
  - **Poster panel** (hidden below `lg`): on paper with the four assets placed as in Mockup 2. The lime band reads "SETOR. PUTAR. ULANG." three times with `mark.svg`, static and rotated about −4.5°. © year at the bottom.
  - **Poster in dark mode.** It stays light paper. Add a class `.light-island` to `app/globals.css`: under `.dark .light-island` it re-declares `--color-background`, `--color-foreground` and `--color-muted` to their light values. Give the poster container `light-island bg-background text-foreground`. Add to the Step 1 test that the poster container has `light-island`, and to `palette.test.ts` that `readBlock(css, ".dark .light-island")` equals the light values of those three tokens.
  - **Form side:** the form sits directly on paper; the card wrapper is removed. Below `lg`, logo plus a thin rotated lime band above the form. Back link "Kembali ke beranda" is underlined.
  - **AuthForm:**
    - Submit is `Button` size `lg`, `w-full justify-between`, with a trailing `ArrowRight` that is hidden while loading.
    - The "Belum punya akun? / Sudah punya akun?" line becomes a divider label above an outline-pill `Link` with the same words ("Daftar" / "Masuk"), keeping its `next` query.
    - Link colors become `text-foreground underline`.
  - **Other forms:** replace their raw colors with tokens.

- [ ] **Step 4: Run it.** Expected: PASS. Then run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(auth): poster layout from landing artwork`.

### Task 9: Editorial legal pages

**Files:**
- Modify: `app/(legal)/layout.tsx`, `app/(legal)/privacy/page.tsx`, `terms/page.tsx`, `data-deletion/page.tsx`, `account-deletion/page.tsx`, `account-deletion/confirm/page.tsx`, `components/legal/AccountDeletionForm.tsx`, `DataDeletionForm.tsx`, `AccountDeletionConfirm.tsx`
- Test: `tests/theme/layouts.test.ts`

- [ ] **Step 1: Add `describe("legal layout")`.**
  - Links `/privacy`, `/terms` and `/account-deletion` are present, plus `← Beranda`.
  - No `backdrop-blur`.
  - No `style=`.
  - For each legal page's default export, `renderToStaticMarkup(await Page(props))` has its `<h1` with `tracking-[-0.06em]`. Pass `{ searchParams: Promise.resolve({}) }` to pages that take props.

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the spec's "Legal" section.
  - Paper header with a rule.
  - `h1`: `text-4xl sm:text-5xl font-bold tracking-[-0.06em]`.
  - Section `h2` elements sit under a `border-t border-rule-strong pt-8`.
  - Raw colors become tokens.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(legal): editorial reading layout`.

### Task 10: PR 2 verification and pull request

- [ ] **Step 1: Mark the public pages as restyled.** Add `/login`, `/register`, `/forgot-password`, `/privacy`, `/terms` to `RESTYLED` in `theme-gallery.spec.ts`, then commit `test(theme): require contrast on public pages`.
- [ ] **Step 2: Run the checks.** Same as Task 7 Steps 1–2. Expected: PASS, with zero `color-contrast` violations on the public pages in all 6 projects.
- [ ] **Step 3: Review and open the PR.** Before/after review of login, register, privacy and terms in light, dark, mobile and desktop with the owner. Then `gh pr create --base feat/app-editorial-theme --title "feat(theme): editorial public pages"`, and merge after approval.

## PR 3 — Logged-in app (`theme/app` from `feat/app-editorial-theme` after PR 2 merges)

### Task 11: AppShell style B

**Files:**
- Modify: `components/AppShell.tsx`
- Test: `tests/theme/layouts.test.ts`

**Interfaces:**
- Consumes: `BrandLogo` `surface: "dark"` (Task 5).

- [ ] **Step 1: Add `describe("app shell")`.**
  - `vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/admin", useRouter: () => ({ push() {}, refresh() {} }) }))` and stub `@/components/notifications/NotificationBell` to render `null`.
  - Render `AppShell` for an ADMIN user and assert:
    - The `<aside` contains `bg-sidebar`.
    - The active "Dashboard" link contains `bg-lime` and `text-ink`.
    - Every sidebar link contains `focus-visible:ring-lime` and `focus-visible:ring-offset-sidebar`.
    - Inside `<aside`, only `/reloop-logo-name-dark.svg` appears.
    - The bottom `nav[aria-label="Navigasi utama"]` contains `bg-sidebar`, and its links contain `focus-visible:ring-lime`.
    - No `style=`.

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Sidebar:**
    - `bg-sidebar text-sidebar-fg` with an `border-r border-border` right edge.
    - Group labels `text-sidebar-label`.
    - Inactive links `text-sidebar-muted hover:bg-white/10 hover:text-sidebar-fg`; the active link is a lime pill with ink text and icon. The left accent bar and the icon boxes are removed.
    - Org block `bg-white/5`.
    - Avatar `rounded-full bg-lime text-ink`.
  - **Top bar:** `bg-background/95` with a rule; avatar and current-page chip are round.
  - **Mobile header:** stays paper.
  - **Bottom nav:**
    - `bg-sidebar` with the active item a lime pill and inactive items `text-sidebar-muted`.
    - The emphasized Scan button is a lime circle with an ink icon and a `ring-sidebar` ring.
  - **"Menu lainnya" sheet:** paper. Its active item is `bg-ink text-on-ink` with a lime icon.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(shell): ink sidebar and lime active navigation`.

### Task 12: Map and scan

**Files:**
- Modify: `components/map/map-markers.css`, `components/map/MapLegend.tsx`, `components/map/MapView.tsx` (only if it carries palette hex beyond the white inner circle), `components/scan/ScanPageClient.tsx`, `components/scan/QrScanner.tsx`
- Test: `tests/theme/palette.test.ts` (add a case)

- [ ] **Step 1: Add the failing case.** `it("map markers use status tokens")`: `map-markers.css` has `.rl-status--online { color: var(--color-status-online)` (and the same for full, maintenance, error and offline) and contains no `#0d9488`. `MapLegend.tsx` contains no `bg-[#`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Markers:** status colors become `var(--color-status-*)`. The campaign pin gets `background: var(--color-ink); color: var(--color-lime)`. Popup text uses `var(--color-foreground)` / `var(--color-muted)` and `font-family: var(--font-sans)`.
  - **Legend:** dots become `bg-status-*`, and the campaign dot becomes `bg-ink text-lime`.
  - **Scan:** raw colors become tokens.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): status tokens for markers and legend`.

### Task 13: Page sweep, dashboard eyebrow and emphasis

**Files:**
- Create: `tests/theme/raw-palette.test.ts`, `tests/dashboard/admin-page.test.ts`
- Modify: `lib/format.ts`, `tests/lib/format.test.ts`, `tests/dashboard/superadmin-page.test.ts`
- Modify (dashboard homes): `app/dashboard/{user,pengepul,admin,superadmin}/page.tsx`
- Modify (raw-color files): `app/dashboard/user/trash-bag/page.tsx`, `components/travel-agent/TravelAgentManager.tsx`, `components/trip/TripManager.tsx`, `components/admin/ConfigEditor.tsx`, `components/profile/EmailVerificationCard.tsx`, `components/machine/MachineActivityPanel.tsx`, `components/machine/MachineRemoteConsole.tsx`, plus any file the guard reports

**Interfaces:**
- Produces: `formatDayHeading(value: Date): string`. Uses `Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jakarta" })`.

- [ ] **Step 1: Write the failing tests.**
  - **`tests/lib/format.test.ts`:** `formatDayHeading(new Date("2026-10-26T18:30:00Z")) === "Selasa, 27 Oktober"`.
  - **`tests/theme/raw-palette.test.ts`:** walk `app/**/*.tsx` and `components/**/*.tsx`, excluding `components/landing/**`, `app/print/**`, `app/kiosk/**`, `app/machine/**`, `components/machine/MachineDisplay.tsx` and `components/trip/PrintControls.tsx`. Expect zero matches of:
    - `/\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:emerald|teal|green|lime|gray|zinc|neutral|stone|sky|cyan|indigo|violet|purple|pink|rose|orange|yellow)-\d{2,3}\b/`
    - `/\b(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/`
  - On failure, report `file:line`.
  - **`tests/dashboard/superadmin-page.test.ts`:** with `organizationCollectorPartner.count` → 0, the rendered page (`renderToStaticMarkup(await SuperadminDashboardPage())`) has no `data-emphasis`. With → 3, it has exactly one. It contains the `formatDayHeading` output for a fixed `vi.setSystemTime(new Date("2026-10-26T18:30:00Z"))`.
  - **`tests/dashboard/admin-page.test.ts`:** same pattern for `/dashboard/admin`. Mock its prisma counts following `superadmin-page.test.ts`. "Perlu perhatian" at 0 → no emphasis; at 2 → exactly one.

- [ ] **Step 2: Run them.** `npx vitest run tests/lib/format.test.ts tests/theme/raw-palette.test.ts tests/dashboard`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`formatDayHeading`:** add it to `lib/format.ts`.
  - **Eyebrow:** pass `eyebrow={formatDayHeading(new Date())}` to `PageHeader` on the four dashboard homes.
  - **Emphasis**, passed only when the value is greater than 0:
    - admin "Perlu perhatian" (`offlineMachines`)
    - pengepul "Tugas aktif" (`taskCount`)
    - superadmin "Kemitraan pending" (`pendingPartners`)
    - The user dashboard has none.
  - **Raw-color sweep:**
    - green families → `brand-*`
    - `gray`/`zinc` → `slate` or tokens
    - `lime-*` → `lime` on ink only
    - `teal` → `brand` or `blue` by meaning
  - Leave red, amber, blue and slate classes as they are (warmed by tokens).

- [ ] **Step 4: Run them.** Expected: PASS. Then run `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(theme): dashboard eyebrow and emphasis, sweep raw palette`.

### Task 14: PR 3 verification, pull request, release

- [ ] **Step 1: Mark the app pages as restyled.** Add every logged-in gallery path to `RESTYLED`, then commit `test(theme): require contrast on app pages`.
- [ ] **Step 2: Run the checks.** Same as Task 7 Steps 1–2, plus `npm run test:browser -- tests/browser/render-qr-map.spec.ts tests/browser/wallet-held.spec.ts`. Expected: PASS, with zero `color-contrast` violations on all restyled pages, `/dashboard/user` without overflow at `mobile-360`, and the landing unchanged.
- [ ] **Step 3: Review and merge PR 3.** Owner review of the dashboards, map, scan, wallet, superadmin table and form pages, kiosk and print (unchanged), in light and dark, mobile and desktop. Then `gh pr create --base feat/app-editorial-theme --title "feat(theme): editorial logged-in app"`, and merge after approval.
- [ ] **Step 4: Run the full set on the integration branch.** Update `feat/app-editorial-theme` from `main`, then rerun Task 7 Steps 1–2 on it and repeat the full gallery review with the owner.
- [ ] **Step 5: Release.** `gh pr create --base main --head feat/app-editorial-theme --title "feat(theme): app-wide editorial theme"`. Merge only on the owner's explicit go, and delete `feat/app-editorial-theme` only after that merge.
