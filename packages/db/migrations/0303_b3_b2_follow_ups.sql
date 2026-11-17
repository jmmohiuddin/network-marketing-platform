-- B2 follow-ups closed in B3 (PLAN B3 section B: OI-3, OI-7; section 1.4) and the references the B3 tables add.

-- 1. OI-3: a built path model is valid until the next relationship start or end after its build (set by the rebuild
-- from gen_path_valid_until); a new position makes both models stale; the job lists stale and expired models.
ALTER TABLE path_model ADD COLUMN valid_until timestamptz;
GRANT UPDATE (valid_until) ON path_model TO nmp_app;

CREATE FUNCTION gen_path_valid_until(p_kind text) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT min(t) FROM (
    SELECT r.valid_from AS t FROM relationship r WHERE r.kind = p_kind AND r.superseded_at IS NULL AND r.valid_from > now()
    UNION ALL
    SELECT r.valid_to FROM relationship r WHERE r.kind = p_kind AND r.superseded_at IS NULL AND r.valid_to > now()
  ) AS changes
$$;

CREATE OR REPLACE FUNCTION gen_stale_models() RETURNS TABLE (tenant_id uuid, kind text, stale_since timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY SELECT m.tenant_id, m.kind, coalesce(m.stale_since, m.valid_until) FROM path_model m
    WHERE m.stale_since IS NOT NULL OR m.valid_until <= now()
    ORDER BY coalesce(m.stale_since, m.valid_until), m.tenant_id, m.kind;
END $$;

CREATE FUNCTION position_marks_paths_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO path_model (tenant_id, kind, stale_since)
  SELECT DISTINCT n.tenant_id, k.kind, now() FROM new_rows n CROSS JOIN (VALUES ('sponsor'), ('placement')) AS k (kind)
  ON CONFLICT (tenant_id, kind) DO UPDATE SET stale_since = coalesce(path_model.stale_since, now());
  RETURN NULL;
END $$;
CREATE TRIGGER position_marks_paths_stale AFTER INSERT ON position REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION position_marks_paths_stale();

-- G2 without its path_model upsert: relationship_marks_paths_stale (0207) marks the model in the same transaction.
CREATE OR REPLACE FUNCTION gen_apply_relationship(p_kind text, p_child uuid, p_parent uuid, p_leg text, p_valid_from timestamptz,
                                       p_event_type text, p_case_id uuid, p_rule_id text) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r relationship;
  v_id uuid;
  v_valid_to timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('genealogy:' || app_tenant_id() || ':' || p_kind, 0));
  IF NOT EXISTS (SELECT 1 FROM position p WHERE p.id = p_parent AND p.status <> 'terminated') THEN
    RAISE EXCEPTION 'position % cannot be a parent', p_parent USING ERRCODE = 'GN004';
  END IF;
  IF p_event_type IN ('enrolment', 'migration') THEN
    IF EXISTS (SELECT 1 FROM relationship x
               WHERE x.kind = p_kind AND x.child_position_id = p_child AND x.superseded_at IS NULL) THEN
      RAISE EXCEPTION 'position % already has % rows', p_child, p_kind USING ERRCODE = 'GN005';
    END IF;
  ELSIF p_event_type IN ('change', 'rule') THEN
    SELECT * INTO r FROM relationship x
    WHERE x.kind = p_kind AND x.child_position_id = p_child AND x.superseded_at IS NULL AND x.valid_to IS NULL
    FOR UPDATE;
    IF FOUND THEN
      IF r.valid_from >= p_valid_from THEN
        RAISE EXCEPTION 'the current % row of % starts at or after %', p_kind, p_child, p_valid_from
          USING ERRCODE = 'GN005';
      END IF;
      UPDATE relationship SET valid_to = p_valid_from WHERE id = r.id;
    END IF;
  ELSIF p_event_type = 'correction' THEN
    SELECT * INTO r FROM relationship x
    WHERE x.kind = p_kind AND x.child_position_id = p_child AND x.superseded_at IS NULL
      AND x.valid_from <= p_valid_from AND (x.valid_to IS NULL OR x.valid_to > p_valid_from)
    FOR UPDATE;
    IF FOUND THEN
      UPDATE relationship SET superseded_at = now() WHERE id = r.id;
      IF p_valid_from > r.valid_from THEN
        INSERT INTO relationship (tenant_id, kind, parent_position_id, child_position_id, leg, valid_from, valid_to,
                                  event_type, case_id, rule_id)
        VALUES (r.tenant_id, r.kind, r.parent_position_id, r.child_position_id, r.leg, r.valid_from, p_valid_from,
                r.event_type, r.case_id, r.rule_id);
      END IF;
      v_valid_to := r.valid_to;
    ELSIF EXISTS (SELECT 1 FROM relationship x
                  WHERE x.kind = p_kind AND x.child_position_id = p_child AND x.superseded_at IS NULL
                    AND x.valid_from > p_valid_from) THEN
      RAISE EXCEPTION 'no % row of % is valid at %', p_kind, p_child, p_valid_from USING ERRCODE = 'GN005';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown relationship event type %', p_event_type USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO relationship (tenant_id, kind, parent_position_id, child_position_id, leg, valid_from, valid_to,
                            event_type, case_id, rule_id)
  VALUES (app_tenant_id(), p_kind, p_parent, p_child, p_leg, p_valid_from, v_valid_to, p_event_type, p_case_id, p_rule_id)
  RETURNING id INTO v_id;
  INSERT INTO outbox_event (tenant_id, topic, key, payload, created_by)
  VALUES (app_tenant_id(), 'genealogy.changed', p_child::text,
          jsonb_build_object('kind', p_kind, 'child_position_id', p_child, 'valid_from', p_valid_from,
                             'event_type', p_event_type),
          app_user_id());
  RETURN v_id;
