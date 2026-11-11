-- Row-level security, pre-context auth entry points, and runtime-role grants.
-- Vendor realm (app.realm = 'vendor') reaches tenant metadata and vendor-owned rows only; never business data.

-- Standard tenant isolation.
SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
  'market', 'tenant_setting_version', 'user_account', 'role', 'role_assignment', 'approval', 'support_session',
  'session', 'audit.audit_event', 'document', 'import_batch', 'import_row_error', 'import_mapping',
  'cpl_fact_participant', 'cpl_fact_order', 'cpl_fact_payout_line', 'compliance_report_snapshot',
  'compliance_figure', 'outbox_event', 'export_job', 'idempotency_key'
]::regclass[]) AS t;

-- tenant: a tenant reads its own row; the vendor realm manages all rows.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_read ON tenant FOR SELECT USING (app_realm() = 'tenant' AND id = app_tenant_id());
CREATE POLICY vendor_manage ON tenant USING (app_realm() = 'vendor') WITH CHECK (app_realm() = 'vendor');

CREATE POLICY vendor_read ON market FOR SELECT USING (app_realm() = 'vendor');

-- E-ADR-08: vendor users (tenant_id NULL) are reachable only in the vendor realm.
CREATE POLICY vendor_users ON user_account
  USING (app_realm() = 'vendor' AND tenant_id IS NULL)
  WITH CHECK (app_realm() = 'vendor' AND tenant_id IS NULL);

-- E-ADR-08: tenants read platform base roles but cannot change them; the vendor realm maintains them.
CREATE POLICY base_role_read ON role FOR SELECT
  USING (tenant_id IS NULL AND is_base AND app_realm() = 'tenant');
CREATE POLICY vendor_platform_roles ON role
  USING (app_realm() = 'vendor' AND tenant_id IS NULL)
  WITH CHECK (app_realm() = 'vendor' AND tenant_id IS NULL);

-- Support sessions (SECURITY_IAM_TENANCY 5.1): the vendor realm reads them, files a request and ends an
-- active session. Approval, denial and activation happen in the tenant realm only, so vendor staff
-- cannot grant themselves access. support_session_vendor_guard (0002) pins the other columns.
CREATE POLICY vendor_read ON support_session FOR SELECT USING (app_realm() = 'vendor');
CREATE POLICY vendor_request ON support_session FOR INSERT
  WITH CHECK (app_realm() = 'vendor' AND state = 'requested' AND decided_by IS NULL
              AND starts_at IS NULL AND ends_at IS NULL
              AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = requester_id AND u.realm = 'vendor'));
CREATE POLICY vendor_end ON support_session FOR UPDATE
  USING (app_realm() = 'vendor' AND state = 'active')
  WITH CHECK (app_realm() = 'vendor' AND state = 'ended');

CREATE POLICY vendor_sessions ON session
  USING (app_realm() = 'vendor' AND tenant_id IS NULL)
  WITH CHECK (app_realm() = 'vendor' AND tenant_id IS NULL);

ALTER TABLE audit.vendor_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.vendor_event FORCE ROW LEVEL SECURITY;
CREATE POLICY vendor_only ON audit.vendor_event
  USING (app_realm() = 'vendor') WITH CHECK (app_realm() = 'vendor');

-- Credentials follow the visibility of their user_account row.
ALTER TABLE password_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_credential FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_visible ON password_credential
  USING (EXISTS (SELECT 1 FROM user_account u WHERE u.id = user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM user_account u WHERE u.id = user_id));

ALTER TABLE mfa_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_credential FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_visible ON mfa_credential
  USING (EXISTS (SELECT 1 FROM user_account u WHERE u.id = user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM user_account u WHERE u.id = user_id));

-- No policy and no grant: reachable only through the auth_* functions below.
ALTER TABLE login_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempt FORCE ROW LEVEL SECURITY;

-- Pre-context auth entry points. Each is SECURITY DEFINER, answers one exact-match question,
-- and refuses to run outside the system realm (withSystem).

-- p_tenant_slug NULL looks up a vendor user.
CREATE FUNCTION auth_find_user(p_tenant_slug text, p_email text)
RETURNS TABLE (user_id uuid, tenant_id uuid, realm text, state text, mfa_enrolled boolean,
               password_hash text, tenant_state text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT u.id, u.tenant_id, u.realm, u.state, u.mfa_enrolled, c.password_hash, t.state
    FROM user_account u
    LEFT JOIN tenant t ON t.id = u.tenant_id
    LEFT JOIN password_credential c ON c.user_id = u.id
    WHERE u.email = lower(p_email)
      AND CASE WHEN p_tenant_slug IS NULL THEN u.tenant_id IS NULL ELSE t.slug = p_tenant_slug END;
END $$;

-- Returns the session only while it is neither revoked nor past its absolute expiry.
CREATE FUNCTION auth_find_session(p_token_hash bytea) RETURNS SETOF session
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT * FROM session s
    WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now();
END $$;

CREATE FUNCTION auth_record_login_attempt(p_account_key text, p_ip inet, p_succeeded boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  INSERT INTO login_attempt (account_key, ip, succeeded) VALUES (p_account_key, p_ip, p_succeeded);
END $$;

-- Failed attempts since p_since, counting only those after the most recent success.
CREATE FUNCTION auth_count_recent_failures(p_account_key text, p_since timestamptz) RETURNS int
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN (
    SELECT count(*)::int FROM login_attempt a
    WHERE a.account_key = p_account_key AND NOT a.succeeded AND a.attempted_at > p_since
      AND a.attempted_at > coalesce(
        (SELECT max(s.attempted_at) FROM login_attempt s WHERE s.account_key = p_account_key AND s.succeeded),
        '-infinity')
  );
END $$;

REVOKE ALL ON FUNCTION
  auth_find_user(text, text), auth_find_session(bytea), auth_record_login_attempt(text, inet, boolean),
  auth_count_recent_failures(text, timestamptz), outbox_claim(int), outbox_settle(uuid, boolean, timestamptz),
  tenant_region_guard(), audit.audit_event_chain(), audit.vendor_event_chain()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  auth_find_user(text, text), auth_find_session(bytea), auth_record_login_attempt(text, inet, boolean),
  auth_count_recent_failures(text, timestamptz), outbox_claim(int), outbox_settle(uuid, boolean, timestamptz)
  TO nmp_app;

-- Runtime-role grants: the minimum each table's mutability class allows. No TRUNCATE, no DDL.
GRANT SELECT, INSERT, UPDATE, DELETE ON market, role, import_mapping, mfa_credential, idempotency_key TO nmp_app;
GRANT SELECT, INSERT, UPDATE ON tenant, user_account, role_assignment, support_session, session,
  password_credential, document, import_batch, compliance_report_snapshot, export_job TO nmp_app;
GRANT SELECT, INSERT, DELETE ON cpl_fact_participant, cpl_fact_order, cpl_fact_payout_line TO nmp_app;
-- Insert-only: approvals, setting versions, derived findings and figures, outbox history, audit.
GRANT SELECT, INSERT ON approval, tenant_setting_version, import_row_error, compliance_figure, outbox_event,
  audit.audit_event, audit.vendor_event TO nmp_app;
GRANT USAGE ON SEQUENCE outbox_event_seq_seq TO nmp_app;
