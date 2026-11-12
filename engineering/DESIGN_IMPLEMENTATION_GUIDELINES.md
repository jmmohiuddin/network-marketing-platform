# Design implementation guidelines (binding for frontend agents)

Status: binding. Applies to every change under `apps/web`.
Sources: Stitch designs `design/stitch/stitch_complete_ui_screen_design/` (48 files: 38 + 10 added as batch 2 on 2026-11-12), `ledger_integrity/DESIGN.md`, extracted theme `design/stitch/tailwind-theme.json`, `engineering/STITCH_DESIGN_INVENTORY.md`, `engineering/DESIGN_COVERAGE_AND_GAP_REPORT.md`, `engineering/context/UI_UX.md`, spec.json screens.

## 1. Precedence

1. **Product rules win over drawings.** UI_UX §0 hard rules, BR-HON-01 and the refusal list (§6.8 below) override anything drawn in Stitch.
2. **Stitch markup is the visual source of truth.** Reuse its DOM structure and Tailwind classes. Do not redesign a screen that has a Stitch file. Where Stitch and DESIGN.md prose disagree on a visual detail (radii, card border vs shadow, hover colour), the Stitch classes win because they are what the user approved visually.
3. **The API is the data source of truth.** Everything shown comes from an API response; Stitch text is sample content.
4. **Canonical instances.** Where Stitch screens disagree with each other, use the canonical instance named in the component catalogue (§8). The canonical staff shell is `sc_01_periods_runs_analyst_home` (shell S1 in the inventory); the canonical portal shell is `sc_37_distributor_home` (header) + `sc_18_distributor_statement_line_explanation` (bottom nav); the canonical card layout is `sc_27_sign_in_and_second_factor`.

## 2. Tailwind (decision a)

### 2.1 Version and setup
- Stitch markup targets the **Tailwind v3 Play CDN** (`https://cdn.tailwindcss.com` with a JS `tailwind.config = {…}` object). Install **`tailwindcss@3.4.x`** (latest 3.4 line, 3.4.17 at the time of writing) with `postcss` and `autoprefixer` as devDependencies of `@nmp/web`, pinned to exact versions. **Do not use Tailwind 4**: it renames scales the markup relies on (`shadow-sm`, `rounded`, `blur-sm`, default border colour, ring width), so the same classes would render differently.
- Files: `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs` (`{ plugins: { tailwindcss: {}, autoprefixer: {} } }`), `apps/web/src/styles/globals.css` imported once in `src/app/layout.tsx`.
- `content: ['./src/**/*.{ts,tsx}']`. Class names must appear as complete literal strings in source (no `'bg-' + tone`); map variants with object lookups of full class strings.
- **Never load `cdn.tailwindcss.com` (or any CDN script) at runtime.** No `<script>` from Stitch is copied.
- No Tailwind plugins (Stitch loaded none). Classes that were no-ops in the renders (`animate-in`, `fade-in`, `zoom-in-95`, `backdrop-blur-xs`, `py-0.2`) are dropped, not emulated.
- `darkMode: 'class'` exactly as Stitch; no element ever receives a `dark` class.
- Keep `theme.extend` (do not replace the theme): the markup also uses the default palette (`amber-50…900` in sc_03, 06, 09, 46; `blue-50/200/900`, `green-50/200/900`, `red-100/600` in sc_03, 46) and default spacing/sizing, and the SupportFrame (§8, no Stitch instance) uses `violet-800`.

### 2.2 Theme extension, ready to paste
Values are the Stitch values (all 48 files share them; see inventory §0.1; `design/stitch/tailwind-theme.json` holds the same `theme.extend` object as JSON). The **only** change is the font-family values, which point at the `next/font` CSS variables (§3) with the original family names kept as fallbacks; every token name is unchanged, so every Stitch class (`font-body-md`, `font-data-mono-sm`, …) works as drawn.

