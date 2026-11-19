-- B5 review fixes: the database itself keeps a portal session to its own rows and its own flows, whatever a portal route
-- does. Self-service bank versions wait the cooling-off and never bypass the shared-account review (BR-PAY-08,
-- D-B5-12); system-opened cases and case events are only the ones the flows write (D-B5-12, D-B5-15, D-B5-16); the self
-- scope covers every table holding another person's data (D-B5-02 (2)); erasure waits for open runs and clears session
-- and notice traces (D-B5-18); a deactivated portal account stays closed (D-B5-05); the erasure exemptions name the owner.

-- 1. The owner role (migrations and the SECURITY DEFINER functions) is the only one the erasure and correction
-- exemptions admit: an allow-list, so a future runtime role gets no exemption.
CREATE FUNCTION acting_as_owner() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_user = pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = 'public.participant'::regclass
$$;

CREATE OR REPLACE FUNCTION erasure_clears_only(p_old jsonb, p_new jsonb, p_cleared text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT acting_as_owner() AND p_new - p_cleared = p_old - p_cleared
     AND NOT EXISTS (SELECT 1 FROM unnest(p_cleared) c WHERE p_new -> c <> 'null'::jsonb)
$$;

CREATE OR REPLACE FUNCTION participant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  merge_fields constant text[] := ARRAY['status', 'merged_into_id'];
  personal_fields constant text[] := ARRAY['display_name', 'contact', 'identity_doc_id', 'pseudonymised_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on participant is not allowed';
  END IF;
  IF (OLD.status = 'active' AND NEW.status = 'merged' AND to_jsonb(NEW) - merge_fields = to_jsonb(OLD) - merge_fields)
     OR (acting_as_owner() AND OLD.pseudonymised_at IS NULL
         AND to_jsonb(NEW) - personal_fields = to_jsonb(OLD) - personal_fields
         AND CASE WHEN NEW.pseudonymised_at IS NULL THEN NEW.identity_doc_id IS NOT DISTINCT FROM OLD.identity_doc_id
                  ELSE num_nulls(NEW.display_name, NEW.contact, NEW.identity_doc_id) = 3 END) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a participant changes only by a merge, once (or by its erasure or correction)' USING ERRCODE = 'check_violation';
END $$;

-- 2. D-B5-05: a deactivated portal account is never reactivated or changed; a portal account's email and IdP subject
-- change only by erasure (owner), its Firebase subject is linked once (sign-in.ts bindFirebase).
CREATE OR REPLACE FUNCTION user_account_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.realm, NEW.tenant_id, NEW.participant_id) IS DISTINCT FROM (OLD.realm, OLD.tenant_id, OLD.participant_id) THEN
    RAISE EXCEPTION 'an account keeps its realm, tenant and participant' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.realm = 'portal' AND NOT acting_as_owner()
     AND ((OLD.state = 'deactivated' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
          OR (NEW.email, NEW.idp_subject) IS DISTINCT FROM (OLD.email, OLD.idp_subject)
          OR (OLD.firebase_subject IS NOT NULL AND NEW.firebase_subject IS DISTINCT FROM OLD.firebase_subject)) THEN
    RAISE EXCEPTION 'a deactivated portal account never changes; a portal account''s email and identity subjects change only by its erasure (Firebase is linked once)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 3. D-B5-12, BR-PAY-08: a self-service version waits at least the configured cooling-off (unset: no self-service
-- version), and is refused while its request is under a bank_detail case or while the account is shared by as many
-- other payees as the threshold (the review the API opens instead). SECURITY DEFINER: a case reviewing the request is
-- seen whatever its payload, as the shared count sees other payees; every query names the tenant of the row.
CREATE OR REPLACE FUNCTION bank_detail_version_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  cooling_off_hours int;
  shared_threshold int;
BEGIN
  IF NEW.superseded_at IS NULL AND NEW.created_via = 'case' AND EXISTS (
       SELECT 1 FROM case_file c
       WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.type = 'bank_detail' AND c.state = 'approved'
         AND c.subject_type = 'participant' AND c.subject_id = NEW.participant_id
         AND c.payload ->> 'request_id' = NEW.request_id::text)
     AND EXISTS (
       SELECT 1 FROM bank_detail_request r
       WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id
         AND (r.scheme, r.fingerprint, r.masked) = (NEW.scheme, NEW.fingerprint, NEW.masked)) THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.superseded_at IS NULL AND NEW.created_via = 'self' AND NEW.case_id IS NULL
          AND NEW.participant_id = app_participant_id() AND EXISTS (
            SELECT 1 FROM bank_detail_request r
            WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id AND r.participant_id = NEW.participant_id
              AND r.created_by = app_user_id()
              AND (r.scheme, r.fingerprint, r.masked) = (NEW.scheme, NEW.fingerprint, NEW.masked))) THEN
    RAISE EXCEPTION 'a bank-detail version is created current, as requested, from the approved bank_detail case of its request or by its payee''s own portal session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  cooling_off_hours := (setting_in_force(NEW.tenant_id, 'payouts.bank_detail_cooling_off_hours'))::int;
  IF cooling_off_hours IS NULL
     OR NEW.cooling_off_until < date_trunc('milliseconds', now()) + make_interval(hours => cooling_off_hours) THEN
    RAISE EXCEPTION 'a self-service bank-detail version waits the configured payouts.bank_detail_cooling_off_hours'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  shared_threshold := (setting_in_force(NEW.tenant_id, 'payouts.shared_account_threshold'))::int;
  IF EXISTS (SELECT 1 FROM case_file c
             WHERE c.tenant_id = NEW.tenant_id AND c.type = 'bank_detail' AND c.payload ->> 'request_id' = NEW.request_id::text)
     OR (shared_threshold IS NOT NULL AND pay_shared_fingerprint_count(NEW.participant_id, NEW.fingerprint) >= shared_threshold) THEN
    RAISE EXCEPTION 'a shared bank account is changed only through its review case' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- The count and the version or case insert that follows are serialised per fingerprint (two payees changing to one
-- account at once would each count 0). VOLATILE: the count after the wait sees the other transaction's commit.
CREATE OR REPLACE FUNCTION pay_shared_fingerprint_count(p_participant uuid, p_fingerprint bytea) RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := assert_participant_scope(p_participant);
  shared int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bank_fingerprint:' || own_tenant || ':' || encode(p_fingerprint, 'hex'), 0));
  SELECT count(DISTINCT x.participant_id) INTO shared FROM (
    SELECT v.participant_id FROM bank_detail_version v
    WHERE v.tenant_id = own_tenant AND v.fingerprint = p_fingerprint AND v.superseded_at IS NULL
    UNION ALL
    SELECT r.participant_id FROM bank_detail_request r
    WHERE r.tenant_id = own_tenant AND r.fingerprint = p_fingerprint AND EXISTS (
      SELECT 1 FROM case_file c
      WHERE c.tenant_id = own_tenant AND c.type = 'bank_detail' AND c.state IN ('open', 'submitted')
        AND c.payload ->> 'request_id' = r.id::text)
  ) x WHERE x.participant_id <> p_participant;
  RETURN shared;
