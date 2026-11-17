-- B3 shared SQL (PLAN B3 section 4.2, D-B3-01): the reads and writes several packages share, so PLN, COMP, CPL and the
-- B2 modules never import each other's TypeScript. SECURITY INVOKER unless stated: row-level security keeps every call
-- inside the caller's tenant. Versions "in force" are those scheduled, active or retired with the greatest
-- effective_from at or before the instant.

-- The version of the period's calendar's plan in force at the period start (BR-CMP-01).
CREATE FUNCTION plan_version_for_period(p_period uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.id FROM period p
  JOIN plan_calendar c ON c.tenant_id = p.tenant_id AND c.calendar_id = p.calendar_id
  JOIN plan_version v ON v.tenant_id = c.tenant_id AND v.plan_id = c.plan_id
  WHERE p.id = p_period AND v.state IN ('scheduled', 'active', 'retired') AND v.effective_from <= p.starts_at
  ORDER BY v.effective_from DESC, v.version DESC
  LIMIT 1
$$;

-- D-B3-05: the crediting event of the version in force at p_at of a plan covering the market; NULL when none. Several
-- plans on one market: the most recent effective_from wins (the schedule gate keeps them consistent).
CREATE FUNCTION plan_crediting_event(p_market uuid, p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.crediting_event FROM plan_market m
  JOIN plan_version v ON v.tenant_id = m.tenant_id AND v.plan_id = m.plan_id
  WHERE m.market_id = p_market AND v.state IN ('scheduled', 'active', 'retired') AND v.effective_from <= p_at
  ORDER BY v.effective_from DESC, v.version DESC
  LIMIT 1
$$;

-- D-B3-06: the placement width of the version in force now for the market; NULL when none or unset.
CREATE FUNCTION placement_width_for(p_market uuid) RETURNS int
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.placement_width FROM plan_market m
  JOIN plan_version v ON v.tenant_id = m.tenant_id AND v.plan_id = m.plan_id
  WHERE m.market_id = p_market AND v.state IN ('scheduled', 'active', 'retired') AND v.effective_from <= now()
  ORDER BY v.effective_from DESC, v.version DESC
  LIMIT 1
$$;

-- D-B3-07: the rules of a kind in the version in force at p_at of every plan covering the market.
CREATE FUNCTION plan_rules_in_force(p_market uuid, p_at timestamptz, p_kind text)
RETURNS TABLE (plan_version_id uuid, rule_key text, params jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.plan_version_id, r.rule_key, r.params
  FROM (SELECT DISTINCT ON (v.plan_id) v.id FROM plan_market m
        JOIN plan_version v ON v.tenant_id = m.tenant_id AND v.plan_id = m.plan_id
        WHERE m.market_id = p_market AND v.state IN ('scheduled', 'active', 'retired') AND v.effective_from <= p_at
        ORDER BY v.plan_id, v.effective_from DESC, v.version DESC) AS in_force
  JOIN plan_rule r ON r.plan_version_id = in_force.id
  WHERE r.kind = p_kind
  ORDER BY r.plan_version_id, r.rule_key
$$;

-- The pln.versions.activate cron lists the scheduled versions due before any tenant context exists (system realm only).
CREATE FUNCTION pln_due_activations() RETURNS TABLE (tenant_id uuid, plan_version_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY SELECT v.tenant_id, v.id FROM plan_version v
    WHERE v.state = 'scheduled' AND v.effective_from <= now() ORDER BY v.effective_from, v.tenant_id, v.id;
END $$;

-- BR-PLN-02: a completed simulation of the version as frozen at submit.
CREATE FUNCTION plan_version_simulated(p_version uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM simulation s JOIN plan_version v ON v.tenant_id = s.tenant_id AND v.id = s.plan_version_id
                 WHERE v.id = p_version AND s.kind = 'simulation' AND s.state = 'completed'
                   AND s.content_hash = v.content_hash)
$$;

-- D-B3-17: the digest of the named rules of a version (the content a guardrail evaluation matched); NULL when one of
-- them no longer exists.
CREATE FUNCTION guardrail_rules_hash(p_version uuid, p_rule_keys text[]) RETURNS bytea
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN count(*) = (SELECT count(DISTINCT k) FROM unnest(p_rule_keys) AS k) THEN
    digest(coalesce(jsonb_agg(jsonb_build_object('rule_key', r.rule_key, 'kind', r.kind, 'params', r.params,
                                                 'calendar_id', r.calendar_id, 'reversal_policy', r.reversal_policy)
                              ORDER BY r.rule_key), '[]'::jsonb)::text, 'sha256') END
  FROM plan_rule r WHERE r.plan_version_id = p_version AND r.rule_key = ANY (p_rule_keys)
$$;

-- Current evaluations of a version (their matched rules unchanged) that still need a decision: a warned one without an
-- acknowledgement or override, a blocked one without an override (or not overridable).
CREATE FUNCTION guardrail_outstanding(p_version uuid)
RETURNS TABLE (decision_id uuid, rule_id text, outcome text, reason text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT e.id, e.rule_id, e.outcome,
         CASE WHEN e.outcome = 'warned' THEN 'acknowledgement_required'
              WHEN g.overridable THEN 'override_required' ELSE 'not_overridable' END
  FROM guardrail_decision e JOIN guardrail_rule g ON g.id = e.rule_id
  WHERE e.plan_version_id = p_version AND e.kind = 'evaluation' AND e.outcome IN ('warned', 'blocked')
    AND guardrail_rules_hash(p_version, ARRAY(SELECT jsonb_array_elements_text(e.detail -> 'rule_keys'))) = e.content_sha256
    AND NOT EXISTS (SELECT 1 FROM guardrail_decision d
                    WHERE d.refers_to_decision_id = e.id
                      AND (d.kind = 'override' OR (d.kind = 'acknowledgement' AND e.outcome = 'warned')))
  ORDER BY e.decided_at, e.id
$$;

-- D-B3-12 catch-up at commit: orders of the period (calendar's market, credited in [starts_at, ends_at)) and events of
-- those orders that the run's snapshot did not hold become pending adjust items of the period. Effect estimates are
-- shaped like ORD's (volumes summed, amount as a decimal string, attributed position). Returns the new ids.
CREATE FUNCTION comp_late_catch_up(p_run uuid) RETURNS SETOF uuid
LANGUAGE sql VOLATILE SET search_path = public AS $$
  WITH target AS (
    SELECT r.tenant_id, p.id AS period_id, p.starts_at, p.ends_at, c.market_id, s.order_ids, s.order_event_ids
    FROM run r
    JOIN run_snapshot s ON s.tenant_id = r.tenant_id AND s.id = r.snapshot_id
    JOIN period p ON p.tenant_id = r.tenant_id AND p.id = r.period_id
    JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
    WHERE r.id = p_run
  ), orders AS (
    SELECT o.id, o.tenant_id, o.amount_minor, o.attributed_position_id, t.period_id AS late_period_id, t.order_ids,
           t.order_event_ids
    FROM target t
    JOIN sales_order o ON o.tenant_id = t.tenant_id AND o.market_id = t.market_id
    WHERE o.credited_at >= t.starts_at AND o.credited_at < t.ends_at
  ), late_orders AS (
    INSERT INTO late_transaction (tenant_id, order_id, original_period_id, effect_estimate, handling, state)
    SELECT o.tenant_id, o.id, o.late_period_id,
           jsonb_build_object(
             'volumes', (SELECT coalesce(jsonb_object_agg(v.key, v.total::text), '{}'::jsonb)
                         FROM (SELECT e.key, sum((e.value #>> '{}')::numeric) AS total
                               FROM order_line l CROSS JOIN jsonb_each(l.volumes) e
                               WHERE l.tenant_id = o.tenant_id AND l.order_id = o.id GROUP BY e.key) AS v),
             'amount_minor', o.amount_minor::text, 'attributed_position_id', o.attributed_position_id),
           'adjust', 'pending'
    FROM orders o WHERE o.id <> ALL (o.order_ids)
    ON CONFLICT DO NOTHING
    RETURNING id
  ), late_events AS (
    INSERT INTO late_transaction (tenant_id, order_event_id, original_period_id, effect_estimate, handling, state)
    SELECT e.tenant_id, e.id, o.late_period_id,
           jsonb_build_object(
             'volumes', coalesce(e.volume_effect -> 'total', '{}'::jsonb),
             'amount_minor', (e.refund_minor * CASE WHEN e.type = 'chargeback_reversed' THEN 1 ELSE -1 END)::text,
             'attributed_position_id', o.attributed_position_id),
           'adjust', 'pending'
    FROM orders o JOIN order_event e ON e.tenant_id = o.tenant_id AND e.order_id = o.id
    WHERE e.id <> ALL (o.order_event_ids)
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT id FROM late_orders UNION ALL SELECT id FROM late_events
$$;

-- Golden dataset from a completed simulation (D-B3-16): its calendar, the settings version in force at the period end,
-- its stored snapshot and its lines (amounts as decimal strings).
CREATE FUNCTION comp_simulation_source(p_simulation uuid)
RETURNS TABLE (calendar_id uuid, settings_version_id uuid, content bytea, lines jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.calendar_id,
         (SELECT v.id FROM tenant_setting_version v WHERE v.effective_from <= p.ends_at - interval '1 microsecond'
          ORDER BY v.effective_from DESC, v.version DESC LIMIT 1),
         n.content,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('payee_position_id', l.payee_position_id, 'rule_key', l.rule_key,
                                                       'origin_type', l.origin_type, 'origin_id', l.origin_id,
                                                       'amount_minor', l.amount_minor::text)
                                    ORDER BY l.payee_position_id, l.rule_key, l.origin_type, l.origin_id), '[]'::jsonb)
          FROM sim_result_line l WHERE l.tenant_id = s.tenant_id AND l.simulation_id = s.id)
  FROM simulation s
  JOIN period p ON p.tenant_id = s.tenant_id AND p.id = s.period_id
  JOIN run_snapshot n ON n.tenant_id = s.tenant_id AND n.id = s.snapshot_id
  WHERE s.id = p_simulation AND s.state = 'completed'
$$;

REVOKE ALL ON FUNCTION pln_due_activations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pln_due_activations() TO nmp_app;
