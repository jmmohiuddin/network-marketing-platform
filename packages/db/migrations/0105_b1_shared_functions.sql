-- B1 shared SQL functions (PLAN B1 sections 1.8, 4): the only cross-module reads of B1, each answering one question.
-- SECURITY INVOKER unless stated, so row-level security keeps every answer inside the caller's tenant.

-- FR-IAM-004: who may approve. Active tenant users holding, now, a role with the permission over the market (all-
-- markets grants included), MFA enrolled where the role requires it, minus the excluded users.
CREATE FUNCTION approval_eligible_users(p_permission text, p_market_id uuid, p_exclude uuid[])
RETURNS TABLE (user_id uuid, display_name text, email text)
LANGUAGE sql STABLE AS $$
  SELECT u.id, u.display_name, u.email FROM user_account u
  WHERE u.realm = 'tenant' AND u.state = 'active' AND u.id <> ALL (coalesce(p_exclude, '{}'))
    AND EXISTS (
      SELECT 1 FROM role_assignment a JOIN role r ON r.id = a.role_id
      WHERE a.user_id = u.id AND a.tenant_id = u.tenant_id
        AND a.valid_from <= now() AND (a.valid_to IS NULL OR a.valid_to > now())
        AND p_permission = ANY (r.permissions)
        AND (a.market_ids IS NULL OR p_market_id IS NULL OR p_market_id = ANY (a.market_ids))
        AND (NOT r.mfa_required OR u.mfa_enrolled))
  ORDER BY u.display_name, u.email
$$;

-- D-B1-04: the objects that reference an evidence document. Download access follows them.
CREATE FUNCTION document_references(p_document_id uuid)
RETURNS TABLE (object_type text, object_id uuid, market_id uuid, case_type text)
LANGUAGE sql STABLE AS $$
  SELECT 'market_checklist_entry', e.id, e.market_id, NULL FROM market_checklist_entry e WHERE e.document_id = p_document_id
  UNION ALL
  SELECT 'provider_config', p.id, p.market_id, NULL FROM provider_config p WHERE p.approval_document_id = p_document_id
  UNION ALL
  SELECT 'market_go_live_request', g.id, g.market_id, NULL FROM market_go_live_request g WHERE g.risk_document_id = p_document_id
  UNION ALL
  SELECT 'case_file', c.id, c.market_id, c.type
  FROM case_evidence v JOIN case_file c ON c.tenant_id = v.tenant_id AND c.id = v.case_id
  WHERE v.document_id = p_document_id
$$;

-- D-B1-04: a document is referenced once, by its uploader, and only as evidence. P0002 = "no such document" for the
-- caller, so the API answers 422 DOCUMENT_NOT_FOUND and never tells someone else's document from a missing one.
CREATE FUNCTION assert_document_referenceable(p_document_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM document d
                 WHERE d.id = p_document_id AND d.class = 'evidence' AND d.uploaded_by = app_user_id())
     OR EXISTS (SELECT 1 FROM document_references(p_document_id)) THEN
    RAISE EXCEPTION 'document % cannot be referenced here', p_document_id USING ERRCODE = 'no_data_found';
  END IF;
END $$;

-- Applies to the runtime role; the owner (migrations, test fixtures) is exempt as in D-B1-17. Argument = the column.
CREATE FUNCTION document_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_document_referenceable((to_jsonb(NEW) ->> TG_ARGV[0])::uuid);
  RETURN NEW;
END $$;
CREATE TRIGGER document_reference_guard BEFORE INSERT ON market_checklist_entry
  FOR EACH ROW WHEN (NEW.document_id IS NOT NULL AND current_user = 'nmp_app')
  EXECUTE FUNCTION document_reference_guard('document_id');
CREATE TRIGGER document_reference_guard BEFORE INSERT ON provider_config
  FOR EACH ROW WHEN (NEW.approval_document_id IS NOT NULL AND current_user = 'nmp_app')
  EXECUTE FUNCTION document_reference_guard('approval_document_id');
CREATE TRIGGER document_reference_guard BEFORE INSERT ON market_go_live_request
  FOR EACH ROW WHEN (NEW.risk_document_id IS NOT NULL AND current_user = 'nmp_app')
  EXECUTE FUNCTION document_reference_guard('risk_document_id');
CREATE TRIGGER document_reference_update_guard BEFORE UPDATE OF risk_document_id ON market_go_live_request
  FOR EACH ROW WHEN (NEW.risk_document_id IS NOT NULL AND NEW.risk_document_id IS DISTINCT FROM OLD.risk_document_id
                     AND current_user = 'nmp_app')
  EXECUTE FUNCTION document_reference_guard('risk_document_id');
CREATE TRIGGER document_reference_guard BEFORE INSERT ON case_evidence
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION document_reference_guard('document_id');

-- What TEN and PAY show of a referenced document (no TS import of AUD).
CREATE FUNCTION document_summary(p_document_id uuid)
RETURNS TABLE (id uuid, file_name text, mime text, size_bytes bigint, sha256 text)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.file_name, d.mime, d.size_bytes, encode(d.sha256, 'hex') FROM document d WHERE d.id = p_document_id
$$;

-- AC-TEN2-3: everything that keeps a market from being deleted. migrations.test.ts compares the referencing tables
-- with the catalogue, so a new key to market fails a test until it is counted here.
CREATE FUNCTION market_references(p_market_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'calendars', (SELECT count(*) FROM calendar WHERE market_id = p_market_id),
    'imports', (SELECT count(*) FROM import_batch WHERE market_id = p_market_id),
    'snapshots', (SELECT count(*) FROM compliance_report_snapshot WHERE market_id = p_market_id),
    'fact_participants', (SELECT count(*) FROM cpl_fact_participant WHERE market_id = p_market_id),
    'providers', (SELECT count(*) FROM provider_config WHERE market_id = p_market_id),
    'checklist_entries', (SELECT count(*) FROM market_checklist_entry WHERE market_id = p_market_id),
    'go_live_requests', (SELECT count(*) FROM market_go_live_request WHERE market_id = p_market_id),
    'cases', (SELECT count(*) FROM case_file WHERE market_id = p_market_id),
    'grants', (SELECT count(*) FROM role_assignment WHERE p_market_id = ANY (market_ids))
            + (SELECT count(*) FROM role_grant_request WHERE p_market_id = ANY (market_ids)))
$$;

-- AC-TEN2-6: a brand is referenced by the grants scoped to it.
CREATE FUNCTION brand_references(p_brand_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('grants', (SELECT count(*) FROM role_assignment WHERE p_brand_id = ANY (brand_ids)))
$$;

-- BUG-023: the vendor user who asked for a support session of the caller's own tenant. SECURITY DEFINER because the
-- tenant realm cannot read vendor users; nothing is returned for another tenant's session or outside the tenant realm.
CREATE FUNCTION support_session_requester(p_session_id uuid) RETURNS TABLE (id uuid, display_name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.id, u.display_name, u.email
  FROM support_session s JOIN user_account u ON u.id = s.requester_id
  WHERE s.id = p_session_id AND app_realm() = 'tenant' AND s.tenant_id = app_tenant_id()
$$;

REVOKE ALL ON FUNCTION support_session_requester(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_session_requester(uuid) TO nmp_app;
