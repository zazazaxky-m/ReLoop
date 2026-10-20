# Editorial landing integration

The approved ReLoop poster prototype replaces the public `/` page. Base branch: `feat/reloop-remediation`, commit `381df7e`. Authentication, dashboard business logic, API, RVM and mobile code are unchanged; the superadmin carousel editor gains an archive clarification.

## Application behavior

- The two main CTAs navigate to `/register`, and Masuk navigates to `/login`. Legal links remain `/privacy` and `/terms` on the current deployment.
- “Coba simulasi setoran” opens the optional local demonstration. Scan, bottle quantity, points and redemption are illustrative only; no network transaction is made.
- Canonical metadata and Organization/WebSite JSON-LD are retained. The JSON-LD script receives the request nonce. The page no longer needs a database config read to render.
- The old `landing_hero_slides` web carousel is superseded by the approved fixed poster composition; saved configuration and its editor are retained for compatibility but do not alter this poster. The editor labels this web carousel as archived to avoid promising changes to the poster. Mobile carousel configuration/API are unchanged. No saved content is deleted.

## Assets and styles

The approved transparent WebP cutouts, paper and generated floor plate are under `public/landing`, with their original embedded provenance. Fonts are self-hosted with licenses. Raster images keep the poster's deliberately measured layered coordinates; below-the-fold imagery is lazy-loaded. Icons use Phosphor, matching the prototype.

`components/landing/editorial/landing.css` scopes resets, typography, palette, controls and responsive rules to `.reloop-landing`; auth/dashboard/legal surfaces retain their existing theme. A single global modal scroll-lock rule is temporary and removed on close/unmount. No CSP rules are relaxed and no inline style attributes are rendered.

## Motion

The bottle and fixed180-segment front/rear coil remain stationary. Identically phased highlights follow one1000-unit route from the lower-left tail to the upper-right tip. Dash90/gap410, offset0→−500 over4s linear, produces an exact repeated pattern without a reset beat. SVG masks retain bottle occlusion. Pause freezes the same offset. Reduced motion removes the highlight and nonessential loops. Hidden-page and offscreen-coil suspension avoid background work. Browser preference subscription is safe during server rendering.

The approved prototype included a JS-updated scroll indicator; this integration uses a CSS scroll timeline with a static fallback, avoiding inline style mutation under CSP.

## Validation

- Production Next16.4 build and TypeScript pass.
- ESLint: zero errors; three pre-existing `BrandLogo.tsx` alt-text warnings.
- Vitest:168 files /1859 tests pass, including SSR without browser globals, production-CSP-compatible markup, local auth/legal links, fixed finite coil geometry and exact flow-pattern period.
- The selected prototype had desktop/mobile visual approval before integration. A fresh cloud-browser reload of the integrated build was blocked by the environment's URL security gate, so integrated browser playback, responsive screenshots and hydration are not claimed as reverified. Source/SSR validation preserves the approved geometry and scoped responsive CSS. No new raster assets or design direction were introduced.
- Production HTTP smoke check:200 response, strict CSP without unsafe-inline, zero inline style attributes, all15 scripts nonced, all25 referenced local CSS/JS/art assets returned200.
- No live database or wallet integration test was needed for the local simulation; no deployment or merge was performed.
