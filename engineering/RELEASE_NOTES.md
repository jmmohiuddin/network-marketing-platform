# Release Notes

## Unreleased

### Increment B1 — MVP-B foundations (2026-11-17)
Sandbox only: no real provider is called and no money moves.

**Tenant setup**
- Markets (country, currency, time zone, languages, market pack), brands and calendars with generated periods, under Settings › Markets. Every change is saved as a new settings version with a reason.
- Settings versions can take a future effective date. Money settings (rounding mode, clawback default) need a Finance approver; you cannot approve your own change. Scheduled changes survive later edits. Each value shows when it came into force.
- Market launch checklist: evidence upload with SHA-256, attestations, payout and payment provider eligibility records, market-pack rules with their basis status. A market goes live only after a go-live request and a sign-off by someone else; a mandatory rule still at screening status needs a written risk acceptance. New markets start as draft.

**Integrations**
- Service accounts and API keys: scopes, rate tier, IP allow-list, expiry, rotation with a grace period, revoke. A key is shown once and only reads what its scope allows.
- Public read API for compliance snapshots and the OpenAPI description of the integration surface.
- Webhooks: HTTPS endpoints with signed deliveries (Standard Webhooks format), secret rotation, test events, retries with backoff and Retry now. Private and loopback addresses are refused.

**Controls**
- Separation of duties: one rule for every approval, shown with the list of people who can approve.
- Case framework (internal; case types and screens arrive from B2).
- New permissions: settings.approve, market.manage, market.signoff, integration.manage.

**Fixes**
- MVP-A interface defects BUG-023, 025–029, 045–048; B1 defects BUG-049..059.

**Known issues**
- BUG-060 (LOW): a rule label in the launch-checklist inspector can break mid-word.
- Security fixes from the B1 review (key market scope, tenant-wide approvers, proxy-aware client address, limiter for keys outside their allow-list) are in the code and pending confirmation.

## Earlier
- Engineering workspace, readiness assessment, verified context briefs.
