# UI_UX — Implementation brief (design tokens, components, navigation, 47 screens, interaction rules)

Sources read in full: `product-documentation/07-ui-design/01..05` (UI-01 direction, UI-02 design system, UI-03 tokens, UI-04 components, UI-05 responsive), `05-ux/01..05` (UX-01 spec, UX-02 IA, UX-03 sitemap, UX-04 journeys, UX-05 interaction), `06-wireframes/01..06` (WF-01 inventory, WF-02 spec + state matrix, WF-03 admin, WF-04 distributor, WF-05 customer/public, WF-06 mobile); cross-checked against `09-governance/traceability-data/spec.json` (screens, requirements, apis, tests, rules, acceptance).
All sources are **v0.1 drafts, not approved, not usability-tested** (OQ-21). No high-fidelity screens exist; product name/brand undecided (OQ-23). Wireframe SVGs exist for 34 screens + 8 phone variants (`06-wireframes/wireframes/`); 13 screens are text-only.

Release tags: **A** = MVP-A (compliance overlay), **B** = MVP-B (engine + compliance), **B-MKT** = MVP-B but only where a market pack requires it, **V1** = after MVP-B. Docs write "MVP-A/MVP-B"; spec.json writes A/B — identical.

---

## 0. Hard rules (non-negotiable, apply to every screen)

| Rule | Source | Rel |
|---|---|---|
| No income projection, potential-earnings calculator, recruit leaderboard, "earn up to", next-rank prompt, recruit counts as rankings, "top earners" | BR-HON-01, UX-01 §6, UI-04 §5 | A |
| Word "wallet" never used; use "Earnings balance" | BR-LED-03, UX-05 §9, UI-01 §9 | B (copy rule applies from A) |
| Disclosure link shown wherever earnings are shown to participants/prospects, when one is published | BR-HON-02 | V1 |
| No celebratory animation, confetti, trophies, medals, flames, rockets, money bags, countdown timers, urgency styling, flashing | UI-01 §9, UI-03 §8–9 | A |
| Colour is never the only signal (label/icon always; negative amounts carry a minus sign) | UI-01 §5, WCAG 1.4.1 | A |
| Negative amounts / clawbacks use `color.text.primary` + minus sign, **not** danger colour | UI-03 §2.3 | A |
| Navigation items the user cannot use are **absent**, not disabled (server-generated nav model from permissions + market scope + edition/release flags) | UX-02 §2 | A |
| Out-of-scope / no-permission page → "Not found or not available to you" (never confirm existence) | UX-03 §6, UX-05 §8 | A |
| One primary action per view (UXQ-05 = 100%) | UX-01 §5.1, UI-04 Button | A |
| Destructive button = outline danger; solid danger only inside its confirmation dialog; safe choice never primary-styled for destructive actions | UI-01 §8, UX-05 §6 | A |
| Preparer can never approve own object (approval controls disabled-with-reason or absent) | UX-01 P6, UX-02/UJ-02 | B (A for privileged role grants, SC-28) |
| Components use only semantic/component tokens — never raw colours/sizes/shadows | UI-02 §2, UI-03 §1 | A |
| Fields hidden by visibility policy are never sent by the API; no client-side hiding | UI-04 §3.1, WF-06 SC-20 | B |
| WCAG 2.2 AA for staff app and portal (NFR-ACC-01); vendor console / migration workspace inherit via components, lower audit priority | UI-02 §4 | A |
| Every limit is explained (visibility policy, cooling-off, holds, blocked actions) — never hide a limit without saying why and what to do | UI-01 §9, UX-01 P11, WF-04 content rules, UXQ-03 | A |
| No imagery in the product (no lifestyle or income imagery); no gradients, background patterns or illustrations on work screens; empty states may use one simple line icon | UI-01 §4 | A |
| Portal shows committed data only; open periods show status, never an estimate | WF-04 content rules, UX-01 §5.3 | B |

---

## 1. Design tokens (UI-03) — paste-ready CSS custom properties

Token naming: `category.role.variant.state` → CSS `--category-role-variant-state`. Three tiers: primitive → semantic → component. Source of truth = one JSON file in W3C design-tokens format, exported to CSS custom properties + design tool (UI-03 §11). Semantic layer is the contract; primitives may change with brand decision (OQ-23).

### 1.1 Light theme (House light — rel A, all apps)

```css
:root {
  /* ---------- Primitives (UI-03 §2.1) — never referenced by components ---------- */
  --slate-950:#0F172A; --slate-700:#334155; --slate-600:#475569; --slate-500:#64748B;
  --slate-400:#94A3B8; --slate-300:#CBD5E1; --slate-200:#E2E8F0; --slate-100:#F1F5F9;
  --slate-50:#F8FAFC;  --white:#FFFFFF;
  --blue-800:#173E82;  --blue-700:#1E4FA3;  --blue-50:#EEF4FC;
  --green-800:#14633A; --green-700:#1B7F4B; --green-50:#E8F5EE;
  --amber-800:#7A4900; --amber-700:#8A5200; --amber-50:#FFF4D6;
  --red-800:#912018;   --red-700:#B42318;   --red-50:#FDECEA;
  --info-800:#1849A9;  --info-700:#175CD3;  --info-50:#EAF2FF;

  /* ---------- Semantic colour (UI-03 §2.2) — measured contrast in comments ---------- */
  --color-text-primary:   var(--slate-950); /* 17.85:1 on white */
  --color-text-secondary: var(--slate-600); /* 7.58:1 */
  --color-text-tertiary:  var(--slate-500); /* 4.76:1 white; 4.55:1 on slate-50; placeholder/helper */
  --color-text-disabled:  var(--slate-400); /* 2.56:1 — disabled labels ONLY, never information */
  --color-text-on-action: var(--white);     /* 7.77:1 on blue-700 */
  --color-text-link:      var(--blue-700);  /* 7.77:1 */
  --color-bg-page:    var(--slate-50);
  --color-bg-surface: var(--white);
  --color-bg-subtle:  var(--slate-100);     /* table header, hover, selected-row tint */
  --color-bg-overlay: rgba(15,23,42,0.5);   /* slate-950 @ 50% scrim */
  --color-border-default: var(--slate-300); /* 1.48:1 decorative only, never identifies a control */
  --color-border-control: var(--slate-500); /* 4.76:1 — inputs, checkboxes, unselected controls */
  --color-border-focus:   var(--blue-700);  /* 2px ring, 2px offset */
  --color-action-primary:       var(--blue-700);
  --color-action-primary-hover: var(--blue-800); /* hover+pressed; 10.25:1 with white */
  --color-action-subtle:        var(--blue-50);  /* selected row / active nav bg; blue-700 text 7.02:1 */
  --color-success-text: var(--green-800); --color-success-bg: var(--green-50); /* 6.51:1 */
  --color-success-icon: var(--green-700); /* 5.02:1 */
  --color-warning-text: var(--amber-800); --color-warning-bg: var(--amber-50); /* 6.89:1 */
  --color-danger-text:  var(--red-800);   --color-danger-bg:  var(--red-50);   /* 7.58:1 */
  --color-danger-action: var(--red-700);  /* destructive button; 6.57:1 with white */
  --color-info-text: var(--info-800);     --color-info-bg: var(--info-50);     /* 7.27:1 */

  /* Data-vis categorical sequence (UI-03 §2.5) — NOT yet CVD-simulated; required before use */
  --dataviz-1:#1E4FA3; --dataviz-2:#C2410C; --dataviz-3:#0F766E;
  --dataviz-4:#7C3AED; --dataviz-5:#A16207; --dataviz-6:#475569;
  /* single-series charts use --color-action-primary */

  /* ---------- Typography (UI-03 §3) size / line-height / weight ---------- */
  --font-family-sans: Inter, "Noto Sans", system-ui, sans-serif; /* + script-specific Noto per market pack */
  --font-family-mono: "JetBrains Mono", ui-monospace, monospace;
  --font-weight-regular:400; --font-weight-medium:500; --font-weight-semibold:600; /* no light weights */
  --font-display:  600 32px/40px var(--font-family-sans); /* the ONE key number: net pay, run total */
  --font-title-lg: 600 24px/32px var(--font-family-sans); /* page title, portal */
  --font-title-md: 600 20px/28px var(--font-family-sans); /* page title, staff */
  --font-heading:  600 16px/24px var(--font-family-sans); /* section heading */
  --font-body-lg:  400 16px/24px var(--font-family-sans); /* portal body; ALL inputs on phones */
  --font-body-md:  400 14px/20px var(--font-family-sans); /* staff body, tables */
  --font-body-sm:  400 13px/18px var(--font-family-sans); /* compact tables, captions */
  --font-caption:  500 12px/16px var(--font-family-sans); /* card labels, chips, table headers */
  --font-mono:     400 13px/18px var(--font-family-mono); /* ids, keys, code */
  --font-numeric: tabular-nums lining-nums; /* font-variant-numeric on ALL amounts, counts, dates, ids */
  --prose-max-width: 75ch;

  /* ---------- Spacing (UI-03 §4) base 4px ---------- */
  --space-0:0; --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px;
  --space-6:24px; --space-8:32px; --space-10:40px; --space-12:48px; --space-16:64px;

  /* ---------- Borders, radii, shadows (UI-03 §5) ---------- */
  --border-width-default:1px; --border-width-strong:2px;
  --radius-sm:4px;   /* inputs, buttons, chips in tables */
  --radius-md:8px;   /* cards, modals, drawers' inner panels */
  --radius-full:999px; /* filter chips, avatars (status chips: see Conflicts C-14) */
  --shadow-none:none;
  --shadow-overlay:0 8px 24px rgba(15,23,42,0.16); /* menus, popovers */
  --shadow-modal:0 16px 48px rgba(15,23,42,0.24);  /* modals, drawers */

  /* ---------- Layout fixed dimensions (UI-03 §6) ---------- */
  --header-height:48px; --sidebar-width:208px; --sidebar-width-collapsed:56px;
  --drawer-min:420px; --drawer-max:720px; --portal-column-max:720px; --form-max:640px;
  --modal-sm:400px; --modal-md:560px; --modal-lg:720px; --content-max:1440px;
  --phone-bottom-nav-height:56px; /* WF-02 T3 */

  /* ---------- Z-index (UI-03 §7) ---------- */
  --z-base:0; --z-sticky:100; --z-header:200; --z-drawer:300; --z-modal:400;
  --z-popover:500; /* may sit above a modal */ --z-toast:600; --z-tooltip:700;

  /* ---------- Motion (UI-03 §8) ---------- */
  --motion-duration-fast:120ms;  /* hover, focus, small state */
  --motion-duration-base:200ms;  /* drawer, modal, sheet enter/exit */
  --motion-easing-standard:cubic-bezier(0.2,0,0,1);

  /* ---------- Component tokens (UI-03 §10) ---------- */
  --button-height-md:36px; --button-height-lg:44px; /* portal + phones use lg */
  --input-height-md:36px;  --input-height-lg:44px;
  --table-row-height-comfortable:44px; --table-row-height-compact:32px;
  --table-header-bg:var(--color-bg-subtle);
  --chip-height:24px;
  --target-min-staff:24px;  /* 24x24 */
  --target-min-portal:44px; /* 44x44, 8px apart */
  --focus-ring:2px solid var(--color-border-focus); --focus-ring-offset:2px; /* never removed */
}
@media (prefers-reduced-motion: reduce) {
  :root { --motion-duration-fast:80ms; --motion-duration-base:80ms; } /* instant fades ≤ 80 ms */
}
```

Font sizes per app: staff base 14px (`font.body.md`), portal base 16px (`font.body.lg`); minimum 12px anywhere; 16px minimum for portal body and all inputs on phones (avoids iOS zoom). Captions on portal ≥ 13px (UI-05 §3). Sentence case everywhere; all-caps only for short chip labels.