```ts
// apps/web/tailwind.config.ts
import type { Config } from 'tailwindcss'

// Stitch uses the literal families "Inter" / "JetBrains Mono"; next/font exposes them as CSS variables (§3).
const sans = ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif']
const mono = ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace']

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f8f9ff',
        error: '#ba1a1a',
        'error-container': '#ffdad6',
        'inverse-on-surface': '#eaf1ff',
        'inverse-primary': '#afc6ff',
        'inverse-surface': '#233144',
        'on-background': '#0d1c2e',
        'on-error': '#ffffff',
        'on-error-container': '#93000a',
        'on-primary': '#ffffff',
        'on-primary-container': '#afc6ff',
        'on-primary-fixed': '#001944',
        'on-primary-fixed-variant': '#074397',
        'on-secondary': '#ffffff',
        'on-secondary-container': '#5c647a',
        'on-secondary-fixed': '#131b2e',
        'on-secondary-fixed-variant': '#3f465c',
        'on-surface': '#0d1c2e',
        'on-surface-variant': '#434752',
        'on-tertiary': '#ffffff',
        'on-tertiary-container': '#8cd7a3',
        'on-tertiary-fixed': '#00210f',
        'on-tertiary-fixed-variant': '#00522d',
        outline: '#737783',
        'outline-variant': '#c3c6d3',
        primary: '#003883',
        'primary-container': '#1e4fa3',
        'primary-fixed': '#d9e2ff',
        'primary-fixed-dim': '#afc6ff',
        secondary: '#565e74',
        'secondary-container': '#dae2fd',
        'secondary-fixed': '#dae2fd',
        'secondary-fixed-dim': '#bec6e0',
        surface: '#f8f9ff',
        'surface-bright': '#f8f9ff',
        'surface-container': '#e6eeff',
        'surface-container-high': '#dce9ff',
        'surface-container-highest': '#d5e3fc',
        'surface-container-low': '#eff4ff',
        'surface-container-lowest': '#ffffff',
        'surface-dim': '#ccdbf3',
        'surface-tint': '#2e5bb0',
        'surface-variant': '#d5e3fc',
        tertiary: '#004525',
        'tertiary-container': '#0d5f36',
        'tertiary-fixed': '#a7f3be',
        'tertiary-fixed-dim': '#8cd7a3',
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg: '0.25rem',
        xl: '0.5rem',
        full: '0.75rem',
      },
      spacing: {
        'space-xxs': '0.125rem',
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2rem',
        'space-2xl': '3rem',
        gutter: '1.5rem',
        'gutter-compact': '0.75rem',
        margin: '1.5rem',
        'margin-mobile': '1rem',
      },
      fontFamily: {
        display: sans,
        'display-mobile': sans,
        'title-lg': sans,
        'title-lg-mobile': sans,
        'title-md': sans,
        'section-heading': sans,
        'body-lg': sans,
        'body-md': sans,
        'body-sm': sans,
        caption: sans,
        'data-mono-lg': mono,
        'data-mono-md': mono,
        'data-mono-sm': mono,
      },
      fontSize: {
        display: ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-mobile': ['26px', { lineHeight: '32px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'title-lg': ['24px', { lineHeight: '32px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'title-lg-mobile': ['20px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'title-md': ['20px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'section-heading': ['16px', { lineHeight: '24px', letterSpacing: '-0.005em', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px', letterSpacing: '0em', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '20px', letterSpacing: '0em', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '18px', letterSpacing: '0.005em', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '500' }],
        'data-mono-lg': ['24px', { lineHeight: '32px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'data-mono-md': ['14px', { lineHeight: '20px', letterSpacing: '-0.01em', fontWeight: '500' }],
        'data-mono-sm': ['12px', { lineHeight: '16px', letterSpacing: '0em', fontWeight: '500' }],
      },
    },
  },
  plugins: [],
}

export default config
```

### 2.3 globals.css (port of the shared Stitch `<style>` block)
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body { margin: 0; padding: 0; }
  body { overscroll-behavior: none; }
  main > :first-child { margin-top: 0 !important; }
  main > :last-child { margin-bottom: 0 !important; }
  :root { color-scheme: light; }
}

