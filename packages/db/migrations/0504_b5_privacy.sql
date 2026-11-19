-- B5 privacy (PLAN B5 section 1.4; D-B5-16..19): data-subject requests behind a system-opened privacy case, access and
-- portability exports over the personal-data map, erasure by pseudonymisation and correction (owner-only exemptions on
-- the guards each change must pass, limited to exactly that change), and the deadline lookup.

-- 1. privacy_request: the requester's own details sealed (context privacy_request:<id>); verification, deadline,
-- escalation and outcome set once; sealed values only ever cleared (corrections replaced while the case is open).
CREATE TABLE privacy_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  case_id uuid NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('access', 'correction', 'erasure', 'portability')),
  channel text NOT NULL CHECK (channel IN ('portal', 'public_form', 'staff')),
  subject_participant_id uuid,
  requester_user_id uuid,
  requester_sealed text,
  verified_at timestamptz,
  verified_by uuid,
  verification_method text CHECK (verification_method IN ('portal_session', 'contact_match', 'document', 'other')),
  verification_note text CHECK (verification_note IS NULL OR length(trim(verification_note)) BETWEEN 1 AND 1000),
  due_at timestamptz,
  escalated_at timestamptz,
  outcome text CHECK (outcome IN ('fulfilled', 'refused')),
  retention_basis text CHECK (retention_basis IS NULL OR length(trim(retention_basis)) BETWEEN 1 AND 2000),
  corrections_sealed text,
  closed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(), -- no key: the public form writes as the system
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CONSTRAINT privacy_request_verification CHECK ((verified_at IS NULL) = (verification_method IS NULL)),
  CONSTRAINT privacy_request_verified_subject CHECK (verified_at IS NULL OR subject_participant_id IS NOT NULL),
  CONSTRAINT privacy_request_portal_session
    CHECK (verified_at IS NULL OR (verification_method = 'portal_session') = (channel = 'portal')),
  CONSTRAINT privacy_request_closed CHECK ((outcome IS NULL) = (closed_at IS NULL)),
  CONSTRAINT privacy_request_due_after_verification CHECK (due_at IS NULL OR verified_at IS NOT NULL),
  CONSTRAINT privacy_request_portal_requester CHECK (channel <> 'portal' OR requester_user_id IS NOT NULL),
  CONSTRAINT privacy_request_corrections CHECK (corrections_sealed IS NULL OR type = 'correction'),
  FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  FOREIGN KEY (tenant_id, subject_participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, requester_user_id) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, verified_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX privacy_request_due_idx ON privacy_request (tenant_id, due_at);
CREATE INDEX privacy_request_subject_idx ON privacy_request (tenant_id, subject_participant_id);

-- Created with its own privacy case (subject = this request), undecided; a portal request is the session participant's
-- own, verified by the session; any other is created unverified.
CREATE FUNCTION privacy_request_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM case_file c
                 WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.type = 'privacy'
                   AND c.subject_type = 'privacy_request' AND c.subject_id = NEW.id)
     OR num_nonnulls(NEW.escalated_at, NEW.outcome, NEW.closed_at, NEW.retention_basis, NEW.due_at) > 0
     OR (CASE WHEN NEW.channel = 'portal'
              THEN NEW.requester_user_id IS DISTINCT FROM app_user_id()
                   OR NEW.subject_participant_id IS DISTINCT FROM app_participant_id()
                   OR NEW.verification_method IS DISTINCT FROM 'portal_session'
              ELSE app_participant_id() IS NOT NULL OR NEW.verified_at IS NOT NULL END) THEN
    RAISE EXCEPTION 'a privacy request is created open with its own privacy case (a portal request by and about the session participant)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER privacy_request_insert_guard BEFORE INSERT ON privacy_request
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION privacy_request_insert_guard();

CREATE FUNCTION privacy_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  set_once constant text[] := ARRAY['verified_at', 'verified_by', 'verification_method', 'verification_note',
                                    'subject_participant_id', 'due_at', 'escalated_at', 'outcome', 'closed_at',
                                    'retention_basis'];
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
         AND NOT EXISTS (SELECT 1 FROM case_file c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.state = 'open')) THEN
    RAISE EXCEPTION 'a privacy request''s verification, deadline, escalation and outcome are set once; sealed values are only cleared (corrections replaced while its case is open)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER privacy_request_set_once BEFORE UPDATE OR DELETE ON privacy_request
  FOR EACH ROW EXECUTE FUNCTION privacy_request_guard();
