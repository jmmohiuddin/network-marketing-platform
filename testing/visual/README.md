# Visual comparison harness

Run from the repo root. One browser at a time (16 GB machine). Chromium comes from the Playwright cache
(`@playwright/test` 1.62.1 pairs with `chromium-1234`); no download is needed.

## 1. Reference renders (needs network: Tailwind Play CDN, Google Fonts)

    pnpm exec tsx testing/visual/render-references.ts [sc_folder …]

Writes `testing/ui-screenshots/reference/<sc_folder>/<WxH>.png` (full page) for 1440x900, 1280x800, 768x1024, 390x844.
Files whose inline `tailwind.config` lacks its closing brace (sc_13, sc_24, sc_25, sc_28) are rendered from a
temporary patched copy in the OS temp dir, deleted afterwards; the originals are untouched.

## 2. Compare an app screen

    NMP_SESSION=<nmp_session cookie value> pnpm exec tsx testing/visual/compare.ts \
      --screen SC-24 --role implementation-consultant --base http://localhost:3100
    # routes with an id: --url http://localhost:3100/compliance/snapshots/<id>
    # harness self-check (Stitch vs itself, no app needed): --screen SC-24 --self

- `--screen` takes an SC id or Stitch folder from `screens.json`. `--role` names the signed-in role (path segment).
- The session cookie is read from `NMP_SESSION` (never a CLI argument); omit it for public pages (SC-27).
- Output: `testing/ui-screenshots/app/<module>/<screen>/<role>/<WxH>.png` and `<WxH>.diff.png`,
  JSON in `testing/visual/results/<SC>__<role>.json`, a run section appended to `testing/VISUAL_REGRESSION_REPORT.md`.
  Self-check output goes to `testing/ui-screenshots/self-check/…` instead of `app/`.
- Pixel mismatch % is informational: API data differs from Stitch sample data.
- Style fidelity compares computed styles of landmarks (`screens.json`: `properties` per landmark, default selectors in
  `landmarks`, per-screen overrides; `null` skips a landmark). Shell landmarks (header, sidebar) are measured against the
  canonical shell `sc_01` at 1440 and 1280 only (below 1280 the app collapses or overlays the sidebar by design).
  Severity: shell, page or primary button drift and any landmark missing in the app = high; title, section heading,
  table header, card drift = medium; landmark Stitch does not draw = info. Exit code 1 when any high finding exists.

## App test ids the frontend must provide

| Landmark | Selector | Where |
|---|---|---|
| header | `[data-testid="app-header"]` | AppShell TopBar `<header>` (staff and vendor) |
| sidebar | `[data-testid="app-sidebar"]` | AppShell `<aside>` holding SidebarNav |
| primaryButton | `[data-testid="primary-action"]` | the page's one primary Button (PageHeader action or form submit on SC-27) |
| card | `[data-testid="card"]` | the first Card/Panel in `main` (SC-27: the sign-in card) |

Semantic selectors used as-is: `main`, `h1`, `main h2`, `thead th`.

## Unit tests and types

    pnpm exec vitest run -c testing/vitest.config.ts
    pnpm exec tsc -p testing/tsconfig.json
