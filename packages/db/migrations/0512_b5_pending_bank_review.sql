-- B5 review (D-B5-12): the payee's undecided bank_detail case, staff-opened ones included. A staff-opened case carries
-- no payload.participant_id, so the portal_self policy hides it inside a portal transaction: the 409
-- BANK_DETAIL_REVIEW_PENDING guard and the screen's pending review missed it. SECURITY DEFINER like
-- pay_shared_fingerprint_count; only the case id and its creation time leave.
CREATE FUNCTION pay_pending_bank_review(p_participant uuid) RETURNS TABLE (case_id uuid, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT c.id, c.created_at FROM case_file c
  WHERE c.tenant_id = assert_participant_scope(p_participant) AND c.type = 'bank_detail' AND c.subject_id = p_participant
    AND c.state IN ('open', 'submitted')
  ORDER BY c.created_at DESC, c.id LIMIT 1
$$;

REVOKE ALL ON FUNCTION pay_pending_bank_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pay_pending_bank_review(uuid) TO nmp_app;