END $$;

-- 4. Cases: a system-opened bank_detail case is only the shared-account review of the session participant's own
-- request, in its portal transaction (staff open bank_detail cases as users, so the opener never approves); a
-- system-opened privacy case is about a privacy request and is committed with it.
CREATE OR REPLACE FUNCTION case_file_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'open'
     OR NOT ((NEW.opened_by_kind = 'user' AND NEW.opened_by = app_user_id())
             OR (NEW.opened_by_kind = 'system' AND NEW.opened_by IS NULL
                 AND NEW.type IN ('duplicate', 'returned_payment', 'privacy', 'bank_detail')))
     OR jsonb_strip_nulls(to_jsonb(NEW))
          ?| ARRAY['submitted_by', 'submitted_at', 'decided_at', 'approval_id', 'first_approval_id', 'approvals_required'] THEN
    RAISE EXCEPTION 'a case is opened by the acting user (or by the system for a duplicate, a returned payment, a privacy request or a shared bank account), open and undecided'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_participant_id() IS NOT NULL
     AND NOT (NEW.type = 'dispute' OR (NEW.opened_by_kind = 'system' AND NEW.type IN ('privacy', 'bank_detail'))) THEN
    RAISE EXCEPTION 'a portal transaction opens only a dispute, a privacy request or a bank-detail review'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.opened_by_kind = 'system' AND NEW.type = 'bank_detail' AND NOT (
       app_participant_id() IS NOT NULL AND NEW.reason_code = 'SHARED_ACCOUNT'
       AND NEW.subject_type = 'participant' AND NEW.subject_id = app_participant_id()
       AND EXISTS (SELECT 1 FROM bank_detail_request r
                   WHERE r.tenant_id = NEW.tenant_id AND r.id::text = NEW.payload ->> 'request_id'
                     AND r.participant_id = app_participant_id() AND r.created_by = app_user_id())) THEN
    RAISE EXCEPTION 'the system opens a bank-detail case only as the shared-account review of the portal participant''s own request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.opened_by_kind = 'system' AND NEW.type = 'privacy' AND NEW.subject_type <> 'privacy_request' THEN
    RAISE EXCEPTION 'a privacy case is about its privacy request' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.type = 'dispute' AND NOT (
       app_participant_id() IS NOT NULL AND NEW.opened_by_kind = 'user'
       AND NEW.payload ->> 'participant_id' = app_participant_id()::text
       AND NEW.subject_type = 'result_line' AND NEW.payload ->> 'line_id' = NEW.subject_id::text
       AND EXISTS (
         SELECT 1 FROM result_line l
         JOIN run r ON r.tenant_id = l.tenant_id AND r.id = l.run_id
         JOIN position p ON p.tenant_id = l.tenant_id AND p.id = l.payee_position_id
         WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.subject_id AND r.state = 'committed'
           AND l.payee_participant_id = app_participant_id() AND l.trace = NEW.payload -> 'trace'
           AND NEW.payload ->> 'run_id' = r.id::text AND NEW.market_id IS NOT DISTINCT FROM p.market_id)) THEN
    RAISE EXCEPTION 'a dispute is opened by the payee of a committed line, in its portal session, with the line''s trace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION case_file_privacy_has_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM privacy_request r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.subject_id AND r.case_id = NEW.id) THEN
    RAISE EXCEPTION 'a privacy case is committed with its privacy request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER case_file_privacy_has_request AFTER INSERT ON case_file DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.type = 'privacy' AND current_user = 'nmp_app') EXECUTE FUNCTION case_file_privacy_has_request();