Icon tokens (UI-03 §9): one open-licence outline set (e.g. Lucide), 24px grid, 1.5px stroke; sizes 16 (inline/tables), 20 (buttons/nav), 24 (empty states/headers); inherit text colour (semantic colour only in chips and banners). Reserved meanings: **lock** = committed/read-only by state · **eye-off** = masked · **shield** = guardrail · **clock** = waiting/cooling-off · **link** = trace/source · **alert-triangle** = warning · **octagon** = blocked. Icon-only buttons need accessible name + tooltip; only search, close, more may be icon-only.

### 1.2 Breakpoints and grid (UI-03 §6, UI-05 §2)

| Token | Range | Cols | Gutter | Margin | Applies to |
|---|---|---|---|---|---|
| `bp.xs` | 360–599 | 4 | 16 | 16 | Phone (portal) |
| `bp.sm` | 600–1023 | 8 | 16 | 24 | Large phone, tablet portrait |
| `bp.md` | 1024–1279 | 12 | 24 | 24 | Staff minimum; tablet landscape |
| `bp.lg` | 1280–1439 | 12 | 24 | 32 | Desktop |
| `bp.xl` | ≥ 1440 | 12 | 24 | auto (content capped 1440, centred) | Wide desktop |

```css
/* CSS custom properties cannot be used inside @media; use these literal queries */
@media (min-width:600px)  { /* sm */ }
@media (min-width:1024px) { /* md */ }
@media (min-width:1280px) { /* lg */ }
@media (min-width:1440px) { /* xl */ }
```
Must also reflow at **320 CSS px** without loss (WCAG 1.4.10); portal checked at 320.

### 1.3 Dark theme — **not in first release** (UI-01 §10, UI-02 §3; release unscheduled, after light theme validated)

Only four mappings are specified (UI-03 §2.6). Everything else is **unspecified** (see Open O-03).

```css
:root[data-theme="dark"] {
  --color-bg-page: var(--slate-950);       /* SOURCE */
  --color-text-primary: var(--slate-50);   /* SOURCE 17.06:1 */
  --color-text-secondary: var(--slate-300);/* SOURCE 12.02:1 */
  --color-action-primary: #8DB4F0;         /* SOURCE; text on it = slate-950 (8.43:1) */
  --color-text-on-action: var(--slate-950);/* SOURCE (implied by the 8.43:1 pairing) */
  /* All other semantic tokens: NOT DEFINED in source — do not ship dark until defined + contrast-checked */
}
```

### 1.4 Themes and tenant branding (UI-01 §3, UI-02 §3, UI-03 §2.3)

| Theme | Scope | Rel |
|---|---|---|
| House light | All apps | A |
| Tenant accent | Portal, statements, emails only: logo (SVG or small PNG), display name, one accent colour | B (first portal release) |
| High contrast | Respect OS forced-colours mode; borders + focus rings must survive; tested per component | A |
| Dark | — | later (unscheduled) |

Tenant accent algorithm: replace `--color-action-primary` (portal scope only) **iff** contrast(accent, white) ≥ 4.5:1 **and** contrast(white text, accent) ≥ 4.5:1 (same number; both stated); else keep house blue-700. Layout, type and semantic/state colours are never tenant-changeable. Staff app and vendor console show tenant **name** only. Branding setting lives in Settings › Company › Branding (logo, name, colour token), versioned.

### 1.5 State → colour mapping (UI-03 §2.4) — global, identical everywhere

| States (period, run, batch, case, connection, …) | Family (text/bg tokens) | Icon |
|---|---|---|
| Open, Draft | Neutral (slate) | circle outline |
| Calculating, Instructing, Computing, In review | Info | progress |
| Calculated, Reviewed, Awaiting approval | Info | eye / clock |
| Committed, Approved | Neutral strong + **lock** | lock |
| Paid, Settled, Closed, Healthy, Ready | Success | check |
| Held, Cooling-off, Behind, Stale, Outdated, Grace | Warning | pause / clock |
| Failed, Rejected, Returned, Blocked, Lapsed | Danger | alert |
| Superseded, Discarded, Retired, Expired | Neutral muted | archive |

Status chip = state colour + icon + label, non-interactive, placed next to object name. States not in the table (e.g. `uploaded`, `mapped`, `Scheduled`, `Active`, `Live`, `instructed`, `accepted`, `unmatched`, `pending`, `denied`, `auto-denied`) need a mapping — see Open O-04.

---

## 2. Layout templates (WF-02 §2)

| ID | Template | Spec |
|---|---|---|
| T1 | Staff shell (≥1024) | Header 48 fixed (logo · tenant · market switcher ▾ │ global search │ bell · help · user) · sidebar 208 (56 collapsed) from permissions · content: title row (object name + state chip, ≤1 primary right-aligned, secondaries left of it, overflow menu) → one-sentence summary → page banner (only when condition) → KPI cards (0–5) → tabs → filter bar → main (table/form/tree/chart) + optional drawer (1/3–1/2) → sticky approval/action bar (approval pages) |
| T2 | Portal desktop/tablet | Top bar: tenant logo + up to 6 nav items; one centred column ≤720; no sidebar; line explanation as side panel (360px) at ≥1024 |
| T3 | Phone (360–599) | Top bar 48 (back, title, bell) · one column, 16px margins · bottom nav 56 with ≤5 items (labels always visible) · bottom sheets instead of drawers · full-width 44px buttons |
| T4 | Centred card | Sign-in, public forms: card ≤480; public documents: 720 column; plain page |

Page hierarchy everywhere (UI-01 §7): (1) title + state, (2) one-sentence summary, (3) condition banner, (4) key figures, (5) detail, (6) action bar. Primary action: top-right of title row, or sticky bottom bar on approval pages and phones. Staff forms 480–640 wide; portal never shows > ~7 items before "Show more". Summary sentence **required** on dashboards, reviews, approvals; every table on executive and distributor pages has a one-sentence summary (UXQ-04).

Visual hierarchy (UI-01 §8): page title 20–24/600; key number 28–36/600 tabular (token: 32/40); section heading 16/600; body 14 staff / 16 portal; secondary 12–13 in `color.text.secondary` (≥4.5:1). Primary button solid accent, one per view; destructive outline danger (solid only in its confirmation); state = chip with icon + label next to object name; banners full-width, tinted by semantic colour, icon + cause + action.

Interface style (UI-01 §4–§5): flat white content on a very light neutral page; 1px borders define regions; **shadows only for overlays**; small radii 4–8px; tables comfortable 44 / compact 32, **forms always comfortable, distributor pages always spacious**; one outline icon family, icons always paired with text except search, close, more; motion functional only (120–200 ms, overlays and state changes). Colour: ~90% of any screen neutral; one accent (deep blue) for primary actions, links, selection, focus; semantic colours carry meaning only, never decorative. Density: executives' pages use cards and charts before tables; distributor pages show at most ~7 items before "Show more". Portal: net pay is the single largest element on the page; one idea per block.

---

## 3. Component library (UI-04) — variants, states, behaviour, a11y

### 3.1 Shared interactive states (all components)
`default · hover · focus-visible (2px ring, 2px offset, never removed) · active/pressed · selected · disabled (reason exposed to AT and on hover/tap) · loading · error`. Min target 24×24 staff, 44×44 portal.

### 3.2 Base components

| Component | Variants | Behaviour rules | A11y |
|---|---|---|---|
| Button | primary (1/view), secondary (outline), tertiary (text), destructive (outline; solid only in its confirmation), icon-only; md 36 / lg 44 | Label = verb + object ("Approve batch"), never "OK". Loading: spinner replaces label, width kept, clicks ignored. Never disabled without visible reason. Submit: disabled only while submitting; idempotency key per form instance | native `<button>`; `aria-busy` while loading; icon-only named |
| Input (text, number, money, password, textarea) | prefix/suffix (currency, unit), helper, error, masked | Label above, helper below, error replaces helper. Money: locale separators, shows parsed value on blur, stored as minor units, what is typed is stored. Masked: "•••• 4821" + separate Show action | label associated; `aria-describedby` error; `aria-invalid` |
| Select | native ≤12 options on phones; custom listbox on desktop | Placeholder is not an option; >~12 options → combobox | listbox; type-ahead |
| Combobox | searchable single; multi with chips; async (people, positions) | debounced; "No results"; chips removable by keyboard | `aria-expanded`, `aria-activedescendant` |
| Menu | row menu, object menu | click/Enter opens; Escape/outside closes; destructive items last, separated | menu button pattern |
| Checkbox | single, group, indeterminate (select-all) | label clickable; group legend | `aria-checked="mixed"` |
| Radio group | vertical (default); horizontal for 2–3 short | one always selected when required | fieldset+legend; arrows |
| Switch | label + "On"/"Off" text | **only** for settings applying immediately; versioned settings use a form + Save | `role="switch"` |
| Card | plain, KPI (label, value, delta, link), status (connection health), selectable | KPI links to source; delta = sign + text, not colour | card not a button unless whole card is one link |
| Table | comfortable 44 / compact 32; selection; expandable rows; totals row | see §6.2 | native table; `aria-sort`; selection announced; row keyboard nav |
| Pagination | cursor: Previous, Next, rows/page, "1–50 of about 12,000" | no page-number jumps on large tables | named buttons |
| Tabs | underline (page), contained (in cards) | state in URL; overflow scroll arrows; **never for steps**; phone: scrollable row, never wraps | tabs pattern; `aria-selected` |
| Sidebar nav | expanded 208, collapsed 56 + tooltips | sections from permissions; current marked; groups remember collapse state | `nav`; `aria-current="page"` |
| Header | staff (market switcher, search, bell, help, user); portal (logo, nav); phone (back, title, bell) | fixed; market switcher scoped to user | `banner`; skip link first |
| Breadcrumbs | text links | only below 2nd level; last = current page, not link | `nav aria-label="Breadcrumb"` |
| Modal | 400 / 560 / 720; confirm, effect preview, critical approval | title states action; one primary; focus trapped, returned on close; never stacked; phone = full-screen sheet; tablet centred 560 | dialog; `aria-modal`; labelled by title |
| Drawer | right, 420–720; phone full-screen or bottom sheet | linkable URL state; Escape closes; page behind stays readable | non-modal dialog; focus to drawer heading |
| Tooltip | text only ≤80 chars | hover + focus; Escape dismisses; never sole place for needed info | `role="tooltip"`; WCAG 1.4.13 |
| Popover | definition, basis status, filter panel | click opens; Escape/outside closes | labelled; focus managed |
| Toast | success, info only | 5 s; pauses on hover/focus; optional action (Undo); max 3 stacked; **errors needing action are never toasts**; phone: bottom above nav bar; desktop bottom-right | `role="status"` polite |
| Banner | info, warning, danger, success; page or section | icon + cause + effect + action; persists while condition holds; not dismissible for blocking conditions; full width, never truncated | `role="status"`, `alert` for danger |
| Chip | status (non-interactive), filter (removable), count | remove button "Remove filter: X" | — |
| Chart | line (trend), bar (comparison), stacked bar (mix), histogram (distribution) | direct labels; axis titles with units; "View as table" toggle **always**; no 3D; no pie > 4 parts; patterns if > 4 series | table alternative; summary sentence above; focusable points |
| KPI with trend | value, delta, sparkline | sparkline decorative; delta text carries info | sparkline `aria-hidden` |
| File upload | drop zone + button; multi-file per-file status | shows accepted types + size limit before upload; per-file progress; per-file server validation; rejected files state reason | button is accessible path; progress announced |
| Date picker | single, range, month, **period picker** | typing in locale format; period picker lists periods with their state; effective dates snap to period boundary with explanation | grid pattern; format hint in label |
| Search | command palette; inline filter search | §6.3 | combobox; grouped headings |
| Filters | bar, chips, "More filters" panel, saved views | §6.3 | each labelled; result count announced |
| Empty state | first use; no results | optional icon + one sentence + one action; 64px padding | heading + text |
| Skeleton / progress | skeleton; determinate progress with stages | skeleton ≤ ~2 s then message; jobs show stage names + counts; no fake percentages | `aria-busy`; text equivalent |
| Stepper | horizontal (wizard), vertical (checklist) | per-step status: done, current, blocked (with reason), to do; phone = vertical, current expanded | list semantics; current marked |

