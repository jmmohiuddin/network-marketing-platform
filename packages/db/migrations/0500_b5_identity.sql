-- B5 portal identity (PLAN B5 section 1.1; D-B5-02..05): portal accounts are user_account rows of realm 'portal' linked to
-- one participant; their transactions stay in the tenant realm and carry app.participant_id, which the RESTRICTIVE
-- self policies (0501..0504, with their tables) read. Sign-in codes, the portal session functions and the lookups the
-- portal and the public privacy form need before or outside a staff context.

-- 1. Context helpers: the session participant of a portal transaction, and the realm a session of it belongs to.
CREATE FUNCTION app_participant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.participant_id', true), '')::uuid
$$;

CREATE FUNCTION app_session_realm() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN app_realm() = 'tenant' AND app_participant_id() IS NOT NULL THEN 'portal' ELSE app_realm() END
$$;

-- 2. user_account: a portal account belongs to exactly one participant of its tenant; emails are unique per realm, and
-- among portal accounts only while not deactivated (a re-invitation creates a new row, D-B5-05; C-B5-14).
ALTER TABLE user_account
  ADD CONSTRAINT user_account_portal_participant CHECK ((realm = 'portal') = (participant_id IS NOT NULL)),
  ADD FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  DROP CONSTRAINT user_account_tenant_email_key;
CREATE UNIQUE INDEX user_account_tenant_email ON user_account (tenant_id, email) WHERE realm = 'tenant';
CREATE UNIQUE INDEX user_account_portal_email_open ON user_account (tenant_id, email)
  WHERE realm = 'portal' AND state <> 'deactivated';
CREATE UNIQUE INDEX user_account_portal_participant_open ON user_account (tenant_id, participant_id)
  WHERE realm = 'portal' AND state <> 'deactivated';

-- The runtime role may update user_account (0006); an account never moves to another realm, tenant or participant, so
-- the self scope of a portal session cannot be redirected.
CREATE FUNCTION user_account_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.realm, NEW.tenant_id, NEW.participant_id) IS DISTINCT FROM (OLD.realm, OLD.tenant_id, OLD.participant_id) THEN
    RAISE EXCEPTION 'an account keeps its realm, tenant and participant' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_account_identity_pinned BEFORE UPDATE ON user_account
  FOR EACH ROW EXECUTE FUNCTION user_account_identity_guard();

-- Portal accounts hold no role (D-B5-02).
CREATE FUNCTION role_assignment_staff_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM user_account u WHERE u.id = NEW.user_id AND u.realm = 'portal') THEN
    RAISE EXCEPTION 'a portal account holds no role' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER role_assignment_staff_only BEFORE INSERT OR UPDATE OF user_id ON role_assignment
  FOR EACH ROW EXECUTE FUNCTION role_assignment_staff_only();

