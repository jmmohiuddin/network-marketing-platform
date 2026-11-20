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

## 2026-11-12 — After UI round 1
- Open web defects: BUG-032..043 (SC-10 needs most work), plus 023, 025..030.
- Ask API owner: in a support session scoped to "Compliance reports", GET /v1/settings/compliance.* returns 200 (other settings refused) — intended?
- Round 2 must cover: step-up dialog (act > 10 min after MFA), BUG-030, export cap, SC-14 capture with a pending request, SC-28 approvals tab capture.

## 2026-11-12 — After UI round 2
- Open web defects: BUG-044 (MEDIUM), 045–048, plus 023, 025–029. BUG-030 not reproduced (status left Open for the owner to close).
- Still not exercised: support-session auto-expiry, go-live, >50,000-row export, grant rejection.

## 2026-11-12 — After UI round 3
- Open web defects: 023, 025–029, 045–048 (BUG-030 not reproduced twice; owner to close). No new ones.
- Still not exercised: support-session auto-expiry, go-live, >50,000-row export.

## 2026-11-12 — Final (after reports finalised)
- Unchanged from round 3: open LOW web defects 023, 025–029, 045–048; BUG-030 to be closed by its owner. Not exercised: auto-expiry, go-live, >50,000-row export, Impeccable Performance.

## 2026-11-17 — After B1 round 1
- Open: BUG-049 (approver stored as version author), BUG-050 (rebased version diff vs wrong base), BUG-051 (SC-17 page scroll at 390) MEDIUM; BUG-052..059 LOW. BUG-030 still not retested.
- Not exercised: webhook secret rotation, delivery `dead` after 72 h, withdraw change/go-live, go-live rejection, calendar/brand delete+rename, key rate-limit 429, SCOPE_MISSING (needs a second scope, B2).

## 2026-11-17 — After B1 round 2
- Open: BUG-060 LOW only (B1). BUG-049..059 verified fixed. BUG-030 still not retested.
- Not exercised: delivery `dead` after 72 h, withdraw change/go-live, go-live rejection, calendar delete, brand rename/delete, key 429, SCOPE_MISSING, server-side BUG-055 mapping.

## 2026-11-17 — After B2 round 1
- Open: BUG-069 MEDIUM; BUG-070..080 LOW (B2 web). B1 BUG-060 not retested this round.
- Not exercised: WooCommerce, connector rotate/withdraw, webhook refunds/cancel, merge/terminate duplicate outcomes, servicing/type change dialogs, later agreement acceptance, sync behind/held-24h, support session on B2 pages, placement tree + known-at, affected committed periods list.
- 2026-11-18 B3 round 1: open BUG-084 (CRITICAL, volume × quantity twice), 085 (seed settings), 086 (consumed_by_run_id), 087 (enrol dialog width), 088 (rule event not shown), 089 (SC-01 table), 090–093 LOW. Not executed: WooCommerce, duplicate merge/terminate, BUG-081/082/083 re-checks, plan Reject/Compare/golden upload/pools/CSV exports, support-session view of B3 pages.
- 2026-11-18 B3 round 3: BUG-094 verified fixed. Open B3 web: BUG-095, 096, 097, 098 (LOW), 093 web part; engine text 090/092. Not executed in round 3: row Calculate/Re-run, restatement submit, W-B3-1..3/6/8 (unchanged since round 2), plus the round-1 not-executed list.
- 2026-11-19 B5 round 2: open B5 = BUG-112 API part (UTC days in team enrolled_on, explanation text, mail expiry ISO), BUG-119 API part (explanation text engine wording), BUG-120 LOW. Not executed in round 2: DE-C lockout, globex portal user, import mapping/load/snapshot, B4 not-exercised paths, BUG-093/095..098 re-checks.
- B6 r1 open: BUG-121 (compliance cannot approve filing-requirements setting in UI), BUG-122 (migration mapping not listed for the approver), BUG-123..127 LOW. Not executed in B6 r1: portal SEC-B5 checks, BUG-112/119 API parts, webhook delivery of period.closed, DE-C portal inbox.
