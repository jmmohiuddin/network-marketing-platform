# frontend — OPEN_ISSUES

_Agent: frontend. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


- (backend) Behind the Next rewrite every browser reaches the API from the web server's address: per-IP sign-in rate limits and login_attempt IPs collapse to one IP. API needs `trustProxy` for the web hop (X-Forwarded-For).
- (env) API COOKIE_SECURE defaults to true; on plain http other than localhost/127.0.0.1 the browser drops the cookie: set COOKIE_SECURE=false for such local setups. API_URL is baked into rewrites at `next build`.
- API nav paths differ from UX-03 proposals (/data/imports): the API's paths win. /compliance and /imports built in T-A15.
- No factor recovery: the API has no MFA reset for a lost authenticator; the UI does not promise one.
- Not driven in a real browser (only `next start` + curl CSP check in gaps); Inter/JetBrains Mono are not loaded (system font fallback).
- (shared, T-A15) lib/api.ts lacks upload progress and non-JSON (CSV) responses; `features/data/transfer.ts` does both locally. Move into lib/api as options and delete transfer.ts. 
- (backend nav, T-A15) Consider a nav entry for mapping approvers instead of the duplicate /compliance/mappings route (FE-10).
- shortcut lists: pending grant requests one page of 200 (count + chips), open support sessions 200 per state, request-session tenant choice first 200 tenants.
- Shared-kit candidates implemented locally in features/admin: TextArea field, radio group (admin-fieldset/admin-choice), FormDialog, description list/card styles.
- Support-session frame colour `--color-support-frame` is an engineering value (O-06). Session id lives in sessionStorage per tab; header only on GET.
- Step-up dialog opens over an open form dialog (ApiProvider design), against UX "never stacked".
- (contract, gaps) Built against the new contract with mocks only (backend implementing in parallel): GET /v1/markets, snapshot `market`, rows meta `sums`/`component`, /v1/me `support_session`, /v1/support-sessions/limits, /v1/imports/limits. Not run against the real API yet. `meta.component.key` is read as the component's name ("numerator"); the UI marks the sums line matched when any *_minor sum equals expected_minor. Import `max_file_bytes` is taken as per file.
- (gaps) Charts scale with their container (viewBox 560): below ~560 px text shrinks (staff app is desktop-first; table toggle is the fallback). SC-46 wireframe's recent-snapshots table is not on the overview ("Open reports" links to it). Comparison chart draws percentages only (one axis); other units are in the table. Only two data-vis slots validated (O-10 for more series).
- (backend, BUG-023) Tenant request card shows the requester as "Vendor user <short id>": the tenant realm cannot read vendor users. Proposed: support-session tenant view adds `requester: {display_name, email}` (read in the vendor realm); then render personLabel on the card.
- (backend, BUG-020) Audit actor names come from GET /v1/users (user.manage only, first 200) or GET /v1/vendor-users; tenant logs cannot name vendor actors. Proposed: audit events carry `actor_name`/`actor_email`.
- (BUG-014 contract) POST /v1/tenants accepts optional `second_admin {email, display_name}`; the provisioning form does not offer it yet. Vendor log has no chain verification or export route, so the vendor audit page has neither.
- (BUG-022) Stacked table checked by unit test only, not re-measured at 390 px in a browser.
- (backend) Tenant view has no created_by (the vendor creator is refused by SOD_SELF_APPROVAL, not pre-hidden). No tenant archive route.
- BUG-024 residual: tenants already provisioned with one admin (e.g. initech from the R2 retest) still cannot approve admin/approver grants; no web or API path adds a second Tenant admin to them. Needs a vendor/ops repair path (backend) or re-provisioning.
