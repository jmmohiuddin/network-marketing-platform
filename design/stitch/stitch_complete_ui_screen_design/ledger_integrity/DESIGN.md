---
name: Ledger & Integrity
colors:
  surface: '#f8f9ff'
  surface-dim: '#ccdbf3'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d5e3fc'
  on-surface: '#0d1c2e'
  on-surface-variant: '#434752'
  inverse-surface: '#233144'
  inverse-on-surface: '#eaf1ff'
  outline: '#737783'
  outline-variant: '#c3c6d3'
  surface-tint: '#2e5bb0'
  primary: '#003883'
  on-primary: '#ffffff'
  primary-container: '#1e4fa3'
  on-primary-container: '#afc6ff'
  inverse-primary: '#afc6ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#004525'
  on-tertiary: '#ffffff'
  tertiary-container: '#0d5f36'
  on-tertiary-container: '#8cd7a3'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d9e2ff'
  primary-fixed-dim: '#afc6ff'
  on-primary-fixed: '#001944'
  on-primary-fixed-variant: '#074397'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#a7f3be'
  tertiary-fixed-dim: '#8cd7a3'
  on-tertiary-fixed: '#00210f'
  on-tertiary-fixed-variant: '#00522d'
  background: '#f8f9ff'
  on-background: '#0d1c2e'
  surface-variant: '#d5e3fc'
typography:
  display:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  title-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  title-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  section-heading:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  data-mono-lg:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  data-mono-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  data-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-compact: 0.75rem
  margin: 1.5rem
  margin-mobile: 1rem
  space-xxs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
---

## Brand & Style

This design system governs an enterprise-grade compensation, payout, and regulatory compliance platform catering to executive operators, compliance officers, and independent distributors. The product operates in a high-stakes, legally audited environment where precision, clarity, and accountability supersede ornamentation.

### Personality & Demeanor
- **Trustworthy & Plain:** The aesthetic is austere, deliberate, and institutional. It speaks with the authority of an immutable audit trail.
- **Exact & Data-First:** Numbers, invariant validations, and compliance status indicators are the primary visual focal points. Decorative abstractions, celebratory banners, gamification badges, and speculative income forecasts are strictly prohibited.
- **Respectful & Measured:** Interactions convey weight and consequence. Destructive or compliance-altering actions require friction, verification, and clear separation-of-duties enforcement.

### Design Movement
The interface relies on **Modern Structural Functionalism**: high-density data tables, rigorous 1px boundary lines, disciplined monochromatic layering, and purposeful semantic accents. The visual environment mimics mission-critical financial terminals and statutory compliance ledgers rather than consumer SaaS applications.

## Colors

The palette is 90% neutral, reserving high-saturation hues exclusively for interactive affordances, active navigational focus, and critical status communication.

### Color Tokens & Assignments
- **Surfaces & Layout Canvas:**
  - Page Background: `#F8FAFC` (Slate-50)
  - Card & Modal Surfaces: `#FFFFFF` (Pure White)
  - Table Header & Secondary Surfaces: `#F1F5F9` (Slate-100)
  - Interactive Hover Tints: `#EEF4FC` (Blue-50)
- **Text & Hierarchy:**
  - Primary Text: `#0F172A` (Slate-950) — Used for values, primary metrics, table contents, and high-emphasis labels.
  - Secondary Text: `#475569` (Slate-600) — Used for descriptive labels, table column headers, and structural metadata.
  - Tertiary / Muted Text: `#64748B` (Slate-500) — Used for disabled content, breadcrumbs, and timestamp qualifiers.
  - Structural Borders: `#CBD5E1` (Slate-300) — Defines table cells, dividing rules, card boundaries, and container limits.
- **Primary Brand & Action Accent:**
  - Base Action: `#1E4FA3` (Blue-700) — Primary CTAs, active pagination states, focused input borders, and active tabs.
  - Hover Action: `#173E82` (Blue-800) — Hover/pressed state for primary buttons.
  - Focus Ring: `rgba(30, 79, 163, 0.2)`
