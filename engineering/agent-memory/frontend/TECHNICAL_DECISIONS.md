# frontend — TECHNICAL_DECISIONS

_Agent: frontend. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


- FE-01 Data loads in client components through the same-origin `/v1` rewrite (HttpOnly SameSite=Strict cookie stays first-party); server components only for layouts and metadata.
- FE-02 Auth error redirects are full navigations (`leavePage`), dropping client state; the API promise never settles so pages keep their loading state.
- FE-03 Theme: light only (`color-scheme: light`, UI_UX 1.3/C-01); dark returns when O-03 values are approved. tokens.test.ts checks WCAG pairs and that no dark branch ships.
- FE-04 No UI kit: native `<dialog>` + own focus trap/Escape/focus return; lucide-react icons; qrcode-generator drawn as SVG path (no innerHTML). QR stays dark-on-light in both themes (`--qr-*`).
- FE-05 Sidebar: 208 px at >= 1024; below that a "Menu" disclosure (deviation from 56 px collapsed rail: API nav entries carry no icons).
- FE-06 403 and 404 are the same "Not found or not available to you" page/component.
- FE-07 MFA enrolment starts on the user's click (never on mount) so a re-render or reload cannot replace the secret being scanned.
- FE-08 Vendor sign-in lives at `/signin/vendor`; vendor flows carry `next=/vendor` so MFA pages and expiry redirects stay in the vendor realm.
- FE-09 Invitation token read from `#token=` once, then removed from the URL with history.replaceState.
- FE-10 (T-A15) Mapping editor lives at both `/imports/mappings` and `/compliance/mappings`: AppShell only renders paths under the user's nav entries, and approvers (Compliance officer: mapping.approve, no import.manage) only have /compliance, editors (Implementation consultant) only /imports.
- FE-11 (T-A15) Upload progress and CSV export bypass lib/api.ts (fetch+JSON cannot do either) through `features/data/transfer.ts` with the same CSRF/Idempotency/error/auth-redirect contract; files are re-labelled text/csv client-side (extension already checked) because some OSes send application/octet-stream, which the API refuses (415).
- FE-12 (T-A15) Figure drill-down takes the figure id as `?figure=` (ids contain dots, spaces, '>' and ','), not a path segment.
- FE-13 (T-A15) Money/volume figures are shown in minor units ("16,000 minor units") and R5 values as "currency units": no endpoint gives the market's currency or exponent; no client arithmetic on money.
- FE-10 Admin dialogs are mounted only while open, so each opening gets fresh fields and a fresh Idempotency-Key (useIdempotencyKey); retry inside one opening reuses it.
- FE-11 List filters live in the URL (audit) or local state (vendor tenants/sessions); filtered lists are keyed by the filter so pagination restarts on change.
- FE-12 Settings: one row per key with a Change dialog (form + reason + Save); If-Match = newest meta.latest_version over all keys; after save or cancel every key is re-read (412 recovery). Unset thresholds open empty (DEC-14).
- FE-13 SoD in the UI: grant decisions hide Approve/Reject for the requester and the grantee with the reason; the API's SOD_SELF_APPROVAL message is shown for anything the UI cannot know (vendor provisioning creator).
- FE-14 Vendor breach-contact read is on demand (button), because each read is written to both audit logs.
- FE-15 (R1) Support session = per-tab sessionStorage frame + X-Support-Session on GET only; the frame and read-only mode are shown only when GET /v1/me confirms the session (role assignment_id = session id), so a stale value never frames a tenant user.
- FE-16 (R1) CSP by nonce in `src/proxy.ts`; all pages render dynamically (root layout `connection()`), the price of nonces.
- FE-17 (R1) Idempotency-Key lives as long as the request body: FormDialog drops it on any field change; provisioning compares the serialized body.
- FE-18 (R1) SC-46 headline per report: R1 customer_share_pct, R2 personal_use_share_pct, R3 share_pct.retail_sale, R4 active_with_no_customer_order_pct, R5 earned_more_than_zero_pct (latest period of the newest ready/outdated snapshot per market).