CREATE TRIGGER privacy_request_verified_by_actor BEFORE UPDATE OF verified_by ON privacy_request
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND NEW.verified_by IS NOT NULL) EXECUTE FUNCTION actor_is_acting_user('verified_by');

-- 2. privacy_export (D-B5-17): the gzip JSON of an approved access or portability request, hashed on insert; deleted
-- only by the erasure of its subject (owner, no DELETE grant).
CREATE TABLE privacy_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  request_id uuid NOT NULL UNIQUE,
  content bytea NOT NULL,
  content_sha256 bytea NOT NULL CHECK (length(content_sha256) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, request_id) REFERENCES privacy_request (tenant_id, id),
  UNIQUE (tenant_id, id)
);

CREATE FUNCTION privacy_export_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'nmp_app' AND NOT EXISTS (
       SELECT 1 FROM privacy_request r JOIN case_file c ON c.tenant_id = r.tenant_id AND c.id = r.case_id
       WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id AND r.type IN ('access', 'portability')
         AND c.state = 'approved') THEN
    RAISE EXCEPTION 'an export is written for an approved access or portability request' USING ERRCODE = 'check_violation';
  END IF;
  NEW.content_sha256 := digest(NEW.content, 'sha256');
  RETURN NEW;
END $$;
CREATE TRIGGER privacy_export_insert_guard BEFORE INSERT ON privacy_export
  FOR EACH ROW EXECUTE FUNCTION privacy_export_insert_guard();
CREATE TRIGGER privacy_export_no_update BEFORE UPDATE ON privacy_export FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['privacy_request', 'privacy_export']::regclass[]) AS t;
CREATE POLICY portal_self ON privacy_request AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR subject_participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR subject_participant_id = app_participant_id());
CREATE POLICY portal_self ON privacy_export AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM privacy_request r WHERE r.id = privacy_export.request_id AND r.subject_participant_id = app_participant_id()))
  WITH CHECK (app_participant_id() IS NULL OR EXISTS (
    SELECT 1 FROM privacy_request r WHERE r.id = privacy_export.request_id AND r.subject_participant_id = app_participant_id()));

GRANT SELECT, INSERT ON privacy_request, privacy_export TO nmp_app;
GRANT UPDATE (verified_at, verified_by, verification_method, verification_note, subject_participant_id, due_at,
  escalated_at, outcome, retention_basis, closed_at, requester_sealed, corrections_sealed) ON privacy_request TO nmp_app;