### 3.3 Advanced / domain components

| Component | Rel | Spec (anatomy · behaviour · states) |
|---|---|---|
| **Genealogy tree view** (FR-GEN-003, -007; FR-DIST-004) | B | Search field · tree-kind toggle (sponsor/placement) · as-of + known-at selectors (staff) · breadcrumb to root · focused node · child rows (id or name per visibility, rank chip, status chip, descendant count) · "Show n more" · node panel. Opens on search or own position; loads one level at a time, **page of 25**; collapsed branches show counts; depth cap per request; selection updates panel + URL. Portal variant: beyond depth limit one summary row "n people · volume v (totals only)". States: loading branch; stale read model (banner, depth-limited); historical view (banner with as-of & known-at); nothing found; outside scope ≡ not found. Keyboard: Up/Down, Right expand/enter, Left collapse/parent, Home/End; announces level, position-in-set, expanded. Indented-list view one toggle away. Phone: list drill-in, breadcrumb "… › parent › current". **Never**: whole-tree canvas, zoomable org chart as only view, client-side field hiding |
| **Plan builder** (FR-PLN-001..004) | B | Version header (state chip, effective date, Compare, Simulate, Submit) · tabs: Rules, Caps and pools, Calendars, Transitions, Golden datasets, History · rules grouped by pass (measures, ladders, bonuses, caps) · rule editor drawer (typed form from primitive schema; expression fields: syntax highlight, type check, example evaluator on a golden case; each rule states tree, measure, reversal policy) · plain-language rendering per rule · guardrail panel · validation list · dependency view (read-only measure→ladder→bonus→cap, table alternative) · diff ("Level 2 rate 5% → 6%"). States: Draft (editable, autosave) · validation errors per rule · guardrail blocked (save refused, rule id + basis) · guardrail warned (acknowledgement) · approved/active (immutable, lock) |
| **Commission statement table** (FR-DIST-001, -002) | B | Net pay (display) · summary rows gross, withholding (with rate), clawbacks, adjustments · payout status · groups position → bonus → lines · line: name, amount, "How calculated" · disclosure link when published (V1). Formula shown as lines: **net = gross − withholding − clawback ± adjustment**. Right-aligned tabular; withholding & clawbacks separate rows with minus signs; adjustment/restatement lines name original period; per-position and per-person totals must add up. Explanation sheet/panel: title, 1–2 plain sentences, inputs (rate, base, rank used, period, rounding), Dispute link. States: open period (status only, no numbers) · payout held (reason, date) · line under dispute (chip) · explanation template missing (generic inputs). Staff variant: trace link per line, masked payee data. Print/download: single-column doc in chosen language. Never: projections, comparisons with others, congratulation styling |
| **Ledger transaction table** (FR-FIN-001, -002) | B | Balance-check strip (accounting identity **expense = payable + withholding + residue** with pass/fail mark) · account cards · filter bar · postings: posted time, entry id, account, debit, credit, origin link, approver · totals row. Debit/credit separate columns; entry postings expand together and show balance; every row links to origin (run, batch, case); **no edit controls of any kind**. States: period selected; account selected; imbalance (danger banner; should never occur). Journal export panel with mapping status |
| **Org performance dashboard** (FR-RPT-001; FR-DIST-009 V1) | B / V1 | Period + market filters · summary sentence · KPI cards with (i) definition popovers · trend charts with table toggle · breakdown by market/brand/(leaders V1) first-level team. Figures only from committed runs and snapshots and reconcile to them; partial-data banner when sync behind. Allowed: net sales, active earners, payout share of sales, retail-customer share, customers served, repeat-order rate, returns. Not allowed: recruit counts as rankings, income projections, top-earner lists |
| **Complex reporting filters** | B | Filter bar + "More filters" panel grouped (time, organisation, people, money, state) + applied chips + saved views. Operators: is, is any of, is not; ranges for amounts/dates; period ranges by calendar. Count updates on apply; URL carries filter; invalid combos explained; export uses current filter and shows row count; panel = dialog on small screens; "Clear all" |
| **Permission matrix** (FR-IAM-003) | A | Roles list (base + tenant) · matrix rows = capability groups (collapsible), cols = roles, cells = none / read / act / approve · scope selector per assignment (markets, brands) · conflict panel. Base roles read-only, clonable; conflicting duty pairs flagged before save; privileged changes show "needs approval by a second admin"; diff shown before submit. Real `<table>` with headers; cells are radios/checkboxes named in full ("Finance approver: approve payout batches") |
| **Workflow status** (stepper with checks) | B | Read-only fixed workflow (plan change, market launch, migration, period close): steps, status, blockers with reasons, who acted, when. **No user-configurable workflow builder** (UI-04 §3.8) |
| **Approval bar** | B (A for SC-25/SC-28 approvals) | Sticky bottom: who prepared, who may approve, policy checks passed/failed, Reject + Approve, step-up prompt; disabled with reason for preparer |
| State timeline | B | Horizontal lifecycle (Open → … → Closed), current emphasised, next action stated; wraps at md |
| Variance table | B | This run, previous run, change, %; sorted by absolute change; rows open movers |
| Effect preview | B | Before/after values, affected people and periods, policy checks; required in every money or structure approval |
| Trace viewer | B | Collapsible tree: rule → inputs → intermediate values → rounding; ids link to orders and positions; opens in drawer |
| Figure card with method | A | Compliance figure + population, numerator, denominator, method link, data-quality warning |
| Masked field | B (A where present) | Masked value, Show action (audited, step-up), auto-hide after short time (duration unspecified — O-05) |
| Evidence list | B | Files with uploader, time, type; immutable once case decided |
| Basis-status badge | B | Values: Screening, Primary read, Counsel-confirmed; on every market-pack rule |
| Support-session frame | A | Persistent coloured border + bar "Vendor support session · read-only · ends in 02:41" around tenant app for vendor staff (colour token unspecified — O-06) |
| Diff viewer | B | Side-by-side: plan versions, settings versions, mappings |

**Not in the library (must not be built):** leaderboard, earnings projection widget, celebration/badge animations, countdown timers (support-session countdown is the only countdown), social feed, chat assistant, whole-tree org-chart canvas, wallet balance widget.

Component → highest-risk screen usage (UI-04 §4): SC-02 = KPI cards, tabs, variance table, exception list, trace drawer, approval bar, critical-approval modal · SC-04/SC-42 = plan builder, diff viewer, guardrail panel, KPI cards, histogram, table · SC-18 = statement table, explanation sheet, held banner, dispute chip · SC-07/SC-20 = tree view, filters, node panel, banners (as-of, stale, limited data) · SC-06 = form, evidence list, effect preview, timeline, approval bar · SC-10/SC-26 = figure cards with method, charts with table toggle, drill-down table, export dialog.

---

## 4. Applications, navigation and sitemap

### 4.1 Application areas (UX-02 §1)

| Area | Audience | Host | Layout | First rel |
|---|---|---|---|---|
| Staff application | Tenant staff | `{tenant}.{cell-domain}` | T1 | A |
| Distributor portal | Distributors, leaders | `{tenant}.{cell-domain}/portal` or tenant domain | T2/T3, mobile-first, server-rendered | B |
| Vendor console | Vendor staff | separate hostname + identity realm | sidebar (T1 variant), desktop only | A |
| Public pages | Anyone | tenant domain | T4 | B (SC-41), V1 (SC-40) |

Sign-in (SC-27) resolves realm + role → staff / portal / vendor. Tenant resolved from hostname; no tenant picker.

### 4.2 Staff application sidebar (UX-02 §3) and role matrix

Sections in order: Home · Periods · Plans · People · Orders · Cases · Payouts · Finance · Compliance · Data · Settings.
**MVP-A sidebar = Home (Compliance overview SC-46), Compliance, Data, Settings (users, vendor access, audit).** (WF-03 says "three items in MVP-A" — see C-06.) MVP-B = 11 items.

| Section → screens |
|---|
| Periods: SC-01, SC-02, SC-32 |
| Plans: SC-04, SC-05, SC-42, SC-44 |
| People: SC-36, SC-09, SC-07, SC-43 |
| Orders: SC-31 |
| Cases: SC-06, SC-08, SC-15 |
| Payouts: SC-03, SC-34 |
| Finance: SC-33, SC-12 |
| Compliance: SC-46, SC-10 (+SC-26), SC-11, SC-23 (V1), SC-45 (V1) |
| Data: SC-24, SC-25, SC-16 |
| Settings: SC-28, SC-29, SC-17, SC-13, SC-14, SC-30, SC-47 (self-hosted, V1) |

Role navigation (● shown, **H** landing, — absent):

| Section | Executive | Tenant admin | Analyst | Plan admin | Finance approver | Payout officer | Compliance | Support | DPO | Impl. consultant |
|---|---|---|---|---|---|---|---|---|---|---|
| Home | **H** SC-35 (A: SC-46) | Settings home | Periods | Plans | Approvals | Batches | Compliance overview | Search | Privacy | Data |
| Periods | — | — | **H** ● | read | ● review, commit | read | read | — | — | read |
| Plans | — | — | read | **H** ● | activate | — | review | — | — | ● |
| People | — | read | ● | — | read | read | ● | **H** ● masked | read | ● |
| Orders | — | — | ● | — | read | — | read | ● | — | ● |
| Cases | — | — | ● | — | approvals | returned payments | ● | ● | privacy | — |
| Payouts | — | — | — | — | **H** approve | **H** ● | holds | — | — | — |
| Finance | read | — | read | — | ● | read | read | — | — | — |
| Compliance | read | read | read | read | read | — | **H** ● | — | read | mapping |
| Data | — | ● | — | — | — | — | mapping approval | — | — | **H** ● |
| Settings | — | **H** ● | — | — | money settings approval | — | market sign-off; audit | — | breach contacts | — |

Licensee administrator (self-hosted, V1): landing Settings › System (SC-47).

Top bar (all staff pages, UX-02 §3.2): tenant name + market switcher (markets in scope; "All markets" where permitted; persists per user) · global search (`/` or `Ctrl K` → command palette SC-36) · period context chip on period-scoped pages (calendar, period, state, lock when committed) · bell (approvals waiting, run finished/failed, sync behind, case assigned, vendor-access request, deadline approaching; each links to object) · help (context help + glossary) · user menu (`/profile`: name, language, time-zone display, MFA devices, sessions, notification prefs, saved views; sign out).

### 4.3 Staff routes (UX-03 §2 — proposals, not a frontend contract)

