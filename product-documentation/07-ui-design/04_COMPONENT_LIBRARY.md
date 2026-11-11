# 04 — COMPONENT LIBRARY
## Base and advanced components: anatomy, variants, states, behaviour, accessibility

| Field | Value |
|---|---|
| Document ID | UI-04 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Design system architect role |
| Depends on | UI-03 (tokens), UX-05 (interaction rules), UI-02 §4 (accessibility) |
| Status | Draft. Specification; nothing is built. Every component's behaviour is defined here so that no screen contains a control without defined behaviour |

## 1. States shared by all interactive components

Default · hover · focus-visible (2 px ring, 2 px offset, never removed) · active (pressed) · selected · disabled (with a reason available to assistive technology and on hover or tap) · loading · error. Minimum target 24 × 24 px (staff) and 44 × 44 px (portal).

## 2. Base components

| Component | Variants | Behaviour and rules | Accessibility |
|---|---|---|---|
| **Button** | Primary (one per view), secondary (outline), tertiary (text), destructive (outline; solid only in its confirmation), icon-only. Sizes md 36 px, lg 44 px | Label = verb + object ("Approve batch"). Loading state replaces the label with a spinner and keeps width; clicks ignored while loading. Never disabled without a visible reason | Native button; icon-only has an accessible name; `aria-busy` while loading |
| **Input** (text, number, money, password, textarea) | With prefix or suffix (currency, unit), helper text, error | Label above; helper below; error replaces helper. Money input accepts locale separators and shows the parsed value on blur. Masked variant shows "•••• 4821" with a separate Show action | Label programmatically associated; error linked with `aria-describedby`; `aria-invalid` |
| **Select** | Native select for ≤ 12 options on phones; custom listbox on desktop | Shows the selected value; placeholder is not an option | Listbox pattern; type-ahead |
| **Dropdown / combobox** | Searchable single; multi-select with chips; async (people, positions) | Debounced search; "No results" state; selected chips removable by keyboard | Combobox pattern with `aria-expanded`, `aria-activedescendant` |
| **Menu** | Row menu, object menu | Opens on click or Enter; closes on Escape or outside click; destructive items last, separated | Menu button pattern |
| **Checkbox** | Single, group, indeterminate (table select-all) | Label clickable; group has a legend | Native; `aria-checked="mixed"` |
| **Radio group** | Vertical (default), horizontal for 2–3 short options | One always selected when required | Native with fieldset and legend; arrow keys |
| **Switch** | With label and state text ("On", "Off") | For settings that apply immediately only; versioned settings use a form with Save | `role="switch"` |
| **Card** | Plain, KPI (label, value, delta, link), status (connection health), selectable | KPI cards link to their source; delta shows direction with a sign and text, not colour alone | Card is not a button unless the whole card is one link |
| **Table** | Comfortable 44 px, compact 32 px; with selection; with expandable rows; with totals row | UX-05 §2. Sticky header; sortable headers show direction; column chooser; server-side everything; summary line above | Native table semantics; `aria-sort`; row selection announced; keyboard row navigation |
| **Pagination** | Cursor-based: Previous, Next, rows per page, "1–50 of about 12,000" | No page-number jumps on large tables | Buttons with accessible names |
| **Tabs** | Underline (page-level), contained (inside cards) | State in URL; overflow scrolls with arrows; never for steps | Tabs pattern; arrow keys; `aria-selected` |
| **Navigation / sidebar** | Expanded 208 px, collapsed 56 px with tooltips; sections from permissions | Current item marked; collapsible groups remember state | `nav` landmark; `aria-current="page"` |
| **Header** | Staff (market switcher, search, bell, help, user), portal (logo, nav), phone (back, title, bell) | Fixed; market switcher scoped to the user | `banner` landmark; skip link first |
| **Breadcrumbs** | Text links with separators | Shown below the second level only; last item is the current page, not a link | `nav` with `aria-label="Breadcrumb"` |
| **Modal** | Sizes 400, 560, 720 px; confirm, effect preview, critical approval | UX-05 §4, §6. Title states the action; one primary button; focus trapped; returns focus on close | Dialog pattern; `aria-modal`; labelled by title |
| **Drawer** | Right side, 420–720 px; phone: full screen or bottom sheet | Linkable state; Escape closes; does not block the page behind for reading | Dialog (non-modal where the page stays usable); focus moved to drawer heading |
| **Tooltip** | Text only, ≤ 80 characters | On hover and focus; dismiss with Escape; never the only place for needed information | `role="tooltip"`; WCAG 1.4.13 |
| **Popover** | Definition, basis status, filter panel | Opens on click; closes on Escape or outside click | Labelled; focus managed |
| **Toast** | Success, info | 5 s; pause on hover and focus; action link optional (Undo); stacked max 3. **Errors needing action are never toasts** | `role="status"`, polite |
| **Banner** | Info, warning, danger, success; page-level or section-level | Icon, cause, effect, action; persistent while the condition holds; not dismissible for blocking conditions | `role="status"` or `alert` for danger |
| **Chip** | Status (state colour + icon + label), filter (removable), count | Status chips are not interactive; filter chips have a remove button | Remove button named "Remove filter: X" |
| **Chart** | Line (trend), bar (comparison), stacked bar (mix), histogram (distribution) | Direct labels; axis titles with units; hover and focus details; "View as table" toggle always present; no 3D, no pie for more than four parts | Table alternative; summary sentence above; focusable data points |
| **Data visualisation: KPI with trend** | Value, delta, sparkline | Sparkline is decorative support; the delta text carries the information | Sparkline hidden from assistive technology |
| **File upload** | Drop zone + button; multi-file with per-file status | Shows accepted types and size limit before upload; per-file progress; server validation results per file; rejected files state the reason | Button is the accessible path; progress announced |
| **Date picker** | Single date, range, month, **period picker** (periods of a calendar) | Typing allowed in the locale's format; period picker lists periods with their state; effective-date pickers snap to period boundaries with an explanation | Grid pattern; fully keyboard operable; format hint in label |
| **Search** | Global command palette; inline filter search | UX-05 §3 | Combobox pattern; results grouped with headings |
| **Filters** | Filter bar, chips, "More filters" panel, saved views | UX-05 §3 | Each filter labelled; result count announced after change |
| **Empty state** | First use; no results | Icon (optional), one sentence, one action | Heading + text; not an image of text |
| **Skeleton / progress** | Skeleton blocks; determinate progress with stages | Skeleton only up to about 2 s, then a message; job progress shows stage names and counts | `aria-busy`; progress has text equivalent |
| **Stepper** | Horizontal (wizard), vertical (checklist) | Shows status per step: done, current, blocked (with reason), to do | List semantics; current step marked |

