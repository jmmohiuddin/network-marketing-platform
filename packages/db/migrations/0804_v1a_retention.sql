-- V1-A retention timers and legal holds (PLAN V1-A sections 1.5 and 1.7; D-V1A-06, D-V1A-08, C-V1A-13, C-V1A-19): schedules
-- per data class and market approved by a second person, the classes' due objects, the logged runs, participant legal
-- holds, erasure deferred by a hold or by credits still owed, and the subject-access export of credits.

-- 1. retention_schedule: proposed by a privacy.manage holder, decided once by another (0800 second_person_decision_guard).
CREATE TABLE retention_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  data_class text NOT NULL CHECK (data_class IN ('privacy_request', 'terminated_participant')),
  market_id uuid,
  retain_days int NOT NULL CHECK (retain_days BETWEEN 1 AND 3650),
  basis text NOT NULL CHECK (length(trim(basis)) BETWEEN 1 AND 500),
  effective_from date NOT NULL,
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'approved', 'rejected')),
  proposed_by uuid NOT NULL DEFAULT app_user_id(),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approval_id uuid,
  decided_at timestamptz,
  CONSTRAINT retention_schedule_decision CHECK ((state = 'proposed') = (approval_id IS NULL AND decided_at IS NULL)
                                                AND (approval_id IS NULL) = (decided_at IS NULL)),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, proposed_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX retention_schedule_one_proposal ON retention_schedule (tenant_id, data_class, market_id) NULLS NOT DISTINCT
  WHERE state = 'proposed';
CREATE TRIGGER retention_schedule_guard BEFORE INSERT OR UPDATE ON retention_schedule
  FOR EACH ROW EXECUTE FUNCTION second_person_decision_guard();
CREATE TRIGGER retention_schedule_no_delete BEFORE DELETE ON retention_schedule FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER retention_schedule_proposed_by_actor BEFORE INSERT ON retention_schedule
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('proposed_by');

-- The schedule in force for a class in a market on a day: the latest approved one effective by then, a market's own
-- before the all-markets one (p_market NULL: the all-markets one).
CREATE FUNCTION retention_schedule_in_force(p_class text, p_market uuid, p_on date) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT s.id FROM retention_schedule s
  WHERE s.data_class = p_class AND s.state = 'approved' AND s.effective_from <= p_on
    AND (s.market_id = p_market OR s.market_id IS NULL)
  ORDER BY s.market_id IS NULL, s.effective_from DESC, s.decided_at DESC, s.id
  LIMIT 1
$$;

-- 2. legal_hold (participant-level): placed and released by different users, released once; never shown to its subject.
CREATE TABLE legal_hold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  participant_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  placed_by uuid NOT NULL DEFAULT app_user_id(),
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid,
  released_at timestamptz,
  CONSTRAINT legal_hold_release CHECK ((released_by IS NULL) = (released_at IS NULL)),
  CONSTRAINT legal_hold_released_by_another CHECK (released_by IS NULL OR released_by <> placed_by),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, placed_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, released_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX legal_hold_active ON legal_hold (tenant_id, participant_id) WHERE released_at IS NULL;
CREATE TRIGGER legal_hold_released_once BEFORE UPDATE OR DELETE ON legal_hold
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('released_by', 'released_at');
CREATE TRIGGER legal_hold_placed_by_actor BEFORE INSERT ON legal_hold
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('placed_by');
CREATE TRIGGER legal_hold_released_by_actor BEFORE UPDATE ON legal_hold
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('released_by');