| Route | Screen | Rel | Permission |
|---|---|---|---|
| `/signin`, `/signin/mfa`, `/signin/enrol` | SC-27 | A | public |
| `/` | role home redirect | A | any |
| `/overview` | SC-35 | B | `dashboard.exec` |
| `/compliance` | SC-46 | A | `compliance.read` |
| `/compliance/reports?from&to&market` | SC-10 | A | `compliance.read` |
| `/compliance/reports/snapshots/:id` | SC-10 (immutable snapshot) | A | `compliance.read` |
| `/compliance/reports/snapshots/:id/figures/:key` | SC-26 | A | `compliance.read` |
| `/compliance/guardrails` | SC-11 | B | `guardrail.read` |
| `/compliance/disclosure` | SC-23 | V1 | `disclosure.publish` |
| `/compliance/signals` | SC-45 | V1 | `compliance.read` |
| `/data/imports`, `/data/imports/:id` | SC-24 | A | `import.manage` |
| `/data/mappings/:id` | SC-25 | A | `mapping.edit` |
| `/data/migration` | SC-16 | B | `migration.manage` |
| `/periods` (calendar tabs) | SC-01 | B | `period.read` |
| `/periods/:id/runs/:runId/review` | SC-02 | B | `run.review` |
| `/periods/late` | SC-32 | B | `late.manage` |
| `/plans`, `/plans/:id/versions/:v` | SC-04 | B | `plan.read` |
| `/plans/:id/versions/:v/caps` | SC-05 | B | `plan.edit` |
| `/plans/:id/versions/:v/simulations/:simId` | SC-42 | B | `plan.simulate` |
| `/plans/:id/versions/:v/change` | SC-44 | B | `plan.approve` |
| `/people/search` | SC-36 | B | by role |
| `/people/:participantId` (tabs: profile, positions, types, status, customers, tax, bank, cases) | SC-09 | B | `participant.read` |
| `/people/:participantId/qualification` | SC-43 | B | `participant.read` |
| `/genealogy?root&kind&asOf&knownAt` | SC-07 | B | `genealogy.read` |
| `/orders`, `/orders/:id` | SC-31 | B | `order.read` |
| `/cases`, `/cases/:id` | SC-06 | B | `case.*.read` |
| `/cases/genealogy/new`, `/cases/duplicates` | SC-08 | B | `case.genealogy.*`, `case.duplicate.*` |
| `/cases/privacy` | SC-15 | B | `privacy.manage` |
| `/payouts/batches`, `/payouts/batches/:id` | SC-03 | B | `payout.prepare` or `payout.approve` |
| `/payouts/reconciliation` | SC-34 | B | `payout.reconcile` |
| `/finance/ledger`, `/finance/ledger/accounts/:id` | SC-33 | B | `ledger.read` |
| `/finance/tax` | SC-12 | B (B-MKT content) | `tax.read` |
| `/settings/users`, `/settings/roles` | SC-28 | A | `user.manage` |
| `/settings/company`, `/settings/policies`, … | SC-29 | A/B (C-05) | `settings.manage` |
| `/settings/markets/:code/launch` | SC-17 | B | `market.manage` |
| `/settings/integrations` | SC-13 | B | `integration.manage` |
| `/settings/vendor-access` | SC-14 | A | `vendor_access.decide` |
| `/settings/audit` | SC-30 | A | `audit.read` |
| `/settings/system` | SC-47 | V1 | `system.manage` (self-hosted only) |
| `/profile` | Profile (no SC id) | A | self |

Settings groups (UX-02 §6): People and access (users, roles, pending approvals, API keys — immediate after approval, audited) · Company (markets + launch checklist, brands, languages, branding — versioned) · Calendars and periods (calendars, cut-off time zones — effective at period boundary) · Participants (types, flags, purpose requirement, agreement versions — versioned, approval) · Money policies (rounding mode, clawback policy per bonus, write-off threshold, minimum payout, cooling-off length, adjustment thresholds — versioned, finance approval, effective at period boundary) · Privacy (visibility policy, breach contacts, retention [V1] — versioned, DPO approval) · Compliance (report thresholds: R2 flag, R4 day and thresholds; guardrail acknowledgements — versioned) · Integrations (commerce connectors, payout providers + eligibility records, webhooks, exports — audited) · Vendor access · Audit (read-only) · System (self-hosted; second approver for updates). **Every versioned setting shows "effective from", who changed it, reason, and a history drawer.**

### 4.4 Distributor portal (rel B) — nav + routes (UX-02 §4, UX-03 §3)

Bottom nav (phone/tablet): **Home · Earnings · Rank · Customers · More** (≤5, labels always visible). Team replaces Customers in the bar only for participant types that can sponsor **and** have a downline; otherwise Team sits under More. md+ uses top bar (T2). More = Payment details and tax profile (SC-22) · Notifications and preferences (SC-38) · Language · My data (access/erasure request) · Earnings disclosure link (V1) · Sign out. Position switcher appears only when the person owns > 1 position; default view per person. Landing: Distributor → SC-37; Team leader → SC-37 with Team (UX-01 §3). Distributor profile (UX-02 §9): language, contact verification, notification channels, MFA option, payment details and tax profile (SC-22), data requests. Desktop/tablet (WF-04): content and order identical to phone; nothing is added on larger screens except side-by-side line explanation. Phone reach (WF-06): primary action in the lower half of the screen; targets ≥44×44 with ≥8px spacing; tables → stacked cards with 3 most important fields, rest behind a tap; trees → list drill-in with counts, never a drawn tree; installable to home screen, no native app in MVP (P-09).

| Route | Screen | Rel | Notes |
|---|---|---|---|
| `/portal/signin` | SC-27 | B | one-time code (default) or password |
| `/portal` | SC-37 | B | home |
| `/portal/earnings` | SC-18 list | B | committed periods only |
| `/portal/earnings/:runId` | SC-18 detail | B | cacheable; service worker keeps last viewed |
| `/portal/earnings/:runId/lines/:lineId` | SC-18 explanation | B | sheet on phone, side panel ≥1024 |
| `/portal/earnings/:runId/lines/:lineId/dispute` | SC-18 → case | B | |
| `/portal/rank` | SC-19 | B | |
| `/portal/customers`, `/portal/customers/:id` | SC-21 | B | |
| `/portal/team`, `/portal/team/:positionRef` | SC-20 | B | visibility policy |
| `/portal/more/payment-details` | SC-22 | B | re-authentication to change |
| `/portal/more/notifications`, `/portal/more/language` | SC-38 | B | |
| `/portal/more/my-data` | privacy request (no SC id) | B | |

Home has no targets dashboard: no recruit counts, no "next rank in X", no projected amounts.

### 4.5 Vendor console (rel A, desktop only) — (UX-02 §5, UX-03 §4)

Sections: Tenants (name, region, tier, state, job health) · Support sessions (requests, active, history) · Provisioning · Market packs (versions, basis status, release notes) · Releases (self-hosted packages, advisories) · Vendor audit log. **No route to tenant business data**; an approved session opens the tenant's staff app in the read-only support-session frame with countdown.

| Route | Screen | Rel |
|---|---|---|
| `/tenants`, `/tenants/:id` | SC-39 | A |
| `/support-sessions` | SC-39 | A |
| `/provisioning/new` | SC-39 | A |
| `/market-packs` | SC-39 | B |
| `/releases` | SC-39 | V1 |
| `/audit` | vendor audit log (no SC id) | A |

### 4.6 Public (T4)

`/privacy-request` → SC-41 (B) · `/earnings-disclosure` → SC-40 (V1).

### 4.7 Deep links (UX-03 §6)
Filters, sort, period, market, as-of dates in the query string; links reproduce the view subject to recipient permissions. Links to committed objects are permanent. Drawer/tab state in URL.

### 4.8 Search scopes (UX-02 §7)
Global staff: participant by external id / name (staff only) / position ref; order by source id; case id; run & period; statement by payee & period — trigram on names, exact on ids, grouped, keyboard. In-list: server-side filter + saved views. Genealogy: position/person then context, as-of applies. Portal Team: name or id **within own downline only**. Audit: actor, action, object, time range.

### 4.9 Notifications matrix (UX-02 §8)

| Event | Staff in-app | Staff email | Distributor |
|---|---|---|---|
| Approval waiting (run, batch, plan, adjustment, role grant) | ● | ● mandatory | — |
| Run finished or failed | ● | optional | — |
| Sync behind at cut-off | ● | ● | — |
| Case assigned / deadline near | ● | optional | — |
| Vendor access requested | ● | ● mandatory (admins) | — |
| Statement ready | — | — | ● in-app, email or SMS by preference |
| Payout sent, returned or held | — | — | ● |
| Bank details changed | — | — | ● **mandatory, to old and new contact** |
| Dispute update | ● assignee | optional | ● |
| Plan change notice | — | — | ● mandatory |
| Credit expiry (FR-DIST-008) | — | — | ● |

Approvals and security notices cannot be turned off. No sensitive amounts or bank details in SMS.

---

## 5. Screen catalogue — all 47 screens

Columns: Rel (spec.json) · Tmpl · Perms (WF-01) · Primary / Secondary actions · Key content (fields/columns) · Components · Nav → · APIs (via spec.json requirement links). Wf = drawn wireframe (Y) or text-only (N).

### 5.1 Staff application — MVP-A screens

| ID | Name | Rel | Wf | Perms | Primary | Secondary | Key content | Components | Nav → | APIs |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-46 | Compliance overview (overlay home) | A | Y | `compliance.read` | Create snapshot | Open reports; open imports | Latest R1–R5 headline figures; data coverage; warnings | KPI cards; trend sparkline; data status panel | SC-10, SC-24 | API-04, -05, -19 |
| SC-10 | Compliance reports | A | Y | `compliance.read`; `snapshot.create` | Create snapshot | Open figure; export; compare periods | R1–R5 figures with populations, method notes (method panel always visible beside figures), data-quality warnings, trend; snapshot list | Period selector; figure cards; charts; method drawer; snapshot list | SC-26, SC-46 | API-04, -05, -06 |
| SC-26 | Figure drill-down | A | Y | `compliance.read`; `export` | Export (logged) | Page; filter | Definition; numerator and denominator row sets; sums (must equal figure components, AC-41.1) | Definition panel; paged table | SC-10 | API-04, -05, -06 |
| SC-24 | Data imports | A | Y | `import.manage` | Upload files / Load — changes with batch state: Upload → View report → Open mapping → Load | Download error report; view batches | Batch table: state, counts, control totals; validation errors by code; market + period range on upload; 3 files | Upload zone; batch table; validation report | SC-25, SC-10 | API-01, -02 |
| SC-25 | Import mapping | A | Y | `mapping.edit`; `mapping.approve` | Approve mapping (compliance officer only; consultant saves drafts) | Add note | Distinct source values with counts → target category (types, purposes, source kinds); version history | Mapping table; version selector | SC-24, SC-10 | API-03 |
| SC-27 | Sign-in and second factor | A (portal entry B) | Y + phone | public | Sign in | Enrol factor; recover | Credential fields; factor prompt. Distributor: one-time code default, numeric keyboard | Form (T4; T3 on phone) | role home | API-07 |
| SC-28 | Users and roles | A | Y | `user.manage` | Invite / Assign role | Approve privileged grant; deactivate | Users: roles, scopes, MFA state; role permission matrix; pending approvals | Table; role editor; permission matrix | SC-30 | API-40 |
| SC-14 | Vendor access sessions | A | Y | `vendor_access.decide` | Approve / Deny | Set duration; end session now | Request cards (reason, scope, duration); active sessions (countdown + End now); per-session log table (visible to tenant) | Request cards; log table | SC-30 | API-08 |
| SC-30 | Audit log | A | N | `audit.read` | Search | Open event; export | Events: actor, action, object, time | Filter bar; table; event drawer (pattern: list + drawer) | — | API-06, -09 |

### 5.2 Vendor console

| ID | Name | Rel | Wf | Perms | Primary | Secondary | Key content | Components | Nav → | APIs |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-39 | Vendor operations console | A (market packs B, releases V1) | Y | vendor roles | Request support session | Provision tenant; maintain market packs | Tenants: name, region, tier, state, job health; session requests (reason, scope, duration required) | Table; request modal; provisioning wizard | — (no tenant-data routes) | API-08, -32, -39 |

### 5.3 Staff application — MVP-B screens

