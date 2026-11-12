-- BUG-003, second half (review 2026-11-12): 0040 pinned UPDATE, but nmp_app could still INSERT a session with any
-- user of its tenant, AAL2, factor and step-up times and any expiry, and could move last_seen_at into the future
-- (which switches the idle timeout off). Sessions are now opened only through auth_open_session, and only at AAL1;
-- AAL2 is reached only through auth_elevate_session (0040).
REVOKE INSERT ON session FROM nmp_app;

-- Opens an AAL1 session for the acting user (app.user_id) in its own realm and tenant: no factor, no step-up,
-- created and last seen now, expiring after p_minutes. 720 minutes (12 h) is the ceiling: the NIST SP 800-63B AAL2
-- reauthentication bound, which a session keeps when elevated; SESSION_ABSOLUTE_MINUTES cannot exceed it
-- (apps/api config.ts).
CREATE FUNCTION auth_open_session(p_token_hash bytea, p_minutes integer, p_ip inet, p_user_agent text,
                                  OUT session_id uuid, OUT session_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  u user_account;
BEGIN
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 720 THEN
    RAISE EXCEPTION 'a session lasts between 1 and 720 minutes' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO u FROM user_account a
  WHERE a.id = app_user_id() AND a.realm = app_realm() AND a.state = 'active'
    AND (a.realm = 'vendor' OR a.tenant_id = app_tenant_id());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a session is opened only for the active acting user, in its own realm'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, expires_at, ip, user_agent)
  VALUES (p_token_hash, u.id, u.tenant_id, u.realm, 'aal1', now() + make_interval(mins => p_minutes), p_ip, p_user_agent)
  RETURNING id, expires_at INTO session_id, session_expires_at;
END $$;

-- 0040's guard, plus: last_seen_at never moves into the future (touch() sets it to now()).
CREATE OR REPLACE FUNCTION session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.token_hash, NEW.user_id, NEW.tenant_id, NEW.realm, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.token_hash, OLD.user_id, OLD.tenant_id, OLD.realm, OLD.created_at)
     OR NEW.expires_at > OLD.expires_at
     OR (NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at AND NEW.last_seen_at > now())
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'a session keeps its identity; its expiry only moves earlier, it is never last seen in the future and a revocation is final'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION auth_open_session(bytea, integer, inet, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_open_session(bytea, integer, inet, text) TO nmp_app;
