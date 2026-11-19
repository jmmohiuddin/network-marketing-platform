-- B5 review: erasure also clears a bank_detail.changed notice's previous_masked (the account it replaced), which 0506
-- left in place although ERASURE_CLEARED lists notification.params.masked. The erasure change of a notice is now
-- erased_notice_params: masked, and previous_masked when it holds a value; notification_guard lets the owner make
-- exactly that change. No backfill: 0506 is applied only on unreleased B5 databases, which are reset.

CREATE FUNCTION erased_notice_params(p_params jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('masked', 'erased')
         || CASE WHEN jsonb_typeof(p_params -> 'previous_masked') = 'string' THEN jsonb_build_object('previous_masked', 'erased')
                 ELSE '{}'::jsonb END
$$;

-- notification_guard (0506) with the owner's erasure change widened to erased_notice_params.
CREATE OR REPLACE FUNCTION notification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  delivery_fields constant text[] := ARRAY['state', 'attempts', 'next_attempt_at', 'last_error', 'sent_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on notification is not allowed (notices are evidence)';
  END IF;
  IF acting_as_owner() AND OLD.params ? 'masked' AND NEW.params = OLD.params || erased_notice_params(OLD.params)
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

-- prv_erase_participant (0506) with the notices' masked values cleared through erased_notice_params.
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
  UPDATE privacy_request SET outcome = 'fulfilled', closed_at = now(), retention_basis = coalesce(retention_basis, request.retention_basis)
  WHERE tenant_id = own_tenant AND id = request.id;

  RETURN jsonb_build_object(
    'cleared', jsonb_build_array('participant.display_name', 'participant.contact', 'participant.identity_doc_id',
      'user_account.email', 'user_account.idp_subject', 'user_account.display_name', 'user_account.firebase_subject',
      'password_credential', 'mfa_credential', 'portal_sign_in_code', 'user_invitation (open: revoked)', 'login_attempt',
      'session.ip', 'session.user_agent', 'participant_signal', 'bank_detail_request.details_sealed',
      'bank_detail_request.contact_email_sealed', 'bank_detail_version.details_sealed', 'tax_profile.tax_id_sealed',
      'tax_profile.tax_id_masked', 'notification.params.masked', 'notification.params.previous_masked',
      'notification (queued email: suppressed)', 'privacy_export',
      'privacy_request.corrections_sealed', 'privacy_request.requester_sealed (other requests)'),
    'retained', jsonb_build_array('position', 'relationship', 'result_line', 'qualification_state', 'run_snapshot',
      'journal_entry', 'posting', 'payout_instruction', 'bank_detail fingerprints', 'tax_profile.residency',
      'tax_profile.entity_type', 'notification', 'case_file', 'audit'));
END $$;