| ID | Name | Rel | Wf | Perms | Primary | Secondary | Key content | Components | Nav → | APIs |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-01 | Periods and runs (analyst home) | B | Y | `period.read`; `run.execute` | Calculate / open review — the only primary = next valid action for newest unfinished period | Replay; open late queue; open batches | Calendar tabs; periods: state, cut-off (with TZ), sync health, last run totals, blockers | State timeline; period table; health banner; progress panel | SC-02, SC-32, SC-03, SC-13 | API-05, -18, -19, -37 |
| SC-02 | Run review | B (variance explainer FR-AI-001 = V1) | Y | `run.review`; `run.commit` (approver, step-up) | Request commit (preparer) / Commit (approver) | Export; open line trace; re-run | Totals vs previous run; variance by bonus; top movers; exceptions (each acknowledged); what changed | KPI cards; tabs; variance table; movers table; exception list; trace drawer; approval bar; critical-approval modal | SC-01, SC-06, SC-03 | API-18..21, -25 |
| SC-32 | Late-transaction queue | B | Y | `late.manage` | Accept default (bulk with preview) | Raise restatement | Items: original period, effect estimate, proposed handling (restatement-policy items propose restatement) | Table; bulk bar; preview modal (count, total effect, affected payees) | SC-06, SC-01 | API-10, -11 |
| SC-04 | Plan versions: edit, compare, simulate | B (config assistant FR-AI-002 = V1) | Y | `plan.edit`; `plan.read` | Save draft / Simulate | Compare versions; submit for review; view guardrails | Rule list in plain language; parameters; guardrail outcomes; version diff | Version header; rule list; rule editor drawer; diff view; guardrail panel | SC-05, SC-42, SC-44, SC-11 | API-16, -17 |
| SC-05 | Cap and pool configuration | B | Y | `plan.edit` | Save cap | Preview on period | Scope, base, rate, method (proportional / priority), priority list, residue; preview of payees and amounts removed (recomputed on method change) | Form; priority list (move up/down buttons, no drag-only); preview table | SC-04, SC-42 | API-16, -17 |
| SC-42 | Simulation results and golden datasets | B | Y | `plan.simulate` | Run simulation | Export; add golden case | Totals v1 vs v2 (reconcile, AC-10.1); distribution of change; payee table; golden pass/fail (failures list lines, block submission) | KPI cards; histogram; table; golden list | SC-04, SC-44 | API-17 |
| SC-44 | Plan change workflow | B | Y | `plan.approve` | Approve / Schedule | Record filing; set notice | Checklist: simulation, guardrails, filing per market (only where market pack requires), notice, transition rules | Stepper; checklist; approval bar | SC-04, SC-42 | API-16 |
| SC-36 | Global search | B | N | by role | Search | — | Grouped results with masked fields | Command palette; result groups | SC-09, SC-31 | API-23 |
| SC-09 | Participant record | B | Y | `participant.read`; unmask needs extra permission (unnamed — O-07) | Start case | Unmask field (audited, step-up); open statement; open tree | Identity (masked), types history, positions, status history, servicing, tax profile, bank detail history, cases — all history tabs read-only effective-dated rows | Header; tabs; history tables; masked fields | SC-07, SC-06, SC-43, SC-18 | API-12, -27, -35 |
| SC-07 | Genealogy explorer (staff, as-of) | B | Y | `genealogy.read` | Search | Set as-of and known-at; switch sponsor/placement tree; open participant | Focused node, breadcrumb to root, children with counts, status, rank | Search box; date selectors; tree-kind toggle; lazy tree; node panel | SC-09, SC-08 | API-12..15 |
| SC-08 | Genealogy change and duplicate cases | B | Y | `case.genealogy.*`; `case.duplicate.*` | Submit request / Approve | Compare records; view affected periods | Form: tree kind, change vs correction, proposed parent, dates, evidence; policy check result; affected committed periods + impact; duplicate side-by-side with matching attributes highlighted | Form wizard; policy result panel; side-by-side comparison | SC-06, SC-07 | API-15, -30 |
| SC-43 | Rank and qualification detail (staff) | B | N | `participant.read` | — | Compare periods | Per period: paid-as, titles, counters, carry, flags, source run | Period table; diff highlight (pattern: record with history tabs) | SC-09 | API-19 |
| SC-31 | Orders and returns (ingested) | B | N | `order.read` | Search | Open order; saved views | Orders: buyer type, purpose, attribution, volumes, period, events | Filterable table; order detail with event timeline | SC-09, SC-32 | API-10, -11, -23 |
| SC-06 | Cases: adjustments, disputes, restatements | B (registers FR-CPL-013 = B-MKT) | Y | `case.<type>.read/act` | Approve / Reject / Submit | Attach evidence; preview effect; reassign | List by type and state; detail: history timeline, reason code, evidence, effect preview, approvals; disputes auto-attach trace; restatements show diff per payee + bonus | Filterable table; case layout with timeline; evidence uploader; effect preview; approval bar | SC-02, SC-09, SC-33 | API-21, -22, -23, -30 |
| SC-15 | Privacy requests | B | N | `privacy.manage` | Fulfil | Verify identity; record retention basis | Requests: type, deadline (indicator), state | Table with deadline indicators; case detail | SC-06 | API-31 |
| SC-03 | Payout batches and approvals | B | Y | `payout.prepare`; `payout.approve` | Prepare batch / Approve | Retry failed lines; open exclusions; open payee | Batches: state, totals, counts; tabs Included / Excluded (reasons) / Instructions (per line: instructed, accepted, settled, returned, failed) | Batch table; detail tabs; approval bar | SC-34, SC-09, SC-06 | API-20, -25 |
| SC-34 | Payout reconciliation and returned payments | B | N | `payout.reconcile` | Resolve item | Open case; import report | Settled, returned, failed, unmatched with amounts; unmatched = working list | Summary cards; exception table | SC-03, SC-06 | API-26 |
| SC-33 | Ledger and journal export | B | Y | `ledger.read`; `export` | Generate export | Open account; receivables ageing; propose write-off | Balance-check strip (expense = payable + withholding + residue, pass/fail); account cards (wireframe: payee payable, in transit, withholding payable, clawback receivable, write-offs); filters account type, payee, origin, date; postings: posted, entry, account, debit, credit, origin, approver; exports (mapping status); receivables + in-transit ageing (UX-01 §5.3) | Account table; postings table; export panel (ledger transaction table) | SC-06, SC-34 | API-22, -23, -24, -28, -30 |
| SC-12 | Tax configuration and year-end forms | B; content B-MKT (FR-TAX-002/003) | N | `tax.read`; `tax.forms` | Generate forms | Fix missing tax ids; export | Rules with effective dates + basis status; year totals per payee per form type; missing ids (validation list) | Rules table; year-end wizard; validation list | SC-09 | API-36, -39 |
| SC-11 | Guardrails and overrides log | B | N | `guardrail.read`; `override.approve` | Approve override | Filter by outcome | Decisions: rule id, basis status, outcome, version; overrides with justification | Table; detail drawer | SC-04 | API-16 |
| SC-16 | Migration workspace and parallel-run report | B | Y | `migration.manage`; `signoff` | Run comparison / Sign off | Upload extracts; map; classify differences | Import steps + validation (cycles, orphans, totals); per-payee differences by class (rule, data, rounding) | Stepper; validation list; difference table; sign-off bar | SC-42, SC-04 | API-38 |
| SC-17 | Market launch checklist | B | Y | `market.manage`; `market.signoff` | Request go-live / Sign off | Attach evidence | Items: owner, evidence, basis status, state (licence evidence, provider eligibility, tax rules, agreements/disclosures, data region, plan variant, compliance sign-off) | Checklist; evidence uploader; sign-off bar | SC-13, SC-12, SC-29 | API-39 |
| SC-13 | Integrations and sync health | B | Y | `integration.manage` | Re-authorise / Create key | Backfill; view differences; manage webhooks; export schedule | Connectors + providers: state, lag, errors; payout provider approval evidence + date; API keys (shown once, hash stored); webhooks; exports | Status cards; tables; key creation modal | SC-01, SC-17 | API-10, -25, -32, -33, -37, -39 |
| SC-29 | Tenant settings | B (part A — C-05) | N | `settings.manage` | Save with effective date | View versions; request approval | Markets, brands, calendars, participant types, policies (rounding, clawback, visibility, thresholds), breach contacts | Section list; forms; version history drawer | SC-17, SC-13 | API-39 |
| SC-35 | Executive overview | B | Y | `dashboard.exec` | Change period or market | Open definition; open compliance | Sales, active earners, payout share of sales, retail share, by market; (i) definition per figure | KPI cards; trend charts; market table | SC-10 | API-05, -19 |

### 5.4 Staff application — V1 screens

| ID | Name | Rel | Wf | Perms | Primary | Secondary | Key content | Components | Nav → | APIs |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-23 | Earnings disclosure builder | V1 | N | `disclosure.publish` | Publish | Preview; compare versions | Snapshot figures; template; versions | Editor; preview; version list (pattern: wizard with checks) | SC-40, SC-10 | API-05, -33 |
| SC-45 | Integrity signals | V1 | N | `compliance.read` | Open case | Set thresholds | Flags with evidence ("Indicator" = not a finding) | Table (list + drawer) | SC-06 | API-05 |
| SC-47 | Licence, updates and diagnostics (self-hosted) | V1 | Y | `system.manage` | Apply update (second approver) | Load licence; run diagnostics; generate support bundle (redaction summary before export) | Entitlement state + limits; installed versions; updates + advisories with check results; health: job queues, outbox age, replication, last backup, last restore test, time sync | Status cards; update list; diagnostics table | SC-30 | API-41 |

### 5.5 Distributor portal (all rel B; T3 phone first; bottom nav xs+sm, T2 top bar md+ — see C-18)

| ID | Name | Rel | Wf | Perms | Primary | Secondary | Key content | Components | Nav → | APIs |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-37 | Distributor home | B (localisation FR-DIST-007 = B-MKT) | Y + phone | self | Open latest statement | Notifications; rank; customers | Latest net pay (display 32px) + payout status; rank chip; alerts (cooling-off, dispute update, plan-change notice) | Summary cards; bottom nav | SC-18, SC-19, SC-21, SC-38 | API-07, -28 |
| SC-18 | Statements and line explanation | B (FR-DIST-007 B-MKT; disclosure link V1) | Y + phone | self | Open line explanation | Download; dispute line; switch period | Net, gross, withholding (rate), clawbacks, adjustments, payout status, rank used, period, groups position → bonus → lines, disclosure link | Period picker; summary block; grouped line list (48px rows); explanation sheet/panel | SC-37, SC-19, SC-22 | API-23, -28, -29, -30 |
| SC-19 | Rank status | B | Y + phone | self | — | View history | Paid-as rank, titles, current-rank requirements with measured values, grace status (end period), plan-transition notice | Status block; requirement list; history list | SC-18 | API-19, -28 |
| SC-20 | Team | B (leader dashboard FR-DIST-009 = V1) | Y + phone | self downline | Search | Expand branch | Permitted fields by depth; aggregates beyond ("n people · volume v (totals only)") | Search; lazy list tree; limited-data notice | SC-37 | API-13, -14, -34 |
| SC-21 | My customers | B | Y + phone | self | Filter | Open customer | Customers: name, last order, repeat (reorder) indicator; reassigned to/from with dates; contact fields only if tenant policy allows | List (phone: stacked cards, 3 fields; sm: 2-col cards; md+: table); filter chips | SC-37 | API-28, -35 |
| SC-22 | Bank details and tax profile | B | Y + phone | self, fresh authentication | Save change (re-authenticate) | View history | Masked bank details; cooling-off status with actual date; affected payouts; tax profile | Masked fields; form (one question group/screen, numeric keyboard); status banner | SC-38 | API-27 |
| SC-38 | Notifications and profile | B | N | self | — | Change language; channel preferences | Inbox (read state, links); preferences: language, channels | List; toggles (Switch — immediate) | SC-22 | API-28 |

### 5.6 Public