@layer utilities {
  /* Portal safe areas (sc_18–sc_37 head style). */
  .pt-safe { padding-top: env(safe-area-inset-top, 0px); }
  .pb-safe { padding-bottom: env(safe-area-inset-bottom, 0px); }
}
```
- **Not ported:** `::-webkit-scrollbar { display: none }` (hides the horizontal scroll affordance that UI_UX §6.2 requires on tables at md) and the portal `body { min-height: max(884px, 100dvh) }` (a Stitch canvas-size artefact).
- Body classes: staff and vendor shells `bg-background font-body-md text-on-surface antialiased` (sc_01); portal `bg-surface font-body-md text-on-surface antialiased` (sc_37); card layout `bg-surface font-body-md text-on-surface min-h-screen flex flex-col justify-between` (sc_27). Put them on the layout's outer element, not on `<body>` in the root layout, so each realm keeps its own.

### 2.4 Known theme facts agents must not "fix"
- `rounded` = 2 px, `rounded-lg` = 4 px, `rounded-xl` = 8 px, `rounded-full` = 12 px (so 32 px avatars render as rounded squares, as in the renders). Do not add a `9999px` radius; do not change the scale to DESIGN.md's.
- Cards are `bg-surface-container-lowest rounded-xl shadow-sm` (sc_01), not bordered.
- Primary button hover goes lighter (`hover:bg-primary-container`), as drawn.
- Warning colours come from the default amber palette and the DESIGN.md hexes already used as arbitrary classes; do not add new colour tokens. If a new semantic colour is ever needed, add it to DESIGN.md first.

### 2.5 Migration of the current CSS
`apps/web` today has no Tailwind; styling lives in `src/styles/{tokens,base,components,layout}.css` and `features/admin/admin.css`, `features/data/data.css`. Preflight resets element styles, so migrate in this order: (1) add Tailwind + globals.css; (2) re-skin `src/components/*` (§8) and the shells; (3) replace feature CSS classes screen by screen; (4) delete the old CSS files and update `src/styles/tokens.test.ts` (it asserts `tokens.css` contents) in the same change that removes `tokens.css`. Do not leave two styling systems for the same component.

## 3. Fonts and icons (decision b)

- **Inter and JetBrains Mono via `next/font/local`**, self-hosted from npm packages `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` (exact versions pinned). Expose `variable: '--font-inter'` and `variable: '--font-jetbrains-mono'`, `display: 'swap'`, and put both variable class names on `<html>` in `src/app/layout.tsx`. Latin subset first; add scripts per launch-market language only when FR-DIST-007 requires them. (`next/font/google` is not used: it needs Google at build time, which the self-hosted edition (SC-47) cannot assume.)
- **Material Symbols Outlined via the npm package `material-symbols`** (exact version pinned): `import 'material-symbols/outlined.css'` once in the root layout. It ships the variable woff2 (FILL, wght, GRAD, opsz axes) and the `.material-symbols-outlined` class used by Stitch, served from the app origin.
- No request to `fonts.googleapis.com` / `fonts.gstatic.com` at build or runtime; no `preconnect` links. The CSP (`src/lib/csp.ts`: `font-src 'self'`, `style-src 'self' 'nonce-…'`) stays as it is; compiled Tailwind and next/font CSS are same-origin files.
- **Filled icons:** replace `style="font-variation-settings: 'FILL' 1"` with the class `[font-variation-settings:'FILL'_1]`.
- **Icon component:** `Icon({ name, size = 18, filled = false, className })` renders `<span aria-hidden="true" class="material-symbols-outlined text-[<size>px] …">{name}</span>`. Icons are decorative; the control carries the accessible name. Sizes used by Stitch: 13, 14, 15, 16, 18, 20, 24 px; prefer 16 (tables), 18 (nav, buttons), 20 (header), 24 (empty states).
- `lucide-react` is replaced by `Icon`; remove the dependency when its last import is gone.

## 4. Images (decision c)

- No hot-linked images, ever (`img-src 'self' blob: data:` already blocks them).
- Header logo (`lh3…` "Platform Integrity Logo") → text: tenant legal name (`me.tenant.legal_name`) in the staff shell, "Operations console" in the vendor shell. The Stitch wordmark "AuditLedger" is a placeholder (brand undecided, OQ-23) and is not used.
- Avatars → initials from `display_name` (fallback: first letter of the email) in the sc_01 avatar box `w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-caption text-caption font-semibold`, `aria-hidden="true"` (the name is shown as text beside it).
- sc_20 portraits and sc_35 photos are removed without replacement (UI_UX §0: no imagery). No local illustration asset is essential for any screen; empty states use one outline icon.

## 5. CSP-safe markup

- No `<script>` blocks, no `onclick`/`on*` attributes, no `javascript:` URLs, no `href="#"` (use a real route via `next/link`, a `<button>`, or omit).
- **No `style` prop/attribute.** Production CSP blocks style attributes in server-rendered HTML. Data-driven widths (progress, share bars: Stitch `style="width: 68%"`) render through `MeterBar`, an SVG (`<svg class="h-1.5 w-full" role="img" aria-label="…"><rect width="100%" class="fill-surface-container-high"/><rect width="68%" class="fill-primary"/></svg>`): SVG presentation attributes are not style attributes. Charts follow the existing `features/data/charts.tsx` SVG approach.
- Fixed decorative widths become arbitrary classes (`w-[17.84%]` only when the value is constant).
- Verify with `next build && next start` and the browser console (no CSP violation reports) before closing a task that touches markup.

## 6. Converting a Stitch screen (decisions e, f, g, h, i)

### 6.1 Procedure per screen
1. Find the screen's file in the inventory; read its "Must not implement" and "Deviations" lines and the gap-report row.
2. Build the page inside the shared shell; never copy the Stitch `<header>`/`<aside>`/bottom `<nav>` into a page.
3. Copy the content DOM structure and classes section by section (the section comments in the file are the unit), replacing repeated blocks with catalogue components (§8). Keep landmark and heading order: one `h1` per page (PageHeader), `h2` per section.
4. Replace every sample value with API data (§6.3). Rows/cards are rendered from arrays; counts in tab labels come from `meta`.
5. Re-implement inline-script behaviour as React state (drawer open, tab selected, expand/collapse), keeping URL state for tabs, filters and drawers (UI_UX §4.7).
6. Add the states Stitch does not draw (loading, empty, error, permission denied, read-only/locked, partial data) with the shared components (gap report §2, UI_UX §6.6).
7. Remove forbidden content (§6.8) and unbacked controls (§6.4).
8. Apply the responsive rules (§7) for that screen.
9. Keep or extend the screen's tests (role-based queries); add a test for every new state you render.

### 6.2 Keep the functional layer (decision f)
- Keep unchanged: `src/lib/*` (API client `useApi`, `ApiError`, messages, session/`useMe`/`useSession`, navigation, `use-resource`, `cursor-pages`, `support-session`, `csp`), `src/proxy.ts`, feature data logic (`features/*/format.ts`, `types.ts`, `mapping-model.ts`, `period.ts`, `transfer.ts`, `resource.ts`), idempotency handling, step-up retry in `ApiProvider`, and all tests.
- Re-skin **in place**: `src/components/*.tsx` keep their names, props and accessible roles/names, and get Stitch markup and classes. Features keep calling the same components, so behaviour and tests stay valid. Extend props only where a Stitch variant needs it (for example `Table.stickyFirstColumn`).
- Navigation stays server-driven (`me.navigation`): labels and order come from the API ("Compliance", "Data imports", "Users and roles", "Vendor access", "Audit log", "Settings"); icons come from the client map in §8.1. Items the user cannot use are absent (UI_UX §0). Stitch sidebar items without a server entry are never rendered.

### 6.3 Sample data (decision g)
- Never ship Stitch figures, names, IDs, hashes, dates, tenant/brand names ("Acrobex Global", "Apex Health", "Global Direct Inc."), people ("Elena Rostova", "Elena Gomez"…), provider names, avatars or the "AuditLedger" wordmark. Test fixtures use their own neutral data.
- Labels follow the glossary (UI_UX §6.7): sentence case, no exclamation marks, "Earnings balance" never "wallet", "Simulated" never "Projected".
- Static claims without a data source are not rendered: status footers, sidebar footer (Cell / Version / Engine), "FTC/SEC INVARIANTS: ENFORCED", "REGULATORY AUDIT CONFORMANT", "SOC-2 / FIPS / ISO 27001" claims, "FTC Validated", "BR-HON-01 Compliant", "STATUTORY AUDIT LOCK ACTIVE", SC ids in the UI.

### 6.4 Controls without a backing API route are not rendered
Rule: a button, link, menu item, input or tab whose action or data has no route in `apps/api` is omitted (not disabled, not "coming soon"). It is added in the change that adds its route. Current API (2026-11-12) covers MVP-A only: auth, me, markets, imports (+limits, errors, source-values, mapping, load), import-mappings (+approve), compliance snapshots (+figure rows), audit events / chain verification / exports, users, roles, role grants and assignments, settings (`GET/PUT /v1/settings/:key`), support sessions (+limits, decision, end, log), tenants (vendor), vendor users, vendor audit events.

Not rendered on screens that ship now:

| Where | Stitch control | Reason |
|---|---|---|
| Staff header (sc_01) | Global search / ⌘K, notifications bell + count, Glossary, tenant dropdown, market chip | No search (SC-36), notifications or glossary API; tenant comes from hostname; market switcher only on pages that take a market scope, with options from `GET /v1/markets` |
| Staff sidebar | Footer Cell / Version / Engine; items not in `me.navigation` | No API; server-driven nav |
| SC-10 (sc_10) | Export Dossier (.ZIP), Methodology & Legal Basis (as a separate document), copy hash, more menu, Review 14 Cases | No API (method notes shown only if the snapshot payload carries them) |
| SC-14 (sc_14) | Access Policy Spec, per-row download, hard-coded 30 min / 1 h / 2 h | No API; durations from `GET /v1/support-sessions/limits` |
| SC-24 (sc_24) | Download Schema Manifest, Full Audit Trace Log, Ledger Postings, Report (separate from findings) | No API |
| SC-25 (sc_25) | Add Mapping Rule, Submit for Statutory Review, Discard Staged Edits, Jump to Entry, governance impact preview | No API (save draft = `PUT /v1/import-mappings`, approve = `/approve`) |
| SC-26 (sc_26) | Compare Period, Filter Cohort, column chooser, first/last page buttons | No API; cursor pagination |
| SC-46 (sc_46) | Acknowledge, Force Ledger Reconciliation Run, Affirm & Countersign, Export Summary (Logged) | No API |
| SC-29 (sc_29) | Revert to previous version, prospect-data ownership, retention timers, any policy without a settings key | Only keys served by `GET/PUT /v1/settings/:key` |
| SC-27 (sc_27) | Use Security Key (WebAuthn), Remember workstation session, Dual-admin device recovery, Privacy Policy / Security Whitepaper / Tenant Resolver links | API supports password + TOTP only |
| SC-28 (sc_28) | Session Security & MFA Logs tab, VIEW CONFLICT MATRIX, Export Access Audit, Edit Scope | No API |
| SC-30 (sc_30) | Download Merkle Proof (.JSON), Report Anomalous Query, page-number jumps | No API; cursor pagination. "Run full hash chain verification" **is** backed (`GET /v1/audit-chain/verification`) |
| SC-39 (sc_39) | Audit Specs, Global Market Packs (spec secondary "maintain market packs", not yet backed), Fleet Diagnostics, Sync Fleet State, fleet KPIs (ingestion tx/s, workers, DLQ), ingestion sparkline; session scopes other than read-only, FIPS hardware-key attestation checkbox | No API; support sessions are read-only, scope/duration from `GET /v1/support-sessions/limits` |
| All step-up prompts | Hardware key, passkey, biometrics, PIN, SSO certificate (sc_23) | Step-up is TOTP (`POST /v1/auth/sessions/current/step-up`) |

MVP-B/V1 screens (Pending) are built only when their routes exist; at that point apply the same rule to every control listed in the inventory.

### 6.5 Light theme only (decision d)
DESIGN.md defines light tokens only and UI_UX §1.3 defers dark. The app is already light-only (`color-scheme: light`, no ThemeSelect, no theme script, per frontend MEMORY); keep it that way: no `dark:` classes, no theme switch, no `prefers-color-scheme` styles. Remove any leftover theme-select CSS when `components.css` is deleted.

### 6.6 Overlays and confirmations
- One `Modal` component for all dialogs (focus trap, return focus, Escape, labelled by title, never stacked, one primary); sizes 400/560/720 (Stitch commit modal is 720).
- Step-up uses `StepUpModal` (the sc_02-modal step-up block with a TOTP code field), opened by `ApiProvider` on `STEP_UP_REQUIRED`.
- Critical approvals (commit run, approve batch, activate plan, apply update) follow the sc_02-modal anatomy: totals strip, per-exception acknowledgements, "You did not prepare this" statement, step-up, button naming amount and object. Never `window.confirm`/`alert` (sc_09, 22, 29, 32, 33, 40, 43 use them).

### 6.7 Status, money and numbers
- State chips use `StatusBadge` with the UI_UX §1.5 state → tone map; colour is never the only signal (icon + label).
- IDs, amounts, hashes, periods: `font-data-mono-*` as drawn; numeric columns right-aligned with `tabular-nums`; negatives with a minus sign in `text-on-surface` (not danger colour).
- Money comes from API minor units / decimal strings and is formatted by the existing format helpers (never `Number` arithmetic on money).

### 6.8 Forbidden content (decision h)
Never implemented, even when drawn: income projections, earnings calculators, "earn up to", recruit leaderboards, recruit or leg counts as rankings, "top builders/earners", next-rank prompts, streak counters shown to participants, growth deltas on distributor pages, targets dashboards on distributor home, celebration styling, countdowns (except the vendor support-session countdown), urgency animation (`animate-ping`, `animate-pulse` dots), gradients/illustrations/photos on work screens, legal-conclusion badges and grades ("safe harbor compliant", "substantiated", "FTC-COMPLIANT", "AAA-STATUTORY", PASS/SAFE/LOW RISK on figures), invented regulatory targets, estimates inside disclosed earnings figures (sc_40 "estimated retail markup"), "time to reach"/tenor per earnings band, head counts per downline leg (sc_20 "Downline Nodes"), automatic sanctions from integrity indicators (sc_45 freeze/hold/"Clawback Auto-Draft"). File-by-file list: inventory §4. Staff simulation totals (SC-04/SC-42) are allowed with "Simulated" wording.

### 6.9 Accessibility (decision i)
- Keep semantic elements: `header`/`nav`/`main`/`aside` landmarks, `table` with `th scope`, `caption` (visually hidden is fine), lists, `button` for actions, `a` for navigation. Stitch `div` fakes (sc_30 filter "selects", sc_06 queue rows, sc_35 market dropdown) become native elements.
- Every icon-only button has `aria-label` (and a `title` tooltip) — only search, close and more may be icon-only (UI_UX §1.1). Stitch leaves many unlabelled (sc_15, sc_16, sc_20, sc_31, sc_35, sc_39, sc_42).
- Every input has a `<label>` (or `aria-label` for the single table filter); helper/error via `aria-describedby`; `aria-invalid` on error.
- Focus visible on every interactive element: add `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary` where the Stitch class removes the outline (`focus:outline-none`); never ship `focus:outline-none` without a visible replacement.
- Contrast: use the token pairs as drawn (`text-on-surface`, `text-secondary` #565e74 on white ≥ 4.5:1, `text-on-surface-variant`); `text-outline` (#737783) is for placeholders and icons only, not information text.
- `aria-current="page"` on the active nav item; `aria-busy` on loading regions; toasts `role="status"`; danger banners `role="alert"`.
- Targets ≥ 24×24 staff, ≥ 44×44 portal; `motion-safe:` for any transition; skip link stays first in the shell.
- One-time codes: a single `<input inputmode="numeric" autocomplete="one-time-code" maxlength="6">` styled like the sc_27 slots (pasteable, autofillable), not six separate inputs.

## 7. Responsive rules
- Staff (S1 shell): sidebar `w-52` at ≥1280 (lg/xl); collapsed 56 px icon rail with tooltips at 1024–1279; below 1024 the sidebar is an overlay opened by the existing Menu button. Header user name `hidden lg:flex` as drawn.
- Content grids keep Stitch breakpoints (`md:grid-cols-2 xl:grid-cols-4` KPIs, `xl:grid-cols-12` splits). Docked inspectors (`xl:col-span-4/5`) become overlay `Drawer`s below lg.
- Tables: `overflow-x-auto` container, sticky first column at md; phone-capable screens (SC-02 commit, SC-03 approve, SC-14 decide) use stacked cards and a pinned `ApprovalBar` with `left-0` below lg.
- Fixed bars offset by the sidebar (`left-52`) must switch to `left-0` when the sidebar collapses or overlays.
- Portal: phone layout as drawn (16 px margins `px-margin-mobile`, bottom nav, sticky full-width primary); sm: centred `max-w-[600px]`; md+: top bar nav (≤6 items, same order as bottom nav) and centred `max-w-[720px]`; line explanation `BottomSheet` below 1024, 360 px side panel at ≥1024. Reflow at 320 px without horizontal scroll.
- Vendor console: desktop only.

## 8. Component catalogue

Location: `apps/web/src/components/` (existing file in brackets is re-skinned in place). "Source" = canonical Stitch file and approximate location (line numbers are in `code.html`; minified files have the shell on one line).

| Component [existing file] | Canonical source | Props | Variants | States |
|---|---|---|---|---|
| **AppShell** (staff + vendor) [`app-shell.tsx`] | sc_01 l.5 `<header class="fixed top-0 … h-12 …">` + `<aside class="fixed left-0 top-12 bottom-0 w-52 …">`, content wrapper `pl-52` / `main pt-12` | `realm`, `children` (nav from `me.navigation`) | tenant; vendor (nav from `console-nav.tsx`); expanded 208 / collapsed 56 / overlay | loading workspace, error + retry, NotAvailable, support-session frame, read-only |
| **TopBar** (inside AppShell) | sc_01 l.5 header | tenant name, user (initials avatar, name, role label), sign-out; optional market switcher | staff, vendor | — |
| **SidebarNav** | sc_01 l.5 `<nav data-active-classes="bg-primary-container text-on-primary font-semibold">`, item `flex items-center gap-space-sm px-space-sm py-1.5 rounded text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-body-sm text-body-sm` | `entries`, `current` | expanded, collapsed (icon + tooltip) | active (`aria-current`), hover, focus |
| **PortalShell** + **BottomNav** | header sc_37 l.9 (`fixed top-0 w-full z-50 bg-surface/90 backdrop-blur-xl … pt-safe`, `h-16 px-margin-mobile`); nav sc_18 l.402 (`fixed bottom-0 w-full z-50 pb-safe …`, `data-active-classes="text-primary font-semibold"`, items Home · Earnings · Rank · Customers · More) | `title`, `back?`, nav items | phone (bottom nav), md+ (top bar) | active item, offline banner slot |
| **CardLayout** [`(card)/layout.tsx`] | sc_27 l.4 `<main>` + auth card l.17 (`w-full max-w-[480px]`) | `children`, `footer?` | — | — |
| **PageHeader** [`page-header.tsx`] | sc_01 l.6 "Top Command & Action Bar" (`bg-surface-container-lowest px-space-lg py-space-md shadow-sm`, `h1.font-title-lg text-title-lg`, summary `font-body-md text-secondary`) | `title`, `state?` (StatusBadge), `summary`, `actions` (≤1 primary), `eyebrow?` (period/object chip), `breadcrumbs?` | staff, portal (`font-title-lg-mobile` on phone) | — |
| **Breadcrumbs** | sc_09 l.7 | `items[]` (last = current, not a link) | — | — |
| **KpiCard** | sc_01 l.123 "Card 1: Active Period" (`bg-surface-container-lowest rounded-xl p-space-md shadow-sm`, label `font-caption text-caption text-secondary uppercase tracking-wider`, value `font-title-md`, footer strip `bg-surface-container-low`) | `label`, `value`, `unit?`, `delta?` (sign + text), `detail?`, `footer?`, `href?`, `definition?` (popover) | default; strip (sc_35 l.66, 5 per row); portal tile (sc_37 l.87); status card (sc_13 l.173 connector) | loading skeleton, null value "—" + reason |
| **DataTable** [`table.tsx`] | sc_01 l.248 (`table w-full text-left border-collapse`; thead row `bg-surface-container-low text-secondary font-caption text-[11px] uppercase tracking-wider`; th `py-2.5 px-3 font-semibold`; tbody `font-body-sm text-body-sm divide-y divide-surface-container`; selected row `bg-primary-fixed/20`) | existing: `caption, columns {key, header, cell, align}, rows, rowKey, loading, error, empty, pagination, density, stackOnPhone`; add `stickyFirstColumn`, `selectedKey`, `onRowOpen` | comfortable 44 / compact 32 (DESIGN.md densities); stacked cards on phone | loading rows, empty (first use / no results), error + retry, selected, hover |
| **Pagination** (in DataTable) | sc_01 l.417 footer (`px-space-md py-2 bg-surface-container-low … font-caption`) | `hasPrevious, hasNext, onPrevious, onNext, rangeText` | cursor only (Previous / Next + "1–50 of about N") | disabled ends |
| **StatusBadge** [`status-chip.tsx`] | info: sc_01 l.~285 CALCULATED (`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-caption font-semibold bg-primary-fixed text-primary` + icon); success: sc_01 l.~270 Synced (`bg-tertiary-fixed text-on-tertiary-fixed`); warning: sc_03 l.262 (`bg-amber-100 text-amber-900 border border-amber-300`); danger: sc_02 l.329 (`bg-error-container text-on-error-container`); neutral: sc_06 l.290 (`bg-surface-container-high text-on-surface`) | `state`, `label` (existing `toneOf`) | info, success, warning, danger, neutral, committed (neutral + `lock`), muted (superseded, `text-secondary`) | non-interactive |
| **Button / LinkButton** [`button.tsx`] | primary sc_01 l.~33 (`h-8 px-space-md rounded bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold flex items-center gap-space-xs shadow-sm`); secondary sc_01 l.~23 (`h-8 px-space-sm rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-medium`); tertiary sc_02-modal l.~240 (`text-primary hover:underline font-semibold`); destructive sc_03 l.594 (`bg-error-container hover:bg-red-100 text-error`); icon-only sc_01 l.~296 (`h-7 w-7 … hover:bg-surface-container rounded`); portal primary sc_37 l.71 (`w-full h-10 … bg-primary-container text-on-primary`) | existing: `variant`, `size`, `loading`; `icon?`; icon-only requires `aria-label` | primary, secondary, tertiary, destructive, destructive-solid (`bg-error text-on-error`, confirmation dialogs only), icon-only; sizes sm 28 (`h-7`, table rows), md 32 (`h-8`), lg 40/44 (portal) | hover, focus-visible, disabled-with-reason, loading (`animate-spin` `sync` icon replaces label, width kept) |
| **TextInput / FormField** [`form-field.tsx`] | input sc_01 l.~238 (`w-full h-8 pl-8 pr-3 text-body-sm font-body-sm bg-surface rounded text-on-surface placeholder:text-outline focus:ring-1 focus:ring-primary`, leading icon `absolute left-2.5`); label sc_39 l.~495 (`font-caption text-caption uppercase tracking-wider text-secondary font-medium`) | existing `FormField` render prop, `TextField` | text, search (leading icon), money (suffix), textarea (sc_39 l.~530), portal 40 px / 16 px text | focus ring, error (`ring-error` + message), disabled, read-only |
| **Select** [`SelectField` in `form-field.tsx`] | sc_39 l.~507 (`h-9 px-space-sm bg-surface-bright text-on-surface font-body-sm text-body-sm rounded`) | existing `options`, `placeholder` | native; combobox when >12 options | focus, error, disabled |
| **Checkbox / Radio** [`Checkbox` in `form-field.tsx`] | sc_02-modal l.134 acknowledgement items; sc_33 ERP radios | existing | checkbox, radio group (fieldset + legend) | checked, focus, disabled |
| **Switch** | sc_38 delivery-channel toggles (`peer` checkbox + `w-11 h-6 … rounded-full peer-checked:…` track) | `label`, `checked`, `onChange`, `locked?` (mandatory channel, with reason) | on/off, locked | focus-visible on the track, `role="switch"`, "On"/"Off" text; only for settings that apply immediately |
| **CommandPalette** (SC-36) | sc_36 search input, type tokens, grouped results, fact sheet (drawn as a page) | `open`, `onClose`, scopes | overlay centred (desktop) / full screen (phone) | min 2 chars, debounce 200 ms, no results, keyboard (↑↓ ↵ Tab) |
| **Tabs** [`tabs.tsx`] | page tabs sc_01 l.214 (selected `text-primary border-b-2 border-primary bg-surface-container-lowest font-semibold`; idle `text-secondary hover:text-on-surface`); contained sc_33 l.149 | existing `label, idPrefix, tabs, selected, onSelect` (state in URL) | underline (page), contained (in card), count suffix | selected, focus, overflow scroll |
| **SegmentedControl** | sc_07 l.50 (Sponsor / Placement) | `options`, `value`, `onChange`, `label` | 2–4 options | selected, focus |
| **FiltersBar + FilterChips** | staff sc_30 l.105 filter console + sc_11 l.167 applied chips with "Clear all filters"; portal chips sc_21 l.108 | `filters` (native controls), `chips[]`, `onClear` | inline bar; phone "Filters (n)" → BottomSheet | applied, empty |
| **Modal / ConfirmDialog** [`dialog.tsx`] | sc_02-modal l.53–262 (scrim `fixed inset-0 z-50 bg-[#0F172A]/70 … flex items-center justify-center`; card `max-w-[720px] bg-surface-container-lowest rounded-xl shadow-2xl`; header l.59; body `max-h-[calc(90vh-140px)] overflow-y-auto`; footer l.245 `bg-surface-container-low`) — drop `backdrop-blur-md` if it hurts performance, drop the gradient rule | existing `open, onClose, title, size, footer`; ConfirmDialog `consequence, confirmLabel, destructive` | 400 / 560 / 720; phone full-screen sheet | focus trapped, busy, error inside |
| **StepUpModal** [step-up dialog in `api-provider.tsx`] | sc_02-modal l.198 step-up block, TOTP field replacing the hardware-key prompt | `onVerified`, `onCancel` | — | verifying, wrong code, locked out |
| **Drawer** | overlay sc_35 l.574 (`fixed inset-y-0 right-0 w-full sm:w-[480px] bg-surface-container-lowest shadow-2xl z-50`, backdrop `bg-on-background/40`); docked sc_30 l.347 side inspector | `open, onClose, title, width` (URL state) | overlay (md and below), docked (lg+); 420–720 px | loading, error |
| **BottomSheet** | sc_18 l.271 (`fixed bottom-0 left-0 right-0 z-50 max-h-[751px] overflow-y-auto … rounded-t`) | `open, onClose, title` | ≤80% height | focus managed, close button |
| **Toast** [`toast.tsx`] | desktop sc_33 l.595 (`fixed bottom-6 right-6`, `rounded-lg bg-inverse-surface text-inverse-on-surface p-space-md shadow-xl`); phone sc_18 l.330 (`fixed bottom-20 left-4 right-4`) | existing `({message, tone})` | success, info only | 5 s, pause on hover/focus, `role="status"` |
| **Banner** [`banner.tsx`] | sc_17 l.37 (`bg-surface-container-lowest border-l-4 border-l-error border border-outline-variant rounded-sm flex items-start gap-space-sm` + icon tile `bg-error-container`); warning border `border-l-[#7A4900]` (sc_08 l.278); success `border-l-tertiary-container` (sc_10 l.74); info `border-l-primary` (sc_15 l.782) | existing `tone, title, action` + `children` | danger (`role="alert"`), warning, success, info | persistent while condition holds |
| **EmptyState / LoadingState / ErrorState / NotAvailable** [`states.tsx`] | no Stitch instance: card shell sc_01 l.123 + one 24 px outline icon + `font-section-heading` sentence + one Button; 64 px padding | existing props (`section`) | first use, no results, error (reference id + Retry), not available | — |
| **Skeleton** | geometry of sc_01 KPI card and table row | `lines`, `shape` | card, row, text | `motion-safe:animate-pulse bg-surface-container rounded` (the only allowed pulse) |
| **ApprovalBar** | sc_02 l.562 (`fixed bottom-0 left-52 right-0 bg-surface-container-lowest border-t border-outline-variant shadow-xl z-30 … md:flex-row`); sc_25 l.422 | `preparedBy`, `approvers`, `checks`, `actions` | preparer view (approve disabled with reason / absent), approver view, committed (lock) | blocked with reason |
| **StateTimeline** | sc_01 l.41–120 period pipeline (7 steps) | `steps[] {label, detail, status}`, `current` | — (wraps at md) | done, current, upcoming |
| **Stepper** | horizontal sc_16 l.51; vertical sc_44 l.143; wizard header sc_12 l.144 | `steps[] {label, status, reason?}` | horizontal, vertical (phone) | done, current, blocked (reason), to do |
| **FileDropZone** [`file-input.tsx`] | sc_24 l.65 drag-and-drop canvas; sc_17 l.348 upload area | existing `extensions, maxBytes, onFiles` | single, multi with per-file status (sc_24 l.80 trackers) | idle, drag-over, uploading (progress), rejected (reason) |
| **MaskedField** | sc_22 l.137 TIN module | `label`, `masked`, `onReveal` (audited, step-up) | — | masked, revealed (auto-hide), not permitted (no Show) |
| **FigureCard** | sc_10 l.88 R1 card | `figure`, `population`, `method`, `warnings`, `trend?` | — | null figure with reason, outdated badge |
| **ChartCard / Sparkline / Histogram / MeterBar** [`features/data/charts.tsx`] | bar+line sc_35 l.175; sparkline sc_13 l.426; histogram sc_42 l.154; share bar sc_03 l.369 | data series, axis titles, `summary` | with "View as table" toggle (required) | empty, loading |
| **Checklist** | sc_02 exception acknowledgement (from l.367); sc_24 pre-flight list (from l.153) | `items[] {label, status, detail}`, `acknowledgeable?` | read-only, acknowledgeable | checked, pending, failed |
| **TraceViewer** | sc_02 l.455 right column | trace tree from API | docked, in Drawer | collapsed / expanded nodes |
| **CodeInput** [`code-form.tsx`] | sc_27 l.92 six-slot visual, as one input (§6.9) | existing `idPrefix, endpoint, submitLabel, onVerified` | — | error, verifying |
| **RequestCard** | sc_14 l.147 | request fields, decision actions | pending, active (countdown), expired, denied | — |
| **LinkCard** | sc_37 l.170 module cards | `title, description, href, icon` | — | hover, focus |
| **NetPayHero** | sc_37 l.36 | `amount`, `status`, `period`, `settledOn`, `account` | committed, held (reason + end date), open period (status only, no number) | — |
| **StatementSummary + LineList** | sc_18 l.66 reconciliation card; l.124 grouped lines | statement from API | — | dispute chip, explanation missing |
| **Icon** | any `material-symbols-outlined` span | `name, size, filled` | outlined, filled | decorative (`aria-hidden`) |
| **Avatar** | sc_01 l.5 avatar box | `name` | initials only | — |
| **SupportFrame** [`support-frame.tsx`] | no Stitch instance; keep behaviour, style with `border-violet-800` + bar in `bg-violet-800 text-white font-caption` | existing | — | countdown (the only countdown) |
| **SecretText, QrCode, SignOutButton** [existing] | restyle with tokens (`font-data-mono-sm`, card surfaces) | existing | — | — |

### 8.1 Navigation icon map (client side, by server `key`)
Source: S1 (sc_01) icons; keys that S1 does not draw take the S3/S6 icon.

| Key / section | Icon |
|---|---|
| overview (SC-35 / role home) | `dashboard` |
| periods | `history_toggle_off` |
| plans | `schema` |
| people | `account_tree` |
| orders | `receipt_long` |
| cases | `rule_folder` |
| payouts | `payments` |
| finance | `account_balance` |
| compliance | `verified_user` |
| imports (data) | `sync_alt` |
| settings | `tune` |
| users | `admin_panel_settings` |
| vendor_access | `vpn_key` |
| audit | `history_edu` |
| vendor console sections: tenants / support sessions / vendor users / audit | `corporate_fare` / `vpn_key` / `admin_panel_settings` / `history_edu` |
| unknown key | no icon (label only) |

## 9. Screens without a Stitch design (decision j)
The brief listed SC-23, SC-26, SC-29, SC-36, SC-38, SC-40, SC-41, SC-43, SC-45, SC-46 as undesigned; Stitch files for all ten were added on 2026-11-12 (batch 2), so they follow §6 like every other screen, with the must-not-implement items in inventory §3.2. The rule below still applies to (1) any batch-2 file that is rejected, (2) views a Stitch file does not draw (missing tabs, dialogs, states: gap report §3), and (3) routes without a spec screen id (`/profile`, `/vendor/users`, `/vendor/audit`, `/invitation`):
- build only from the §8 components, using the recipes in gap report §4 (pattern sources follow UI_UX §5.7 "reused patterns");
- no new visual language: no new colours, radii, shadows or type sizes;
- if a component is missing, add it to §8 with a canonical Stitch source and record the gap in the gap report in the same change.

## 10. Definition of done for a screen
- Uses the shared shell and catalogue components; Stitch classes preserved for the drawn parts.
- No sample data, no unbacked controls, no forbidden content (§6.3, §6.4, §6.8).
- All states from UI_UX §5.7 for the screen rendered and tested.
- Keyboard and screen-reader pass for the page; icon-only controls labelled; focus visible.
- Responsive rules (§7) checked at 1024/1280/1440 (staff) or 320/360/768/1280 (portal).
- `pnpm vitest run apps/web` and `tsc -p apps/web` clean; `next build` passes; no CSP violations in the console under `next start`.
- Inventory status updated (Pending → Implemented, with route) in `engineering/STITCH_DESIGN_INVENTORY.md`.
