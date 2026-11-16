# frontend — TECHNICAL_DECISIONS

_Agent: frontend. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


- FE-01 Data loads in client components through the same-origin `/v1` rewrite (HttpOnly SameSite=Strict cookie stays first-party); server components only for layouts and metadata.
- FE-02 Auth error redirects are full navigations (`leavePage`), dropping client state; the API promise never settles so pages keep their loading state.
- FE-03 Theme: light only (`color-scheme: light`, UI_UX 1.3/C-01); dark returns when O-03 values are approved. tokens.test.ts checks WCAG pairs and that no dark branch ships.
- FE-04 No UI kit: native `<dialog>` + own focus trap/Escape/focus return (useModalDialog, shared by Modal and Drawer); Material Symbols (npm material-symbols) via Icon, lucide-react removed; qrcode-generator drawn as SVG path (no innerHTML). QR stays dark-on-light in both themes (`--qr-*`).
- FE-05 Sidebar (sc_01): 208 px at >= 1280, 56 px icon rail with title tooltips at 1024-1279 (icons from the client key map, guidelines §8.1; unknown key = first letter), overlay opened by the Menu button below 1024 (Escape/backdrop close).
- FE-06 403 and 404 are the same "Not found or not available to you" page/component.
- FE-07 MFA enrolment starts on the user's click (never on mount) so a re-render or reload cannot replace the secret being scanned.
- FE-08 Vendor sign-in lives at `/signin/vendor`; vendor flows carry `next=/vendor` so MFA pages and expiry redirects stay in the vendor realm.
- FE-09 Invitation token read from `#token=` once, then removed from the URL with history.replaceState.
- FE-10 (T-A15) Mapping editor lives at both `/imports/mappings` and `/compliance/mappings`: AppShell only renders paths under the user's nav entries, and approvers (Compliance officer: mapping.approve, no import.manage) only have /compliance, editors (Implementation consultant) only /imports.
- FE-11 (T-A15) Upload progress and CSV export bypass lib/api.ts (fetch+JSON cannot do either) through `features/data/transfer.ts` with the same CSRF/Idempotency/error/auth-redirect contract; files are re-labelled text/csv client-side (extension already checked) because some OSes send application/octet-stream, which the API refuses (415).
- FE-12 (T-A15) Figure drill-down takes the figure id as `?figure=` (ids contain dots, spaces, '>' and ','), not a path segment.
- FE-13 (T-A15) Money/volume figures are shown in minor units ("16,000 minor units") and R5 values as "currency units"; no client arithmetic on money (GET /v1/markets now gives currency but not the exponent).
- FE-19 (T-A14, was a second FE-10) Admin dialogs are mounted only while open, so each opening gets fresh fields and a fresh Idempotency-Key (useIdempotencyKey); retry inside one opening reuses it.
- FE-20 (T-A14, was a second FE-11) List filters live in the URL (audit) or local state (vendor tenants/sessions); filtered lists are keyed by the filter so pagination restarts on change.
- FE-21 (T-A14, was a second FE-12) Settings: one row per key with a Change dialog (form + reason + Save); If-Match = newest meta.latest_version over all keys; after save or cancel every key is re-read (412 recovery). Unset thresholds open empty (DEC-14).
- FE-22 (T-A14, was a second FE-13) SoD in the UI: grant decisions hide Approve/Reject for the requester and the grantee with the reason; the API's SOD_SELF_APPROVAL message is shown for anything the UI cannot know (vendor provisioning creator).
- FE-14 Vendor breach-contact read is on demand (button), because each read is written to both audit logs.
- FE-15 (R1) Support session = per-tab sessionStorage frame + X-Support-Session on GET only; the frame and read-only mode are shown only when GET /v1/me confirms the session (role assignment_id = session id), so a stale value never frames a tenant user.
- FE-16 (R1) CSP by nonce in `src/proxy.ts`; all pages render dynamically (root layout `connection()`), the price of nonces.
- FE-17 (R1) Idempotency-Key lives as long as the request body: FormDialog drops it on any field change; provisioning compares the serialized body.
- FE-18 (R1) SC-46 headline per report: R1 customer_share_pct, R2 personal_use_share_pct, R3 share_pct.retail_sale, R4 active_with_no_customer_order_pct, R5 earned_more_than_zero_pct (latest period of the newest ready/outdated snapshot per market).