END $$;

-- OI-3: P2 tells its caller whether it created the customer (ORD audits only a creation).
DROP FUNCTION par_create_customer(text, uuid, uuid, timestamptz);
CREATE FUNCTION par_create_customer(p_external_ref text, p_market_id uuid, p_type_id uuid, p_at timestamptz,
                                    OUT id uuid, OUT created boolean)
LANGUAGE plpgsql SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM participant_type t
                 WHERE t.id = p_type_id AND t.state = 'active' AND t.counts_as_end_customer) THEN
    RAISE EXCEPTION 'type % is not an active end-customer type', p_type_id USING ERRCODE = 'PA002';
  END IF;
  INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at)
  VALUES (app_tenant_id(), p_external_ref, 'individual', p_market_id, p_at)
  ON CONFLICT (tenant_id, external_ref) DO NOTHING
  RETURNING participant.id INTO id;
  created := id IS NOT NULL;
  IF NOT created THEN
    SELECT p.id INTO id FROM participant p WHERE p.external_ref = p_external_ref;
    RETURN;
  END IF;
  INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from)
  VALUES (app_tenant_id(), id, p_type_id, p_at);
END $$;

-- OI-3: whoever edited a case (event 'updated') contributed to it and cannot decide it, as the API already refuses.
CREATE OR REPLACE FUNCTION case_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on case_file is not allowed (cases are history)';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.type, NEW.subject_type, NEW.subject_id, NEW.opened_by, NEW.opened_by_kind, NEW.market_id,
      NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.type, OLD.subject_type, OLD.subject_id, OLD.opened_by,
                         OLD.opened_by_kind, OLD.market_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a case''s type, subject, opener and market never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state IN ('approved', 'rejected', 'withdrawn')
     OR NOT (NEW.state = OLD.state
             OR (OLD.state = 'open' AND NEW.state IN ('submitted', 'withdrawn'))
             OR (OLD.state = 'submitted' AND NEW.state IN ('approved', 'rejected', 'withdrawn'))) THEN
    RAISE EXCEPTION 'case state cannot change from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.submitted_by, NEW.submitted_at) IS DISTINCT FROM (OLD.submitted_by, OLD.submitted_at)
     AND NOT (OLD.state = 'open' AND NEW.state = 'submitted') THEN
    RAISE EXCEPTION 'a case''s submission is recorded once, when it is submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'open'
     AND (NEW.reason_code, NEW.payload, NEW.effect_preview) IS DISTINCT FROM (OLD.reason_code, OLD.payload, OLD.effect_preview) THEN
    RAISE EXCEPTION 'a submitted case is decided as it was submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state IN ('approved', 'rejected') AND NOT EXISTS (
       SELECT 1 FROM approval a
       WHERE a.id = NEW.approval_id AND a.object_type = 'case' AND a.object_id = NEW.id AND a.decision = NEW.state
         AND a.approver_id IS DISTINCT FROM NEW.opened_by AND a.approver_id <> NEW.submitted_by
         AND (NEW.opened_by IS NOT NULL OR a.preparer_id = NEW.submitted_by)
         AND NOT EXISTS (SELECT 1 FROM case_evidence e
                         WHERE e.tenant_id = NEW.tenant_id AND e.case_id = NEW.id AND e.added_by = a.approver_id)
         AND NOT EXISTS (SELECT 1 FROM case_event v
                         WHERE v.tenant_id = NEW.tenant_id AND v.case_id = NEW.id AND v.kind = 'updated'
                           AND v.actor_id = a.approver_id)) THEN
    RAISE EXCEPTION 'a case is decided with an approval of it by someone who did not prepare it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 2. OI-7: per-unit and line volumes are non-negative, an event's effect is signed; at most 18 digits (fits bigint).