| ID | Name | Rel | Wf | Perms | Primary | Secondary | Key content | Components | Nav → | APIs |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-41 | Public privacy request form | B | Y + phone | public, rate limited, bot-protected | Submit | — | Request type; identity details; confirmation shows reference number only; never confirms whether a person exists | Form (T4; T3 without bottom nav) | — | API-31 (C-10) |
| SC-40 | Public earnings disclosure page | V1 | N | public | — | Change language | Tenant name + "Earnings disclosure for [year]"; one-sentence summary; bands table with count + share **including zero band**; basis statement (gross commissions net of clawbacks, before expenses); population definition; version + publication date; language switch; **no call to action to join** | Static page (T4 720 column) | — | API-05 |

### 5.7 Per-screen state matrix (WF-02 §3) — "Std" = standard behaviour from §6.6

| Screen | Initial | Loading | Empty | Success | Error | Validation | Permission denied | Disabled / locked | Partial data | Offline |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-46 | Latest ready snapshot | Skeleton cards | "Upload an export to begin" → SC-24 | Snapshot ready toast | Std | — | Page absent from nav | Outdated snapshot badge (figures unchanged) | Data-quality warnings beside figures | Std |
| SC-24 | Batch list | Validation + load as jobs with stages | "No imports yet" + schema and sample files | Batch loaded | Rejected batch: banner + row report download | File presence, size, type | Std | Superseded batches read-only (greyed, readable) | Validated but not loaded | Upload resumes or restarts cleanly |
| SC-25 | Current version | Std | — | Version approved | Std | Unmapped values listed (each mapped or explicitly unknown) | Approve absent for consultant | Approved versions read-only | Unknowns allowed, counted | Draft autosaved |
| SC-10 | Latest snapshot, R1 | Computing with progress | No data for range | Std | Computation failed: retry | Period range within loaded data | Std | Outdated badge; partial year (R5) not publishable | Warnings; null figures with reason (denominator 0 → "—" + reason) | Std |
| SC-26 | Numerator rows | Std | "No rows in this set" | Export queued | Std | — | Export button absent | Export above cap refused (→ scheduled export) | — | Std |
| SC-27 | Credential form | Std | — | Redirect to role home | Generic failure; lockout (6th attempt after 5 fails, AC-35.2) | Field format | — | Forced MFA enrolment | — | "Cannot reach sign-in service" |
| SC-28 | User list | Std | Only the first admin | Invitation sent | Std | Conflicting duties refused | Std | Privileged grant pending second admin; sole admin cannot remove own admin role | — | Std |
| SC-14 | Requests | Std | "No requests" | Decision recorded | Std | Duration within maximum | Std | Expired requests read-only | — | Std |
| SC-01 | Current calendar | Run progress with stages, safe to leave | "No periods yet" + set-up steps (connect store / import history) | Run calculated | Run failed: diagnostics + Resume | — | Calculate absent without permission | Committed: lock, "Request restatement" | **Sync behind: calculation blocked with last sync time** | Std |
| SC-02 | Variance tab | Skeleton | "Nothing needs acknowledgement" | Committed | Invariant failed: commit refused, alert | Exceptions must be acknowledged | Commit disabled for preparer with reason | Superseded run read-only | Stale sync after run: commit blocked | Std |
| SC-32 | Open items | Std | "No late transactions" | Handling accepted | Std | — | Std | Consumed items read-only | — | Std |
| SC-04 | Rules tab | Std | "Add your first rule" | Draft saved; submitted | Save refused: guardrail blocked | Schema + dependency errors per rule | Edit absent for readers | Approved/active immutable | Extension rule without template flagged | Draft autosaved |
| SC-05 | Form | Preview computing | — | Saved | Std | Priority covers scope; residue rule set | Std | Immutable in approved versions | Preview needs a committed period | Std |
| SC-42 | Summary | Job progress | No simulation yet | Completed | Failed with reason | Full historical period required | Std | — | Golden failures listed | Std |
| SC-44 | Current step | Std | — | Scheduled | Std | Incomplete checks named | Approve absent for author | Blocked steps explained (cannot skip) | Filing step only where required | Std |
| SC-07 | Search focused | Lazy branch loading | "Search for a position or person" | — | Std | Dates valid | Std | Historical view read-only | **Read model rebuilding: notice, depth-limited** | Std |
| SC-08 | Step 1 | Checks computing | — | Request submitted | Std | Outside window; cycle; slot taken (next slot proposed) | Approve absent for filer | Decided cases read-only | Affected periods listed | Draft kept |
| SC-09 | Overview | Std | Tabs "No history yet" | — | Std | — | Masked fields; unmask needs permission | Pseudonymised record: identity removed | — | Std |
| SC-06 | Case detail | Std | "No cases match" | Decision recorded | Std | Reason + evidence required | Approve disabled for proposer | Decided cases read-only | Effect preview unavailable → cannot approve | Draft kept |
| SC-03 | Batch detail | Instruction progress | "No batches yet" | Approved; settled | Provider rejected: retry failed lines | Provider eligible; amount ≤ payable | Approve disabled for preparer | Settled batch read-only; balance changed since draft → line recalculated, batch back to Draft | Partially settled | Std |
| SC-33 | Period accounts | Std | No postings | Export generated | Imbalance alert | Mapping complete for export (blocked list otherwise) | Std | Read-only always | — | Std |
| SC-13 | Status cards | Std | "Connect your store" | Connected | Failing connection with guidance | Credentials | Std | — | Behind: lag shown | Std |
| SC-16 | Current step | Import + comparison jobs | — | Signed off | Validation blocks: cycles, orphans, totals | Mapping complete | Sign-off absent for consultant | Sign-off disabled until unexplained = 0 | Legacy file lacks bonus detail: payee-level only | Std |
| SC-17 | Items | Std | — | Market Live | Std | Evidence per mandatory item | Sign-off absent for preparer | Go-live disabled with missing items named | Screening-status rule flagged (needs written risk acceptance) | Std |
| SC-35 | Last committed period | Skeleton cards | "No committed period yet" | — | Std | — | Std | — | Sync behind banner | Std |
| SC-39 | Tenant list | Std | No tenants | Request sent | Std | Reason + scope required | Business data routes do not exist | — | — | Std |
| SC-47 | Status | Checks running | No updates available | Update activated | Signature/check failure: refused + report (auto rollback) | — | Std | Activation needs second approver | **Licence lapsed: notice; runs and payouts unaffected** | Works offline |
| SC-37 | Latest statement | Skeleton | "Your first statement appears after the first pay period closes" | — | Std | — | — | Payout held: reason + end date | — | Last loaded content with time |
| SC-18 | Latest period | Skeleton | No committed periods | Dispute submitted | Std | — | Other people's data never shown | Open period: status only, no estimate | Explanation template missing: generic inputs | Last loaded statement |
| SC-19 | Current | Std | No state yet | — | Std | — | — | — | Open period labelled not final | Std |
| SC-20 | Own first level | Lazy | "No one in your team yet" | — | Std | — | **Beyond depth: aggregates + explanation; outside downline: not found** | — | Updating after a change (stale) | Std |
| SC-21 | Current | Std | "No customers yet" | — | Std | — | — | Past customers read-only | — | Std |
| SC-22 | Masked details | Std | No details yet: add | Change saved; cooling-off date | Std | Bank format; re-authentication | — | Cooling-off active; under review (shared-account signal) | — | Input kept |
| SC-41 | Form | Std | — | Reference number | Std | Required fields | — | — | — | Input kept |

Additional per-screen states from the wireframe notes (WF-03/04/06), not in the WF-02 matrix: **SC-06** approval pending · rejected (reason shown) · blocked by policy (escalation path). **SC-04** activation blocked (no simulation, failing golden case, missing filing). **SC-03** provider not eligible (blocked). **SC-14** request states pending · active (countdown + End now) · expired · denied · auto-denied (no decision). **SC-19** grace period active (explained with end period) · plan change in progress (transition notice). **SC-22** change refused (re-authentication failed). **SC-33** export blocked with a list when an account has no mapping to the tenant's chart of accounts. **SC-16** each difference classified and either fixed or explained-and-approved. **SC-17** blocked items named in the go-live refusal; each row opens an evidence uploader. **SC-24** re-import of a loaded period supersedes the earlier batch (BR-IMP-04). **SC-35** no income projection or recruit count ever. **SC-18** no other person's personal data in explanations; server-rendered, readable without scripts. **SC-38** phone layout follows the SC-21 list pattern (WF-06 §4).

Text-only screens (SC-11, 12, 15, 23, 29, 30, 31, 34, 36, 38, 40, 43, 45): standard states plus — SC-12 missing tax ids = validation state; SC-15 deadline indicators; SC-30 read-only; SC-34 unmatched items = working list. Reused patterns (WF-02 §5): list + drawer (SC-06/33) → SC-11, 15, 30, 31, 34, 45 · record with history tabs (SC-09) → SC-43 · settings sections with version history (SC-28) → SC-29, SC-12 rules, SC-38 · command palette → SC-36 · wizard with checks (SC-16/44) → SC-12 year-end, SC-23 · static document (SC-41) → SC-40.

### 5.8 Five highest-risk screens (design + test first; UX-01 §4)

| Screen | Must have | Test task |
|---|---|---|
| SC-02 | Totals vs previous run; variance by bonus; top movers; exceptions; what changed; approve by second person | "Find why leadership bonus rose 12% and decide whether to approve" |
| SC-04 + SC-42 | Plain-language rule diff; payee-level impact distribution; cap effects; guardrail flags | "Who loses more than 10% under version 8?" |
| SC-18 | Gross, withholding, clawbacks, net; each line → how calculated; rank used; period; disclosure link | "What were you paid in March and why this line?" |
| SC-07 + SC-20 | Search-first; lazy expansion; counts beyond visibility; as-of for staff | "Show who sponsored X on 15 March" |
| SC-06 | Reason codes; evidence; thresholds; effect preview; immutable history | "Propose a 50.00 correction and get it approved" |

UX quality gates: UXQ-01 ≥ 80% first-time task success, 5 participants/role (proposed) · UXQ-02 distributor reaches net pay + one line explanation ≤ 2 taps from home · UXQ-03 100% of blocked actions state reason + next step · UXQ-04 summary sentence above every table on exec + distributor pages · UXQ-05 ≤ 1 primary action per screen · UXQ-06 100% labels match glossary.

---

## 6. Interaction rules (UX-05)

### 6.1 Forms
- One column; labels above; related fields grouped under short heading; required fields unmarked, optional labelled "(optional)".
- Validation: on blur for format; on submit for cross-field and server rules; **never while typing**.
- Errors: message under field (what + how to fix) + summary at top with links to fields; focus moves to summary on failed submit. Server rule failures shown in summary with plain rule name and code (e.g. "Outside the change window (10 days after enrolment)").
- Money: locale decimal separator; currency shown once; stored in minor units; no rounding surprises.
- Dates/periods: period pickers (not free dates) where rule is period-bound; effective dates snap to period boundaries with explanation.
- Unsaved changes: warn on navigation; **autosave drafts** of plan versions, mappings, cases.
- Sensitive fields masked by default; "Show" separate, audited, step-up; never prefilled unmasked.
- Submit labels name the action ("Submit for approval", "Approve batch"); disabled only while submitting (spinner, no double submit, idempotency key per form instance).
- Distributor forms: one question group per screen; correct mobile keyboard; 44px targets; progress for multi-step; values kept locally on connection loss.
- Auth: one-time codes pasteable/fillable from SMS; password managers and passkeys work; no cognitive test (WCAG 3.3.8); no redundant entry (3.3.7).

### 6.2 Tables
- Server-side pagination, sort, filter; **50 rows** default; cursor pagination; sticky header; first column identifies row and is the link.
- Summary line above every table: "1,284 payees · 412,300.00 total".
- Numbers right-aligned, tabular, currency in header (once per table); negatives with minus sign + label.
- Column chooser; order + widths saved per user in saved view; only permitted columns.
- Row actions: inline primary at row end; others in row menu; row click → drawer or page.
- Selection checkboxes only when a bulk action exists; "select all matching the filter" explicit with count.
- Density comfortable by default (remembered per user); compact for analysts.
- Export respects filters, visibility, role cap; async above a size; logged; dialog states row count and that export is recorded.
- Keyboard: arrows move rows; Enter opens; `/` focuses filter.
- md (1024–1279): horizontal scroll inside container, first column sticky. Phone: stacked cards with 3 most important fields; rest behind "Details".