-- 3. retention_run: one log row per applied schedule (ids only).
CREATE FUNCTION retention_items_ok(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array' AND jsonb_array_length(p) <= 1000 THEN NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p) i
    WHERE NOT jsonb_keys_ok(i, ARRAY['object_type', 'object_id', 'outcome'], '{}')
       OR NOT jsonb_string_set_ok(jsonb_build_array(i -> 'object_type'), ARRAY['participant', 'privacy_request'], '')
       OR NOT jsonb_string_set_ok(jsonb_build_array(i -> 'outcome'), ARRAY['applied', 'held', 'deferred'], '')
       OR NOT jsonb_string_set_ok(jsonb_build_array(i -> 'object_id'), NULL,
                                  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  ELSE false END
$$;

CREATE TABLE retention_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  schedule_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  due int NOT NULL CHECK (due >= 0),
  applied int NOT NULL CHECK (applied >= 0),
  held int NOT NULL CHECK (held >= 0),
  deferred int NOT NULL CHECK (deferred >= 0),
  items jsonb NOT NULL CHECK (retention_items_ok(items)),
  CHECK (finished_at >= started_at),
  FOREIGN KEY (tenant_id, schedule_id) REFERENCES retention_schedule (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX retention_run_schedule_idx ON retention_run (tenant_id, schedule_id, started_at DESC);
CREATE TRIGGER retention_run_no_mutation BEFORE UPDATE OR DELETE ON retention_run FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['retention_schedule', 'legal_hold', 'retention_run']::regclass[]) AS t;
CREATE POLICY portal_hidden ON legal_hold AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);
CREATE POLICY portal_hidden ON retention_run AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);
GRANT SELECT, INSERT ON retention_schedule, legal_hold, retention_run TO nmp_app;
GRANT UPDATE (state, approval_id, decided_at) ON retention_schedule TO nmp_app;
GRANT UPDATE (released_by, released_at) ON legal_hold TO nmp_app;

-- 4. privacy_request: what retention keeps of a closed request's export once it is deleted. Only the owner (inside
-- prv_retention_clear_request) sets these, once.
ALTER TABLE privacy_request
  ADD COLUMN retention_cleared_at timestamptz,
  ADD COLUMN export_sha256 bytea CHECK (length(export_sha256) = 32),
  ADD COLUMN export_bytes int CHECK (export_bytes >= 0),
  ADD CONSTRAINT privacy_request_retention_closed CHECK (retention_cleared_at IS NULL OR closed_at IS NOT NULL),
  ADD CONSTRAINT privacy_request_export_kept CHECK ((export_sha256 IS NULL) = (export_bytes IS NULL));

CREATE OR REPLACE FUNCTION privacy_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  set_once constant text[] := ARRAY['verified_at', 'verified_by', 'verification_method', 'verification_note',
                                    'subject_participant_id', 'due_at', 'escalated_at', 'outcome', 'closed_at',
                                    'retention_basis', 'retention_cleared_at', 'export_sha256', 'export_bytes'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on privacy_request is not allowed (history)';
  END IF;
  IF to_jsonb(NEW) - set_once - 'requester_sealed' - 'corrections_sealed'
       IS DISTINCT FROM to_jsonb(OLD) - set_once - 'requester_sealed' - 'corrections_sealed'
     OR EXISTS (SELECT 1 FROM unnest(set_once) c
                WHERE to_jsonb(OLD) -> c <> 'null'::jsonb AND to_jsonb(NEW) -> c IS DISTINCT FROM to_jsonb(OLD) -> c)
     OR (NEW.requester_sealed IS DISTINCT FROM OLD.requester_sealed AND NEW.requester_sealed IS NOT NULL)
     OR (NEW.corrections_sealed IS DISTINCT FROM OLD.corrections_sealed AND NEW.corrections_sealed IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM case_file c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.state = 'open'))
     OR ((NEW.retention_cleared_at, NEW.export_sha256, NEW.export_bytes)
           IS DISTINCT FROM (OLD.retention_cleared_at, OLD.export_sha256, OLD.export_bytes) AND NOT acting_as_owner()) THEN
    RAISE EXCEPTION 'a privacy request''s verification, deadline, escalation and outcome are set once; sealed values are only cleared (corrections replaced while its case is open)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 5. The classes' due objects under a schedule (D-V1A-08). A market's own approved schedule effective today takes its