-- Cases are assigned to staff accounts only (a portal account assigned would show its dispute "Under review").
CREATE FUNCTION case_file_assignee_staff() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_account u WHERE u.id = NEW.assigned_to AND u.realm = 'tenant') THEN
    RAISE EXCEPTION 'a case is assigned to a staff account' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER case_file_assignee_staff BEFORE INSERT OR UPDATE OF assigned_to ON case_file
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND NEW.assigned_to IS NOT NULL) EXECUTE FUNCTION case_file_assignee_staff();

-- D-B5-15: a portal transaction writes only the events of its own open, submit and withdraw, as itself; the escalation
-- is the overdue job's, without an actor, on a submitted dispute past its due date.
CREATE FUNCTION case_event_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_participant_id() IS NOT NULL AND NOT (
       NEW.kind IN ('opened', 'submitted', 'withdrawn') AND NEW.actor_id IS NOT NULL AND NEW.actor_id IS NOT DISTINCT FROM app_user_id()) THEN
    RAISE EXCEPTION 'a portal transaction records only its own open, submit and withdraw' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.kind = 'escalated' AND NOT (
       NEW.actor_id IS NULL AND app_participant_id() IS NULL AND EXISTS (
         SELECT 1 FROM case_file c
         WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.type = 'dispute' AND c.state = 'submitted' AND c.due_at < now())) THEN
    RAISE EXCEPTION 'an escalation is recorded by the system on a submitted dispute past its due date' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER case_event_insert_guard BEFORE INSERT ON case_event
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION case_event_insert_guard();

-- 5. Self scope, completed (D-B5-02 (2)): the portal session's own account, sessions and sign-in codes, its own payout
-- batch lines, the origins of its own lines and the evidence of its own cases; payout holds and batches never (staff
-- hold text, other payees' exclusion reasons: D-B5-07, D-B5-24). The statement reads a batch's period through
-- pay_batch_period.
CREATE POLICY portal_self ON user_account AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR participant_id = app_participant_id());
CREATE POLICY portal_self ON session AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR user_id = app_user_id())
  WITH CHECK (app_participant_id() IS NULL OR user_id = app_user_id());
