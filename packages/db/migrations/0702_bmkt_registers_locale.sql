-- B-MKT locale, notifications, registers, plan filings, privacy and indexes (PLAN B-MKT sections 1.3 and B; D-BM-08..11,
-- D-BM-13, TK-B6-18).

-- 1. Portal locale preference (D-BM-11): a 2-letter primary subtag on portal accounts, changed by nmp_app only on the
-- acting user's own row and alone in its statement; erasure (owner) clears it.
ALTER TABLE user_account ADD COLUMN locale text
  CONSTRAINT user_account_locale CHECK (locale IS NULL OR (locale ~ '^[a-z]{2}$' AND realm = 'portal'));
GRANT UPDATE (locale) ON user_account TO nmp_app;

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
  IF NEW.locale IS DISTINCT FROM OLD.locale AND NOT acting_as_owner()
     AND (OLD.id IS DISTINCT FROM app_user_id() OR to_jsonb(NEW) - 'locale' IS DISTINCT FROM to_jsonb(OLD) - 'locale') THEN
    RAISE EXCEPTION 'a portal user changes only its own locale, and nothing else with it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 2. Notification locale (C-BM-3): any 2-letter code, set on insert from the recipient's portal locale.
-- portal_locale_for: the participant's open portal account's preference, else the primary subtag of the market's first
-- language when it is two letters, else en (en-GB -> en, de-AT -> de, fil -> en). Internal: definer callers only.
CREATE FUNCTION portal_locale_for(p_tenant uuid, p_participant uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(
    (SELECT u.locale FROM user_account u
     WHERE u.tenant_id = p_tenant AND u.participant_id = p_participant AND u.realm = 'portal' AND u.state <> 'deactivated'),
    (SELECT nullif(d.tag, '') FROM participant x JOIN market m ON m.tenant_id = x.tenant_id AND m.id = x.market_id
     CROSS JOIN LATERAL (SELECT CASE WHEN lower(split_part(m.languages[1], '-', 1)) ~ '^[a-z]{2}$'
                                     THEN lower(split_part(m.languages[1], '-', 1)) ELSE '' END AS tag) d
     WHERE x.tenant_id = p_tenant AND x.id = p_participant),
    'en')
$$;
REVOKE ALL ON FUNCTION portal_locale_for(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION portal_locale(p_participant uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT portal_locale_for(assert_participant_scope(p_participant), p_participant)
$$;
REVOKE ALL ON FUNCTION portal_locale(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_locale(uuid) TO nmp_app;

ALTER TABLE notification DROP CONSTRAINT notification_locale_check,
  ADD CONSTRAINT notification_locale_check CHECK (locale ~ '^[a-z]{2}$');

-- SECURITY DEFINER: the recipient's portal account is outside a portal session's own scope only for other payees,
-- and the row's tenant and recipient pass RLS and the key after this trigger.
CREATE FUNCTION notification_locale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  NEW.locale := portal_locale_for(NEW.tenant_id, NEW.recipient_participant_id);
  RETURN NEW;
END $$;
CREATE TRIGGER notification_locale BEFORE INSERT ON notification FOR EACH ROW EXECUTE FUNCTION notification_locale();

-- 3. Grievance deadlines (D-BM-08): from payload.received_at and the subject market's grievance_register rule in force
-- on that date in the market zone; the acknowledgement in elapsed hours, the resolution in calendar days or months of
-- the market zone. No row without a rule. Pack rows are immutable and received_at is fixed, so this never changes.
CREATE FUNCTION cpl_grievance_deadlines(p_case uuid)
RETURNS TABLE (rule_id text, ack_due_at timestamptz, resolution_due_at timestamptz, lead_hours int)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.id, x.received + make_interval(hours => (r.params ->> 'ack_hours')::int),
         ((x.received AT TIME ZONE m.time_zone)
           + make_interval(days => coalesce((r.params -> 'resolution' ->> 'days')::int, 0),
                           months => coalesce((r.params -> 'resolution' ->> 'months')::int, 0))) AT TIME ZONE m.time_zone,
         coalesce((r.params ->> 'escalation_lead_hours')::int, 0)
  FROM case_file c
  JOIN market m ON m.tenant_id = c.tenant_id AND m.id = c.market_id
  CROSS JOIN LATERAL (SELECT (c.payload ->> 'received_at')::timestamptz AS received) x
  JOIN pack_rule r ON r.market_pack = m.market_pack AND r.kind = 'grievance_register'
    AND r.effective_from <= (x.received AT TIME ZONE m.time_zone)::date
    AND (r.effective_to IS NULL OR r.effective_to > (x.received AT TIME ZONE m.time_zone)::date)
  WHERE c.id = p_case AND c.type = 'grievance'
$$;

-- received_at is fixed at creation for nmp_app too, not only by the API (D-BM-08), so the deadlines never move.
CREATE FUNCTION case_file_received_at_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a grievance''s received_at is fixed at creation' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER case_file_received_at_fixed BEFORE UPDATE OF payload ON case_file FOR EACH ROW
  WHEN (current_user = 'nmp_app' AND NEW.type = 'grievance'
        AND NEW.payload ->> 'received_at' IS DISTINCT FROM OLD.payload ->> 'received_at')
  EXECUTE FUNCTION case_file_received_at_fixed();

-- Whether the system may escalate the grievance now for the deadline: ack while open, resolution while submitted, from
-- due - lead_hours, once per deadline.
CREATE FUNCTION cpl_grievance_escalation_due(p_case uuid, p_deadline text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM case_file c CROSS JOIN LATERAL cpl_grievance_deadlines(c.id) d
    WHERE c.id = p_case
      AND ((p_deadline = 'ack' AND c.state = 'open' AND now() >= d.ack_due_at - make_interval(hours => d.lead_hours))
           OR (p_deadline = 'resolution' AND c.state = 'submitted'
               AND now() >= d.resolution_due_at - make_interval(hours => d.lead_hours)))
      AND NOT EXISTS (SELECT 1 FROM case_event e
                      WHERE e.tenant_id = c.tenant_id AND e.case_id = c.id AND e.kind = 'escalated' AND e.data ->> 'deadline' = p_deadline))
$$;

-- case_event_insert_guard (0506) with the grievance branch: the system escalates a submitted dispute past its due date
-- (unchanged) or a grievance per deadline as cpl_grievance_escalation_due admits it (payload in case_event.data).
CREATE OR REPLACE FUNCTION case_event_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_participant_id() IS NOT NULL AND NOT (
       NEW.kind IN ('opened', 'submitted', 'withdrawn') AND NEW.actor_id IS NOT NULL AND NEW.actor_id IS NOT DISTINCT FROM app_user_id()) THEN
    RAISE EXCEPTION 'a portal transaction records only its own open, submit and withdraw' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.kind = 'escalated' AND NOT (
       NEW.actor_id IS NULL AND app_participant_id() IS NULL AND (
         EXISTS (
           SELECT 1 FROM case_file c
           WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.type = 'dispute' AND c.state = 'submitted' AND c.due_at < now())
         OR coalesce(cpl_grievance_escalation_due(NEW.case_id, NEW.data ->> 'deadline'), false))) THEN
    RAISE EXCEPTION 'an escalation is recorded by the system on a submitted dispute past its due date or a grievance near its deadline'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
-- Once per grievance deadline, also under concurrent escalations (dispute escalations carry no deadline).
CREATE UNIQUE INDEX case_event_escalated_once ON case_event (tenant_id, case_id, (data ->> 'deadline'))
  WHERE kind = 'escalated';

-- System realm only: the grievances the guard would let the system escalate now, across tenants, by due instant.
CREATE FUNCTION cpl_grievances_to_escalate(p_limit int) RETURNS TABLE (tenant_id uuid, case_id uuid, deadline text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT c.tenant_id, c.id, k.deadline
    FROM case_file c
    CROSS JOIN LATERAL (SELECT CASE c.state WHEN 'open' THEN 'ack' ELSE 'resolution' END AS deadline) k
    CROSS JOIN LATERAL cpl_grievance_deadlines(c.id) d
    WHERE c.type = 'grievance' AND c.state IN ('open', 'submitted') AND cpl_grievance_escalation_due(c.id, k.deadline)
    ORDER BY CASE k.deadline WHEN 'ack' THEN d.ack_due_at ELSE d.resolution_due_at END, c.id
    LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION cpl_grievances_to_escalate(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cpl_grievances_to_escalate(int) TO nmp_app;

-- 4. Delisted sellers (D-BM-09): participants of the market (not merged) whose currently owned positions (at least one)
-- were all terminated on or before p_on; terminated_on is the latest termination date in the market zone. CPL applies
-- the rule's fields and window.
CREATE FUNCTION cpl_delisted(p_market uuid, p_on date)
RETURNS TABLE (participant_id uuid, external_ref text, display_name text, terminated_on date)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT x.id, x.external_ref, x.display_name, max((p.status_from AT TIME ZONE m.time_zone)::date)
  FROM participant x
  JOIN market m ON m.tenant_id = x.tenant_id AND m.id = x.market_id
  JOIN position_ownership o ON o.tenant_id = x.tenant_id AND o.participant_id = x.id AND o.valid_from <= now()
    AND (o.valid_to IS NULL OR o.valid_to > now())
  JOIN position p ON p.tenant_id = o.tenant_id AND p.id = o.position_id
  WHERE x.market_id = p_market AND x.status <> 'merged'
  GROUP BY x.id, x.external_ref, x.display_name
  HAVING bool_and(p.status = 'terminated' AND (p.status_from AT TIME ZONE m.time_zone)::date <= p_on)
  ORDER BY 4 DESC, 2
$$;

-- 5. Filing requirements (D-BM-10): a plan market needs a filing when plan.filing_requirements names it or its pack has
-- a plan_filing rule in force today (market zone). One row per market and source.
CREATE FUNCTION plan_filing_required(p_version uuid)
RETURNS TABLE (market_id uuid, source text, rule_id text, authority text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT pm.market_id, 'setting'::text, NULL::text, NULL::text
  FROM plan_version v JOIN plan_market pm ON pm.tenant_id = v.tenant_id AND pm.plan_id = v.plan_id
  WHERE v.id = p_version
    AND pm.market_id::text IN (
      SELECT jsonb_array_elements_text(setting_in_force(v.tenant_id, 'plan.filing_requirements') -> 'market_ids'))
  UNION ALL
  SELECT pm.market_id, 'pack', r.id, r.params ->> 'authority'
  FROM plan_version v
  JOIN plan_market pm ON pm.tenant_id = v.tenant_id AND pm.plan_id = v.plan_id
  JOIN market m ON m.tenant_id = pm.tenant_id AND m.id = pm.market_id
  JOIN pack_rule r ON r.market_pack = m.market_pack AND r.kind = 'plan_filing'
    AND r.effective_from <= (now() AT TIME ZONE m.time_zone)::date
    AND (r.effective_to IS NULL OR r.effective_to > (now() AT TIME ZONE m.time_zone)::date)
  WHERE v.id = p_version
  ORDER BY 1, 2
$$;

CREATE OR REPLACE FUNCTION plan_filing_missing(p_version uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT r.market_id ORDER BY r.market_id), '{}')
  FROM plan_filing_required(p_version) r
  JOIN plan_version v ON v.id = p_version
  WHERE NOT EXISTS (SELECT 1 FROM plan_version_filing f
                    WHERE f.tenant_id = v.tenant_id AND f.plan_version_id = v.id AND f.market_id = r.market_id
                      AND f.content_hash = v.content_hash)
$$;

-- 6. Personal-data map (D-BM-13): tax lines and forms are the payee's data, exported to it (and retained on erasure as
-- tax records of the payer); generations are staff actions whose held list holds payee ids and refs only.
CREATE OR REPLACE FUNCTION prv_personal_data_map()
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
    ('case_file', 'opened_by', 'cases'), ('case_file', 'submitted_by', 'cases'), ('case_event', 'actor_id', 'cases'),
    ('tax_line', 'payee_participant_id', 'tax_lines'), ('tax_form', 'participant_id', 'tax_forms')
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
    ('tax_form_generation', 'held', 'staff record of payees held without a tax id: participant ids and external refs only, retained; never in the portal')
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
    ('parallel_run', 'requested_by'), ('parallel_run_difference', 'classified_by'), ('tax_form_generation', 'created_by')
  ) AS staff (t, c)
$$;

-- The B5 export (0504) plus the subject's tax lines and year-end forms (sections tax_lines, tax_forms).
ALTER FUNCTION prv_personal_data(uuid) RENAME TO prv_personal_data_b5;
CREATE FUNCTION prv_personal_data(p_participant uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT prv_personal_data_b5(p_participant) || jsonb_build_object(
    'tax_lines', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tax_date, x.run_id) FROM (
      SELECT l.run_id, l.rule_id, l.rate::text AS rate, l.rate_basis, l.taxable_minor::text AS taxable_minor,
             l.withheld_minor::text AS withheld_minor, l.tax_year, l.tax_date
      FROM tax_line l WHERE l.payee_participant_id = p_participant) x), '[]'),
    'tax_forms', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tax_year, x.form_type, x.version) FROM (
      SELECT f.tax_year, f.form_type, f.version, f.payee_ref, f.tax_id_masked, f.currency, f.totals, f.created_at
      FROM tax_form f WHERE f.participant_id = p_participant) x), '[]'))
