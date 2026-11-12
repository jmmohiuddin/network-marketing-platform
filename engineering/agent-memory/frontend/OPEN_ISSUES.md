# frontend — OPEN_ISSUES

_Agent: frontend. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


- (backend) Behind the Next rewrite every browser reaches the API from the web server's address: per-IP sign-in rate limits and login_attempt IPs collapse to one IP. API needs `trustProxy` for the web hop (X-Forwarded-For).
- (env) API COOKIE_SECURE defaults to true; on plain http other than localhost/127.0.0.1 the browser drops the cookie: set COOKIE_SECURE=false for such local setups. API_URL is baked into rewrites at `next build`.
- API nav paths differ from UX-03 proposals (/data/imports): the API's paths win. /compliance and /imports built in T-A15.
- No factor recovery: the API has no MFA reset for a lost authenticator; the UI does not promise one.
- Not verified in a real browser (no servers started in T-A13); Inter/JetBrains Mono are not loaded (system font fallback).
- (backend, T-A15) Snapshot views carry `market_id` only: the snapshot list/report cannot show the market code and a failed snapshot cannot be re-requested with its parameters. Add `market` (code) like BatchView has. No markets endpoint either: market is typed as a code on upload and snapshot forms.
- (backend, T-A15) No endpoint for the import file size limit (UI assumes the 10 MiB default; server 413 still shown), no error-report download (SC-24 secondary) and no schema/sample files: UI lists required columns inline.
- (shared, T-A15) lib/api.ts lacks upload progress and non-JSON (CSV) responses; `features/data/transfer.ts` does both locally. Move into lib/api as options and delete transfer.ts. `useResource` (features/data/use-resource.ts) is a candidate shared hook.
- (backend nav, T-A15) Consider a nav entry for mapping approvers instead of the duplicate /compliance/mappings route (FE-10).
- (T-A15 not built) SC-46 headline KPI cards/trend sparkline, SC-10 compare periods/charts with table toggle, SC-26 sums line and filters, mapping draft autosave and unsaved-changes warning. Not verified in a real browser (no dev server per task rules).
- (backend) No vendor audit read route (audit.vendor_event): the vendor audit view (UX-02 5 /audit) is not built.
- (backend) No tenant-realm GET /v1/markets: role grants take market scope as market IDs typed by the admin; user roles show "N markets", not names.
- (backend) Support-session view has requester_id only (tenant cannot see who asked); tenant view has no created_by (vendor creator is refused by the API SOD_SELF_APPROVAL, not pre-hidden). No archive transition route.
- Client mirrors API constants with no endpoint: support max 480 min, support scope list (catalogue minus participant.unmask). Not offered: grant valid_to, settings effective_from (saves apply now).
- shortcut lists: pending grant requests one page of 200 (count + chips), open support sessions 200 per state, request-session tenant choice first 200 tenants.
- Shared-kit candidates implemented locally in features/admin: TextArea field, radio group (admin-fieldset/admin-choice), FormDialog, description list/card styles.
- Step-up dialog opens over an open form dialog (ApiProvider design), against UX "never stacked". crypto.randomUUID needs a secure context (plain-http LAN IPs break Idempotency-Key creation).
- (backend, R1) GET /v1/me inside a support session returns no `user` (vendor user row is hidden by tenant RLS on user_account; me-routes `user.rows[0]!`). The web uses the vendor user stored at "Open tenant app". Fix in API (read the user in the vendor realm or return the session's actor).
- (backend, R1) Invitation links must carry the tenant: `${WEB_URL}/invitation?tenant=<slug>#token=...` in iam/invitations.ts and ops/first-admin-invitation.ts. The web already reads ?tenant= and prefills sign-in; until then invitees still type the company.
- (backend, R1) Market code: snapshot views carry market_id only (web shows the id: "market <uuid>" in list, report title, drill-down, overview). Add `market` code like BatchView. No tenant-realm GET /v1/markets: grant dialog still takes market ids; roles cell says "N markets".
- (backend, R1) SC-26 sums line (AC-41.1) needs the API to return per-set sums of the *_minor columns (and the figure component each must equal) in the rows meta; the page holds one page of rows, so the client cannot sum a set.
- (product, R1) Not built: SC-10 period selector (a snapshot is the period range; choose a range by creating one), trend charts and SC-46 sparklines (data-vis palette unchecked, O-10; compare-periods table is the table form), SoD conflicting-pair flags in the role editor (no conflict list in docs or API). Charts need O-10 first.
- Support-session frame colour `--color-support-frame` is an engineering value (O-06). Session id lives in sessionStorage per tab; header only on GET.