- FE-23 (gaps) Charts are hand-written SVG in `features/data/charts.tsx` (no chart dependency): axes from zero (`niceScale`), single series in --color-action-primary, two series in --dataviz-1/--dataviz-2 (validated with the dataviz palette script, light/white), direct labels, focusable points with a readout line, "View as table" toggle (aria-pressed) on every chart. Colours by CSS class only: the CSP (style-src nonce) blocks style attributes. Chart geometry uses Number() for positions only; every label and every comparison/difference uses the exact decimal string (format.ts `compareDecimal`, `changeLabel`, BigInt).
- FE-24 (gaps) SC-10 period selector = `?period=` (one period of the snapshot) and `?compare=` (second period) in the URL; all periods: trend chart (monthly reports) + every period section; compare: percentage bar chart (one axis) + table of every figure with "Difference (A minus B)". A snapshot is still the range; another range = another snapshot.
- FE-25 (gaps) Support-session frame comes from GET /v1/me `support_session` (server truth); sessionStorage keeps only the session id (`nmp-support-session-id`) to send as X-Support-Session.
- FE-26 (gaps) Idempotency-Key = `newIdempotencyKey()` (lib/api.ts, getRandomValues UUID v4): works on plain-http LAN addresses where crypto.randomUUID is missing.
- FE-27 (BUG-022) Phone tables: opt-in `Table stackOnPhone` turns rows into "header: value" cards below 600 px with explicit ARIA table roles (display:block would drop table semantics); only approvals use it (UI_UX §7: approvals usable on phones, other staff tables scroll).
- FE-28 (BUG-021) Focus on client navigation: AppShell focuses `<main tabIndex=-1>` on each pathname change (query-only changes such as tabs/filters keep focus); single-task card pages focus their field (CodeForm `autoFocus` on /signin/mfa).
- FE-29 (BUG-018) One date-time format app-wide (`lib/format.ts` formatDateTime, medium date + short time) and counted nouns via `countLabel`; decimal figures keep their exact digits and only gain locale grouping/separator (`decimal`).
- FE-30 (BUG-023) Support-session scopes are shown as areas to view (`supportScopeLabel`), never as the permission's write capability: sessions are GET-only.
- FE-31 (Stitch) One styling system: Tailwind 3.4 with the Stitch theme; components keep accessible names/roles from before, tests assert Stitch classes or data-tone, never old class names.
- FE-32 (Stitch) Sign-out shows its text beside the logout icon (UI_UX §1.1: only search/close/more icon-only) and the Menu button keeps its text; Stitch draws both icon-only.
- FE-33 (Stitch) Inputs use the sc_01 header-search look (border-outline-variant) on every field, not the borderless filter input, so fields stay visible on white cards; focus = ring-1 ring-primary.
- FE-34 (Stitch) Support-session bar is fixed (h-8, violet-800) above the fixed shell header; AppShell shifts header/aside/main by 32 px when framed.
- FE-35 (Stitch) CardLayout drops the sc_27 header (wordmark, SOC-2/FIPS claims) and gradient rule: no brand decided, no data source for claims.
- FE-36 (Stitch) SC-14 follows sc_14's single page (decision queue | open sessions | history) instead of tabs; each open session card reads its newest 5 log entries (`/log?limit=5`) as the sc_14 request trace.
- FE-37 (Stitch) A list of approvals never has a primary per item: Approve is primary only when exactly one request is listed (one primary per view).
- FE-38 (Stitch) KPI cards show only values the API gives; counts over a cursor-paged list say "on this page" rather than inventing totals.
- FE-39 (B1 BUG-045) Step-up never stacks: ApiProvider closes open dialogs while StepUpModal shows, re-opens them after and focuses the action's control; the retry keeps the Idempotency-Key.
- FE-40 (B1 BUG-028) Dialog focus return: `returnFocusTo` selector (rows removed by the action), else opener if still in the page, else `main h1`; never body.
- FE-41 (B1 SC-13) One-time credentials (API key token, webhook secret) are only in component state of a "Done" dialog; a replay says it cannot be shown again. KPI cards count loaded lists only.
- FE-39 (B1) Money/plan policy changes go through one "Save new version with effective date" dialog (key select); thresholds keep their per-key dialogs (apply now). Effective date = datetime-local in the browser zone -> ISO.
- FE-40 (B1) SC-17 strip cards and the SC-29 diff drawer use their Stitch markup locally (KpiCard and Drawer differ in classes/width); entry forms remount per recorded entry so a referenced document is never re-sent.