-- 3. Erasure and correction exemptions (D-B5-18, D-B5-19). current_user is the owner only inside the SECURITY DEFINER
-- functions below (and migrations); the runtime role keeps every refusal.
-- The owner changes nothing but the listed columns, each to NULL.
CREATE FUNCTION erasure_clears_only(p_old jsonb, p_new jsonb, p_cleared text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_user <> 'nmp_app' AND p_new - p_cleared = p_old - p_cleared
     AND NOT EXISTS (SELECT 1 FROM unnest(p_cleared) c WHERE p_new -> c <> 'null'::jsonb)
$$;

-- participant: a merge (0200), or, for the owner, pseudonymisation (personal fields cleared, pseudonymised_at set once)
-- or correction (display_name, contact) of a participant not yet pseudonymised.
CREATE OR REPLACE FUNCTION participant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  merge_fields constant text[] := ARRAY['status', 'merged_into_id'];
  personal_fields constant text[] := ARRAY['display_name', 'contact', 'identity_doc_id', 'pseudonymised_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on participant is not allowed';
  END IF;
  IF (OLD.status = 'active' AND NEW.status = 'merged' AND to_jsonb(NEW) - merge_fields = to_jsonb(OLD) - merge_fields)
     OR (current_user <> 'nmp_app' AND OLD.pseudonymised_at IS NULL
         AND to_jsonb(NEW) - personal_fields = to_jsonb(OLD) - personal_fields
         AND CASE WHEN NEW.pseudonymised_at IS NULL THEN NEW.identity_doc_id IS NOT DISTINCT FROM OLD.identity_doc_id
                  ELSE num_nulls(NEW.display_name, NEW.contact, NEW.identity_doc_id) = 3 END) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a participant changes only by a merge, once (or by its erasure or correction)' USING ERRCODE = 'check_violation';
END $$;

-- participant_signal: never updated; deleted only by erasure (nmp_app holds no DELETE grant).
DROP TRIGGER participant_signal_no_mutation ON participant_signal;
CREATE TRIGGER participant_signal_no_update BEFORE UPDATE ON participant_signal FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Bank details: sealed details (and a request's contact email) are cleared by erasure, the mask becoming 'erased'; the
-- trigger arguments are the columns otherwise set once (none for a request, superseded_at for a version).
ALTER TABLE bank_detail_request
  ALTER COLUMN details_sealed DROP NOT NULL,
  ADD CONSTRAINT bank_detail_request_erased CHECK (details_sealed IS NOT NULL OR masked = 'erased');
ALTER TABLE bank_detail_version
  ALTER COLUMN details_sealed DROP NOT NULL,
  ADD CONSTRAINT bank_detail_version_erased CHECK (details_sealed IS NOT NULL OR masked = 'erased');

CREATE FUNCTION bank_detail_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  set_once constant text[] := coalesce(TG_ARGV::text[], '{}');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on % is not allowed (history)', TG_TABLE_NAME;
  END IF;
  IF NEW.masked = 'erased'
     AND erasure_clears_only(to_jsonb(OLD) - 'masked', to_jsonb(NEW) - 'masked', ARRAY['details_sealed', 'contact_email_sealed']) THEN
    RETURN NEW;
  END IF;
  IF to_jsonb(NEW) - set_once IS DISTINCT FROM to_jsonb(OLD) - set_once
     OR EXISTS (SELECT 1 FROM unnest(set_once) c
                WHERE to_jsonb(OLD) -> c <> 'null'::jsonb AND to_jsonb(NEW) -> c IS DISTINCT FROM to_jsonb(OLD) -> c) THEN
    RAISE EXCEPTION 'UPDATE on % is not allowed beyond setting % once, or its erasure', TG_TABLE_NAME, set_once
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER bank_detail_request_no_mutation ON bank_detail_request;
CREATE TRIGGER bank_detail_request_erased_only BEFORE UPDATE OR DELETE ON bank_detail_request
  FOR EACH ROW EXECUTE FUNCTION bank_detail_guard();
DROP TRIGGER bank_detail_version_superseded_once ON bank_detail_version;
CREATE TRIGGER bank_detail_version_superseded_once BEFORE UPDATE OR DELETE ON bank_detail_version
  FOR EACH ROW EXECUTE FUNCTION bank_detail_guard('superseded_at');

-- tax_profile: valid_to set once (0403), or the tax id cleared by erasure on any version (residency and entity type kept).
CREATE FUNCTION tax_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on tax_profile is not allowed (history)';
  END IF;
  IF erasure_clears_only(to_jsonb(OLD), to_jsonb(NEW), ARRAY['tax_id_sealed', 'tax_id_masked'])
     OR (to_jsonb(NEW) - 'valid_to' = to_jsonb(OLD) - 'valid_to'
         AND (OLD.valid_to IS NULL OR NEW.valid_to IS NOT DISTINCT FROM OLD.valid_to)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'tax_profile.valid_to is set once; the tax id is cleared only by erasure' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER tax_profile_closed_once ON tax_profile;
CREATE TRIGGER tax_profile_closed_once BEFORE UPDATE OR DELETE ON tax_profile FOR EACH ROW EXECUTE FUNCTION tax_profile_guard();

-- 4. The personal-data map (D-B5-17): every column with a key to participant or user_account, either exported under a
-- section of prv_personal_data or excluded with the reason. packages/db/test/b5-privacy.test.ts fails on a key it lacks.
CREATE FUNCTION prv_personal_data_map()
RETURNS TABLE (table_name text, column_name text, section text, reason text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT t, c, s, NULL FROM (VALUES
    ('participant', 'merged_into_id', 'participant'), ('participant_type_assignment', 'participant_id', 'types'),
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
    ('case_file', 'opened_by', 'cases'), ('case_file', 'submitted_by', 'cases'), ('case_event', 'actor_id', 'cases')
  ) AS exported (t, c, s)
  UNION ALL
  SELECT t, c, NULL, r FROM (VALUES
    ('participant_signal', 'participant_id', 'keyed HMAC digests for duplicate detection, no readable value; deleted on erasure'),
    ('sim_result_line', 'payee_participant_id', 'simulation output: never committed, paid or used for a decision about the person'),
    ('password_credential', 'user_id', 'password hash: a secret, never disclosed; deleted on erasure'),
    ('mfa_credential', 'user_id', 'sealed TOTP secret: never disclosed (enrolment is portal_accounts.mfa_enrolled); deleted on erasure'),
    ('role_assignment', 'user_id', 'a portal account holds no role (role_assignment_staff_only)'),
    ('role_grant_request', 'user_id', 'a portal account holds no role (role_assignment_staff_only)')
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
    ('payout_hold', 'released_by'), ('privacy_request', 'verified_by')
  ) AS staff (t, c)
$$;

-- Rows of login_attempt for a portal account's key (nmp_app holds no privilege on login_attempt): the account must be a
-- portal account of the acting tenant (in a portal transaction, of the session participant).
CREATE FUNCTION prv_sign_in_attempts(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  attempt_key text;
BEGIN
  SELECT 'portal:' || t.slug || ':' || u.email INTO attempt_key
  FROM user_account u JOIN tenant t ON t.id = u.tenant_id
  WHERE u.id = p_user AND u.realm = 'portal' AND u.tenant_id = app_tenant_id() AND app_realm() = 'tenant'
    AND u.participant_id = coalesce(app_participant_id(), u.participant_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only a portal account of the acting tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('attempted_at', a.attempted_at, 'ip', a.ip, 'succeeded', a.succeeded)
                                    ORDER BY a.attempted_at, a.id)
                   FROM login_attempt a WHERE a.account_key = attempt_key), '[]');
END $$;

-- D-B5-17: the subject's personal data, one key per section of the map; money as strings, masked values only.
CREATE FUNCTION prv_personal_data(p_participant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  subject participant;
  accounts uuid[];
  requests uuid[];
BEGIN
  PERFORM assert_participant_scope(p_participant);
  SELECT * INTO subject FROM participant WHERE id = p_participant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown participant' USING ERRCODE = 'foreign_key_violation';
  END IF;
  accounts := array(SELECT u.id FROM user_account u WHERE u.participant_id = p_participant ORDER BY u.created_at, u.id);
  requests := array(SELECT r.id FROM privacy_request r
                    WHERE r.subject_participant_id = p_participant OR r.requester_user_id = ANY (accounts));
  RETURN jsonb_build_object(
    'participant', jsonb_build_object(
      'id', subject.id, 'external_ref', subject.external_ref, 'account_type', subject.account_type,
      'market_id', subject.market_id, 'display_name', subject.display_name, 'contact', subject.contact,
      'status', subject.status, 'enrolled_at', subject.enrolled_at, 'pseudonymised_at', subject.pseudonymised_at,
      'merged_from', coalesce((SELECT jsonb_agg(m.external_ref ORDER BY m.external_ref) FROM participant m
                               WHERE m.merged_into_id = p_participant), '[]')),
    'types', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.valid_from) FROM (
      SELECT t.code, t.name, a.valid_from, a.valid_to FROM participant_type_assignment a
      JOIN participant_type t ON t.tenant_id = a.tenant_id AND t.id = a.type_id WHERE a.participant_id = p_participant) x), '[]'),
    'positions', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.owned_from, x.position_ref) FROM (
      SELECT p.position_ref, m.code AS market, p.status, o.valid_from AS owned_from, o.valid_to AS owned_to,
             (SELECT q.position_ref FROM relationship r JOIN position q ON q.tenant_id = r.tenant_id AND q.id = r.parent_position_id
              WHERE r.child_position_id = p.id AND r.kind = 'sponsor' AND r.superseded_at IS NULL AND r.valid_from <= now()
                AND (r.valid_to IS NULL OR r.valid_to > now())) AS sponsor_ref,
             (SELECT q.position_ref FROM relationship r JOIN position q ON q.tenant_id = r.tenant_id AND q.id = r.parent_position_id
              WHERE r.child_position_id = p.id AND r.kind = 'placement' AND r.superseded_at IS NULL AND r.valid_from <= now()
                AND (r.valid_to IS NULL OR r.valid_to > now())) AS placement_ref
      FROM position_ownership o JOIN position p ON p.tenant_id = o.tenant_id AND p.id = o.position_id
      JOIN market m ON m.tenant_id = p.tenant_id AND m.id = p.market_id WHERE o.participant_id = p_participant) x), '[]'),
    'agreement_acceptances', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.accepted_at) FROM (
      SELECT v.label, a.accepted_at FROM agreement_acceptance a
      JOIN agreement_version v ON v.tenant_id = a.tenant_id AND v.id = a.agreement_version_id
      WHERE a.participant_id = p_participant) x), '[]'),
    'orders', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ordered_at, x.source_order_id) FROM (
      SELECT o.source_system, o.source_order_id, o.ordered_at, o.amount_minor::text AS amount_minor,
             o.tax_minor::text AS tax_minor, o.currency, o.purpose
      FROM sales_order o WHERE o.buyer_id = p_participant) x), '[]'),
    'servicing', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.valid_from) FROM (
      SELECT p.position_ref AS servicing_position_ref, s.source, s.valid_from, s.valid_to FROM customer_servicing s
      LEFT JOIN position p ON p.tenant_id = s.tenant_id AND p.id = s.servicing_position_id
      WHERE s.customer_id = p_participant) x), '[]'),
    'result_lines', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM (
      SELECT l.id, l.run_id, r.state AS run_state, p.position_ref, l.rule_key, l.bonus_type, l.amount_minor::text AS amount_minor,
             l.currency, l.created_at
      FROM result_line l JOIN run r ON r.tenant_id = l.tenant_id AND r.id = l.run_id
      JOIN position p ON p.tenant_id = l.tenant_id AND p.id = l.payee_position_id
      WHERE l.payee_participant_id = p_participant) x), '[]'),
    'statements', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.run_id) FROM (
      SELECT s.run_id, s.gross_minor::text AS gross_minor, s.receivable_before_minor::text AS receivable_before_minor,
             s.netted_minor::text AS netted_minor, s.withheld_minor::text AS withheld_minor,
             s.net_payable_minor::text AS net_payable_minor
      FROM run_settlement s WHERE s.payee_participant_id = p_participant) x), '[]'),
    'ledger', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.posted_at, x.entry_id, x.account_type) FROM (
      SELECT m.code AS market, a.type AS account_type, e.id AS entry_id, e.event_type, e.posted_at,
             x.debit_minor::text AS debit_minor, x.credit_minor::text AS credit_minor, x.currency
      FROM ledger_account a JOIN posting x ON x.tenant_id = a.tenant_id AND x.account_id = a.id
      JOIN journal_entry e ON e.tenant_id = x.tenant_id AND e.id = x.entry_id
      JOIN market m ON m.tenant_id = a.tenant_id AND m.id = a.market_id
      WHERE a.payee_participant_id = p_participant) x), '[]'),
    'related_staff_declarations', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.declared_at) FROM (
      SELECT d.relation, d.declared_at, d.withdrawn_at FROM user_related_participant d WHERE d.participant_id = p_participant) x), '[]'),
    'bank_detail_requests', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM (
      SELECT r.id, r.scheme, r.masked, r.created_at FROM bank_detail_request r WHERE r.participant_id = p_participant) x), '[]'),
    'bank_detail_versions', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (
      SELECT v.scheme, v.masked, v.created_via, v.created_at, v.cooling_off_until, v.superseded_at
      FROM bank_detail_version v WHERE v.participant_id = p_participant) x), '[]'),
    'payout_batch_lines', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.batch_id) FROM (
      SELECT l.batch_id, l.amount_minor::text AS amount_minor FROM payout_batch_line l WHERE l.participant_id = p_participant) x), '[]'),
    'payout_instructions', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM (
      SELECT i.id, i.batch_id, i.amount_minor::text AS amount_minor, i.currency, i.state, v.masked, i.created_at, i.terminal_at
      FROM payout_instruction i JOIN bank_detail_version v ON v.tenant_id = i.tenant_id AND v.id = i.bank_detail_version_id
      WHERE i.payee_participant_id = p_participant) x), '[]'),
    'payout_holds', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.placed_at) FROM (
      SELECT m.code AS market, h.placed_at, h.released_at FROM payout_hold h
      JOIN market m ON m.tenant_id = h.tenant_id AND m.id = h.market_id WHERE h.participant_id = p_participant) x), '[]'),
    'tax_profiles', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.valid_from) FROM (
      SELECT t.residency, t.entity_type, t.tax_id_masked, t.valid_from, t.valid_to FROM tax_profile t
      WHERE t.participant_id = p_participant) x), '[]'),
    'cases', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id) FROM (
      SELECT c.id, c.type, c.state, c.created_at, c.submitted_at, c.decided_at FROM case_file c
      WHERE c.payload ->> 'participant_id' = p_participant::text OR c.opened_by = ANY (accounts)
         OR (c.subject_type = 'participant' AND c.subject_id = p_participant)
         OR (c.subject_type = 'privacy_request' AND c.subject_id = ANY (requests))
         OR (c.subject_type = 'position' AND EXISTS (SELECT 1 FROM position_ownership o
                                                     WHERE o.position_id = c.subject_id AND o.participant_id = p_participant))
         OR (c.subject_type = 'ledger_account' AND EXISTS (SELECT 1 FROM ledger_account a
                                                           WHERE a.id = c.subject_id AND a.payee_participant_id = p_participant))) x), '[]'),
    'notifications', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (
      SELECT n.template, n.channel, n.state, n.created_at, n.sent_at, n.read_at FROM notification n
      WHERE n.recipient_participant_id = p_participant) x), '[]'),
    'notification_preferences', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.topic) FROM (
      SELECT n.topic, n.email, n.updated_at FROM notification_preference n WHERE n.participant_id = p_participant) x), '[]'),
    'portal_accounts', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'email', u.email, 'state', u.state, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
        'mfa_enrolled', u.mfa_enrolled,
        'sessions', coalesce((SELECT jsonb_agg(jsonb_build_object('created_at', s.created_at, 'last_seen_at', s.last_seen_at,
                                                                  'expires_at', s.expires_at, 'revoked_at', s.revoked_at, 'ip', s.ip)
                                               ORDER BY s.created_at) FROM session s WHERE s.user_id = u.id), '[]'),
        'sign_in_attempts', prv_sign_in_attempts(u.id),
        'sign_in_codes', coalesce((SELECT jsonb_agg(jsonb_build_object('created_at', k.created_at, 'used_at', k.used_at)
                                                    ORDER BY k.created_at) FROM portal_sign_in_code k WHERE k.user_id = u.id), '[]'),
        'invitations', coalesce((SELECT jsonb_agg(jsonb_build_object('created_at', i.created_at, 'used_at', i.used_at,
                                                                     'revoked_at', i.revoked_at) ORDER BY i.created_at)
                                 FROM user_invitation i WHERE i.user_id = u.id), '[]'))
      ORDER BY u.created_at, u.id) FROM user_account u WHERE u.id = ANY (accounts)), '[]'),
    'privacy_requests', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.received_at, x.id) FROM (
      SELECT r.id, r.type, r.channel, r.received_at, r.verified_at, r.verification_method, r.due_at, r.outcome,
             r.retention_basis, r.closed_at FROM privacy_request r WHERE r.id = ANY (requests)) x), '[]'));