-- market out of the all-markets schedule; a request without a subject falls under the all-markets schedule only.
CREATE FUNCTION retention_schedule_applies(s retention_schedule, p_market uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT s.market_id = p_market OR (s.market_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM retention_schedule o
    WHERE o.tenant_id = s.tenant_id AND o.data_class = s.data_class AND o.market_id = p_market AND o.state = 'approved'
      AND o.effective_from <= current_date))
$$;

CREATE FUNCTION prv_retention_candidates(p_schedule uuid)
RETURNS TABLE (object_type text, object_id uuid, ref text, held boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'participant', x.id, x.external_ref,
         EXISTS (SELECT 1 FROM legal_hold h WHERE h.tenant_id = x.tenant_id AND h.participant_id = x.id AND h.released_at IS NULL)
  FROM retention_schedule s JOIN participant x ON x.tenant_id = s.tenant_id
  CROSS JOIN LATERAL (
    SELECT bool_and(p.status = 'terminated') AS all_terminated, max(p.status_from) AS last_terminated
    FROM position_ownership o JOIN position p ON p.tenant_id = o.tenant_id AND p.id = o.position_id
    WHERE o.tenant_id = x.tenant_id AND o.participant_id = x.id AND o.valid_to IS NULL) owned
  WHERE s.id = p_schedule AND s.data_class = 'terminated_participant' AND x.pseudonymised_at IS NULL
    AND retention_schedule_applies(s, x.market_id)
    AND owned.all_terminated AND owned.last_terminated < now() - make_interval(days => s.retain_days)
  UNION ALL
  SELECT 'privacy_request', r.id, r.id::text,
         EXISTS (SELECT 1 FROM legal_hold h
                 WHERE h.tenant_id = r.tenant_id AND h.participant_id = r.subject_participant_id AND h.released_at IS NULL)
  FROM retention_schedule s JOIN privacy_request r ON r.tenant_id = s.tenant_id
  LEFT JOIN participant x ON x.tenant_id = r.tenant_id AND x.id = r.subject_participant_id
  WHERE s.id = p_schedule AND s.data_class = 'privacy_request' AND r.closed_at IS NOT NULL AND r.retention_cleared_at IS NULL
    AND r.closed_at < now() - make_interval(days => s.retain_days) AND retention_schedule_applies(s, x.market_id)
$$;

-- Preview and cron: the first p_limit due objects of a schedule.
CREATE FUNCTION prv_retention_due(p_schedule uuid, p_limit int)
RETURNS TABLE (object_type text, object_id uuid, ref text, held boolean)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY SELECT c.object_type, c.object_id, c.ref, c.held FROM prv_retention_candidates(p_schedule) c
    ORDER BY c.object_type, c.object_id LIMIT p_limit;
END $$;

-- The cron's schedules (system realm, archived tenants skipped): per tenant, class and market the latest approved one
-- effective today.
CREATE FUNCTION retention_schedules_due(p_limit int) RETURNS TABLE (tenant_id uuid, schedule_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT d.tenant_id, d.id FROM (
      SELECT DISTINCT ON (s.tenant_id, s.data_class, s.market_id) s.tenant_id, s.id
      FROM retention_schedule s JOIN tenant t ON t.id = s.tenant_id AND t.state <> 'archived'
      WHERE s.state = 'approved' AND s.effective_from <= current_date
      ORDER BY s.tenant_id, s.data_class, s.market_id, s.effective_from DESC, s.decided_at DESC, s.id) d
    ORDER BY 1, 2
    LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION retention_schedules_due(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_schedules_due(int) TO nmp_app;

-- 6. Clearing a due closed request (staff or system transaction of the tenant): its sealed requester and correction data
-- are cleared and its export deleted, the export's sha256 and size kept; the request row stays as the record.
CREATE FUNCTION prv_retention_clear_request(p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := app_tenant_id();
  request record;
  kept record;
BEGIN
  IF app_realm() IS DISTINCT FROM 'tenant' OR own_tenant IS NULL OR app_participant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'retention runs in a staff transaction of the tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT r.id, r.subject_participant_id AS subject INTO request FROM privacy_request r
  JOIN retention_schedule s ON s.tenant_id = r.tenant_id
    AND s.id = retention_schedule_in_force('privacy_request', (SELECT x.market_id FROM participant x
                                                                WHERE x.tenant_id = own_tenant AND x.id = r.subject_participant_id),
                                           current_date)
  WHERE r.tenant_id = own_tenant AND r.id = p_request AND r.closed_at IS NOT NULL AND r.retention_cleared_at IS NULL
    AND s.tenant_id = own_tenant AND r.closed_at < now() - make_interval(days => s.retain_days)
  FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only a closed request due under the schedule in force is cleared' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF EXISTS (SELECT 1 FROM legal_hold h WHERE h.tenant_id = own_tenant AND h.participant_id = request.subject AND h.released_at IS NULL) THEN
    RAISE EXCEPTION 'retention deferred' USING ERRCODE = 'PV001',
      DETAIL = (SELECT jsonb_agg(jsonb_build_object('reason', 'legal_hold', 'hold_id', h.id)) FROM legal_hold h
                WHERE h.tenant_id = own_tenant AND h.participant_id = request.subject AND h.released_at IS NULL)::text;
  END IF;
  SELECT e.content_sha256, length(e.content) AS bytes INTO kept FROM privacy_export e
  WHERE e.tenant_id = own_tenant AND e.request_id = p_request;
  DELETE FROM privacy_export e WHERE e.tenant_id = own_tenant AND e.request_id = p_request;
  UPDATE privacy_request SET requester_sealed = NULL, corrections_sealed = NULL, export_sha256 = kept.content_sha256,
                             export_bytes = kept.bytes, retention_cleared_at = now()
  WHERE tenant_id = own_tenant AND id = p_request;
END $$;

-- 7. Erasure deferrals (0506 list plus C-V1A-19): an active legal hold, and unexpired credits the tenant still owes.
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
    UNION ALL
    SELECT 6, h.id::text, jsonb_build_object('reason', 'legal_hold', 'hold_id', h.id) FROM legal_hold h
    WHERE h.tenant_id = own_tenant AND h.participant_id = p_participant AND h.released_at IS NULL
    UNION ALL
    SELECT 7, k.market_id::text || k.credit_type_id::text,
           jsonb_build_object('reason', 'credits_outstanding', 'market_id', k.market_id, 'credit_type_id', k.credit_type_id,
                              'amount_minor', owed.amount::text)
    FROM (SELECT DISTINCT a.market_id, a.credit_type_id FROM credit_award a
          WHERE a.tenant_id = own_tenant AND a.payee_participant_id = p_participant) k
    CROSS JOIN LATERAL (SELECT sum(l.remaining_minor) AS amount FROM credit_lots(p_participant, k.credit_type_id, k.market_id) l
                        WHERE l.expires_at IS NULL OR l.expires_at > now()) owed
    WHERE owed.amount > 0
  ) b), '[]');
END $$;

-- 8. Erasure (0702's prv_erase_participant) split so retention can pseudonymise a due participant without a request:
-- prv_erase_subject does the work (internal: no grant), prv_erase_participant erases the subject of an approved erasure
-- request and closes it, prv_retention_erase a participant due under a terminated_participant schedule in force.
CREATE FUNCTION prv_erase_subject(own_tenant uuid, p_subject uuid, p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  blockers jsonb;
  account record;
  exports jsonb;
BEGIN
  PERFORM 1 FROM participant x WHERE x.tenant_id = own_tenant AND x.id = p_subject AND x.pseudonymised_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'erasure needs a subject not yet pseudonymised' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || own_tenant || ':' || m.market_id, 0))
  FROM (SELECT a.market_id FROM ledger_account a WHERE a.tenant_id = own_tenant AND a.payee_participant_id = p_subject
        UNION
        SELECT p.market_id FROM position_ownership o JOIN position p ON p.tenant_id = o.tenant_id AND p.id = o.position_id
        WHERE o.tenant_id = own_tenant AND o.participant_id = p_subject
        ORDER BY 1) m;
  -- TK-B5-18: an adjustment or dispute being opened for the subject holds this lock shared until it commits.
  PERFORM pg_advisory_xact_lock(hashtextextended('erase:' || own_tenant || ':' || p_subject, 0));
  blockers := prv_erasure_blockers(p_subject);
  IF jsonb_array_length(blockers) > 0 THEN
    RAISE EXCEPTION 'erasure deferred' USING ERRCODE = 'PV001', DETAIL = blockers::text;
  END IF;

  UPDATE participant SET display_name = NULL, contact = NULL, identity_doc_id = NULL, account_holders = NULL, pseudonymised_at = now()
  WHERE tenant_id = own_tenant AND id = p_subject;
  FOR account IN
    SELECT u.id, 'portal:' || t.slug || ':' || u.email AS account_key FROM user_account u JOIN tenant t ON t.id = u.tenant_id
    WHERE u.tenant_id = own_tenant AND u.participant_id = p_subject
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
                            firebase_subject = NULL, mfa_enrolled = false, state = 'deactivated',
                            locale = NULL
    WHERE id = account.id;
  END LOOP;
  DELETE FROM participant_signal WHERE tenant_id = own_tenant AND participant_id = p_subject;
  UPDATE bank_detail_request SET details_sealed = NULL, contact_email_sealed = NULL, masked = 'erased'
  WHERE tenant_id = own_tenant AND participant_id = p_subject AND masked <> 'erased';
  UPDATE bank_detail_version SET details_sealed = NULL, masked = 'erased'
  WHERE tenant_id = own_tenant AND participant_id = p_subject AND masked <> 'erased';
  UPDATE tax_profile SET tax_id_sealed = NULL, tax_id_masked = NULL
  WHERE tenant_id = own_tenant AND participant_id = p_subject AND tax_id_sealed IS NOT NULL;
  UPDATE notification SET params = params || erased_notice_params(params)
  WHERE tenant_id = own_tenant AND recipient_participant_id = p_subject AND params ->> 'masked' <> 'erased';
  UPDATE notification SET state = 'suppressed'
  WHERE tenant_id = own_tenant AND recipient_participant_id = p_subject AND state = 'queued';
  DELETE FROM privacy_export e USING privacy_request r
  WHERE e.tenant_id = own_tenant AND r.tenant_id = own_tenant AND r.id = e.request_id AND r.subject_participant_id = p_subject;
  UPDATE privacy_request SET corrections_sealed = NULL
  WHERE tenant_id = own_tenant AND subject_participant_id = p_subject AND corrections_sealed IS NOT NULL;
  -- The fulfilled request's own requester details stay until prv.send-outcome has mailed the outcome (D-B5-16).
  UPDATE privacy_request SET requester_sealed = NULL
  WHERE tenant_id = own_tenant AND subject_participant_id = p_subject AND id IS DISTINCT FROM p_request
    AND requester_sealed IS NOT NULL;
  -- D-B6-13: every full export holds the subject's data: completed ones expire, unfinished ones fail (files deleted).
  WITH changed AS (
    UPDATE data_export SET state = CASE state WHEN 'completed' THEN 'expired' ELSE 'failed' END,
                           error = CASE state WHEN 'completed' THEN NULL ELSE '{"code": "ERASED_DURING_EXPORT"}'::jsonb END,
                           finished_at = coalesce(finished_at, now())
    WHERE tenant_id = own_tenant AND state IN ('queued', 'running', 'completed')
    RETURNING id, state)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'state', state) ORDER BY id), '[]') INTO exports FROM changed;
  DELETE FROM data_export_file f USING data_export d
  WHERE f.tenant_id = own_tenant AND d.tenant_id = own_tenant AND d.id = f.export_id AND d.state IN ('failed', 'expired');

  RETURN jsonb_build_object(
    'cleared', jsonb_build_array('participant.display_name', 'participant.contact', 'participant.identity_doc_id',
      'participant.account_holders',
      'user_account.email', 'user_account.idp_subject', 'user_account.display_name', 'user_account.firebase_subject', 'user_account.locale',
      'password_credential', 'mfa_credential', 'portal_sign_in_code', 'user_invitation (open: revoked)', 'login_attempt',
      'session.ip', 'session.user_agent', 'participant_signal', 'bank_detail_request.details_sealed',
      'bank_detail_request.contact_email_sealed', 'bank_detail_version.details_sealed', 'tax_profile.tax_id_sealed',
      'tax_profile.tax_id_masked', 'notification.params.masked', 'notification.params.previous_masked',
      'notification (queued email: suppressed)', 'privacy_export',
      'privacy_request.corrections_sealed', 'privacy_request.requester_sealed (other requests)', 'data_export_file.content'),
    'retained', jsonb_build_array('position', 'relationship', 'result_line', 'qualification_state', 'run_snapshot',
      'journal_entry', 'posting', 'payout_instruction', 'bank_detail fingerprints', 'tax_profile.residency',
      'tax_profile.entity_type', 'notification', 'case_file', 'audit'),
    'exports', exports);
