# 05 — INTERACTION DESIGN
## Behaviour of forms, tables, filters, search, overlays, bulk actions, confirmations, notifications and states

| Field | Value |
|---|---|
| Document ID | UX-05 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | UX architect role |
| Depends on | UX-01; UI-04 (component library defines appearance; this document defines behaviour) |
| Status | Draft |

## 1. Forms

| Topic | Rule |
|---|---|
| Layout | One column; labels above fields; related fields grouped under a short heading; required fields unmarked, optional ones labelled "(optional)" |
| Validation timing | On blur for format; on submit for cross-field and server rules. Never while the user is still typing |
| Error display | Message under the field stating what is wrong and how to fix it; a summary at the top listing errors with links to fields; focus moves to the summary on failed submit |
| Server rule failures | Shown in the summary with the rule's plain name and code (for example "Outside the change window (10 days after enrolment)") |
| Money input | Accepts the locale's decimal separator; shows currency once; stored as minor units; no rounding surprises: what is typed is what is stored |
| Dates and periods | Period pickers offer periods of the relevant calendar, not free dates, where the rule is period-bound; effective dates snap to period boundaries with an explanation |
| Unsaved changes | Warn on navigation away; drafts of plan versions, mappings and cases autosave |
| Sensitive fields | Masked by default; "Show" is a separate, audited action with step-up; never pre-filled with unmasked values |
| Submit buttons | State the action ("Submit for approval", "Approve batch"), never "OK"; disabled only while submitting, with a spinner and no double submit (idempotency key per form instance) |
| Distributor forms | One question group per screen; correct mobile keyboard; large targets; progress shown for multi-step forms |

## 2. Tables

| Topic | Rule |
|---|---|
| Default | Server-side pagination, sorting and filtering; 50 rows; sticky header; first column identifies the row and is the link |
| Summary line | Above every table: count and key total in a sentence ("1,284 payees · 412,300.00 total") |
| Numbers | Right-aligned, tabular figures, currency in the header; negative amounts with a minus sign and a label, never colour alone |
| Columns | Column chooser; order and widths saved per user in a saved view; permitted columns only |
| Row actions | Inline primary action at row end where there is one; others in a row menu; row click opens detail in a drawer or page |
| Selection | Checkboxes appear only when a bulk action exists; "select all matching the filter" is explicit and shows the count |
| Density | Comfortable by default; compact option for analysts |
| Empty, loading, error | See §8 |
| Export | Respects filters, visibility and role cap; asynchronous above a size; logged; the dialog states row count and that the export is recorded |
| Keyboard | Arrow keys move between rows; Enter opens; `/` focuses the filter; shortcuts listed in help |
| Mobile | Tables become stacked cards showing the three most important fields; the rest behind "Details" |

## 3. Filters and search

| Topic | Rule |
|---|---|
| Filter bar | Above the table; the most used filters visible, others under "More filters"; applied filters shown as removable chips; "Clear all" |
| Apply | Simple filters apply immediately; multi-field filter panels apply on "Apply" |
| Saved views | Name, share within role, set as default; the URL always reflects the current filter so links reproduce it |
| Complex reporting filters | Period range, market, brand, participant type, bonus type, rank, state; each with "is", "is any of", ranges for amounts and dates; no free-form query language |
| Global search | Command palette; debounce 200 ms; minimum 2 characters; results grouped by type with counts; recent items; exact id match first; masked fields; nothing outside scope |
| Tree search | Finds a position, then shows it in context with breadcrumb to root |
| No results | Say so, restate the query and scope, suggest clearing filters; never imply that something exists outside scope |

## 4. Overlays

| Component | Use | Behaviour |
|---|---|---|
| **Modal** | A decision that must be made before continuing: confirmations, approvals with step-up, short creation forms | Focus trapped; Escape cancels unless work would be lost; one primary action; never stacked |
| **Drawer** (right side) | Detail or edit while keeping list context: trace, case detail, rule editor, method notes, version history | Closable with Escape; URL updates so the drawer state is linkable; width one third to one half |
| **Bottom sheet** (phone) | Same role as drawer on small screens: line explanation, filters | Swipe or button to close; focus managed |
| **Dropdown / select** | Up to about 12 options; above that, a searchable combobox | Type-ahead; keyboard operable |
| **Tabs** | Peer views of the same object (participant record; batch: included, excluded, instructions) | State in URL; never for sequential steps |
| **Wizard** | Sequential tasks with dependencies: import, migration, market launch, year-end, plan change | Steps listed with status; back allowed; each step saved; a blocked step explains why; final review before the committing action |
| **Tooltip** | Supplementary text for icons and truncated values | Never essential information; available on focus |
| **Popover** | Small contextual content: definition of a metric, basis status of a rule | Dismiss on outside click or Escape |

## 5. Bulk actions

| Rule | Detail |
|---|---|
| Preview first | A bulk action shows what will change: count, total amount, exclusions with reasons |
| Money is never bulk-edited directly | Bulk money effects go through a case or batch with approval (write-offs, late-transaction handling, batch preparation) |
| Partial failure | Results list successes and failures per item; failures can be retried; nothing is half-applied per item |
| Undo | Offered for a short window only where the action is reversible (assigning cases, saved views); never for approvals, commits or instructions |
| Long-running | Runs as a job with progress; safe to leave |