### 6.3 Filters and search
- Filter bar above table; common filters visible, others under "More filters"; applied filters as removable chips; "Clear all". Simple filters apply immediately; multi-field panels apply on "Apply". Phone: "Filters (n)" button → sheet; chips scroll horizontally.
- Saved views: name, share within role, set as default; URL always reflects filter.
- Reporting filters: period range, market, brand, participant type, bonus type, rank, state; "is", "is any of", ranges; **no free-form query language**.
- Global search: command palette; debounce **200 ms**; min **2 characters**; grouped by type with counts; recent items; exact id match first; masked fields; nothing outside scope.
- No results: say so, restate query and scope, suggest clearing filters; never imply something exists outside scope.

### 6.4 Overlays
| Overlay | Use | Rules |
|---|---|---|
| Modal | Decisions before continuing: confirmations, approvals with step-up, short creation forms | Focus trapped; Escape cancels unless work would be lost; one primary; **never stacked** |
| Drawer | Detail/edit keeping list context: trace, case detail, rule editor, method notes, version history | Escape closes; URL updated; width 1/3–1/2 (md: half; xl: one third) |
| Bottom sheet (phone) | Line explanation, filters | ≤ 80% height, scrollable; swipe **or** button to close; focus managed |
| Tabs | Peer views of one object | State in URL; never sequential steps |
| Wizard | Import, migration, market launch, year-end, plan change | Steps with status; back allowed; each step saved; blocked step explains why; final review before committing action |
| Tooltip / Popover | Supplementary / metric definition, basis status | Never essential; available on focus; Escape/outside dismiss |

### 6.5 Bulk actions and confirmations
Bulk: preview first (count, total amount, exclusions with reasons) · money never bulk-edited directly (goes via case or batch with approval) · partial failure: per-item success/failure, failures retryable, nothing half-applied per item · Undo only for reversible actions (assigning cases, saved views), never approvals, commits, instructions · long-running = job with progress, safe to leave.

| Confirmation level | When | Pattern |
|---|---|---|
| None | Reversible, low impact | Act immediately; toast with Undo where available |
| Simple confirm | Irreversible but contained (reject case, deactivate user) | Title = action + object; one-sentence consequence; buttons "Reject case" / "Cancel" |
| Effect preview | Changes money or structure (approve adjustment, approve genealogy change, accept late-transaction handling) | Before/after, affected people and periods, policy checks passed |
| **Critical approval** | Commit run, approve payout batch, activate plan, apply update | Totals + variance summary; exceptions acknowledged individually; statement "You did not prepare this"; step-up auth; button names amount/object ("Approve batch of 412,300.00 to 1,284 payees") |
| Typed confirmation | Rare destructive admin (archive tenant) | Type the tenant name |

Never "Are you sure?" alone. Safe choice never primary-styled for destructive actions.

### 6.6 Feedback and states (standard behaviour, "Std")

