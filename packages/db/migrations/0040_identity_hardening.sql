-- Identity hardening (T-A07b): BUG-001..004 of engineering/BUG_REGISTER.md.

-- The acting user (withTenant / withVendor set app.user_id); NULL when unset.
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- BUG-001: a vendor user files support requests in its own name only. Outside the vendor realm the 0011 trigger
-- already says so; this is the vendor-realm half.
ALTER POLICY vendor_request ON support_session
  WITH CHECK (app_realm() = 'vendor' AND requester_id = app_user_id() AND state = 'requested' AND decided_by IS NULL
              AND starts_at IS NULL AND ends_at IS NULL
              AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = requester_id AND u.realm = 'vendor'));

-- BUG-002: a password hash or sealed TOTP secret is reachable only by its own user, and only in that user's realm
-- (the user row must be visible too). Sign-in reads the hash through auth_find_user.
DROP POLICY owner_visible ON password_credential;
CREATE POLICY acting_user ON password_credential
  USING (user_id = app_user_id() AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = user_id))
  WITH CHECK (user_id = app_user_id() AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = user_id));
DROP POLICY owner_visible ON mfa_credential;
CREATE POLICY acting_user ON mfa_credential
  USING (user_id = app_user_id() AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = user_id))
  WITH CHECK (user_id = app_user_id() AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = user_id));

-- BUG-003: the runtime role may only touch a session (last_seen_at) and revoke it. Assurance changes go through
-- auth_elevate_session. The trigger holds for every role: a session keeps its identity, its expiry only moves
-- earlier and a revocation is final.
REVOKE UPDATE ON session FROM nmp_app;
GRANT UPDATE (last_seen_at, revoked_at) ON session TO nmp_app;

CREATE FUNCTION session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.token_hash, NEW.user_id, NEW.tenant_id, NEW.realm, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.token_hash, OLD.user_id, OLD.tenant_id, OLD.realm, OLD.created_at)
     OR NEW.expires_at > OLD.expires_at
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'a session keeps its identity; its expiry only moves earlier and a revocation is final'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_identity_pinned BEFORE UPDATE ON session FOR EACH ROW EXECUTE FUNCTION session_guard();

-- A second factor was verified now for the acting user's own live session (FR-IAM-002). The caller checked the
-- code; this records it: AAL2 and a fresh step_up_at. With p_new_token_hash the session is replaced by a new
-- row under that token and the old one revoked (ASVS V3.2.1: a token seen before MFA never reaches AAL2); the
-- new row keeps the sign-in time and absolute expiry. Without it (step-up) the session must already be AAL2.
CREATE FUNCTION auth_elevate_session(p_session_id uuid, p_new_token_hash bytea,
                                     OUT session_id uuid, OUT session_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s session;
BEGIN
  SELECT * INTO s FROM session
  WHERE id = p_session_id AND user_id = app_user_id() AND realm = app_realm()
    AND tenant_id IS NOT DISTINCT FROM app_tenant_id() AND revoked_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only the acting user''s own live session can be elevated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_new_token_hash IS NULL THEN
    IF s.assurance_level <> 'aal2' THEN
      RAISE EXCEPTION 'a step-up without a new token needs an AAL2 session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE session SET step_up_at = now() WHERE id = s.id;
    session_id := s.id;
    session_expires_at := s.expires_at;
    RETURN;
  END IF;
  UPDATE session SET revoked_at = now() WHERE id = s.id;
  INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, mfa_verified_at, step_up_at, created_at,
                       expires_at, ip, user_agent)
  VALUES (p_new_token_hash, s.user_id, s.tenant_id, s.realm, 'aal2', coalesce(s.mfa_verified_at, now()), now(),
          s.created_at, s.expires_at, s.ip, s.user_agent)
  RETURNING id, expires_at INTO session_id, session_expires_at;
END $$;

-- BUG-004: sessions of users who are not active, or of archived tenants, do not resolve ...
CREATE OR REPLACE FUNCTION auth_find_session(p_token_hash bytea) RETURNS SETOF session
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT s.* FROM session s
    JOIN user_account u ON u.id = s.user_id
    LEFT JOIN tenant t ON t.id = s.tenant_id
    WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now()
      AND u.state = 'active' AND (s.tenant_id IS NULL OR t.state <> 'archived');
END $$;

-- ... and are revoked in the transaction that closes the account. SECURITY DEFINER: a tenant is archived in the
-- vendor realm, which cannot see tenant sessions.
CREATE FUNCTION revoke_sessions_of_closed_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'tenant' THEN
    UPDATE session SET revoked_at = now() WHERE tenant_id = NEW.id AND revoked_at IS NULL;
  ELSE
    UPDATE session SET revoked_at = now() WHERE user_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER user_account_closed_revokes_sessions AFTER UPDATE OF state ON user_account
  FOR EACH ROW WHEN (NEW.state <> 'active') EXECUTE FUNCTION revoke_sessions_of_closed_account();
CREATE TRIGGER tenant_archived_revokes_sessions AFTER UPDATE OF state ON tenant
  FOR EACH ROW WHEN (NEW.state = 'archived') EXECUTE FUNCTION revoke_sessions_of_closed_account();

REVOKE ALL ON FUNCTION auth_elevate_session(uuid, bytea), revoke_sessions_of_closed_account(), session_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_elevate_session(uuid, bytea) TO nmp_app;