- **Semantic & State Semantics:**
  - **Success (Settled, Closed, Healthy, Ready):** Text/Icon `#14633A` (Green-800) on Surface `#E8F5EE` (Green-50). Border `#A3D9B8`.
  - **Warning (Held, Cooling-off, Behind, Stale, Grace):** Text/Icon `#7A4900` (Amber-800) on Surface `#FFF4D6` (Amber-50). Border `#F5D580`.
  - **Danger (Errors, Invariant Breach, Blocked, Failed):** Text/Icon `#912018` (Red-800) with Action `#B42318` (Red-700) on Surface `#FDECEA` (Red-50). Border `#F7A8A3`.
  - **Information (Calculating, In Review, Awaiting Approval):** Text/Icon `#1849A9` (Info-800) on Surface `#EAF2FF` (Info-50). Border `#B2CCFF`.
  - **Committed / Immutable:** Text/Icon `#0F172A` (Slate-900) accompanied by a hard slate lock icon.

## Typography

The type scale combines **Inter** for administrative navigation, descriptions, and labels, with **JetBrains Mono** strictly enforced for IDs, compensation math, settlement totals, hash checksums, and table cell data.

### Numerical Integrity Rules
- Every numerical value rendered in Inter must apply the CSS utility `font-feature-settings: "tnum" 1, "lnum" 1`. Monospaced tabular alignment guarantees vertical scanning accuracy across ledger lines.
- Ledger payouts and aggregate metric totals use `data-mono-lg` and `data-mono-md` to explicitly distinct financial numbers from standard UI text.
- Staff consoles (T1) lean heavily on `body-md` (14px) and `body-sm` (13px) to maximize screen real estate and row density. Distributor Portals (T2/T3) use `body-lg` (16px) for narrative notifications and general statements.

## Layout & Spacing

A strict **4px baseline grid** orchestrates all structural layout components, form rows, and cell paddings.

### Canvas Grid Model
- **Desktop (≥ 1280px):** 12-column layout, capped at a maximum width of `1440px`. Column gutter is `24px` (`1.5rem`) with outer margin `24px` (`1.5rem`).
- **Tablet (768px - 1279px):** 8-column layout. Column gutter is `16px` (`1rem`) with outer margin `16px` (`1rem`). Side drawers switch from docked to overlaid modal viewports.
- **Mobile (< 768px):** 4-column layout. Gutter is `12px` (`0.75rem`), outer canvas margin is `16px` (`1rem`). Data tables convert to carded audit rows or pinned-column scroll containers.

### Density Scales
- **Staff Dense Tables (Compact):** Row height clamped to `32px`. Cell padding: `4px 8px`. For rapid line-item cross-checking, reconciliation, and audit log processing.
- **Portal & Standard Tables (Comfortable):** Row height clamped to `44px`. Cell padding: `10px 16px`. Used in Distributor statements and executive summary overviews.
- **Drawers & Inspector Panels:** Right-docked sliding drawers occupy exactly 33.33% (`480px` min) or 50% (`720px` max) of viewport width.

## Elevation & Depth

Visual separation relies primarily on **1px crisp boundary lines** (`#CBD5E1`) and surface color differentials rather than dramatic lighting models or skeuomorphic diffusion.

### Depth Architecture
1. **Canvas Level (0dp):** Page background `#F8FAFC`.
2. **Surface Level (Flat / Raised by Border):** Data tables, cards, stat panels, and summary modules sit on `#FFFFFF` with a mandatory `1px solid #CBD5E1` border. No drop shadow is applied to static content containers.
3. **Sticky Controls & Global Headers (4dp):** Sticky table column headers (`#F1F5F9`) and two-person approval sticky footers (`#FFFFFF`) utilize a hairline separator `border-b: 1px solid #CBD5E1` or `border-t: 1px solid #CBD5E1`, anchored by a minimal ambient shadow:
   `box-shadow: 0 2px 4px -1px rgba(15, 23, 42, 0.04), 0 4px 6px -1px rgba(15, 23, 42, 0.02)`.
