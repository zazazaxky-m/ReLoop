# App-wide editorial theme — design

Date: 2026-10-27. Status: agreed in conversation; awaiting approval of this document.

## Intent

The public landing page (`/`) was rebuilt as an approved editorial poster (PR #6, `components/landing/editorial/`). Every other page still uses the older app theme: mint-white background, bright green `#16a34a`, Plus Jakarta Sans, white cards with soft shadows. The product now looks like two products.

The owner wants every page to feel like **the same family** as the landing page. For working surfaces (dashboards), comfort during a full working day matters more than poster expressiveness. Public pages that people pass through briefly (login, register, legal) may sit closer to the poster.

Two directions were mocked up for the admin dashboard: "A · Kalem" (paper sidebar, minimal lime) and "B · Berkarakter". **The owner chose B.** The login mockup was accepted as shown.

Reference mockup (local only, git-excluded): `.superpowers/brainstorm/3175333-1793117367/content/satu-keluarga.html`. Serve it with the brainstorm companion, or open it next to its copied assets in the same folder. Use the "B · Berkarakter" tab for the dashboard and "Mockup 2" for login. The rules below are the contract. The mockup illustrates them, and its pixel values are not normative unless they are restated here.

## Goals

- One visual language across the landing page, public pages and the logged-in app.
- Dashboards stay calm and legible for long sessions: dense tables, forms, status at a glance.
- Change things at the root (tokens, fonts, UI primitives, layout shells) so the ~55 pages follow automatically. Page-level edits only where a page bypasses tokens.

## Non-goals

- No changes to layout structure, navigation items, routes, copy, data, permissions or behavior. This is a reskin.
- No poster artwork or motion inside the logged-in app: no photos, ribbons, tickers or scroll effects.
- The landing page itself does not change. It must stay pixel-identical and `tests/landing` must pass.
- Out of scope, and must look unchanged afterwards: kiosk (`/kiosk/[code]`), machine display (`/machine/[code]/display`), trip print page (`/print/trips/[id]`).
- Also out of scope: the Flutter app (`mobile/`), RVM code, transactional emails (`lib/account-email.ts`, `lib/mailer.ts`), the OG image (`app/opengraph-image.tsx`).

## Anti-goals (failure even if it "works")

- Dashboards that feel like a poster: hard to scan, display type in body text, low contrast.
- Lime used as text on paper (it fails contrast) or used to mean a status.
- Status meaning lost. Online / full / maintenance / error / offline must stay distinguishable and always carry a text label plus an icon, never color alone (existing rule in `app/globals.css` and `components/ui/StatusBadge.tsx`).
- Kiosk or machine display visibly changing. Both render `components/machine/MachineDisplay.tsx`, which uses the shared semantic tokens, so a naive global token change would restyle them.
- Weakened CSP or new inline `style` attributes. Production CSP forbids them.
- Any landing regression.

## Constraints

- Tailwind v4 tokens live in `app/globals.css` (`@theme`). Dark mode is the `.dark` class via `next-themes` (`defaultTheme="system"`, toggle in `components/ui/ThemeToggle.tsx`).
- Fonts are self-hosted only. DM Sans 400/700 and Anton are already in `public/landing/fonts/` with OFL licences. Plus Jakarta Sans is loaded through `next/font/local` in `app/layout.tsx`.
- Production CSP: no inline style attributes, no relaxing CSP (see `docs/frontend/editorial-landing.md`).
- `components/landing/editorial/AGENTS.md` currently says "Do not … change the rest of the app's theme to support this landing page". The owner has reversed that. Replace it with the new rule: the whole app shares this visual language, and the landing composition itself stays fixed. Update the matching sentence in `docs/frontend/editorial-landing.md`.
- `public/manifest.webmanifest` (`theme_color`, `background_color`) and `viewport.themeColor` in `app/layout.tsx` move to the new palette.
- Treat `main` as production. It carries a "Deploy to VPS" job; as of 2026-10-27 that job is not set up yet, but it will deploy every merge once it is.
- Text contrast WCAG AA: 4.5:1 for body text, 3:1 for large text and UI boundaries. Applies in both light and dark.

## Visual language (decided)

The source of truth is the landing's own tokens in `components/landing/editorial/landing.css`.

| Role | Value |
|---|---|
| Paper (page background) | `#f0eee5` |
| Ink (text, primary actions, dark surfaces) | `#082f22`, hover `#225c3f` |
| Lime (accent) | `#d2f437` |
| Muted text | `#454c40` |
| Strong rule | `#a4ac9a` |
| Card surface (mockup) | lighter paper, around `#f7f6ef`, with soft rule around `#d6d7ca` |

- **Texture.** The paper grain from the landing (`/landing/paper-v2.webp`, multiply) appears on app backgrounds. It must stay subtle, never reduce text legibility, never intercept pointer events, and must not make long tables janky to scroll.
- **Depth.** No drop shadows on cards. Separation comes from 1px rules and the slight surface tone change.
- **Type.**
  - DM Sans (400/700) everywhere, replacing Plus Jakarta Sans. Headings are 700 with tight negative tracking, tighter as size grows (roughly −0.03em on small headings to −0.06em on page titles).
  - Anton only for display numerals (metric values, quick-action numbers) and big display moments on public pages. Never use it for labels, body text or table cells.
- **Shapes.** Buttons are pills (fully rounded). Cards around 16px radius, inputs around 14px. Icon chips are circular.
- **Icons.** Keep the app's existing icon set (`components/ui/icons.tsx`).
- **Lime rules.**
  - Lime as a fill (active nav pill, highlight tag, focus ring, count badge) always carries ink text or icon.
  - Lime as text or icon is allowed only on ink or dark surfaces.
  - Lime is never a status color.

## Logged-in app (dashboard style B)

Applies to everything rendered inside `components/AppShell.tsx`: all `/dashboard/**` pages for USER, PENGEPUL, ADMIN and SUPERADMIN, plus `/map` and `/scan` (both live inside AppShell).

- **Sidebar.**
  - Ink background. Paper text, dimmed for inactive items. Group labels in lime at reduced opacity.
  - Active item is a lime pill with ink text and icon. Count badges are translucent paper, inverted on the active item.
  - Logo uses the light-text variant `/reloop-logo-name-dark.svg`. The org block and user footer are restyled to match.
- **Top bar.** Paper background with a 1px rule below. Icon buttons sit on the card surface with a rule border.
- **`PageHeader`.**
  - Large DM Sans 700 title (the mockup uses about 44px on desktop), muted description. The green vertical accent bar goes away.
  - Optional eyebrow, rendered as a small lime tag rotated about −1.5°. The mockup shows the date on a dashboard home page.
- **`MetricCard`.**
  - Neutral paper card. Value in Anton, large. Uppercase small-tracked label. Icon in a circular neutral chip.
  - The colored top borders and per-tone colors (`tone` prop: green/blue/amber/teal/slate) collapse to neutral. Keep the prop for API compatibility.
  - Add one **emphasis** variant: ink card, lime value, lime icon chip. Use it for the single metric that needs action, at most one per page.
- **`QuickAction`.** Numbered `01…0n` in Anton, grey at rest and ink on hover/focus, with an arrow at the right. No icon chip.
- **`DataTable`.** Header is uppercase, small and ink, with a strong rule under it. Row rules are soft, no zebra striping. Links are underlined.
- **`Badge` / `StatusBadge`.** Tinted pill. `StatusBadge` keeps its existing per-status icon in the leading position where the mockup shows a dot; the "text label + icon" rule in `StatusBadge.tsx` and `app/globals.css` stays. Plain `Badge` without an icon may use the dot. Hues stay as they are today but are warmed to sit on paper; the mockup's ok / warn / info / error values are a good start. Offline gets the same treatment.
- **Buttons.** Primary is an ink pill with paper text. Outline is a pill with a strong-rule border. Ghost stays minimal. Danger stays in the red family.
- **Forms (`FormField` and inputs).** 1px rule border on a lighter paper background. Focus is an ink border plus a lime ring.
- **Focus-visible (app-wide).** Must be clearly visible on paper, on ink, and on lime surfaces.
- **Capacity and progress bars (`FillLevelBar` etc.).** Ink fill, switching to amber when nearly full (same threshold as today).
- **Mobile.** Keep the current mobile header and bottom nav structure; only the colors follow B. The active state must read consistently with the sidebar (lime pill, ink content).
- **Map.** Markers (`components/map/map-markers.css`, `MapLegend`) move to the palette. Machine statuses stay distinguishable.
- **Everything else** (notifications bell, modals, toasts, skeletons, empty states, timeline, pagination) follows the tokens and primitives.

## Public pages (closer to the poster)

### Auth

Covers login, register, forgot-password, reset-password, verify-email and accept-invitation (`app/(auth)/layout.tsx` and pages). Follows "Mockup 2".

- **Left panel (lg and up).** A poster on paper reusing landing assets:
  - Logo, `heading-v2.webp` ("Selesai dipakai."), `slogan-v2.webp`, and the `bottle-v2.webp` cutout.
  - A static lime band reading "SETOR. PUTAR. ULANG." with `mark.svg` (no animation).
  - © year at the bottom.
  - All of it is decorative: `aria-hidden` / empty alt. The page's `<h1>` stays in the form.
- **Right side.**
  - The form on paper: uppercase eyebrow, large DM Sans title, inputs as above.
  - Full-width ink pill submit with an arrow, and an outline pill as the secondary action.
  - An underlined "Kembali ke beranda" link.
- **Below lg.** The poster panel stays hidden, as it is today. Mobile shows the logo, paper texture, and a thin lime band above the form.

### Legal

Covers privacy, terms, data-deletion, account-deletion and its confirm page (`app/(legal)/layout.tsx`). An editorial reading page: paper background, ink text, DM Sans, a large title, comfortable line length, rules between sections. The header has the logo and "← Beranda"; the footer keeps its links. No poster artwork.

## Dark mode

Kept, as the dark counterpart of B.

- Deep forest/ink backgrounds, paper-colored text, lime accent unchanged. On dark, lime may be used as text and icon color.
- Status hues adapted for dark. All text pairs meet AA.
- Rules become translucent paper.
- The sidebar must still read as distinct from the content area.
- The paper texture is reduced or turned off in dark mode.
- The auth poster panel stays light paper in dark mode, like a printed poster, because the heading artwork is ink-colored and would vanish on a dark background.

## Delivery

**Release all at once.** Production must never show a half-restyled app. The owner chose this explicitly.

- Create one integration branch from `main` (e.g. `feat/app-editorial-theme`).
- Each of the three PRs targets that integration branch, not `main` and not each other. They are reviewed and merged one by one.
- When all three are merged and verified together, the integration branch goes to `main` in a single PR. Delete it only after that merge.
- In this repo, deleting a PR's base branch closes the dependent PR instead of retargeting it. Never delete a branch that an open PR targets.
- Keep the integration branch current with `main` while the work is in progress.

Three PRs, as agreed:

1. **Foundation.**
   - Tokens (light and dark), fonts, texture, and all `components/ui/*` primitives.
   - Manifest and theme-color updates.
   - The AGENTS.md and doc updates.
   - Keeping kiosk, machine display and print visually unchanged.
2. **Public pages.** Auth layout and pages, legal layout and pages.
3. **Logged-in app.**
   - AppShell: sidebar, top bar, mobile nav.
   - `/map` and `/scan`.
   - A sweep of every role's pages for colors that bypass tokens: about 400 raw Tailwind palette classes, mostly red/amber status styling, plus hex literals in 5 files. Also page-specific fixes.

Each PR includes before/after screenshots (light and dark, desktop and mobile) of its key pages, for the owner's visual approval before merge. The final PR to `main` repeats the full screenshot review from the Verification section, across all three PRs together.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (including `tests/landing`), and the browser smoke test (`tests/browser/smoke.spec.ts` checks login in both themes without horizontal overflow).
- Contrast check of every text and background token pair in light and dark.
- Screenshot review:
  - **Must be unchanged:** landing, kiosk display, trip print page.
  - **New look:** login, register, privacy, each role's dashboard home, one table-heavy page (e.g. superadmin users or audit), one form-heavy page (e.g. superadmin config or waste types), map, scan, wallet.
- No new inline `style` attributes, and CSP headers unchanged.

## Left to the builder

- Exact token values beyond the anchored ones above, including the full dark palette.
- How the Tailwind `brand-*` scale and semantic tokens are remapped versus new token names.
- The texture mechanism.
- The font-loading mechanism, and whether to de-duplicate the landing's `@font-face` rules. The landing must stay pixel-identical either way.
- How kiosk, machine display and print are kept visually unchanged.
- The secondary button style within the palette.
- Bottom-nav background (ink or paper), as long as the active state matches the sidebar.
- Where page eyebrows are used.
- Ordering within PR 3.

## Calls made without the owner (check these)

- Transactional emails and the OG image are out of scope.
- The auth poster is static (no motion) and stays light in dark mode.
- The metric emphasis variant is applied only when the value calls for action (non-zero). A zero "needs attention" metric renders as a normal card.
- The app keeps its existing icon set rather than switching to Phosphor like the landing.
- Status badges keep their per-status icon where the mockup shows a dot, to preserve the existing accessibility rule.
- Legal pages get no poster artwork.
- Mobile auth shows a thin lime band instead of the poster panel.
- `/map` and `/scan` follow dashboard style B, not the poster style, because they are logged-in pages inside AppShell.