END $$;

-- D-B5-18: what defers an erasure ([] when nothing), in this order: a positive payable per market, instructions in
-- flight, active holds, open money cases that could create a payable later.
CREATE FUNCTION prv_erasure_blockers(p_participant uuid) RETURNS jsonb
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
  ) b), '[]');
END $$;

-- D-B5-18: erasure in the approval transaction of an erasure request (SECURITY DEFINER: it passes the guards' owner-only
-- exemptions; every statement names the acting tenant). Blockers under the subject's ledger locks raise PV001 with the
-- blockers JSON as DETAIL (409 ERASURE_DEFERRED; the decision rolls back).
CREATE FUNCTION prv_erase_participant(p_request uuid) RETURNS jsonb
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
  FROM (SELECT DISTINCT a.market_id FROM ledger_account a
        WHERE a.tenant_id = own_tenant AND a.payee_participant_id = request.subject ORDER BY 1) m;
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
      'participant_signal', 'bank_detail_request.details_sealed', 'bank_detail_request.contact_email_sealed',
      'bank_detail_version.details_sealed', 'tax_profile.tax_id_sealed', 'tax_profile.tax_id_masked',
      'notification (queued email: suppressed)', 'privacy_export', 'privacy_request.corrections_sealed',
      'privacy_request.requester_sealed (other requests)'),
    'retained', jsonb_build_array('position', 'relationship', 'result_line', 'qualification_state', 'run_snapshot',
      'journal_entry', 'posting', 'payout_instruction', 'bank_detail fingerprints', 'tax_profile.residency',
      'tax_profile.entity_type', 'notification', 'case_file', 'audit'));
