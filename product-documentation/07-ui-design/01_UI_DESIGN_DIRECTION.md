# 01 — UI DESIGN DIRECTION
## Visual personality, brand direction, interface style and the reasons for each choice

| Field | Value |
|---|---|
| Document ID | UI-01 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | UI designer / design system architect roles |
| Depends on | UX-01, UX-05, WF-02 |
| Companion documents | UI-02 design system · UI-03 tokens · UI-04 component library · UI-05 responsive design |
| Status | Draft. **A design system specification, not a finished interface.** No high-fidelity screens exist. The research repository contains no UI research; the direction below is derived from the product's users and risks, and from well-established conventions of financial and administrative software, not from a fresh study of competitor interfaces (their back offices are behind logins and were not seen). The product has no name or brand yet (OQ-23) |

## 1. What the interface has to do

| Requirement from earlier documents | Visual consequence |
|---|---|
| Buyers must trust the product with commission and financial data | Calm, exact, unembellished; numbers are the heroes |
| Analysts read dense tables for hours | High legibility, tabular figures, restrained colour, comfortable and compact densities |
| Distributors are a broad population, many aged 55 and over, multilingual, on phones | Large type, high contrast, generous targets, plain icons with labels |
| The product must never imply income | No celebratory visuals, confetti, trophies, progress-to-riches meters or "level up" styling |
| State (open, calculated, committed, held, stale) drives what users may do | A consistent, visible language of state |
| Tenants brand the distributor portal | Brand is a thin layer: logo, name, one accent colour |

## 2. Visual personality

| Attribute | Means | Does not mean |
|---|---|---|
| **Trustworthy** | Consistent, precise alignment; honest labels; visible sources | Heavy, bank-like ornament |
| **Calm** | Neutral surfaces; colour reserved for meaning; no motion for its own sake | Dull or low-contrast |
| **Exact** | Tabular numerals; right-aligned amounts; explicit units and time zones | Dense for the sake of density |
| **Plain** | Short words; one primary action; standard patterns | Childish or oversimplified for analysts |
| **Respectful** | States facts about pay and rank; explains limits | Motivational, gamified, pressuring |

## 3. Brand direction

- The product ships with a **neutral house style** (below). Its name and logo are undecided.
- **Tenant branding** applies to the distributor portal, statements and emails only: logo, display name, and one accent colour that the system checks for contrast (falls back to the house accent if it fails 4.5:1 on white). Layout, type and semantic colours cannot be changed, so a "committed" chip or a clawback line looks the same for every tenant.
- The staff application and vendor console are not tenant-branded beyond the tenant name.

## 4. Interface style

| Aspect | Decision | Reason |
|---|---|---|
| Surfaces | Flat, white content on a very light neutral page; 1 px borders define regions; shadows only for overlays | Borders read better than shadows in dense tables and print well |
| Shape | Small radii (4–8 px); no pills except filter chips and status chips | Serious without being harsh |
| Decoration | None: no gradients, illustrations in work screens, or background patterns. Empty states may use a single simple line icon | "Avoid unnecessary decoration" |
| Density | Two densities for tables (comfortable 44 px rows, compact 32 px rows); forms always comfortable; distributor pages always spacious | Analysts and distributors have opposite needs |
| Iconography | One outline icon family, 1.5 px stroke; icons always paired with text except in universally known cases (search, close, more) | Recognition across languages and ages |
| Imagery | None in the product | No lifestyle or income imagery |
| Motion | Functional only: 120–200 ms transitions for overlays and state changes; respects reduced-motion settings | Calm; accessible |

## 5. Colour strategy

1. **Neutral first.** About 90% of any screen is neutral (text, borders, surfaces).
2. **One accent** (deep blue) for primary actions, links, selection and focus.
3. **Semantic colours carry meaning only**: success, warning, danger, information. Never decorative.
4. **Colour is never the only signal.** Every state has a label or icon as well; negative amounts carry a minus sign.
5. **State colours** map to the period and payout lifecycles consistently (UI-03 §2.4).
6. **Charts** use a small, colour-blind-safe sequence and always have labels or a table alternative.
7. All text and essential graphics meet WCAG 2.2 AA contrast; the measured ratios are in UI-03.

## 6. Typography

| Decision | Detail | Reason |
|---|---|---|
| One sans-serif family with wide language coverage | **Inter** for Latin scripts, paired with **Noto Sans** families for scripts Inter lacks (for example Devanagari, Tamil, Bengali, Arabic, Thai); system font stack as fallback | Legible at small sizes; tabular figures; open licence; market packs decide scripts |
| Tabular, lining numerals for all amounts and ids | `font-variant-numeric: tabular-nums lining-nums` | Columns of numbers align |
| A monospace for ids, keys and code only | **JetBrains Mono** or system monospace | Distinguish identifiers from prose |
| Base size 14 px in the staff application, 16 px in the portal | Minimum 12 px anywhere; 16 px minimum for portal body and all inputs on phones | Density for staff; readability for distributors; avoids zoom on focus in mobile browsers |
| Weights 400, 500, 600 | No light weights | Contrast on low-quality screens |

## 7. Layout strategy and information density

- **Staff:** persistent shell (header, sidebar), content on a 12-column grid, maximum width 1440 px; tables use the full width; forms stay narrow (480–640 px).
- **Portal:** one column, maximum 720 px; one idea per block; net pay as the single largest element on the page.
- **Hierarchy on every page:** (1) title and state, (2) one-sentence summary, (3) condition banner if any, (4) key figures, (5) detail, (6) action bar. The primary action is always in the same place: top right of the title row, or a sticky bottom bar on approval pages and on phones.
- **Density:** staff tables default to comfortable and remember the user's choice; executives' pages use cards and charts before tables; distributor pages never show more than about seven items before a "show more".

## 8. Visual hierarchy rules

| Element | Treatment |
|---|---|
| Page title | 20–24 px, weight 600 |
| The one number that matters on a page (net pay, run total) | 28–36 px, weight 600, tabular |
| Section headings | 16 px, weight 600 |
| Body and table text | 14 px (staff), 16 px (portal) |
| Secondary text, captions | 12–13 px, secondary text colour, never below 4.5:1 contrast |
| Primary button | Solid accent; one per view |
| Destructive button | Outline in danger colour; solid only inside its confirmation dialog |
| State | Chip with icon and label next to the object name |
| Banners | Full-width, tinted by semantic colour, with icon, cause and action |

## 9. What the design must never do

Show projected or potential earnings; celebrate rank or pay with animation; rank people on leaderboards; use urgency styling (countdowns, flashing) to drive purchases or recruitment; use the word "wallet"; hide a limit without explaining it; rely on colour alone.

## 10. Next design steps (not done)

1. Name and brand decision (OQ-23).
2. High-fidelity designs of the five highest-risk screens in light theme.
3. Usability and comprehension testing (UX-01 §7), then iteration.
4. Component build with accessibility tests.
5. Dark theme only after the light theme is validated; tokens are structured to allow it (UI-03 §2.6).