## 6. Confirmation dialogs

| Level | When | Pattern |
|---|---|---|
| None | Reversible, low impact | Act immediately; toast with Undo where available |
| Simple confirm | Irreversible but contained (reject a case, deactivate a user) | Title states the action and object; consequence in one sentence; buttons "Reject case" / "Cancel" |
| Effect preview | Changes money or structure (approve adjustment, approve genealogy change, accept late-transaction handling) | Shows before and after, affected people and periods, policy checks passed |
| **Critical approval** | Commit run, approve payout batch, activate plan, apply update | Summary of totals and variance; exceptions acknowledged individually; statement "You did not prepare this"; step-up authentication; the button names the amount or object ("Approve batch of 412,300.00 to 1,284 payees") |
| Typed confirmation | Rare destructive administration (archive tenant) | Type the tenant name |

Dialogs never use "Are you sure?" alone, and the safe choice is never styled as primary for destructive actions.

## 7. Notifications and feedback

| Type | Use | Behaviour |
|---|---|---|
| Inline message | Validation, field help, state of a section | Next to the thing it concerns |
| Banner (page-level) | Conditions affecting the whole page: sync behind, period committed and read-only, read model rebuilding, support session active, licence lapsed | Persistent until the condition ends; states cause and action |
| Toast | Confirmation of a completed, non-critical action | 5 s; dismissible; announced politely to assistive technology; never for errors that need action |
| In-app notification | Events that need me later (UX-02 §8) | Bell list; links to the object; read state |
| Email, SMS | By preference; mandatory for approvals, vendor access requests and security notices | No sensitive amounts or bank details in SMS |
| Progress | Long jobs | Stages with counts ("Calculating bonuses: 320,000 of 600,000 payees") and elapsed time; no fake percentages |

## 8. States

Every screen is designed for all applicable states; the screen-by-screen application is in WF-02 §3.

| State | Behaviour | Example copy |
|---|---|---|
| **Initial** | First view before any user choice; sensible defaults (current period, user's market) | — |
| **Loading** | Skeletons shaped like the content for under about 2 s; progress with stages for jobs; the page shell is usable meanwhile | "Loading statement…" |
| **Empty (first use)** | Explains what will appear and offers the first action | "No periods yet. Connect your store or import history to begin." |
| **Empty (no results)** | States the filter produced nothing; offers to clear | "No cases match these filters." |
| **Success** | Inline confirmation near the action; next step offered | "Batch approved. 1,284 instructions are being sent." |
| **Error (recoverable)** | What happened, what was not changed, what to do; retry keeps input | "We could not save the mapping. Nothing was changed. Try again." |
| **Error (blocking)** | Full-section message with reference id for support | "This page could not be loaded. Reference 7F3A…" |
| **Validation** | Per §1 | — |
| **Permission denied** | For a page: "Not found or not available to you". For a control: the control is absent. For limited data: explain the limit | "You can see totals for this part of your team, not names. Your company sets this." |
| **Disabled / blocked by state** | The control is visible but inactive only when the user could act later; always with the reason | "Commit is available after someone else reviews this run." |
| **Locked (committed)** | Read-only with a lock indicator and the path to change | "March is committed. To correct it, request a restatement." |
| **Partial data** | Banner with what is missing and its effect | "Order sync is 2 h behind (last order 09:14). Runs are blocked until it catches up." |
| **Stale** | Mark what is stale and when it was current | "Team view is updating after a change. Showing structure as of 10:02." |
| **Offline / connection failure** | Loaded content stays readable; actions that need the server say so; forms keep input | "You are offline. This statement was loaded at 08:40." |
| **Long job running** | Progress, safe to leave, notification on completion | "You can leave this page. We will notify you when the run finishes." |
| **Held** (distributor) | Explain the hold and what ends it | "Your payout is on hold until 14 March because your bank details changed." |

## 9. Glossary (labels must use these terms)

| Term | Meaning shown to users |
|---|---|
| Period | A pay period of a calendar (week, month) |
| Cut-off | The moment a period stops accepting orders, in the calendar's time zone |
| Run | One calculation of a period |
| Review | Checking a calculated run before approval |
| Commit | Freezing a run's inputs and results; done by an approver |
| Statement | A person's pay summary for a committed period |
| Gross / Withholding / Clawback / Adjustment / Net | As on the statement; net = gross − withholding − clawback ± adjustment |
| Earnings balance | Amount the company owes the distributor, not yet paid. Never "wallet" |
| Payout batch | A group of payments prepared and approved together |
| Position | A place in the organisation tree; a person may own more than one |
| Sponsor / Placement | Who enrolled you / where your position sits |
| Change / Correction | A move from a date onward / fixing a mistake from its original date |
| Case | A request or exception with reason, evidence and decision |
| Restatement | An approved recalculation of a committed period, applied as adjustments |
| Snapshot | A saved, unchangeable set of compliance figures |
| Indicator | A figure for a reviewer to consider; not a finding |
| Guardrail | A platform rule that blocks, warns on or reports a configuration |
| Market pack | The set of market-specific rules, each with its basis and status |

## 10. Microcopy rules

Plain words; sentence case; the user's language; state facts and next steps; no blame; no exclamation marks; numbers with units; dates in the user's locale with the time zone where a cut-off is involved; never promise or imply earnings.