## 3. Advanced components

### 3.1 Genealogy tree view

| Aspect | Specification |
|---|---|
| Purpose | Explore sponsor or placement structure without rendering the whole tree (FR-GEN-003, -007; FR-DIST-004) |
| Anatomy | Search field · tree-kind toggle · as-of and known-at selectors (staff) · breadcrumb to root · focused node · child rows (id or name per visibility, rank chip, status chip, descendant count) · "Show n more" · node panel |
| Behaviour | Opens on search or on the viewer's own position; loads one level at a time (page of 25); collapsed branches show counts; depth cap per request; selecting a node updates the panel and URL |
| Variants | Staff (ids, masked names, history); portal (fields by visibility policy; beyond the depth limit a single summary row "n people · volume v (totals only)") |
| States | Loading branch; stale read model (banner; depth-limited); historical view (banner stating as-of and known-at); nothing found; outside scope (identical to not found) |
| Accessibility | Tree pattern: Up and Down move, Right expands or enters, Left collapses or goes to parent, Home and End; each item announces level, position in set and expanded state. An **indented list view** with the same data is one toggle away. Not dependent on drag or hover |
| Phone | List drill-in: tap a person to make them the focus; breadcrumb collapses to "… › parent › current" |
| Never | Whole-tree canvas; zoomable org chart as the only view; client-side hiding of fields |