-- 3. Sign-in lookup per realm (replaces the 2-argument form of 0044). participant_active is true for staff and vendor
-- accounts; for a portal account it is false once its participant is merged or pseudonymised.
DROP FUNCTION auth_find_user(text, text);
CREATE FUNCTION auth_find_user(p_realm text, p_tenant_slug text, p_email text)
RETURNS TABLE (user_id uuid, tenant_id uuid, realm text, state text, mfa_enrolled boolean, password_hash text,
               tenant_state text, participant_id uuid, participant_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT u.id, u.tenant_id, u.realm, u.state, u.mfa_enrolled, c.password_hash, t.state, u.participant_id,
           u.participant_id IS NULL OR (p.status = 'active' AND p.pseudonymised_at IS NULL)
    FROM user_account u
    LEFT JOIN tenant t ON t.id = u.tenant_id
    LEFT JOIN password_credential c ON c.user_id = u.id
    LEFT JOIN participant p ON p.tenant_id = u.tenant_id AND p.id = u.participant_id
    WHERE u.realm = p_realm AND u.email = lower(p_email)
      AND CASE WHEN p_tenant_slug IS NULL THEN u.tenant_id IS NULL ELSE t.slug = p_tenant_slug END
    ORDER BY u.state = 'deactivated', u.created_at DESC
    LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION auth_find_user(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(text, text, text) TO nmp_app;

-- 4. Sessions: the realm of a session is the session realm of its transaction (a portal transaction opens a portal
-- session); a portal account's session belongs to its own participant.
CREATE OR REPLACE FUNCTION auth_open_session(p_token_hash bytea, p_minutes integer, p_ip inet, p_user_agent text,
                                             OUT session_id uuid, OUT session_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  u user_account;
BEGIN
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 720 THEN
    RAISE EXCEPTION 'a session lasts between 1 and 720 minutes' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO u FROM user_account a
  WHERE a.id = app_user_id() AND a.realm = app_session_realm() AND a.state = 'active'
    AND (a.realm = 'vendor' OR a.tenant_id = app_tenant_id())
    AND (a.realm <> 'portal' OR a.participant_id = app_participant_id());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a session is opened only for the active acting user, in its own realm'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, expires_at, ip, user_agent)
  VALUES (p_token_hash, u.id, u.tenant_id, u.realm, 'aal1', now() + make_interval(mins => p_minutes), p_ip, p_user_agent)
  RETURNING id, expires_at INTO session_id, session_expires_at;
END $$;

-- The acting user's own live session in its session realm (0040's body otherwise unchanged).
CREATE FUNCTION auth_own_live_session(p_session_id uuid) RETURNS session
LANGUAGE sql SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT s.* FROM session s
  WHERE s.id = p_session_id AND s.user_id = app_user_id() AND s.realm = app_session_realm()
    AND s.tenant_id IS NOT DISTINCT FROM app_tenant_id() AND s.revoked_at IS NULL AND s.expires_at > now()
    AND (s.realm <> 'portal'
         OR EXISTS (SELECT 1 FROM user_account u WHERE u.id = s.user_id AND u.participant_id = app_participant_id()))
  FOR UPDATE
$$;

CREATE OR REPLACE FUNCTION auth_elevate_session(p_session_id uuid, p_new_token_hash bytea,
                                                OUT session_id uuid, OUT session_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s session;
BEGIN
  s := auth_own_live_session(p_session_id);
  IF s.id IS NULL THEN
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

-- D-B5-04: a portal user re-proved its password (the caller checked it): a fresh step_up_at, assurance unchanged.
CREATE FUNCTION auth_reauth_session(p_session_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s session;
  stepped_up_at timestamptz;
BEGIN
  s := auth_own_live_session(p_session_id);
  IF s.id IS NULL OR s.realm <> 'portal' THEN
    RAISE EXCEPTION 'only the acting portal user''s own live session is re-authenticated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE session SET step_up_at = now() WHERE id = s.id RETURNING step_up_at INTO stepped_up_at;
  RETURN stepped_up_at;
END $$;

REVOKE ALL ON FUNCTION auth_own_live_session(uuid), auth_reauth_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_reauth_session(uuid) TO nmp_app;

-- 5. portal_sign_in_code (D-B5-03): only a hash of the code; one more attempt at a time, used once; deleted on erasure.
CREATE TABLE portal_sign_in_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL,
  code_hash bytea NOT NULL CHECK (length(code_hash) = 32),
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  FOREIGN KEY (tenant_id, user_id) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX portal_sign_in_code_open_idx ON portal_sign_in_code (user_id) WHERE used_at IS NULL;

CREATE FUNCTION portal_sign_in_code_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_account u WHERE u.id = NEW.user_id AND u.realm = 'portal')
     OR NEW.attempts <> 0 OR NEW.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'a sign-in code is issued unused, to a portal account' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER portal_sign_in_code_insert_guard BEFORE INSERT ON portal_sign_in_code
  FOR EACH ROW EXECUTE FUNCTION portal_sign_in_code_insert_guard();

CREATE FUNCTION portal_sign_in_code_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  checking_fields constant text[] := ARRAY['attempts', 'used_at'];
BEGIN
  IF to_jsonb(NEW) - checking_fields IS DISTINCT FROM to_jsonb(OLD) - checking_fields
     OR NEW.attempts NOT IN (OLD.attempts, OLD.attempts + 1)
     OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at) THEN
    RAISE EXCEPTION 'a sign-in code counts one attempt at a time and is used once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER portal_sign_in_code_guard BEFORE UPDATE ON portal_sign_in_code
  FOR EACH ROW EXECUTE FUNCTION portal_sign_in_code_guard();

SELECT apply_tenant_rls('portal_sign_in_code');
GRANT SELECT, INSERT, DELETE ON portal_sign_in_code TO nmp_app;
GRANT UPDATE (attempts, used_at) ON portal_sign_in_code TO nmp_app;

-- 6. Portal reads (INVOKER: the caller's RLS applies).
-- The session participant's identity strip and navigation facts (D-B5-02, D-B5-06, UI_UX section 4.4).
CREATE FUNCTION portal_profile(p_participant uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH owned AS (
    SELECT p.id, p.position_ref, p.status, m.code AS market_code
    FROM position_ownership o
    JOIN position p ON p.tenant_id = o.tenant_id AND p.id = o.position_id
    JOIN market m ON m.tenant_id = p.tenant_id AND m.id = p.market_id
    WHERE o.participant_id = p_participant AND o.valid_from <= now() AND (o.valid_to IS NULL OR o.valid_to > now())
  )
  SELECT jsonb_build_object(
    'participant_id', x.id, 'display_name', x.display_name, 'external_ref', x.external_ref,
    'pseudonymised', x.pseudonymised_at IS NOT NULL,
    'market', jsonb_build_object('id', m.id, 'code', m.code, 'currency', m.currency, 'minor_unit', m.minor_unit,
                                 'time_zone', m.time_zone),
    'positions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'position_ref', o.position_ref,
                                                               'status', o.status, 'market_code', o.market_code)
                                            ORDER BY o.position_ref) FROM owned o), '[]'),
    'can_sponsor', coalesce((SELECT t.can_sponsor FROM par_type_at(x.id, now()) t), false),
    'has_downline', EXISTS (
      SELECT 1 FROM owned o JOIN relationship r ON r.parent_position_id = o.id
      WHERE r.kind = 'sponsor' AND r.superseded_at IS NULL AND r.valid_from <= now()
        AND (r.valid_to IS NULL OR r.valid_to > now())),
    'terminated', NOT EXISTS (SELECT 1 FROM owned o WHERE o.status <> 'terminated'))
  FROM participant x JOIN market m ON m.tenant_id = x.tenant_id AND m.id = x.market_id
  WHERE x.id = p_participant
