# 05 — RESPONSIVE DESIGN
## Desktop, tablet and mobile behaviour, with the distributor phone experience first

| Field | Value |
|---|---|
| Document ID | UI-05 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | UI designer role |
| Depends on | UI-03 §6 (breakpoints), WF-02 §4, WF-06 |
| Status | Draft. Device and browser assumptions are unverified for the launch market (distributor device data does not exist in the research) |

## 1. Strategy

Two products, two starting points:

| Application | Designed first for | Then adapted to | Reason |
|---|---|---|---|
| **Distributor portal** | Phone, 360 px, slow connection | Tablet and desktop by adding margin and a side panel | Large, varied population; mobile is the cheap safe default (need unverified) |
| **Staff application** | Desktop, 1280 px and wider | Down to 1024 px fully; approvals usable on tablets and phones | Dense analytical work; approvers may be away from a desk |
| **Public pages** | Phone | Wider by centring | Reached from links on any device |
| **Vendor console** | Desktop only | — | Internal |

## 2. Breakpoints

| Name | Range | Layout |
|---|---|---|
| xs | 360–599 px | Phone |
| sm | 600–1023 px | Large phone, tablet portrait |
| md | 1024–1279 px | Tablet landscape, small laptop |
| lg | 1280–1439 px | Desktop |
| xl | ≥ 1440 px | Wide desktop; content capped at 1440 px |

Content must also survive 320 CSS px (browser zoom at 400% on a 1280 px screen) without loss of information or function (WCAG 1.4.10); the portal is checked at 320 px.

## 3. Distributor portal

| Element | xs (phone) | sm (tablet portrait) | md and wider |
|---|---|---|---|
| Navigation | Bottom bar, 5 items maximum, labels always visible | Bottom bar | Top bar |
| Column | Full width, 16 px margins | 600 px centred | 720 px centred |
| Net pay | Display size 32 px | Same | Same |
| Statement lines | Full-width rows, 48 px high, amount right-aligned | Same | Same; explanation opens in a 360 px side panel |
| Explanation | Bottom sheet, up to 80% height, scrollable | Bottom sheet | Side panel |
| Tables (customers) | Stacked cards: name, last order, reorder mark | Two-column cards | Table |
| Team | List drill-in | List drill-in | Tree view with node panel |
| Forms | One question group per screen; full-width 44 px controls and buttons | Same, 480 px wide | 480 px wide |
| Buttons | Full width; primary at the bottom of the form or sticky | Auto width, right-aligned | Auto width |
| Banners | Full width, text wraps; never truncated | Same | Same |
| Type | Body 16 px; captions ≥ 13 px | Same | Same |
| Touch targets | ≥ 44 × 44 px, 8 px apart | Same | ≥ 24 × 24 px with pointer |

**Low-bandwidth and low-end device rules**

| Rule | Detail |
|---|---|
| Server rendering | Statement, rank and home are complete HTML on first response; scripts enhance |
| Budget | ≤ 150 KB transfer for the statement page excluding cached fonts; usable ≤ 3 s on a 3G-class profile (NFR-PERF-06, proposed) |
| Fonts | System font stack first; web font loaded with swap; script-specific fonts only for the user's language, subset |
| Images | None required; tenant logo as SVG or small PNG |
| Caching | Committed statements cacheable; service worker keeps the last viewed statement for offline reading |
| Data use | No auto-refresh, no background polling; pull to refresh |
| Inputs | Correct keyboard types; one-time codes fillable from SMS; no hover-only affordances |
| Orientation | Works in portrait and landscape; no orientation lock (WCAG 1.3.4) |
| Text growth | Layouts hold with 200% text size and 40% longer translations |

## 4. Staff application

| Element | md (1024–1279) | lg (1280–1439) | xl (≥ 1440) |
|---|---|---|---|
| Sidebar | Collapsed to 56 px icons with tooltips; expands as an overlay | Expanded 208 px | Expanded |
| Content grid | 12 columns, 24 px gutters, 24 px margins | 32 px margins | Capped at 1440 px, centred |
| KPI cards | 3 per row, wrap | 4 per row | 5 per row |
| Tables | Horizontal scroll inside the table container with the first column sticky; column chooser encouraged; compact density offered | Full | Full |
| Two-column pages (list + panel) | Panel becomes a drawer over the list | Side by side 60/40 | Side by side |
| Drawers | Half width | One third to one half | One third |
| Charts | Full width, stacked | Two per row | Two per row |
| Action bar | Sticky bottom | Sticky bottom | Sticky bottom |

**Below 1024 px** the staff application is not optimised, with three exceptions designed for small screens:

| Task | Behaviour on sm and xs |
|---|---|
| Approve a run commit | Summary sentence, totals and variance as cards, exceptions as an acknowledgeable list, approval bar pinned, step-up authentication |
| Approve a payout batch | Totals, counts, exclusion reasons with counts, approval bar pinned |
| Decide a vendor access request | Request card with Approve and Deny |

Other staff pages show a short notice ("This page works best on a larger screen") and remain operable by scrolling. This limit is recorded in the readiness report.

## 5. Component adaptations

| Component | Phone | Tablet | Desktop |
|---|---|---|---|
| Modal | Full-screen sheet with a close button | Centred, 560 px | Centred |
| Drawer | Full screen or bottom sheet | Half width | 420–720 px |
| Tabs | Scrollable row; never wrap to two lines | Same | All visible |
| Filter bar | "Filters (n)" button opening a sheet; applied chips scroll horizontally | Bar with overflow | Bar |
| Date and period picker | Native control where it meets needs; otherwise a full-width sheet | Popover | Popover |
| Stepper | Vertical, current step expanded | Horizontal | Horizontal |
| Tree view | List drill-in | Tree | Tree with panel |
| Charts | One per row; simplified axis labels; table toggle | One or two per row | Two per row |
| Toast | Bottom, above the navigation bar | Bottom right | Bottom right |
| Command palette | Full-screen search | Centred | Centred |

## 6. Input modes

Pointer, touch and keyboard are all first-class everywhere. No function depends on hover, drag, multi-touch or a path gesture (WCAG 2.5.1, 2.5.7). Focus rings are visible for keyboard users on every platform.

## 7. Print

Statements, tax forms, compliance snapshots and run reviews have print styles: single column, no navigation, page numbers, tenant name, period, generation time and document version; tables repeat headers across pages.

## 8. Test matrix (QA TS-55)

| Viewport | Screens |
|---|---|
| 320 px (reflow check) | SC-37, 18, 19, 22, 41 |
| 360 px | All portal screens; SC-27; staff approvals |
| 768 px | Portal; staff approvals |
| 1024 px | All staff screens with drawn wireframes |
| 1280 and 1440 px | All staff screens |
| Conditions | 200% text size; longest supported translation; right-to-left locale; throttled 3G profile; reduced motion; forced colours |

Devices: at least one low-end Android phone and one older iPhone representative of the launch market, once the market is chosen.