| State | Behaviour | Example copy |
|---|---|---|
| Initial | Sensible defaults (current period, user's market) | — |
| Loading | Skeletons shaped like content ≤ ~2 s, then message; jobs show stages; shell usable | "Loading statement…" |
| Empty (first use) | What will appear + first action | "No periods yet. Connect your store or import history to begin." |
| Empty (no results) | Filter produced nothing; offer clear | "No cases match these filters." |
| Success | Inline near action; next step offered (toast for non-critical) | "Batch approved. 1,284 instructions are being sent." |
| Error (recoverable) | What happened, what was not changed, what to do; retry keeps input | "We could not save the mapping. Nothing was changed. Try again." |
| Error (blocking) | Full-section message with reference id | "This page could not be loaded. Reference 7F3A…" |
| Permission denied | Page: "Not found or not available to you"; control: absent; limited data: explain limit | "You can see totals for this part of your team, not names. Your company sets this." |
| Disabled / blocked by state | Visible but inactive only when user could act later; always with reason | "Commit is available after someone else reviews this run." |
| Locked (committed) | Read-only + lock + path to change | "March is committed. To correct it, request a restatement." |
| Partial data | Banner: what is missing, effect | "Order sync is 2 h behind (last order 09:14). Runs are blocked until it catches up." |
| Stale | Mark stale + when current | "Team view is updating after a change. Showing structure as of 10:02." |
| Offline | Loaded content readable with time; server actions say so; forms keep input; **money actions never queued silently** | "You are offline. This statement was loaded at 08:40." |
| Long job | Progress with counts + elapsed; safe to leave; notify on completion; no fake % | "Calculating bonuses: 320,000 of 600,000 payees" / "You can leave this page. We will notify you when the run finishes." |
| Held (distributor) | Explain hold and what ends it | "Your payout is on hold until 14 March because your bank details changed." |

Page banners (persistent until condition ends; cause + action): sync behind, period committed/read-only, read model rebuilding, support session active, licence lapsed. Session time-outs warn and allow extension; no time limits on reading or approving (WCAG 2.2.1).

### 6.7 Glossary — labels must use these (UX-05 §9)
Period · Cut-off (in calendar's TZ) · Run · Review · Commit · Statement · Gross / Withholding / Clawback / Adjustment / Net (net = gross − withholding − clawback ± adjustment) · Earnings balance (never "wallet") · Payout batch · Position · Sponsor / Placement · Change (from a date onward) / Correction (from original date) · Case · Restatement · Snapshot · Indicator (not a finding) · Guardrail · Market pack.
Microcopy: plain words, sentence case, user's language, facts + next steps, no blame, **no exclamation marks**, numbers with units, dates in user locale with TZ where a cut-off is involved, never promise or imply earnings.

### 6.8 Localisation (UI-02 §5)
Externalised strings (message catalogues per locale; no text in images) · layouts tolerate **40%** longer strings, no fixed-width buttons · CSS logical properties (start/end) for RTL · numbers/dates/currency by locale; currency code/symbol per market; TZ shown at cut-offs · ICU message format plurals; avoid gendered phrasing · page `lang` and language-of-parts marked. Distributor pages + statements in launch-market languages (FR-DIST-007, B-MKT).

---

## 7. Responsive rules (UI-05, WF-02 §4, WF-06)

| App | Designed first for | Then |
|---|---|---|
| Portal | Phone 360, slow connection | tablet/desktop add margin + side panel |
| Staff | Desktop ≥1280 | fully down to 1024; approvals usable on tablet/phone |
| Public | Phone | wider by centring |
| Vendor console | Desktop only | — |

Portal: nav bottom bar xs+sm, top bar md+ · column full width 16px margins (xs), 600 centred (sm), 720 centred (md+) · statement lines 48px full-width rows, amount right · explanation bottom sheet (xs, sm) / 360 side panel (md+) · customers stacked cards / 2-col cards / table · team list drill-in (xs, sm) / tree + node panel (md+) · forms full-width 44px (xs), 480 wide (sm+) · buttons full width, primary at bottom or sticky (xs) / auto, right-aligned (sm+) · touch targets ≥44×44, 8px apart (xs, sm), ≥24×24 with pointer (md+).

Low-bandwidth (FR-DIST-007 B-MKT; NFR-PERF-06 proposed: 3G-class 1.6 Mbit/s, 300 ms RTT, usable ≤ 3 s, ≤ 150 KB transfer excl. cached fonts on statement page): statement, rank, home server-rendered complete HTML; scripts enhance; system font stack first, web font `font-display: swap`, script fonts subset and only for user's language; no images required; committed statements cacheable, service worker keeps last viewed statement offline; no auto-refresh/background polling (pull to refresh); correct keyboard types; no hover-only affordances; no orientation lock; holds at 200% text + 40% longer strings; installable (add to home screen), no native app.

Staff: sidebar 56 collapsed overlay (md) / 208 (lg, xl) · margins 24 (md) / 32 (lg) / capped 1440 (xl) · KPI cards 3 / 4 / 5 per row · tables horizontal scroll with sticky first column (md) · list+panel: drawer over list (md) / 60/40 side by side (lg+) · drawers half (md), 1/3–1/2 (lg), 1/3 (xl) · charts full width stacked (md), two per row (lg+) · action bar sticky bottom always.
Below 1024 only three tasks are designed: approve run commit (SC-02: summary, totals + variance cards, exceptions as acknowledgeable cards, pinned approval bar, step-up; tables reduce to bonus, amount, change), approve payout batch (SC-03: totals, counts, exclusion reasons with counts, pinned bar, paged payee lists), decide vendor access request (SC-14: request card Approve/Deny). All other staff pages show notice "This page works best on a larger screen" and stay operable by scrolling.

Component adaptations (phone / tablet / desktop): modal = full-screen sheet / centred 560 / centred · drawer = full screen or bottom sheet / half / 420–720 · tabs scroll row / same / all visible · date picker native or full-width sheet / popover / popover · stepper vertical / horizontal / horizontal · charts 1 per row with simplified axes + table toggle / 1–2 / 2 · toast bottom above nav / bottom-right · command palette full-screen / centred.

Input modes: pointer, touch, keyboard all first-class; nothing depends on hover, drag, multi-touch or path gestures (priority lists and column order have move-up/down buttons — WCAG 2.5.7).
Print (statements, tax forms, compliance snapshots, run reviews): single column, no nav, page numbers, tenant name, period, generation time, document version, repeated table headers.

---

## 8. Accessibility checklist (UI-02 §4) — target WCAG 2.2 AA (NFR-ACC-01)
1.1.1 text alternatives (every chart has data table) · 1.3.1 semantics (headings, landmarks, `th scope`, labels) · 1.4.10 reflow at 320 (data tables excepted; portal gets stacked cards) · 1.4.3/1.4.11 contrast 4.5:1 text (3:1 large), 3:1 non-text · 1.4.1 no colour-only · 1.4.4/1.4.12 200% text, text-spacing overrides · 1.4.13 hover/focus content dismissible, hoverable, persistent · 2.1.1/2.1.2/2.4.3/2.4.7/2.4.11 keyboard, no traps, order, visible focus not obscured by sticky bars · 2.4.1/2.4.2/2.4.5 skip link, titles, multiple ways · 2.5.8 targets ≥24 (portal 44 by policy) · 2.5.7 no drag required · 2.2.1 timeouts warn + extend · 2.3.1 no flashing, motion reducible · 3.1.1/3.1.2 language · 3.2.3/3.2.4/3.2.6 consistent nav, identification, help placement · 3.3.1–3.3.4 errors in text, labels, financial submissions confirmed · 3.3.7/3.3.8 no redundant entry, no cognitive auth test · 4.1.2/4.1.3 name/role/value; status messages announced without moving focus. ARIA APG patterns for tree, grid, combobox, dialog, tabs.

Tests: **TS-54** (B) WCAG 2.2 AA automated scan + manual keyboard + screen-reader (≥1 desktop, ≥1 mobile SR) on the five highest-risk screens and all distributor pages → no A/AA failures; tree and tables keyboard-operable. **TS-55** (B, ref AC-34.1) distributor at 360, 768, 1280; admin at 1024, 1440 → no horizontal scroll on distributor pages at 360. UI-05 §8 extended matrix: 320 px reflow on SC-37, 18, 19, 22, 41; 360 all portal + SC-27 + staff approvals; 768 portal + staff approvals; 1024 all drawn staff screens; 1280 + 1440 all staff screens; conditions: 200% text, longest translation, RTL locale, throttled 3G, reduced motion, forced colours; devices: one low-end Android + one older iPhone of launch market. Automated a11y + visual regression + contrast check on token changes are CI gates (UI-02 §6).

Design-system governance: semantic versioning, breaking changes need migration note; deprecation announced one minor ahead, removed next major; a new component needs a job no existing component does + states + keyboard model + accessible-name rules + content rules + responsive behaviour. Hosted and self-hosted editions share one library; SC-47 uses only existing components.

---

## 9. Journey → screen map (UX-04)

| Journey | Rel | Screens | Key UI decision points |
|---|---|---|---|
| UJ-01 compliance evidence from export | A | SC-24, 25, 10, 26, 46 | Forbidden column → whole batch rejected, files deleted, columns named; unknown mapping allowed (counted); approve needs `mapping.approve`; interrupted load → batch stays `mapped`; snapshot `computing`→`ready`; export above cap refused → scheduled export; re-import supersedes batch, old snapshot marked Outdated, unchanged |
| UJ-17 first sign-in & roles | A | SC-27, 28, 29 | Factor enrolment; privileged grants need second admin; record breach contacts; sole admin cannot remove own admin role |
| UJ-11 vendor support session | A | SC-39, 14, 30 | Request (reason, scope, duration) → admin approve/deny → read-only time-boxed frame + countdown → auto-expiry; no decision → auto-denied |
| UJ-02 period close | B | SC-01, 02, 03, 34, 32, 13 | Sync unhealthy → run blocked showing last sync; failed run → diagnostics + resume; approver ≠ preparer + step-up; provider rejects → retry failed lines only |
| UJ-03/04 genealogy change, duplicates | B | SC-09, 08, 06, 07 | Outside window / cycle / slot taken; merge / allow with reason / terminate; stale notice until read model rebuilt |
| UJ-05 dispute | B | SC-18, 06 | Dispute window passed (explained); second open dispute on same line blocked |
| UJ-06/07 refund, restatement | B | SC-31, 32, 06, 33 | Committed period never reopened; empty diff closes case |
| UJ-08 plan change | B | SC-04, 05, 42, 44, 11 | States Draft → InReview → Approved → Scheduled → Active → Retired; blocks: missing simulation, failing golden case, missing filing, notice too short |
| UJ-09 market launch | B | SC-17, 13, 12, 29 | Until Live, enrolments/orders for market rejected; screening-status mandatory rule needs written risk acceptance |
| UJ-10 bank-detail change | B | SC-22, 09 | Re-auth; new version + cooling-off; notify old+new contact; payouts inside cooling-off held; shared-details signal → case + hold; staff change only via case + second person |
| UJ-12 data-subject request | B | SC-41, 15 | Verification fails; open payable / legal hold defers erasure with explanation |
| UJ-13 migration | B | SC-16, 42 | Sign-off only when unexplained differences = 0 |
| UJ-14 tax year-end | B-MKT | SC-12 | Missing tax ids list; regeneration creates new version |
| UJ-15 customer reassignment | B | SC-09, 21 | Past orders unchanged |
| UJ-16 distributor reads statement | B | SC-37, 18, 19 | Open period → status only; held → reason; offline → last loaded + time |
| UJ-18 self-hosted update | V1 | SC-47 | Signature + compatibility + golden + replay checks; second approver; auto rollback; lapsed licence never blocks runs/payouts |

---

## Conflicts found

| # | Conflict | Resolution |
|---|---|---|
| C-01 | Dark theme: UI-01/UI-02 say "later, not in first release"; UI-03 §2.6 gives only 4 token values. Task asks for dark tokens | Ship light only. The four values in §1.3 are the full source set. Treat dark as unscheduled until every semantic token has a contrast-checked value (O-03) |
| C-02 | spec.json/WF tag screens as B, while some features on them are another release: SC-02 FR-AI-001 (V1), SC-04 FR-AI-002 (V1), SC-20 FR-DIST-009 (V1), SC-06 FR-CPL-013 (B-MKT), SC-12 FR-TAX-002/003 (B-MKT), SC-18/37 FR-DIST-007 (B-MKT), SC-18 disclosure link BR-HON-02 (V1) | Build the screen in its own release and gate the feature behind its own release/market-pack flag (nav service already takes edition/release flags, UX-02 §2) |
| C-03 | WF-06 §3 says "Two tasks are supported" on small screens but lists three; UI-05 §4 says three | Three: SC-02 commit, SC-03 batch approval, SC-14 vendor request |
| C-04 | SC-46 wireframe note "cards wrap 2 per row below 900 px"; 900 is not a breakpoint, and staff app below 1024 is "not optimised" | Use the token breakpoints: KPI cards 3/4/5 per row at md/lg/xl; ignore 900 |
| C-05 | SC-29 is rel B (WF-01, spec.json), but UX-03 route says A/B, UJ-17 (A) has admin record breach contacts, MVP-A nav includes Settings, and API-39 `PUT /v1/settings/{key}` is rel A | Ship a minimal A slice of Settings (breach contacts, plus whatever API-39 A covers) in SC-29's shell; full SC-29 sections in B. Product to confirm (O-08) |
| C-06 | WF-03 says MVP-A sidebar has "three items"; UX-02 §3.1 lists four (Home/Compliance overview, Compliance, Data, Settings) | Home *is* the Compliance overview (SC-46) → render 3 sections (Compliance with SC-46 as its landing, Data, Settings) plus role-home redirect; equivalent outcome |
| C-07 | Entry-point names in WF-01 differ from IA: SC-07 "Nav Genealogy" (IA: People › Genealogy), SC-12 "Nav Tax" (Finance › Tax), SC-15 "Nav Privacy" (Cases › Privacy), SC-16 "Implementation menu" (Data › Migration), SC-22 "Portal nav Profile" (More › Payment details) | UX-02/UX-03 IA and routes win |
| C-08 | UX-01/UX-02 landing pages "Approvals queue" (finance approver) and "Settings home" (tenant admin) have no SC id; UX-03 home list maps homes to SC-35, 46, 01, 03, 36, 15, 24 | Finance approver home → SC-03 (approve filter) until an Approvals screen is specified; tenant admin home → SC-28 (A) / SC-29 (B). Flagged O-09 |
| C-09 | Permission strings disagree between screens and APIs: SC-33 `export` vs API-24 `ledger.export`; SC-13 `integration.manage` vs API-37 `integration.read`; trace drawer on SC-02/06 needs API-21 `trace.read` not in screen perms; SC-16 bare `signoff`; SC-26 bare `export`; SC-39 "vendor roles"; SC-09 unmask permission unnamed | API catalogue (spec.json) is authoritative for server checks; nav model must reference the same strings. Use `ledger.export`, `integration.read` (view) + `integration.manage` (change), `trace.read`, `migration.signoff` (proposed, not in any source). SC-26 bare `export` matches API-06 (`compliance.read, export`), so keep `export` there unless the IAM owner scopes it (O-07) |
| C-10 | SC-41 is a public, unauthenticated form, but its only linked API-31 `POST /v1/privacy-requests` requires `privacy.manage` | Needs a separate public, rate-limited, bot-protected endpoint (or API-31 public variant) that never confirms a person exists. Raise with API owner |
| C-11 | Portal T2 top bar "up to six navigation items" vs bottom bar max five | Treat six as a ceiling only. WF-04 says the desktop shows the same content and order as phone, adding nothing except the side-by-side line explanation, so the top bar shows the same items as the bottom bar (Home · Earnings · Rank · Customers/Team · More). Product to confirm whether More items may be promoted on desktop |
| C-12 | TS-55 viewports (360/768/1280 portal; 1024/1440 admin) vs UI-05 §8 (adds 320 reflow, 1280 for staff) | Run the superset (UI-05 §8 matrix) |
| C-13 | WF-02 KPI cards "0–5" vs "2–5 in one row" | 0–5 cards per page; when present, rows hold 2–5 depending on breakpoint |
| C-14 | UI-01 §4 "no pills except filter chips and status chips" (implies status chips are pills) vs UI-03 `radius.sm` for "chips in tables" and `radius.full` for "filter chips, avatars" | Status chips use `radius.sm` (4px) in tables and elsewhere; filter chips use `radius.full` |
| C-15 | UI-03 §6 lists `bp.xs` min 360 but WCAG reflow must work at 320 | Layout targets 360; 320 must reflow without loss (no new layout, just no breakage) |
| C-16 | UX-03 `/portal/signin` rel B vs SC-27 rel A | SC-27 staff/vendor sign-in is A; portal variant (one-time code) is B |
| C-17 | SC-25 route perm `mapping.edit`; approve needs `mapping.approve` (API-03 takes both) | Route visible with `mapping.edit`; Approve button absent without `mapping.approve` |
| C-18 | Portal nav at 600–1023: UI-05 §3 says bottom bar at sm (top bar md+); WF-02 §4 says "Top navigation; single column" at 600–1023 | UI-05 (the responsive spec WF-02 §4 defers to: "Full rules: UI-05") wins: bottom bar xs+sm, top bar md+ |
| C-19 | UI-01 §5 calls the chart palette "colour-blind-safe"; UI-03 §2.5 says it is not yet checked with a CVD simulator | Treat as unchecked; O-10 blocks chart use until verified |

## Open / unresolved

| # | Item | Blocks |
|---|---|---|
| O-01 | OQ-23 product name and brand; house accent may change | Final primitives, logo, high-fidelity design for all SC; tenant-accent fallback value |
| O-02 | OQ-21 no usability testing; persona choices are hypotheses (UX-01 §7 plan not executed) | Sign-off of SC-02, SC-04/42, SC-18, SC-07/20, SC-06; UXQ-01 measurement |
| O-03 | Dark theme semantic values (all except 4) undefined | Any dark theme (unscheduled) |
| O-04 | State → colour mapping missing for: `uploaded`, `validated`, `mapped`, `loaded`, Scheduled, Active, InReview, Live, instructed, accepted, unmatched, pending, denied, auto-denied, under review | Status chips on SC-24, SC-44, SC-17, SC-03, SC-34, SC-14, SC-22 (A and B). Proposed: uploaded/validated/mapped = Neutral; loaded/Active/Live/accepted = Success; Scheduled/pending/instructed = Info; denied/auto-denied = Danger; unmatched/under review = Warning — needs design-system owner approval |
| O-05 | Masked-field auto-hide duration "a short time"; step-up window not given | SC-09, SC-22, SC-36 masked fields (B) |
| O-06 | Support-session frame colour token not defined (must not reuse a state colour ambiguously) | SC-39/SC-14 session frame (A) |
| O-07 | Permission strings: unmask permission name; `signoff`, `export`, "vendor roles" unscoped; screen vs API mismatches (C-09) | Nav model + server checks for SC-09, 16, 26, 33, 13, 39 (A and B) |
| O-08 | Which SC-29 settings exist in MVP-A (C-05) | SC-29 A slice, UJ-17 breach contacts |
| O-09 | No screen spec for "Approvals queue", "Settings home", staff `/profile`, portal `/portal/more/my-data`, vendor `/audit` | Role-home rule for finance approver and tenant admin; profile; portal privacy request; vendor audit log (A/B) |
| O-10 | Data-vis palette not checked with a colour-vision simulator | Any chart: SC-10, 35, 42, 46 (A and B) |
| O-11 | Distributor device/browser data for launch market unknown (P-09); NFR-PERF-06 only "proposed" | Portal budget sign-off, TS-55 device list (B) |
| O-12 | Display/locale: launch market + scripts undecided (Noto families per market pack) | Font subsetting, RTL verification, FR-DIST-007 (B-MKT) |
| O-13 | Session-timeout values, lockout window length (AC-35.2 states 5 fails → lock, window unspecified here) | SC-27 (A) copy and timers |
| O-14 | OQ-20 whether sales/regional/country managers, warehouse, marketing staff need screens | None today (no screens) |
| O-15 | OQ-22 original journey maps J-01..J-17 missing; UJ-01..18 are reconstructions | Journey validation |
| O-16 | Workflow builder intentionally replaced (UI-04 §3.8); tenant-configurable workflows would need a new requirement + threat review | Nothing in A/B/V1 |