4. **Side Drawers & Overlays (8dp):** Slide-out rule calculation editors and transaction trace inspectors cast an ambient, neutral-tinted shadow:
   `box-shadow: -4px 0 16px 0 rgba(15, 23, 42, 0.08)`.
5. **Modals & Popovers (16dp):** Compliance confirmation dialogs use `box-shadow: 0 12px 24px -4px rgba(15, 23, 42, 0.12), 0 4px 8px -2px rgba(15, 23, 42, 0.04)` over a backdrop tint of `rgba(15, 23, 42, 0.45)`.

## Shapes

The interface employs a **Soft** shape metric (`roundedness: 1`), keeping corner radii restrained to ensure maximum data density, sharp grid fidelity, and an austere institutional tone.

### Corner Radius Allocation
- **Standard Controls & Interactive Components (`4px` / `0.25rem`):** Buttons, inputs, search controls, dropdowns, and semantic badge tags.
- **Card Containers, Drawers, & Modals (`8px` / `0.5rem`):** Outer card containers, filter panels, popover menus, and modal dialogs.
- **Data Table Cells & Sticky Bars (`0px`):** Inner data table cells, column headers, and docked horizontal approval bars retain completely sharp zero-radius edges to maintain structural integrity against window borders.

## Components

### Buttons & Action Bars
- **Primary:** Background `#1E4FA3`, label `#FFFFFF`, border none, radius `4px`. Hover: `#173E82`. Height: `32px` (compact) or `40px` (comfortable).
- **Secondary / Neutral:** Background `#FFFFFF`, label `#0F172A`, border `1px solid #CBD5E1`. Hover: `#F1F5F9`.
- **Destructive:** Background `#FFFFFF`, label `#912018`, border `1px solid #F7A8A3`. Hover: `#FDECEA`.
- **Separation-of-Duties (Two-Person Rule):** Displayed inside sticky bottom approval ribbons. Features distinct visual states: Pending First Signature (outlined blue), Awaiting Second Sign-off (warning amber strip with explicit actor tag), and Fully Committed (slate solid with locked padlock icon).

### Status Badges & Chips
- Form factor: Compact `20px` height, `4px` border radius, padding `2px 8px`. Font: `caption` (12px), weight 600, uppercase letter-spacing `0.02em`.
- **Settled / Paid:** Text `#14633A`, Background `#E8F5EE`, Border `1px solid #A3D9B8`.
- **Held / Cooling-Off:** Text `#7A4900`, Background `#FFF4D6`, Border `1px solid #F5D580`.
- **Breached / Invariant Error:** Text `#912018`, Background `#FDECEA`, Border `1px solid #F7A8A3`.
- **Calculating / Under Review:** Text `#1849A9`, Background `#EAF2FF`, Border `1px solid #B2CCFF`.

### Data Tables
- Pinned, sticky table header row styled in `#F1F5F9` with a persistent bottom border `1px solid #CBD5E1`.
- Numeric data columns must align right and utilize `data-mono-md` or `data-mono-sm`.
- Hover row state: `#F8FAFC`. Selected row state: `#EEF4FC`.

### Form Controls & Inputs
- Height: `32px` (staff) or `40px` (portal). Background `#FFFFFF`, border `1px solid #CBD5E1`, text `#0F172A`.
- Active focus state: border `#1E4FA3`, outline `2px solid rgba(30, 79, 163, 0.2)`.
- Input labels rendered in `body-sm` (`#475569`, weight 500). Required indicators use `#912018`.

### Inspection Drawers (Trace & Rule Inspector)
- Right-anchored flyouts for rule breakdown, qualification path trees, and payout traces.
- Segmented header featuring the exact Entity ID, Rule Hash, and immutable timestamp in `JetBrains Mono`.
- Sub-panels bordered by `1px solid #CBD5E1` with `#F8FAFC` contextual code or expression preview blocks.

### Invariant & Compliance Banners
- Non-dismissible top-of-section warnings for held payout cycles or rule-engine failures.
- Solid 4px left-border accent matching the semantic color (Red-800 for invariant halts, Amber-800 for cooling-off exceptions), `#FFFFFF` fill, and clear action button to review ledger trace.