# Approved ReLoop landing design

The user approved the editorial poster prototype on 18 October 2026 and requested its integration from `feat/reloop-remediation` in a new branch.

Preserve the cream paper, forest headline, lime brush slogan/ticker, photographed bottle/can/receipt, gritty contact floor, three steps, and lime ecosystem field. Desktop coordinates derive from the selected 1122×1402 composition; mobile recomposes the same assets.

The ribbon silhouette MUST stay fixed. Material highlights flow lower-left → upper-right on the shared route. Do not restore the rejected orbit/morph or disconnected vertical strips. Both masks share phase; keep the four-second seamless dash period.

All styles must remain scoped under `.reloop-landing`. Production CSP forbids inline style attributes: use stylesheet rules, including SVG mask type. The whole app shares this visual language (see `docs/superpowers/specs/2026-10-27-app-editorial-theme-design.md`); the landing composition itself stays fixed, and CSP must not be weakened.

Primary CTAs lead to `/register`; login and legal links use local app routes. The separate deposit/redemption demo is explicitly simulated and must never call real wallet/payment APIs. Keep keyboard focus containment, Escape, inert background, timer cleanup, motion pause and reduced-motion support.

Run typecheck, lint, production build, and the tests under `tests/landing`. Check changes against the approved prototype before changing composition.
