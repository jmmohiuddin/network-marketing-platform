-- BUG-133 (PLAN B-MKT W-B-MKT-3 "admin@ gives AT-A a contact e-mail"): staff record a contact e-mail for an active
-- participant who has none (e.g. a migrated one, before a portal invitation, D-B5-05). An e-mail already on record is
-- changed only by the DPO correction (prv_correct_participant, D-B5-19), so this path never redirects a member's mail.
-- SECURITY DEFINER: participant_guard admits personal-field changes by the owner only; this function is that change.
CREATE FUNCTION par_record_contact_email(p_participant uuid, p_email text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := app_tenant_id();
BEGIN
  IF app_realm() IS DISTINCT FROM 'tenant' OR own_tenant IS NULL OR app_participant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'a contact e-mail is recorded in a staff transaction of the tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_email IS NULL OR length(p_email) > 320 OR p_email !~ '^[^@\s]+@[^@\s]+$' THEN
    RAISE EXCEPTION 'an e-mail address is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE participant SET contact = coalesce(contact, '{}') || jsonb_build_object('email', p_email)
  WHERE tenant_id = own_tenant AND id = p_participant AND status = 'active' AND pseudonymised_at IS NULL
    AND contact ->> 'email' IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION par_record_contact_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION par_record_contact_email(uuid, text) TO nmp_app;