### 3.2 Compensation plan builder

| Aspect | Specification |
|---|---|
| Purpose | Compose a plan version from primitives and extensions and understand it (FR-PLN-001..004) |
| Anatomy | Version header (state chip, effective date, compare, simulate, submit) · tabs (Rules, Caps and pools, Calendars, Transitions, Golden datasets, History) · rule list grouped by pass (measures, ladders, bonuses, caps) · rule editor drawer · plain-language rendering per rule · guardrail panel · validation list |
| Rule editor | Typed form generated from the primitive's schema; expression fields have syntax highlighting, type checking and an example evaluator on a golden case; every rule states its tree, measure and reversal policy |
| Dependency view | Read-only diagram of which rules feed which (measure → ladder → bonus → cap) to explain pass order |
| Diff | Side-by-side versions: added, removed, changed rules; changes described in plain language ("Level 2 rate 5% → 6%") |
| States | Draft (editable, autosave) · validation errors per rule · guardrail blocked (save refused, rule id and basis shown) · guardrail warned (acknowledgement) · approved or active (immutable, lock) |
| Accessibility | Standard form and list components; the dependency diagram has a table alternative |

### 3.3 Commission statement table

| Aspect | Specification |
|---|---|
| Purpose | Show a payee's pay for a committed period and let them open the reason for each line (FR-DIST-001, -002) |
| Anatomy | Net pay (display size) · summary rows: gross, withholding (with rate), clawbacks, adjustments · payout status · groups: position → bonus → lines · each line: name, amount, "How calculated" · disclosure link when published |
| Rules | Net first. Amounts right-aligned, tabular. Withholding and clawbacks are separate labelled rows with minus signs. Lines from adjustments or restatements name the original period. Totals per position and per person are shown and must add up |
| Explanation | Sheet or side panel: title, one or two plain sentences, inputs list (rate, base, rank used, period, rounding), Dispute link |
| States | Open period (status only, no numbers) · payout held (reason, date) · line under dispute (chip) · explanation template missing (generic inputs) |
| Staff variant | Same table with trace link per line and masked payee data |
| Print and download | Single-column document in the chosen language |
| Never | Projected earnings, comparisons with other people, congratulation styling |

### 3.4 Financial transaction table (ledger)

| Aspect | Specification |
|---|---|
| Purpose | Inspect postings and prove totals (FR-FIN-001, -002) |
| Anatomy | Balance check strip (the accounting identity with a pass or fail mark) · account cards · filter bar · postings table: posted time, entry id, account, debit, credit, origin link, approver · totals row |
| Rules | Debit and credit in separate columns; each entry's postings can be expanded together and shown to balance; every row links to its origin (run, batch, case); no edit controls of any kind |
| States | Period selected; account selected; imbalance (danger banner; should never occur) |
| Export | Journal export panel with mapping status |

### 3.5 Organisational performance dashboard

| Aspect | Specification |
|---|---|
| Purpose | Executive and leader views of committed results (FR-RPT-001; FR-DIST-009 in V1) |
| Anatomy | Period and market filters · summary sentence · KPI cards with definitions · trend charts with table toggle · breakdown table by market, brand or (leaders) first-level team within visibility |
| Rules | Figures come from committed runs and snapshots and reconcile to them; each has an (i) definition popover; partial-data banner when sync is behind |
| Metrics allowed | Net sales, active earners, payout share of sales, retail-customer share, customers served, repeat-order rate, returns |
| Metrics not allowed | Recruit counts as rankings, income projections, "top earners" lists |

### 3.6 Complex reporting filters

