# 02 — WIREFRAMING SPECIFICATION
## Layout templates, structural rules, screen states and what has actually been drawn

| Field | Value |
|---|---|
| Document ID | WF-02 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | UX architect role |
| Depends on | WF-01 (inventory), UX-02, UX-05; gap audit 14, 27 |
| Status | Draft |

## 1. What exists and what does not

| Deliverable | Status |
|---|---|
| Screen inventory with all fields | **Done**: 47 screens (WF-01) |
| Actual low-fidelity wireframes | **Done for 34 screens** as SVG files in `wireframes/`, plus **8 phone variants** (42 files). Generated from layout specifications, structure only |
| Screens specified in text only | **13**: SC-11, 12, 15, 23, 29, 30, 31, 34, 36, 38, 40, 43, 45. Each follows a drawn pattern (list with drawer, form with history, static page) named in §5 |
| Wireframes for every state of every screen | **Not done.** Key states are shown inside the drawings as example banners; the full state matrix is specified in §3 |
| Clickable prototype | **Not done** |
| Usability testing of wireframes | **Not done** (UX-01 §7) |
| High-fidelity designs | **Not done, by intent**: structure first |

The five highest-risk screens (SC-02, SC-04 with SC-42, SC-18, SC-07 with SC-20, SC-06) all have drawn wireframes.

## 2. Layout templates

