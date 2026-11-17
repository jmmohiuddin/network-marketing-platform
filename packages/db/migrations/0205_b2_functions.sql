-- B2 shared SQL (PLAN B2 sections 1.8 and 4.2, D-B2-02): the reads and writes several modules share, so backend packages
-- never import each other's TypeScript. SECURITY INVOKER unless stated: row-level security keeps every call inside the
-- caller's tenant, and writes carry tenant_id = app_tenant_id(). Each write is audited by its TypeScript caller.
-- SQLSTATEs (PLAN 4.3): GN001-GN009, PA001-PA003, CR001-CR003, OR001.

-- 1. Reads (PLAN 1.8).

-- Committed, paid or closed periods of the market's calendars overlapping [p_from, p_to).
CREATE FUNCTION committed_periods_overlapping(p_market_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (period_id uuid, calendar_id uuid, starts_at timestamptz, ends_at timestamptz, state text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.calendar_id, p.starts_at, p.ends_at, p.state
  FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  WHERE c.market_id = p_market_id AND p.state IN ('committed', 'paid', 'closed')
    AND p.starts_at < p_to AND p.ends_at > p_from
  ORDER BY p.starts_at, p.id
$$;

-- shortcut: single-calendar markets only (D-B2-12), B3 assigns the period by the plan's calendar.
CREATE FUNCTION market_period_at(p_market_id uuid, p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  WHERE c.market_id = p_market_id AND p.starts_at <= p_at AND p.ends_at > p_at
    AND (SELECT count(*) FROM calendar x WHERE x.market_id = p_market_id) = 1
$$;

CREATE FUNCTION latest_committed_end(p_market_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT max(p.ends_at) FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  WHERE c.market_id = p_market_id AND p.state IN ('committed', 'paid', 'closed')
$$;

CREATE FUNCTION par_type_at(p_participant uuid, p_at timestamptz)
RETURNS TABLE (type_id uuid, code text, can_earn boolean, counts_as_end_customer boolean, can_sponsor boolean,
               can_hold_positions boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT t.id, t.code, t.can_earn, t.counts_as_end_customer, t.can_sponsor, t.can_hold_positions
  FROM participant_type_assignment a JOIN participant_type t ON t.tenant_id = a.tenant_id AND t.id = a.type_id
  WHERE a.participant_id = p_participant AND a.valid_from <= p_at AND (a.valid_to IS NULL OR a.valid_to > p_at)
$$;

CREATE FUNCTION par_display(p_ids uuid[])
RETURNS TABLE (participant_id uuid, external_ref text, display_name text, status text, market_id uuid)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.external_ref, p.display_name, p.status, p.market_id FROM participant p WHERE p.id = ANY (p_ids)
$$;

-- An exact external reference wins; otherwise names with trigram similarity >= 0.3, most similar first.
CREATE FUNCTION par_search(p_q text, p_limit int)
RETURNS TABLE (participant_id uuid, external_ref text, display_name text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.external_ref, p.display_name FROM participant p WHERE p.external_ref = p_q
  UNION ALL
  (SELECT p.id, p.external_ref, p.display_name FROM participant p
   WHERE NOT EXISTS (SELECT 1 FROM participant x WHERE x.external_ref = p_q)
     AND p.display_name % p_q AND similarity(p.display_name, p_q) >= 0.3
   ORDER BY similarity(p.display_name, p_q) DESC, p.id
   LIMIT p_limit)
$$;

CREATE FUNCTION gen_owner_at(p_position uuid, p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT o.participant_id FROM position_ownership o
  WHERE o.position_id = p_position AND o.valid_from <= p_at AND (o.valid_to IS NULL OR o.valid_to > p_at)
$$;

-- Ownership rows valid at p_at; p_at NULL = the full history.
CREATE FUNCTION gen_positions_of(p_participant uuid, p_at timestamptz)
RETURNS TABLE (position_id uuid, position_ref text, status text, market_id uuid, owned_from timestamptz,
               owned_to timestamptz)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.position_ref, p.status, p.market_id, o.valid_from, o.valid_to
  FROM position_ownership o JOIN position p ON p.tenant_id = o.tenant_id AND p.id = o.position_id
  WHERE o.participant_id = p_participant
    AND (p_at IS NULL OR (o.valid_from <= p_at AND (o.valid_to IS NULL OR o.valid_to > p_at)))
  ORDER BY o.valid_from, p.id
$$;

-- No row = no servicer; a row with a NULL position = the company.
CREATE FUNCTION crm_servicer_at(p_customer uuid, p_at timestamptz) RETURNS TABLE (position_id uuid, source text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT s.servicing_position_id, s.source FROM customer_servicing s
  WHERE s.customer_id = p_customer AND s.valid_from <= p_at AND (s.valid_to IS NULL OR s.valid_to > p_at)
$$;

-- D-B2-14: the webhook route finds its connector before any tenant context exists (system realm only).
CREATE FUNCTION connector_for_webhook(p_id uuid)
RETURNS TABLE (tenant_id uuid, provider text, market_id uuid, webhook_secret_sealed text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT c.tenant_id, c.provider, c.market_id, c.webhook_secret_sealed FROM provider_config c
    WHERE c.id = p_id AND c.kind = 'commerce' AND c.state = 'recorded';
END $$;

-- 2. Writes (PLAN 4.2).

-- P2: a buyer unknown to the tenant becomes a customer of the given type; an existing external ref returns its id.
CREATE FUNCTION par_create_customer(p_external_ref text, p_market_id uuid, p_type_id uuid, p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM participant_type t
                 WHERE t.id = p_type_id AND t.state = 'active' AND t.counts_as_end_customer) THEN
    RAISE EXCEPTION 'type % is not an active end-customer type', p_type_id USING ERRCODE = 'PA002';
  END IF;
  INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at)
  VALUES (app_tenant_id(), p_external_ref, 'individual', p_market_id, p_at)
  ON CONFLICT (tenant_id, external_ref) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT p.id INTO v_id FROM participant p WHERE p.external_ref = p_external_ref;
    RETURN v_id;
  END IF;
  INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from)
  VALUES (app_tenant_id(), v_id, p_type_id, p_at);
  RETURN v_id;
END $$;

-- G1: a position owned by the participant from p_at (pending or active), with its first history row.
CREATE FUNCTION gen_create_position(p_participant_id uuid, p_market_id uuid, p_brand_id uuid, p_position_ref text,
                                    p_status text, p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_label text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'a position starts pending or active' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT coalesce((SELECT t.can_hold_positions FROM par_type_at(p_participant_id, p_at) t), false) THEN
    RAISE EXCEPTION 'participant % cannot hold positions', p_participant_id USING ERRCODE = 'PA001';
  END IF;
  v_label := to_base36(nextval('position_label_seq'));
  BEGIN
    INSERT INTO position (tenant_id, position_ref, label, market_id, brand_id, status, status_from)
    VALUES (app_tenant_id(), coalesce(p_position_ref, 'P-' || upper(v_label)), v_label, p_market_id, p_brand_id, p_status,
            p_at)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'position reference % is taken', coalesce(p_position_ref, 'P-' || upper(v_label))
      USING ERRCODE = 'GN009';
  END;
  INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from)
  VALUES (app_tenant_id(), v_id, p_participant_id, p_at);
  INSERT INTO position_status_history (tenant_id, position_id, from_status, to_status, effective_from, reason)
  VALUES (app_tenant_id(), v_id, NULL, p_status, p_at, 'Enrolment');
  RETURN v_id;
END $$;

-- G2: the only writer of relationship rows (PLAN 4.2). enrolment/migration: a first row; change/rule: close the open
-- row and open the new one; correction: supersede the row valid at p_valid_from, keep its part before that date, insert
-- the corrected row to its end. relationship_guard checks overlap, leg and cycle. Marks the read model stale and emits
-- genealogy.changed (ids only). Callers dry-run it inside a savepoint.
CREATE FUNCTION gen_apply_relationship(p_kind text, p_child uuid, p_parent uuid, p_leg text, p_valid_from timestamptz,
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
  INSERT INTO path_model (tenant_id, kind, stale_since) VALUES (app_tenant_id(), p_kind, now())
  ON CONFLICT (tenant_id, kind) DO UPDATE SET stale_since = coalesce(path_model.stale_since, now());
  INSERT INTO outbox_event (tenant_id, topic, key, payload, created_by)
  VALUES (app_tenant_id(), 'genealogy.changed', p_child::text,
          jsonb_build_object('kind', p_kind, 'child_position_id', p_child, 'valid_from', p_valid_from,
                             'event_type', p_event_type),
          app_user_id());
  RETURN v_id;
END $$;

-- G3 (D-B2-20): under the placement lock, breadth-first from p_parent over the placement rows valid now (siblings by
-- leg number), the first non-terminated position with a free leg, and its smallest free leg. No row = no free slot.
CREATE FUNCTION gen_auto_place(p_parent uuid, p_width int) RETURNS TABLE (parent_position_id uuid, leg text)
LANGUAGE plpgsql SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF p_width IS NULL OR p_width NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION 'placement width must be 2..20' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('genealogy:' || app_tenant_id() || ':placement', 0));
  RETURN QUERY
    WITH RECURSIVE tree (position_id, depth, ord) AS (
      SELECT p_parent, 0, ARRAY[]::int[]
      UNION ALL
      SELECT r.child_position_id, t.depth + 1, t.ord || r.leg::int
      FROM relationship r JOIN tree t ON r.parent_position_id = t.position_id
      WHERE r.kind = 'placement' AND r.superseded_at IS NULL AND r.leg IS NOT NULL
        AND r.valid_from <= now() AND (r.valid_to IS NULL OR r.valid_to > now())
    )
    SELECT t.position_id, l.n::text
    FROM tree t
    JOIN position p ON p.id = t.position_id AND p.status <> 'terminated'
    CROSS JOIN generate_series(1, p_width) AS l (n)
    WHERE NOT EXISTS (SELECT 1 FROM relationship x
                      WHERE x.kind = 'placement' AND x.parent_position_id = t.position_id AND x.leg = l.n::text
                        AND x.superseded_at IS NULL AND (x.valid_to IS NULL OR x.valid_to > now()))
    ORDER BY t.depth, t.ord, l.n
    LIMIT 1;
END $$;

-- G4: the position changes owner at p_valid_from (OWNERSHIP_CONFLICT when the current row cannot close then).
CREATE FUNCTION gen_transfer_ownership(p_position uuid, p_to uuid, p_valid_from timestamptz, p_case_id uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  current_row position_ownership;
  v_id uuid;
BEGIN
  IF NOT coalesce((SELECT t.can_hold_positions FROM par_type_at(p_to, p_valid_from) t), false) THEN
    RAISE EXCEPTION 'participant % cannot hold positions', p_to USING ERRCODE = 'PA001';
  END IF;
  SELECT * INTO current_row FROM position_ownership o WHERE o.position_id = p_position AND o.valid_to IS NULL FOR UPDATE;
  IF NOT FOUND OR current_row.valid_from >= p_valid_from OR current_row.participant_id = p_to THEN
    RAISE EXCEPTION 'position % cannot change owner at %', p_position, p_valid_from USING ERRCODE = 'GN008';
  END IF;
  UPDATE position_ownership SET valid_to = p_valid_from WHERE id = current_row.id;
  BEGIN
    INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, case_id)
    VALUES (app_tenant_id(), p_position, p_to, p_valid_from, p_case_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'position % would have two owners', p_position USING ERRCODE = 'GN008';
  END;
  RETURN v_id;
END $$;

-- C1: the customer is serviced by p_position (NULL = the company) from p_valid_from; the same servicer is a no-op.
CREATE FUNCTION crm_set_servicer(p_customer uuid, p_position uuid, p_source text, p_valid_from timestamptz,
                                 p_case_id uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  current_row customer_servicing;
  v_id uuid;
BEGIN
  IF NOT coalesce((SELECT t.counts_as_end_customer FROM par_type_at(p_customer, p_valid_from) t), false) THEN
    RAISE EXCEPTION 'participant % is not an end customer', p_customer USING ERRCODE = 'CR001';
  END IF;
  IF p_position IS NOT NULL AND NOT EXISTS (SELECT 1 FROM position p WHERE p.id = p_position AND p.status <> 'terminated') THEN
    RAISE EXCEPTION 'position % cannot service customers', p_position USING ERRCODE = 'CR002';
  END IF;
  SELECT * INTO current_row FROM customer_servicing s WHERE s.customer_id = p_customer AND s.valid_to IS NULL FOR UPDATE;
  IF FOUND THEN
    IF current_row.servicing_position_id IS NOT DISTINCT FROM p_position THEN
      RETURN current_row.id;
    END IF;
    IF current_row.valid_from >= p_valid_from THEN
      RAISE EXCEPTION 'the current servicer of % starts at or after %', p_customer, p_valid_from
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE customer_servicing SET valid_to = p_valid_from WHERE id = current_row.id;
  END IF;
  INSERT INTO customer_servicing (tenant_id, customer_id, servicing_position_id, source, valid_from, case_id, reason)
  VALUES (app_tenant_id(), p_customer, p_position, p_source, p_valid_from, p_case_id, p_reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- C3 (D-B2-16): the customers p_position services move by the reassignment rule in force at p_effective_from: to its
-- sponsor parent valid then when not terminated (else the company) or to the company, from p_effective_from plus the
-- notice days. Rule unset: refused when it services anyone (CR003). Returns the number moved.
CREATE FUNCTION crm_reassign_customers(p_position uuid, p_effective_from timestamptz) RETURNS int
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_rule jsonb;
  v_target uuid;
  v_customer uuid;
  v_moved int := 0;
BEGIN
  SELECT v.settings -> 'customers.reassignment_rule' INTO v_rule FROM tenant_setting_version v
  WHERE v.effective_from <= p_effective_from ORDER BY v.effective_from DESC, v.version DESC LIMIT 1;
  IF v_rule IS NULL OR v_rule = 'null'::jsonb THEN
    IF EXISTS (SELECT 1 FROM customer_servicing s WHERE s.servicing_position_id = p_position AND s.valid_to IS NULL) THEN
      RAISE EXCEPTION 'customers.reassignment_rule is not set' USING ERRCODE = 'CR003';
    END IF;
    RETURN 0;
  END IF;
  IF v_rule ->> 'rule' = 'sponsor' THEN
    SELECT r.parent_position_id INTO v_target
    FROM relationship r JOIN position p ON p.id = r.parent_position_id
    WHERE r.kind = 'sponsor' AND r.child_position_id = p_position AND r.superseded_at IS NULL
      AND r.valid_from <= p_effective_from AND (r.valid_to IS NULL OR r.valid_to > p_effective_from)
      AND p.status <> 'terminated';
  END IF;
  FOR v_customer IN
    SELECT s.customer_id FROM customer_servicing s
    WHERE s.servicing_position_id = p_position AND s.valid_to IS NULL ORDER BY s.customer_id
  LOOP
    PERFORM crm_set_servicer(v_customer, v_target, 'reassignment',
                             p_effective_from + make_interval(days => (v_rule ->> 'notice_days')::int), NULL,
                             'Servicing position terminated');
    v_moved := v_moved + 1;
  END LOOP;
  RETURN v_moved;
END $$;

-- G5 (D-B2-06): a dated status change with its history row; termination reassigns the position's customers.
CREATE FUNCTION gen_set_position_status(p_position uuid, p_status text, p_effective_from timestamptz, p_reason text,
                                        p_case_id uuid) RETURNS int
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  pos record;
BEGIN
  SELECT * INTO pos FROM position p WHERE p.id = p_position FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'position % not found', p_position USING ERRCODE = 'no_data_found';
  END IF;
  IF (pos.status, p_status) NOT IN (('pending', 'active'), ('pending', 'terminated'), ('active', 'suspended'),
                                    ('active', 'terminated'), ('suspended', 'active'), ('suspended', 'terminated'),
                                    ('terminated', 'active')) THEN
    RAISE EXCEPTION 'position status cannot change from % to %', pos.status, p_status USING ERRCODE = 'GN006';
  END IF;
  IF p_effective_from > now() OR p_effective_from < coalesce(latest_committed_end(pos.market_id), '-infinity') THEN
    RAISE EXCEPTION 'a status change is effective between the latest committed period end and now'
      USING ERRCODE = 'GN007';
  END IF;
  IF pos.status = 'pending' AND p_status = 'active' AND EXISTS (
       SELECT 1 FROM case_file c
       WHERE c.type = 'duplicate' AND c.state IN ('open', 'submitted') AND c.subject_type = 'participant'
         AND c.subject_id = gen_owner_at(p_position, now()) AND c.id IS DISTINCT FROM p_case_id) THEN
    RAISE EXCEPTION 'position % is held by a duplicate review', p_position USING ERRCODE = 'PA003';
  END IF;
  INSERT INTO position_status_history (tenant_id, position_id, from_status, to_status, effective_from, reason, case_id)
  VALUES (app_tenant_id(), p_position, pos.status, p_status, p_effective_from, p_reason, p_case_id);
  UPDATE position SET status = p_status, status_from = p_effective_from WHERE id = p_position;
  IF p_status = 'terminated' THEN
    RETURN crm_reassign_customers(p_position, p_effective_from);
  END IF;
  RETURN 0;
END $$;

-- 3. Path read model helpers (D-B2-07).

-- The (tenant, kind) models to rebuild; the gen.paths.rebuild job lists them before any tenant context exists.
CREATE FUNCTION gen_stale_models() RETURNS TABLE (tenant_id uuid, kind text, stale_since timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY SELECT m.tenant_id, m.kind, m.stale_since FROM path_model m WHERE m.stale_since IS NOT NULL
    ORDER BY m.stale_since, m.tenant_id, m.kind;
END $$;

-- Fresh planner statistics before a full build (E-ADR-32 spike: the build is fast only after ANALYZE). The runtime role
-- owns no table, so this runs as the owner; tenant realm only.
CREATE FUNCTION gen_analyze_genealogy() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app_realm() IS DISTINCT FROM 'tenant' THEN
    RAISE EXCEPTION 'gen_analyze_genealogy runs in the tenant realm' USING ERRCODE = 'insufficient_privilege';
  END IF;
  ANALYZE position, relationship;
END $$;

REVOKE ALL ON FUNCTION connector_for_webhook(uuid), gen_stale_models(), gen_analyze_genealogy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connector_for_webhook(uuid), gen_stale_models(), gen_analyze_genealogy() TO nmp_app;