$$;

-- 7. AC-TEN2-3: the B-MKT tables with a key to market (tax form generations and forms).
CREATE OR REPLACE FUNCTION market_references(p_market_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'calendars', (SELECT count(*) FROM calendar WHERE market_id = p_market_id),
    'imports', (SELECT count(*) FROM import_batch WHERE market_id = p_market_id),
    'snapshots', (SELECT count(*) FROM compliance_report_snapshot WHERE market_id = p_market_id),
    'fact_participants', (SELECT count(*) FROM cpl_fact_participant WHERE market_id = p_market_id),
    'providers', (SELECT count(*) FROM provider_config WHERE market_id = p_market_id AND kind <> 'commerce'),
    'connectors', (SELECT count(*) FROM provider_config WHERE market_id = p_market_id AND kind = 'commerce'),
    'checklist_entries', (SELECT count(*) FROM market_checklist_entry WHERE market_id = p_market_id),
    'go_live_requests', (SELECT count(*) FROM market_go_live_request WHERE market_id = p_market_id),
    'cases', (SELECT count(*) FROM case_file WHERE market_id = p_market_id),
    'participants', (SELECT count(*) FROM participant WHERE market_id = p_market_id),
    'positions', (SELECT count(*) FROM position WHERE market_id = p_market_id),
    'orders', (SELECT count(*) FROM sales_order WHERE market_id = p_market_id),
    'product_volumes', (SELECT count(*) FROM product_volume_map WHERE market_id = p_market_id),
    'agreement_versions', (SELECT count(*) FROM agreement_version WHERE market_id = p_market_id),
    'plans', (SELECT count(*) FROM plan_market WHERE market_id = p_market_id),
    'ledger_accounts', (SELECT count(*) FROM ledger_account WHERE market_id = p_market_id),
    'journal_entries', (SELECT count(*) FROM journal_entry WHERE market_id = p_market_id),
    'gl_mappings', (SELECT count(*) FROM gl_account_map WHERE market_id = p_market_id),
    'journal_exports', (SELECT count(*) FROM journal_export WHERE market_id = p_market_id),
    'payout_batches', (SELECT count(*) FROM payout_batch WHERE market_id = p_market_id),
    'payout_holds', (SELECT count(*) FROM payout_hold WHERE market_id = p_market_id),
    'filings', (SELECT count(*) FROM plan_version_filing WHERE market_id = p_market_id),
    'migrations', (SELECT count(*) FROM migration WHERE market_id = p_market_id),
    'tax_form_generations', (SELECT count(*) FROM tax_form_generation WHERE market_id = p_market_id),
    'tax_forms', (SELECT count(*) FROM tax_form WHERE market_id = p_market_id),
    'grants', (SELECT count(*) FROM role_assignment WHERE p_market_id = ANY (market_ids))
            + (SELECT count(*) FROM role_grant_request WHERE p_market_id = ANY (market_ids)))