### T1 Staff shell (desktop, 1024 px and wider)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ HEADER 48: logo · tenant · market ▾ │ global search │ bell · help · user │
├───────────┬──────────────────────────────────────────────────────────────┤
│ SIDEBAR   │ PAGE TITLE (+ state chip)                 [secondary] [PRIMARY]│
│ 208       │ One-sentence summary                                         │
│ nav items │ Page banner (only when a condition applies)                  │
│ from      │ KPI cards (0–5)                                              │
│ permis-   │ Tabs (peer views)                                            │
│ sions     │ Filter bar                                                   │
│           │ MAIN: table / form / tree / chart      │ DRAWER (optional,   │
│           │                                         │ 1/3–1/2 width)      │
│           │ Approval / action bar (sticky bottom, when the page approves) │
└───────────┴──────────────────────────────────────────────────────────────┘
```

| Region | Rule |
|---|---|
| Header | Fixed. Market switcher scoped to the user; search opens the command palette; bell opens the notification list |
| Sidebar | Items generated from permissions; collapsible to icons at 1024–1279 px; current section highlighted |
| Navigation | Sidebar for sections; tabs for peer views of one object; breadcrumbs only below the second level |
| Title row | Object name with state chip; at most one primary button, right-aligned; secondary buttons to its left; overflow menu for the rest |
| Summary sentence | Required on dashboards, reviews and approvals |
| Main content | 12-column grid, 24 px gutters, maximum content width 1440 px; tables take full width |
| Cards | 2–5 in one row; each a figure with label and optional delta; each links to its source |
| Tables | Per UX-05 §2; sticky header; summary line above |
| Charts | Only where a trend or distribution answers the page's question; always with a table alternative |
| Forms | One column, 480–640 px wide, inside the content area or a drawer |
| Filters | Bar above tables; chips for applied filters |
| Buttons | Primary action names the object; destructive actions never primary-styled |
| Modals | Decisions only (confirmations, approvals with step-up) |
| Drawers | Detail and edit in context (trace, rule editor, method notes, case detail, version history) |
| Contextual actions | Row menu on tables; object menu in the title row |
| Sticky action bar | On approval pages: states who prepared, who may approve, and holds the approve and reject buttons |

### T2 Portal (desktop and tablet)

Top bar with tenant logo and up to six navigation items; one centred column of at most 720 px; no sidebar. The line explanation opens as a side panel at 1024 px and wider.

### T3 Phone (360–599 px)

Top bar 48 px (back, title, bell) · one column, 16 px margins · bottom navigation 56 px with at most five items · bottom sheets instead of drawers · full-width buttons 44 px high.

### T4 Centred card

Sign-in, public forms, public disclosure: one card of at most 480 px (forms) or a 720 px column (documents) on a plain page.

## 3. Screen states

General behaviour of each state is in UX-05 §8. This matrix lists which states apply to which screens and anything specific. "Std" = standard behaviour with no screen-specific rule.

| Screen | Initial | Loading | Empty | Success | Error | Validation | Permission denied | Disabled / locked | Partial data | Offline |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-46 Compliance overview | Latest ready snapshot | Skeleton cards | "Upload an export to begin" → SC-24 | Snapshot ready toast | Std | — | Page absent from nav | Outdated snapshot badge | Data-quality warnings beside figures | Std |
| SC-24 Imports | Batch list | Validation and load as jobs with stages | "No imports yet" with schema and sample files | Batch loaded | Rejected batch: banner + row report | File presence, size, type | Std | Superseded batches read-only | Batch validated but not loaded | Upload resumes or restarts cleanly |
| SC-25 Mapping | Current version | Std | — | Version approved | Std | Unmapped values listed | Approve absent for consultant | Approved versions read-only | Unknowns allowed, counted | Draft autosaved |
| SC-10 Reports | Latest snapshot, R1 | Computing with progress | No data for range | Std | Computation failed: retry | Period range within loaded data | Std | Outdated badge; partial year not publishable | Warnings; null figures with reason | Std |
| SC-26 Drill-down | Numerator rows | Std | "No rows in this set" | Export queued | Std | — | Export button absent | Export above cap refused | — | Std |
| SC-27 Sign-in | Credential form | Std | — | Redirect to role home | Generic failure; lockout | Field format | — | Forced MFA enrolment | — | "Cannot reach sign-in service" |
| SC-28 Users and roles | User list | Std | Only the first admin | Invitation sent | Std | Conflicting duties refused | Std | Privileged grant pending second admin | — | Std |
| SC-14 Vendor access | Requests | Std | "No requests" | Decision recorded | Std | Duration within maximum | Std | Expired requests read-only | — | Std |
| SC-01 Periods | Current calendar | Run progress with stages, safe to leave | "No periods yet" with set-up steps | Run calculated | Run failed: diagnostics + Resume | — | Calculate absent without permission | Committed: lock, "Request restatement" | **Sync behind: calculation blocked with last sync time** | Std |
| SC-02 Run review | Variance tab | Skeleton | No exceptions: "Nothing needs acknowledgement" | Committed | Invariant failed: commit refused, alert | Exceptions must be acknowledged | Commit disabled for preparer with reason | Superseded run read-only | Stale sync after run: commit blocked | Std |
| SC-32 Late queue | Open items | Std | "No late transactions" | Handling accepted | Std | — | Std | Consumed items read-only | — | Std |
| SC-04 Plan version | Rules tab | Std | New plan: "Add your first rule" | Draft saved; submitted | Save refused: guardrail blocked | Schema and dependency errors per rule | Edit absent for readers | Approved and active versions immutable | Extension rule without template flagged | Draft autosaved |
| SC-05 Cap | Form | Preview computing | — | Saved | Std | Priority covers scope; residue rule set | Std | Immutable in approved versions | Preview needs a committed period | Std |
| SC-42 Simulation | Summary | Job progress | No simulation yet | Completed | Failed with reason | Period must be a full historical period | Std | — | Golden failures listed | Std |
| SC-44 Change workflow | Current step | Std | — | Scheduled | Std | Checks incomplete named | Approve absent for author | Blocked steps explained | Filing step only where required | Std |
| SC-07 Genealogy | Search focused | Lazy branch loading | "Search for a position or person" | — | Std | Dates valid | Std | Historical view read-only | **Read model rebuilding: notice, depth-limited** | Std |
| SC-08 Genealogy request | Step 1 | Checks computing | — | Request submitted | Std | Outside window; cycle; slot taken | Approve absent for filer | Decided cases read-only | Affected periods listed | Draft kept |
| SC-09 Participant | Overview | Std | Tabs with "No history yet" | — | Std | — | Masked fields; unmask needs permission | Pseudonymised record: identity removed | — | Std |
| SC-06 Case | Case detail | Std | List: "No cases match" | Decision recorded | Std | Reason and evidence required | Approve disabled for proposer | Decided cases read-only | Effect preview unavailable → cannot approve | Draft kept |
| SC-03 Payout batch | Batch detail | Instruction progress | "No batches yet" | Approved; settled | Provider rejected: retry failed lines | Provider eligible; amount ≤ payable | Approve disabled for preparer | Settled batch read-only | Partially settled | Std |
| SC-33 Ledger | Period accounts | Std | No postings | Export generated | Imbalance alert (should never occur) | Mapping complete for export | Std | Read-only always | — | Std |
| SC-13 Integrations | Status cards | Std | "Connect your store" | Connected | Failing connection with guidance | Credentials | Std | — | Behind: lag shown | Std |
| SC-16 Migration | Current step | Import and comparison jobs | — | Signed off | Validation blocks: cycles, orphans, totals | Mapping complete | Sign-off absent for consultant | Sign-off disabled until unexplained = 0 | Legacy file lacks bonus detail: payee-level only | Std |
| SC-17 Launch checklist | Items | Std | — | Market Live | Std | Evidence per mandatory item | Sign-off absent for preparer | Go-live disabled with missing items named | Screening-status rule flagged | Std |
| SC-35 Executive overview | Last committed period | Skeleton cards | "No committed period yet" | — | Std | — | Std | — | Sync behind banner | Std |
| SC-39 Vendor console | Tenant list | Std | No tenants | Request sent | Std | Reason and scope required | Business data routes do not exist | — | — | Std |
| SC-47 System | Status | Checks running | No updates available | Update activated | Signature or check failure: refused, report | — | Std | Activation needs second approver | **Licence lapsed: notice; runs and payouts unaffected** | Works offline |
| SC-37 Home | Latest statement | Skeleton | "Your first statement appears after the first pay period closes" | — | Std | — | — | Payout held: reason and date | — | Last loaded content with time |
| SC-18 Statement | Latest period | Skeleton | No committed periods | Dispute submitted | Std | — | Other people's data never shown | Open period: status only | Explanation template missing: generic inputs | Last loaded statement |
| SC-19 Rank | Current | Std | No state yet | — | Std | — | — | — | Open period labelled not final | Std |
| SC-20 Team | Own first level | Lazy | "No one in your team yet" | — | Std | — | **Beyond depth: aggregates with explanation; outside downline: not found** | — | Updating after a change | Std |
| SC-21 Customers | Current | Std | "No customers yet" | — | Std | — | — | Past customers read-only | — | Std |
| SC-22 Payment details | Masked details | Std | No details yet: add | Change saved; cooling-off date | Std | Bank format; re-authentication | — | Cooling-off active; change under review | — | Input kept |
| SC-41 Privacy request | Form | Std | — | Reference number | Std | Required fields | — | — | — | Input kept |

Text-only screens (SC-11, 12, 15, 23, 29, 30, 31, 34, 36, 38, 40, 43, 45) use standard states; specific rules: SC-12 lists missing tax ids as a validation state; SC-15 shows deadline indicators; SC-30 is read-only; SC-34 treats unmatched items as the working list.

## 4. Responsive behaviour (structure)

| Width | Staff application (T1) | Portal (T2/T3) |
|---|---|---|
| ≥ 1440 px | Sidebar expanded; drawers one third; cards up to five per row | Centred 720 px column; explanation side panel |
| 1280–1439 px | Same; cards up to four per row | Same |
| 1024–1279 px | Sidebar collapsed to icons; tables scroll horizontally inside their container; drawers half width | Same |
| 600–1023 px | Not optimised except approvals (WF-06 §3); notice shown | Top navigation; single column |
| 360–599 px | Read-and-approve only | T3 phone: bottom navigation; bottom sheets; stacked cards |

Full rules: `07-ui-design/05_RESPONSIVE_DESIGN.md`.

## 5. Patterns reused by text-only screens

| Pattern | Drawn in | Reused by |
|---|---|---|
| Filterable list with detail drawer | SC-06, SC-33 | SC-11, SC-15, SC-30, SC-31, SC-34, SC-45 |
| Object record with history tabs | SC-09 | SC-43 |
| Settings sections with version history | SC-28 | SC-29, SC-12 (rules), SC-38 |
| Command palette | Header of T1 | SC-36 |
| Wizard with checks | SC-16, SC-44 | SC-12 (year-end), SC-23 |
| Static document page | SC-41 (card) | SC-40 |

## 6. Annotation conventions in the drawings

Solid dark button = primary action · outlined button = secondary · dashed box = explanatory or placeholder region (drawer, panel, sheet) · dashed grey bar starting with "!" = page banner showing an example state · grey bars = placeholder data · numbered circles = steps · "▸" = expandable branch · "+n" = count of collapsed descendants.