END $$;
REVOKE ALL ON FUNCTION prv_erase_subject(uuid, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION prv_erase_participant(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := app_tenant_id();
  request record;
  result jsonb;
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
  result := prv_erase_subject(own_tenant, request.subject, request.id);
  UPDATE privacy_request SET outcome = 'fulfilled', closed_at = now(), retention_basis = coalesce(retention_basis, request.retention_basis)
  WHERE tenant_id = own_tenant AND id = request.id;
  RETURN result;
END $$;

CREATE FUNCTION prv_retention_erase(p_schedule uuid, p_participant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := app_tenant_id();
BEGIN
  IF app_realm() IS DISTINCT FROM 'tenant' OR own_tenant IS NULL OR app_participant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'retention runs in a staff transaction of the tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM retention_schedule s JOIN participant x ON x.tenant_id = s.tenant_id AND x.id = p_participant
                 WHERE s.tenant_id = own_tenant AND s.id = p_schedule
                   AND s.id = retention_schedule_in_force('terminated_participant', x.market_id, current_date))
     OR NOT EXISTS (SELECT 1 FROM prv_retention_candidates(p_schedule) c
                    WHERE c.object_type = 'participant' AND c.object_id = p_participant) THEN
    RAISE EXCEPTION 'only a participant due under the schedule in force is pseudonymised by retention'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN prv_erase_subject(own_tenant, p_participant, NULL);
END $$;
REVOKE ALL ON FUNCTION prv_retention_clear_request(uuid), prv_retention_erase(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prv_retention_clear_request(uuid), prv_retention_erase(uuid, uuid) TO nmp_app;

-- 9. Subject access (0702's prv_personal_data): the participant section carries the account holders; credit awards and
-- redemptions are their own sections.
ALTER FUNCTION prv_personal_data(uuid) RENAME TO prv_personal_data_bmkt;
CREATE FUNCTION prv_personal_data(p_participant uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_set(d, '{participant,account_holders}',
                   coalesce((SELECT x.account_holders FROM participant x WHERE x.id = p_participant), 'null'::jsonb))
    || jsonb_build_object(
      'credit_awards', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM (
        SELECT a.id, a.run_id, a.market_id, t.code AS credit_type, a.amount_minor::text AS amount_minor, a.currency, a.expiry_days,
               a.taxable, a.created_at
        FROM credit_award a JOIN credit_type t ON t.tenant_id = a.tenant_id AND t.id = a.credit_type_id
        WHERE a.payee_participant_id = p_participant) x), '[]'),
      'credit_redemptions', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.occurred_at, x.id) FROM (
        SELECT r.id, r.market_id, t.code AS credit_type, r.amount_minor::text AS amount_minor, r.currency, r.source_system,
               r.source_redemption_id, r.item_class, r.occurred_at
        FROM credit_redemption r JOIN credit_type t ON t.tenant_id = r.tenant_id AND t.id = r.credit_type_id
        WHERE r.participant_id = p_participant) x), '[]'))
  FROM prv_personal_data_bmkt(p_participant) d
