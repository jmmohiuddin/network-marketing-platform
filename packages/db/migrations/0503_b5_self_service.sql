-- B5 payee self-service (PLAN B5 section 1.5; D-B5-07, D-B5-12): bank-detail versions written by the payee's own portal
-- session, the shared-account count across payees the self policies hide, and the payout blockers PAY's batch selection
-- and the COMP statement share.

-- 1. A portal transaction writes its own participant's version from a request its user just created ('self'); the staff
-- path (approved bank_detail case) is unchanged (0407).
ALTER TABLE bank_detail_version ADD CONSTRAINT bank_detail_version_self CHECK (created_via <> 'self' OR request_id IS NOT NULL);

CREATE OR REPLACE FUNCTION bank_detail_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW.superseded_at IS NULL AND NEW.created_via = 'self' AND NEW.case_id IS NULL
     AND NEW.participant_id = app_participant_id() AND EXISTS (
       SELECT 1 FROM bank_detail_request r
       WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id AND r.participant_id = NEW.participant_id
         AND r.created_by = app_user_id()
         AND (r.scheme, r.fingerprint, r.masked) = (NEW.scheme, NEW.fingerprint, NEW.masked)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a bank-detail version is created current, as requested, from the approved bank_detail case of its request or by its payee''s own portal session'
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- 2. The setting in force now for a tenant (the chain row with the greatest effective_from, then version; D-B1-01).
CREATE FUNCTION setting_in_force(p_tenant uuid, p_key text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.settings -> p_key FROM tenant_setting_version v
  WHERE v.tenant_id = p_tenant AND v.effective_from <= now()
  ORDER BY v.effective_from DESC, v.version DESC
  LIMIT 1
$$;

-- The caller may ask about a participant of its own tenant only, and a portal transaction only about itself.
CREATE FUNCTION assert_participant_scope(p_participant uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF app_realm() IS DISTINCT FROM 'tenant' OR app_tenant_id() IS NULL
     OR (app_participant_id() IS NOT NULL AND p_participant IS DISTINCT FROM app_participant_id()) THEN
    RAISE EXCEPTION 'only a participant of the acting tenant (in a portal session: itself)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN app_tenant_id();
END $$;

-- 3. D-B5-12: other participants with a current version or a pending (case open or submitted) request of this
-- fingerprint. SECURITY DEFINER: the self policies hide other payees inside a portal transaction; only the count leaves.
CREATE FUNCTION pay_shared_fingerprint_count(p_participant uuid, p_fingerprint bytea) RETURNS int
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := assert_participant_scope(p_participant);
  shared int;
BEGIN
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

-- 4. D-B5-07: the policy-independent exclusion reasons of pay/selection.ts for one payee in one market, in its order and
-- shape ([{reason, detail}], [] when none). A version whose sealed details were erased counts as no bank details.
-- SECURITY DEFINER: a portal statement reads its own blockers through the same function the batch selection uses.
CREATE FUNCTION pay_payee_blockers(p_participant uuid, p_market uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := assert_participant_scope(p_participant);
  version record;
  reasons jsonb := '[]';
BEGIN
  SELECT v.cooling_off_until, v.details_sealed IS NULL AS erased INTO version FROM bank_detail_version v
  WHERE v.tenant_id = own_tenant AND v.participant_id = p_participant AND v.superseded_at IS NULL;
  IF NOT FOUND OR version.erased THEN
    reasons := reasons || jsonb_build_array(jsonb_build_object('reason', 'no_bank_details', 'detail', '{}'::jsonb));
  ELSIF version.cooling_off_until > now() THEN
    reasons := reasons || jsonb_build_array(jsonb_build_object('reason', 'bank_detail_cooling_off',
                                                               'detail', jsonb_build_object('until', json_instant(version.cooling_off_until))));
  END IF;
  reasons := reasons || coalesce((
    SELECT jsonb_agg(jsonb_build_object('reason', 'duplicate_case', 'detail', jsonb_build_object('case_id', c.id)) ORDER BY c.id)
    FROM case_file c WHERE c.tenant_id = own_tenant AND c.type = 'duplicate' AND c.state IN ('open', 'submitted')
      AND c.subject_type = 'participant' AND c.subject_id = p_participant), '[]');
  IF (setting_in_force(own_tenant, 'payouts.market_policy') -> p_market::text ->> 'tax_profile_required') = 'true'
     AND NOT EXISTS (
       SELECT 1 FROM tax_profile t WHERE t.tenant_id = own_tenant AND t.participant_id = p_participant AND t.valid_from <= now()
         AND (t.valid_to IS NULL OR t.valid_to > now())) THEN
    reasons := reasons || jsonb_build_array(jsonb_build_object('reason', 'tax_profile_missing', 'detail', '{}'::jsonb));
  END IF;
  reasons := reasons || coalesce((
    SELECT jsonb_agg(jsonb_build_object('reason', 'hold', 'detail', jsonb_build_object(
             'hold_id', h.id, 'reason', h.reason, 'placed_at', json_instant(h.placed_at))) ORDER BY h.placed_at, h.id)
    FROM payout_hold h WHERE h.tenant_id = own_tenant AND h.participant_id = p_participant AND h.market_id = p_market
      AND h.released_at IS NULL), '[]');
  reasons := reasons || coalesce((
    SELECT jsonb_agg(jsonb_build_object('reason', 'returned_payment_open', 'detail', jsonb_build_object('case_id', c.id)) ORDER BY c.id)
    FROM case_file c
    JOIN payout_instruction i ON i.tenant_id = c.tenant_id AND i.id = c.subject_id
    JOIN payout_batch b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
    WHERE c.tenant_id = own_tenant AND c.type = 'returned_payment' AND c.state IN ('open', 'submitted') AND b.market_id = p_market
      AND i.payee_participant_id = p_participant), '[]');
  RETURN reasons;
END $$;

REVOKE ALL ON FUNCTION pay_shared_fingerprint_count(uuid, bytea), pay_payee_blockers(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pay_shared_fingerprint_count(uuid, bytea), pay_payee_blockers(uuid, uuid) TO nmp_app;