END $$;

-- D-B5-19: the corrections of an approved correction request, values unsealed by the API; the given fields must be
-- exactly the case payload's field names.
CREATE FUNCTION prv_correct_participant(p_request uuid, p_display_name text, p_contact jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := app_tenant_id();
  request record;
  fields text[];
BEGIN
  IF app_realm() IS DISTINCT FROM 'tenant' OR own_tenant IS NULL OR app_participant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'a correction runs in a staff transaction of the tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT r.id, r.type, r.subject_participant_id AS subject, c.state, c.payload INTO request
  FROM privacy_request r JOIN case_file c ON c.tenant_id = r.tenant_id AND c.id = r.case_id
  WHERE r.tenant_id = own_tenant AND r.id = p_request
  FOR UPDATE OF r;
  IF NOT FOUND OR request.type <> 'correction' OR request.state <> 'approved' OR request.subject IS NULL THEN
    RAISE EXCEPTION 'a correction needs an approved correction request with a subject' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_contact IS NOT NULL AND (jsonb_typeof(p_contact) <> 'object' OR EXISTS (
       SELECT 1 FROM jsonb_each(p_contact) e WHERE e.key NOT IN ('email', 'phone') OR jsonb_typeof(e.value) <> 'string')) THEN
    RAISE EXCEPTION 'contact corrections are {email?, phone?} strings' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  fields := array(SELECT f FROM (SELECT 'display_name' AS f WHERE p_display_name IS NOT NULL
                                 UNION ALL SELECT 'contact.' || k FROM jsonb_object_keys(coalesce(p_contact, '{}')) k) x ORDER BY f);
  IF cardinality(fields) = 0
     OR fields <> array(SELECT f FROM jsonb_array_elements_text(coalesce(request.payload -> 'corrections', '[]')) f ORDER BY f) THEN
    RAISE EXCEPTION 'the corrected fields must be the request''s fields' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE participant SET display_name = coalesce(p_display_name, display_name),
                         contact = CASE WHEN p_contact IS NULL THEN contact ELSE coalesce(contact, '{}') || p_contact END
  WHERE tenant_id = own_tenant AND id = request.subject AND pseudonymised_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a pseudonymised participant is not corrected' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE privacy_request SET corrections_sealed = NULL WHERE tenant_id = own_tenant AND id = request.id;
  RETURN jsonb_build_object('fields', to_jsonb(fields));
END $$;

-- System realm only: open, verified requests not yet escalated whose due date minus the tenant's
-- privacy.policy.escalate_before_days has come (no policy: none).
CREATE FUNCTION privacy_deadline_lookup(p_limit int) RETURNS TABLE (tenant_id uuid, request_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT r.tenant_id, r.id FROM privacy_request r
    CROSS JOIN LATERAL (SELECT (setting_in_force(r.tenant_id, 'privacy.policy') ->> 'escalate_before_days')::int AS days) s
    WHERE r.closed_at IS NULL AND r.due_at IS NOT NULL AND r.escalated_at IS NULL AND s.days IS NOT NULL
      AND r.due_at - make_interval(days => s.days) <= now()
    ORDER BY r.due_at, r.id
    LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION prv_sign_in_attempts(uuid), prv_erase_participant(uuid), prv_correct_participant(uuid, text, jsonb),
  privacy_deadline_lookup(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prv_sign_in_attempts(uuid), prv_erase_participant(uuid), prv_correct_participant(uuid, text, jsonb),
  privacy_deadline_lookup(int) TO nmp_app;