$$;

-- 8. prv_erase_participant (0606) also clearing the subject's portal locale preference (D-BM-13).
CREATE OR REPLACE FUNCTION prv_erase_participant(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := app_tenant_id();
  request record;
  blockers jsonb;
  account record;
  exports jsonb;
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
  -- TK-B5-18: an adjustment or dispute being opened for the subject holds this lock shared until it commits.
  PERFORM pg_advisory_xact_lock(hashtextextended('erase:' || own_tenant || ':' || request.subject, 0));
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
                            firebase_subject = NULL, mfa_enrolled = false, state = 'deactivated',
                            locale = NULL
    WHERE id = account.id;
  END LOOP;
  DELETE FROM participant_signal WHERE tenant_id = own_tenant AND participant_id = request.subject;
  UPDATE bank_detail_request SET details_sealed = NULL, contact_email_sealed = NULL, masked = 'erased'
  WHERE tenant_id = own_tenant AND participant_id = request.subject AND masked <> 'erased';
  UPDATE bank_detail_version SET details_sealed = NULL, masked = 'erased'
  WHERE tenant_id = own_tenant AND participant_id = request.subject AND masked <> 'erased';
  UPDATE tax_profile SET tax_id_sealed = NULL, tax_id_masked = NULL
  WHERE tenant_id = own_tenant AND participant_id = request.subject AND tax_id_sealed IS NOT NULL;
  UPDATE notification SET params = params || erased_notice_params(params)
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
  UPDATE privacy_request SET outcome = 'fulfilled', closed_at = now(), retention_basis = coalesce(retention_basis, request.retention_basis)
  WHERE tenant_id = own_tenant AND id = request.id;

  RETURN jsonb_build_object(
    'cleared', jsonb_build_array('participant.display_name', 'participant.contact', 'participant.identity_doc_id',
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


-- 9. TK-B6-18: the B6 dashboards' reads (not CONCURRENTLY: migrations run in a transaction).
CREATE INDEX sales_order_market_credited_idx ON sales_order (tenant_id, market_id, credited_at);
CREATE INDEX sales_order_amount_idx ON sales_order (tenant_id, amount_minor, id);
CREATE INDEX order_event_occurred_idx ON order_event (tenant_id, occurred_at);