| Aspect | Specification |
|---|---|
| Anatomy | Filter bar with the common filters · "More filters" panel with groups (time, organisation, people, money, state) · applied chips · saved views menu |
| Operators | Is, is any of, is not; ranges for amounts and dates; period ranges by calendar |
| Behaviour | Result count updates on apply; URL carries the filter; invalid combinations explained; export uses the current filter and shows the row count |
| Accessibility | Panel is a dialog on small screens; each control labelled; "Clear all" available |

### 3.7 Permission management interface

| Aspect | Specification |
|---|---|
| Purpose | Define roles and assign them with scope (FR-IAM-003) |
| Anatomy | Roles list (base and tenant roles) · permission matrix: rows = capability groups (collapsible), columns = roles, cells = none, read, act, approve · scope selector per assignment (markets, brands) · conflict panel |
| Rules | Base roles are read-only and clonable; conflicting duty pairs are flagged before save; privileged changes show "needs approval by a second admin"; a diff of the change is shown before submit |
| Accessibility | Matrix is a real table with row and column headers; cells are radio groups or checkboxes with full names ("Finance approver: approve payout batches") |

### 3.8 Workflow builder — **not built; replaced**

The brief lists a workflow builder. No requirement in the research or in these documents needs user-defined workflows: approval flows are fixed by design for safety (preparer and approver, thresholds from settings). The need is met by two components:

| Component | Specification |
|---|---|
| **Workflow status (stepper with checks)** | Read-only visualisation of a fixed workflow (plan change, market launch, migration, period close): steps, status, blockers with reasons, who acted and when |
| **Approval bar** | Sticky bar on approvable objects: who prepared, who may approve, policy checks passed or failed, Reject and Approve buttons, step-up prompt. Disabled with reason for the preparer |

If tenant-configurable workflows are requested later, they need their own requirement and threat review (a builder could weaken separation of duties).

### 3.9 Other domain components

| Component | Specification |
|---|---|
| **State timeline** | Horizontal lifecycle (Open → … → Closed) with the current state emphasised and the next action stated |
| **Variance table** | This run, previous run, change, percentage; sorted by absolute change; rows open movers |
| **Effect preview** | Before and after values, affected people and periods, policy checks; used in every money or structure approval |
| **Trace viewer** | Collapsible tree of a line's calculation: rule → inputs → intermediate values → rounding; ids link to orders and positions |
| **Figure card with method** | Compliance figure with population, numerator, denominator, method link, data-quality warning |
| **Masked field** | Masked value, Show action (audited, step-up), auto-hide after a short time |
| **Evidence list** | Uploaded files with uploader, time, type; immutable once the case is decided |
| **Basis-status badge** | Screening, primary read, counsel-confirmed; shown on every market-pack rule |
| **Support-session frame** | Persistent coloured border and bar "Vendor support session · read-only · ends in 02:41" around the tenant application for vendor staff |
| **Diff viewer** | Side-by-side for plan versions, settings versions and mappings |

## 4. Component-to-screen usage (highest-risk screens)

| Screen | Components |
|---|---|
| SC-02 Run review | KPI cards, tabs, variance table, exception list, trace viewer (drawer), approval bar, critical-approval modal |
| SC-04 / SC-42 Plans | Plan builder, diff viewer, guardrail panel, KPI cards, histogram, table |
| SC-18 Statement | Statement table, explanation sheet, banner (held), chip (dispute) |
| SC-07 / SC-20 Genealogy | Tree view, filters, node panel, banners (as-of, stale, limited data) |
| SC-06 Case | Form, evidence list, effect preview, timeline, approval bar |
| SC-10 / SC-26 Compliance | Figure cards with method, charts with table toggle, drill-down table, export dialog |

## 5. Not in the library

Leaderboard, earnings projection widget, celebration or badge animations, countdown timers, social feed, chat assistant, whole-tree org chart canvas, wallet balance widget.
