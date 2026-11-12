# qa — OPEN_ISSUES

_Agent: qa. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## 2026-11-12 — packages/compliance review findings (all verified by probe)
- MEDIUM r4.ts: `activePvMinor: null` at runtime (e.g. unset JSON setting) is treated as threshold 0 — every earner with an order becomes active, nothing omitted. Null `personalShareFlag` / `rankThresholdsPvMinor` throw raw TypeError. validateConfig does not check types or negative thresholds.
- MEDIUM r4.ts: same-day orders tie-break by orderRef, prototype by file order. `of_which_refunded_later` and the crossing drill id differ when ids are not in file order (file [O2 4000, O1 2000 refunded], day 28: prototype 1/1, package 1/0). Fact table has no row sequence; method text does not state the tie-break.
- LOW r5.ts: payout lines to payees outside the R5 population (non-earning type, or ref not in participants) are dropped silently; R5 total no longer reconciles to R3 and no note says so.
- LOW r5.ts/r3.ts: partial-year label lives only on ReportPeriod; every Figure.note is null, while spec 5.1 puts the partial-year text in compliance_figure.note. R5 is also emitted for a year with zero payout lines (0.00 % earners, mean 0.00).
- LOW golden.test.ts: R5 population assertion is vacuous (`typeof population === 'string'`); R2 has no figure-count check.

## 2026-11-12 — T-A07 observations (not registered as bugs)
- Catalogue question (E-ADR-09): SDD-10 gives Tenant admin "full" on Audit log, but audit export needs audit.read + export and Tenant admin lacks export. Product to confirm.
- By design, pinned by the suites: a vendor without session sees support-session metadata incl. decided_by (a tenant admin's user id) and breach contacts; in a session the vendor cannot download the tenant's audit exports (requester-only, 404) and cannot use vendor routes while sending X-Support-Session (REALM_FORBIDDEN, logged).
- Not covered by TS-21 here: job/outbox payload namespacing and upload paths (SEC-29), timing side channels, API keys (rel B). Rel-B routes must add cases when they land.

## 2026-11-12 — Browser E2E follow-ups
- BUG-010 (HIGH) blocks AC-36.1 for Compliance officer/Finance approver/DPO/Payout officer in every tenant whose admins are Tenant admins only. Retest W3 after fix.
- Not exercised: step-up on grant approval/vendor-access approval (admins had stepped up < 10 min before; step-up shown on revoke), support-session auto-expiry, go-live, rejection of a request by deny, more than 50,000-row export.
- Observation (by design E-ADR-25, not registered): saving an unapproved mapping draft marks every ready snapshot Outdated.

## 2026-11-12 — After browser retest R2
- BUG-024 (MEDIUM): console provisioning cannot name a second admin, so new tenants deadlock on every privileged grant. Retest W1/W2 after the web form sends `second_admin`.
- BUG-023 open part: tenant request card shows "Vendor user <id>" (needs requester name in the API).
- Still not exercised: support-session auto-expiry, go-live, >50,000-row export, vendor-user re-invite/deactivate of a non-last user.

## 2026-11-12 — After browser retest R3
- Open web defects: BUG-023 (requester name, needs API), 025, 026, 027, 028, 029, 030.
- Observation (not registered): a mapping draft link /imports/mappings?version=… is "Not found" for the approver (no import.manage); the approver must use /compliance/mappings?version=…. The editor tells the author another user must approve, but gives no shareable link that works for them.
- Still not exercised: support-session auto-expiry, go-live, >50,000-row export, LAST_ADMIN (unreachable while two admins exist: SECOND_ADMIN_REQUIRED first).