CREATE FUNCTION volume_map_valid(v jsonb, p_signed boolean) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN false ELSE NOT EXISTS (
    SELECT 1 FROM jsonb_each(v) e
    WHERE e.key !~ '^[a-z][a-z0-9_]{0,31}$' OR jsonb_typeof(e.value) <> 'string'
       OR e.value #>> '{}' !~ CASE WHEN p_signed THEN '^-?(0|[1-9][0-9]{0,17})$' ELSE '^(0|[1-9][0-9]{0,17})$' END) END
$$;

CREATE OR REPLACE FUNCTION volumes_valid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT volume_map_valid(v, false)
$$;

CREATE OR REPLACE FUNCTION volume_effect_valid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN false
    WHEN v - ARRAY['lines', 'total'] <> '{}'::jsonb THEN false
    WHEN v ? 'total' AND NOT volume_map_valid(v -> 'total', true) THEN false
    WHEN NOT v ? 'lines' THEN true
    WHEN jsonb_typeof(v -> 'lines') <> 'array' THEN false
    ELSE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'lines') x
                     WHERE jsonb_typeof(x -> 'line_no') IS DISTINCT FROM 'number'
                        OR NOT volume_map_valid(x -> 'volumes', true))
  END
$$;

-- 3. PLAN 1.4: plans keep their markets from being deleted (plan_market); calendars are kept by plan_calendar's key.
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
    'grants', (SELECT count(*) FROM role_assignment WHERE p_market_id = ANY (market_ids))
            + (SELECT count(*) FROM role_grant_request WHERE p_market_id = ANY (market_ids)))
$$;

-- An override's evidence is referenced by its decision (no market: guardrail decisions span the plan's markets).
CREATE OR REPLACE FUNCTION document_references(p_document_id uuid)
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
  UNION ALL
  SELECT 'agreement_version', a.id, a.market_id, NULL FROM agreement_version a WHERE a.document_id = p_document_id
  UNION ALL
  SELECT 'guardrail_decision', d.id, NULL, NULL FROM guardrail_decision d WHERE d.evidence_document_id = p_document_id
$$;