$$;

-- D-B5-05 eligibility facts for a portal invitation.
CREATE FUNCTION portal_invite_target(p_participant uuid)
RETURNS TABLE (market_id uuid, email text, can_earn boolean, active boolean, pseudonymised boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT x.market_id, x.contact ->> 'email', coalesce((SELECT t.can_earn FROM par_type_at(x.id, now()) t), false),
         x.status = 'active', x.pseudonymised_at IS NOT NULL
  FROM participant x WHERE x.id = p_participant
$$;

-- 7. The public privacy form names a tenant by slug before any tenant context exists (system realm only; the system
-- realm cannot read tenant rows, 0006).
CREATE FUNCTION tenant_by_slug(p_slug text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  found uuid;
BEGIN
  PERFORM require_system_realm();
  SELECT t.id INTO found FROM tenant t WHERE t.slug = p_slug AND t.state NOT IN ('provisioning', 'archived');
  RETURN found;
END $$;
REVOKE ALL ON FUNCTION tenant_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_by_slug(text) TO nmp_app;

-- 8. Self scope (D-B5-02 (2)): inside a portal transaction the money and case tables show and accept only the session
-- participant's rows; no-ops when app_participant_id() is unset (staff, jobs). A portal transaction never approves.
CREATE POLICY portal_self ON result_line AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR payee_participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR payee_participant_id = app_participant_id());
CREATE POLICY portal_self ON run_settlement AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR payee_participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR payee_participant_id = app_participant_id());
CREATE POLICY portal_self ON payout_instruction AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR payee_participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR payee_participant_id = app_participant_id());
CREATE POLICY portal_self ON ledger_account AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR payee_participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR payee_participant_id = app_participant_id());
CREATE POLICY portal_self ON posting AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM ledger_account a WHERE a.id = posting.account_id AND a.payee_participant_id = app_participant_id()))
  WITH CHECK (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM ledger_account a WHERE a.id = posting.account_id AND a.payee_participant_id = app_participant_id()));
CREATE POLICY portal_self ON bank_detail_request AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR participant_id = app_participant_id());
CREATE POLICY portal_self ON bank_detail_version AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR participant_id = app_participant_id());
CREATE POLICY portal_self ON tax_profile AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR participant_id = app_participant_id());
-- Every case type a portal flow opens or reads carries payload.participant_id.
CREATE POLICY portal_self ON case_file AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR payload ->> 'participant_id' = app_participant_id()::text)
  WITH CHECK (app_participant_id() IS NULL OR payload ->> 'participant_id' = app_participant_id()::text);
CREATE POLICY portal_self ON case_event AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM case_file c WHERE c.id = case_event.case_id AND c.payload ->> 'participant_id' = app_participant_id()::text))
  WITH CHECK (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM case_file c WHERE c.id = case_event.case_id AND c.payload ->> 'participant_id' = app_participant_id()::text));
CREATE POLICY portal_never_approves ON approval AS RESTRICTIVE FOR INSERT WITH CHECK (app_participant_id() IS NULL);
