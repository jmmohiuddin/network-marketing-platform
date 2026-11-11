# security — AUDIT_RESULTS

_Agent: security. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## 2026-11-12 — Adversarial review of packages/db (T-A01), read-only
Scope: migrations 0001–0006, pool.ts, migrate.ts, testing.ts, tests. Probed as nmp_app on nmp_test (all probes rolled back); suite 90/90.
Clean: every table ENABLE+FORCE RLS; every tenant_id table has USING+WITH CHECK; all 9 SECURITY DEFINER functions pin search_path and are revoked from PUBLIC; set_config values are bound parameters and transaction-local; audit/outbox/approval/tenant_setting_version have no UPDATE/DELETE grant; --reset checks current_database(); tests run as nmp_app (vitest env overrides shell env).
Findings (verified):
- HIGH support_session: vendor realm can INSERT state='active' or UPDATE requested->approved with decided_by = itself. Tenant approval gate (SEC-02) is not enforced in SQL.
- MEDIUM single-column FKs: tenant A can insert role_assignment / approval / import_batch / session rows pointing at tenant B or vendor ids; auth_find_session returns a session with tenant A + tenant B user. Also an existence oracle.
- MEDIUM tenant_isolation policies ignore app.realm; withVendor/withSystem never clear app.tenant_id.
- MEDIUM vacuous tests: vendor "cannot read" on 10 empty tables; no-context checks on empty role/session/vendor_event; policy test does not reject an extra permissive policy.
- LOW audit.verify_audit_chain returns NULL (intact) when the caller sees no rows (system realm / wrong tenant).
- LOW outbox_settle revives dead rows.
- LOW --reset allows any nmp_* name (nmp_prod), script default is .env = nmp_dev.
Not checked: behaviour with a non-superuser owner role; concurrency of the audit chain; apps/api usage.