CREATE POLICY portal_self ON portal_sign_in_code AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR user_id = app_user_id())
  WITH CHECK (app_participant_id() IS NULL OR user_id = app_user_id());
CREATE POLICY portal_self ON payout_batch_line AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR participant_id = app_participant_id());
CREATE POLICY portal_self ON adjustment_origin AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM result_line l WHERE l.origin_id = adjustment_origin.id AND l.payee_participant_id = app_participant_id()))
  WITH CHECK (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM result_line l WHERE l.origin_id = adjustment_origin.id AND l.payee_participant_id = app_participant_id()));
CREATE POLICY portal_self ON case_evidence AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM case_file c WHERE c.id = case_evidence.case_id AND c.payload ->> 'participant_id' = app_participant_id()::text))
  WITH CHECK (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM case_file c WHERE c.id = case_evidence.case_id AND c.payload ->> 'participant_id' = app_participant_id()::text));
CREATE POLICY portal_hidden ON payout_hold AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);
CREATE POLICY portal_hidden ON payout_batch AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);

-- D-B5-07: the period of a payout batch of the acting tenant (NULL when unknown), for the statement's payout status.
CREATE FUNCTION pay_batch_period(p_batch uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT b.period_id FROM payout_batch b WHERE app_realm() = 'tenant' AND b.tenant_id = app_tenant_id() AND b.id = p_batch
$$;
REVOKE ALL ON FUNCTION pay_batch_period(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pay_batch_period(uuid) TO nmp_app;

-- 6. Erasure (D-B5-18). A run not yet committed that already holds lines of the subject defers it (committing it later
-- would create a payable for an erased payee).
CREATE OR REPLACE FUNCTION prv_erasure_blockers(p_participant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  own_tenant uuid := assert_participant_scope(p_participant);
BEGIN
  RETURN coalesce((SELECT jsonb_agg(b.reason ORDER BY b.ord, b.sort_key) FROM (
    SELECT 1 AS ord, a.market_id::text AS sort_key,
           jsonb_build_object('reason', 'open_payable', 'market_id', a.market_id, 'amount_minor', a.payable::text) AS reason
    FROM (SELECT x.market_id, led_balance(x.market_id, p_participant, 'payee_payable') AS payable FROM ledger_account x
          WHERE x.tenant_id = own_tenant AND x.payee_participant_id = p_participant AND x.type = 'payee_payable') a
    WHERE a.payable > 0
    UNION ALL
    SELECT 2, '', jsonb_build_object('reason', 'payout_in_flight', 'count', f.n)
    FROM (SELECT count(*) AS n FROM payout_instruction i
          WHERE i.tenant_id = own_tenant AND i.payee_participant_id = p_participant
            AND i.state IN ('pending', 'instructed', 'accepted')) f
    WHERE f.n > 0
    UNION ALL
    SELECT 3, h.id::text, jsonb_build_object('reason', 'payout_hold', 'hold_id', h.id) FROM payout_hold h
    WHERE h.tenant_id = own_tenant AND h.participant_id = p_participant AND h.released_at IS NULL
    UNION ALL
    SELECT 4, c.id::text, jsonb_build_object('reason', 'open_case', 'case_id', c.id, 'type', c.type) FROM case_file c
    WHERE c.tenant_id = own_tenant AND (
      (c.type = 'adjustment' AND c.state IN ('open', 'submitted') AND c.subject_type = 'position' AND (
         EXISTS (SELECT 1 FROM position_ownership o
                 WHERE o.tenant_id = own_tenant AND o.position_id = c.subject_id AND o.participant_id = p_participant
                   AND o.valid_from <= now() AND (o.valid_to IS NULL OR o.valid_to > now()))
         OR EXISTS (SELECT 1 FROM result_line l
                    WHERE l.tenant_id = own_tenant AND l.payee_position_id = c.subject_id AND l.payee_participant_id = p_participant)))
      OR (c.type = 'dispute' AND c.state IN ('open', 'submitted') AND c.payload ->> 'participant_id' = p_participant::text)
      OR (c.type = 'write_off' AND c.state IN ('open', 'submitted') AND c.subject_type = 'ledger_account' AND EXISTS (
            SELECT 1 FROM ledger_account a
            WHERE a.tenant_id = own_tenant AND a.id = c.subject_id AND a.payee_participant_id = p_participant))
      OR (c.type = 'restatement' AND c.state = 'submitted' AND c.subject_type = 'period' AND EXISTS (
            SELECT 1 FROM result_line l JOIN run r ON r.tenant_id = l.tenant_id AND r.id = l.run_id
            WHERE l.tenant_id = own_tenant AND r.period_id = c.subject_id AND l.payee_participant_id = p_participant)))
    UNION ALL
    SELECT 5, r.id::text, jsonb_build_object('reason', 'open_run', 'run_id', r.id) FROM run r
    WHERE r.tenant_id = own_tenant AND r.state IN ('queued', 'running', 'calculated') AND EXISTS (
      SELECT 1 FROM result_line l WHERE l.tenant_id = own_tenant AND l.run_id = r.id AND l.payee_participant_id = p_participant)
  ) b), '[]');
END $$;

-- A notice's masked account value is cleared by erasure (the owner, that one change only).
CREATE OR REPLACE FUNCTION notification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  delivery_fields constant text[] := ARRAY['state', 'attempts', 'next_attempt_at', 'last_error', 'sent_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on notification is not allowed (notices are evidence)';
  END IF;
  IF acting_as_owner() AND OLD.params ? 'masked' AND NEW.params = OLD.params || '{"masked": "erased"}'
     AND to_jsonb(NEW) - 'params' = to_jsonb(OLD) - 'params' THEN
    RETURN NEW;
  END IF;
  IF to_jsonb(NEW) - delivery_fields - 'read_at' IS DISTINCT FROM to_jsonb(OLD) - delivery_fields - 'read_at'
     OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
     OR ((to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at')
         AND (OLD.state <> 'queued' OR NEW.state = 'delivered')) THEN
    RAISE EXCEPTION 'a notification is delivered once from queued (retried while queued) and read once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- prv_erase_participant (0504), plus: the ledger lock of every market where the subject owns or owned a position (a
-- first payable there is serialised too); session IP and user agent of the subject's accounts and the masked account
-- in its notices cleared.
CREATE OR REPLACE FUNCTION prv_erase_participant(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := app_tenant_id();
  request record;
  blockers jsonb;
  account record;
BEGIN
  IF app_realm() IS DISTINCT FROM 'tenant' OR own_tenant IS NULL OR app_participant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'erasure runs in a staff transaction of the tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT r.id, r.type, r.subject_participant_id AS subject, c.state, c.payload ->> 'retention_basis' AS retention_basis
  INTO request
  FROM privacy_request r JOIN case_file c ON c.tenant_id = r.tenant_id AND c.id = r.case_id
  WHERE r.tenant_id = own_tenant AND r.id = p_request
  FOR UPDATE OF r;
  IF NOT FOUND OR request.type <> 'erasure' OR request.state <> 'approved' THEN
    RAISE EXCEPTION 'erasure needs an approved erasure request' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM participant x WHERE x.tenant_id = own_tenant AND x.id = request.subject AND x.pseudonymised_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'erasure needs a subject not yet pseudonymised' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || own_tenant || ':' || m.market_id, 0))
  FROM (SELECT a.market_id FROM ledger_account a WHERE a.tenant_id = own_tenant AND a.payee_participant_id = request.subject
        UNION
        SELECT p.market_id FROM position_ownership o JOIN position p ON p.tenant_id = o.tenant_id AND p.id = o.position_id
        WHERE o.tenant_id = own_tenant AND o.participant_id = request.subject
        ORDER BY 1) m;
  blockers := prv_erasure_blockers(request.subject);
  IF jsonb_array_length(blockers) > 0 THEN
    RAISE EXCEPTION 'erasure deferred' USING ERRCODE = 'PV001', DETAIL = blockers::text;
  END IF;

  UPDATE participant SET display_name = NULL, contact = NULL, identity_doc_id = NULL, pseudonymised_at = now()
  WHERE tenant_id = own_tenant AND id = request.subject;
  FOR account IN
    SELECT u.id, 'portal:' || t.slug || ':' || u.email AS account_key FROM user_account u JOIN tenant t ON t.id = u.tenant_id
    WHERE u.tenant_id = own_tenant AND u.participant_id = request.subject
  LOOP
    DELETE FROM login_attempt WHERE account_key = account.account_key;
    DELETE FROM password_credential WHERE user_id = account.id;
    DELETE FROM mfa_credential WHERE user_id = account.id;
    DELETE FROM portal_sign_in_code WHERE tenant_id = own_tenant AND user_id = account.id;
    UPDATE user_invitation SET revoked_at = now()
    WHERE tenant_id = own_tenant AND user_id = account.id AND used_at IS NULL AND revoked_at IS NULL;
    UPDATE session SET ip = NULL, user_agent = NULL
    WHERE tenant_id = own_tenant AND user_id = account.id AND (ip IS NOT NULL OR user_agent IS NOT NULL);
    UPDATE user_account SET email = 'erased+' || id || '@erased.invalid', idp_subject = 'erased:' || id, display_name = NULL,
                            firebase_subject = NULL, mfa_enrolled = false, state = 'deactivated'
    WHERE id = account.id;
  END LOOP;
  DELETE FROM participant_signal WHERE tenant_id = own_tenant AND participant_id = request.subject;
  UPDATE bank_detail_request SET details_sealed = NULL, contact_email_sealed = NULL, masked = 'erased'
  WHERE tenant_id = own_tenant AND participant_id = request.subject AND masked <> 'erased';
  UPDATE bank_detail_version SET details_sealed = NULL, masked = 'erased'
  WHERE tenant_id = own_tenant AND participant_id = request.subject AND masked <> 'erased';
  UPDATE tax_profile SET tax_id_sealed = NULL, tax_id_masked = NULL
  WHERE tenant_id = own_tenant AND participant_id = request.subject AND tax_id_sealed IS NOT NULL;
  UPDATE notification SET params = params || '{"masked": "erased"}'
  WHERE tenant_id = own_tenant AND recipient_participant_id = request.subject AND params ->> 'masked' <> 'erased';
  UPDATE notification SET state = 'suppressed'
  WHERE tenant_id = own_tenant AND recipient_participant_id = request.subject AND state = 'queued';
  DELETE FROM privacy_export e USING privacy_request r
  WHERE e.tenant_id = own_tenant AND r.tenant_id = own_tenant AND r.id = e.request_id AND r.subject_participant_id = request.subject;
  UPDATE privacy_request SET corrections_sealed = NULL
  WHERE tenant_id = own_tenant AND subject_participant_id = request.subject AND corrections_sealed IS NOT NULL;
  -- The fulfilled request's own requester details stay until prv.send-outcome has mailed the outcome (D-B5-16).
  UPDATE privacy_request SET requester_sealed = NULL
  WHERE tenant_id = own_tenant AND subject_participant_id = request.subject AND id <> request.id AND requester_sealed IS NOT NULL;
  UPDATE privacy_request SET outcome = 'fulfilled', closed_at = now(), retention_basis = coalesce(retention_basis, request.retention_basis)
  WHERE tenant_id = own_tenant AND id = request.id;

  RETURN jsonb_build_object(
    'cleared', jsonb_build_array('participant.display_name', 'participant.contact', 'participant.identity_doc_id',
      'user_account.email', 'user_account.idp_subject', 'user_account.display_name', 'user_account.firebase_subject',
      'password_credential', 'mfa_credential', 'portal_sign_in_code', 'user_invitation (open: revoked)', 'login_attempt',
      'session.ip', 'session.user_agent', 'participant_signal', 'bank_detail_request.details_sealed',
      'bank_detail_request.contact_email_sealed', 'bank_detail_version.details_sealed', 'tax_profile.tax_id_sealed',
      'tax_profile.tax_id_masked', 'notification.params.masked', 'notification (queued email: suppressed)', 'privacy_export',
      'privacy_request.corrections_sealed', 'privacy_request.requester_sealed (other requests)'),
    'retained', jsonb_build_array('position', 'relationship', 'result_line', 'qualification_state', 'run_snapshot',
      'journal_entry', 'posting', 'payout_instruction', 'bank_detail fingerprints', 'tax_profile.residency',
      'tax_profile.entity_type', 'notification', 'case_file', 'audit'));
END $$;