$$;

-- 10. The personal-data map (D-B5-17) with the V1-A keys and columns.
CREATE OR REPLACE FUNCTION prv_personal_data_map()
RETURNS TABLE (table_name text, column_name text, section text, reason text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT t, c, s, NULL FROM (VALUES
    ('participant', 'merged_into_id', 'participant'), ('participant', 'account_holders', 'participant'),
    ('participant_type_assignment', 'participant_id', 'types'),
    ('agreement_acceptance', 'participant_id', 'agreement_acceptances'), ('position_ownership', 'participant_id', 'positions'),
    ('customer_servicing', 'customer_id', 'servicing'), ('sales_order', 'buyer_id', 'orders'),
    ('result_line', 'payee_participant_id', 'result_lines'), ('run_settlement', 'payee_participant_id', 'statements'),
    ('ledger_account', 'payee_participant_id', 'ledger'),
    ('user_related_participant', 'participant_id', 'related_staff_declarations'),
    ('bank_detail_request', 'participant_id', 'bank_detail_requests'), ('bank_detail_request', 'created_by', 'bank_detail_requests'),
    ('bank_detail_version', 'participant_id', 'bank_detail_versions'), ('payout_batch_line', 'participant_id', 'payout_batch_lines'),
    ('payout_instruction', 'payee_participant_id', 'payout_instructions'), ('payout_hold', 'participant_id', 'payout_holds'),
    ('tax_profile', 'participant_id', 'tax_profiles'), ('tax_profile', 'created_by', 'tax_profiles'),
    ('notification', 'recipient_participant_id', 'notifications'),
    ('notification_preference', 'participant_id', 'notification_preferences'),
    ('notification_preference', 'updated_by', 'notification_preferences'),
    ('privacy_request', 'subject_participant_id', 'privacy_requests'), ('privacy_request', 'requester_user_id', 'privacy_requests'),
    ('user_account', 'participant_id', 'portal_accounts'), ('session', 'user_id', 'portal_accounts'),
    ('portal_sign_in_code', 'user_id', 'portal_accounts'), ('user_invitation', 'user_id', 'portal_accounts'),
    ('case_file', 'opened_by', 'cases'), ('case_file', 'submitted_by', 'cases'), ('case_event', 'actor_id', 'cases'),
    ('tax_line', 'payee_participant_id', 'tax_lines'), ('tax_form', 'participant_id', 'tax_forms'),
    ('credit_award', 'payee_participant_id', 'credit_awards'), ('credit_redemption', 'participant_id', 'credit_redemptions')
  ) AS exported (t, c, s)
  UNION ALL
  SELECT t, c, NULL, r FROM (VALUES
    ('participant_signal', 'participant_id', 'keyed HMAC digests for duplicate detection, no readable value; deleted on erasure'),
    ('sim_result_line', 'payee_participant_id', 'simulation output: never committed, paid or used for a decision about the person'),
    ('password_credential', 'user_id', 'password hash: a secret, never disclosed; deleted on erasure'),
    ('mfa_credential', 'user_id', 'sealed TOTP secret: never disclosed (enrolment is portal_accounts.mfa_enrolled); deleted on erasure'),
    ('role_assignment', 'user_id', 'a portal account holds no role (role_assignment_staff_only)'),
    ('role_grant_request', 'user_id', 'a portal account holds no role (role_assignment_staff_only)'),
    ('migration_opening_balance', 'participant_id', 'migration opening record: retained as ledger history (the opening entry''s postings are exported under ledger)'),
    ('parallel_run_difference', 'participant_id', 'parallel-run comparison: retained as qualification history, never paid or used for a decision about the person'),
    ('tax_form_generation', 'held', 'staff record of payees held without a tax id: participant ids and external refs only, retained; never in the portal'),
    ('legal_hold', 'participant_id', 'legal-claims restriction: a hold is not disclosed to its subject while active; ids only in logs'),
    ('legal_hold', 'reason', 'legal-claims restriction: a hold is not disclosed to its subject while active; ids only in logs'),
    ('retention_run', 'items', 'ids only: the log of applied retention')
  ) AS excluded (t, c, r)
  UNION ALL
  SELECT t, c, NULL, 'staff action: a portal account holds no permission and never performs it' FROM (VALUES
    ('approval', 'approver_id'), ('approval', 'preparer_id'), ('tenant_setting_version', 'created_by'),
    ('support_session', 'decided_by'), ('support_session', 'requester_id'), ('document', 'uploaded_by'),
    ('import_mapping', 'approved_by'), ('import_batch', 'uploaded_by'), ('compliance_report_snapshot', 'created_by'),
    ('export_job', 'requested_by'), ('role_grant_request', 'requested_by'), ('setting_change_request', 'decided_by'),
    ('setting_change_request', 'requested_by'), ('provider_config', 'created_by'), ('provider_config', 'withdrawn_by'),
    ('market_checklist_entry', 'recorded_by'), ('market_go_live_request', 'decided_by'),
    ('market_go_live_request', 'requested_by'), ('service_account', 'created_by'), ('service_account', 'disabled_by'),
    ('api_key', 'created_by'), ('case_file', 'assigned_to'), ('case_evidence', 'added_by'), ('webhook_endpoint', 'created_by'),
    ('participant_type', 'decided_by'), ('participant_type', 'requested_by'), ('agreement_version', 'published_by'),
    ('product_volume_map', 'created_by'), ('late_transaction', 'decided_by'), ('plan', 'created_by'),
    ('plan_version', 'created_by'), ('plan_version', 'submitted_by'), ('plan_rule', 'created_by'), ('plan_rule', 'updated_by'),
    ('plan_transition', 'created_by'), ('guardrail_decision', 'decided_by'), ('run', 'commit_requested_by'),
    ('run', 'prepared_by'), ('run', 'review_opened_by'), ('simulation', 'requested_by'), ('golden_dataset', 'created_by'),
    ('gl_account_map', 'updated_by'), ('user_related_participant', 'declared_by'), ('user_related_participant', 'user_id'),
    ('user_related_participant', 'withdrawn_by'), ('payout_batch', 'cancelled_by'), ('payout_batch', 'prepared_by'),
    ('payout_batch', 'submitted_by'), ('payout_exception', 'resolved_by'), ('payout_hold', 'placed_by'),
    ('payout_hold', 'released_by'), ('privacy_request', 'verified_by'), ('plan_version_filing', 'recorded_by'),
    ('period', 'closed_by'), ('saved_view', 'user_id'), ('migration', 'created_by'), ('migration', 'opening_submitted_by'),
    ('parallel_run', 'requested_by'), ('parallel_run_difference', 'classified_by'), ('tax_form_generation', 'created_by'),
    ('credit_type', 'created_by'), ('credit_type', 'updated_by'), ('credit_redemption', 'created_by'),
    ('fx_rate_batch', 'proposed_by'), ('retention_schedule', 'proposed_by'), ('legal_hold', 'placed_by'),
    ('legal_hold', 'released_by'), ('tenant_offboarding', 'requested_by'), ('tenant_offboarding', 'confirmed_by'),
    ('tenant_offboarding', 'archived_by'), ('tenant_offboarding', 'purge_requested_by'),
    ('tenant_offboarding', 'purge_approved_by'), ('tenant_offboarding', 'closed_by')
  ) AS staff (t, c)
$$;
