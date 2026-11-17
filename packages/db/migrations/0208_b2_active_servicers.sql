-- B2 review fixes, round 3. Never edit an applied migration: add the next number.

-- 1. C1: only an active position services customers. A pending (duplicate-held, D-B2-10) or suspended position must not
-- collect customers while it is under review; terminated was already refused. CR002 as before.
CREATE OR REPLACE FUNCTION crm_set_servicer(p_customer uuid, p_position uuid, p_source text, p_valid_from timestamptz,
                                            p_case_id uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  current_row customer_servicing;
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('servicing:' || p_customer, 0));
  IF NOT coalesce((SELECT t.counts_as_end_customer FROM par_type_at(p_customer, p_valid_from) t), false) THEN
    RAISE EXCEPTION 'participant % is not an end customer', p_customer USING ERRCODE = 'CR001';
  END IF;
  IF p_position IS NOT NULL AND NOT EXISTS (SELECT 1 FROM position p WHERE p.id = p_position AND p.status = 'active') THEN
    RAISE EXCEPTION 'position % is not active and cannot service customers', p_position USING ERRCODE = 'CR002';
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

-- 2. C3: the sponsor takes the customers only while active; a pending, suspended or terminated sponsor leaves them to the
-- company (NULL), as an unset sponsor does. Same body as 0207 otherwise.
CREATE OR REPLACE FUNCTION crm_reassign_customers(p_position uuid, p_effective_from timestamptz) RETURNS int
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_rule jsonb;
  v_target uuid;
  v_from timestamptz;
  v_customer uuid;
  v_since timestamptz;
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
  IF coalesce(v_rule ->> 'notice_days', '') !~ '^[0-9]{1,2}$' OR (v_rule ->> 'notice_days')::int > 90 THEN
    RAISE EXCEPTION 'customers.reassignment_rule.notice_days must be 0..90' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_from := p_effective_from + make_interval(days => (v_rule ->> 'notice_days')::int);
  IF v_rule ->> 'rule' = 'sponsor' THEN
    SELECT r.parent_position_id INTO v_target
    FROM relationship r JOIN position p ON p.id = r.parent_position_id
    WHERE r.kind = 'sponsor' AND r.child_position_id = p_position AND r.superseded_at IS NULL
      AND r.valid_from <= p_effective_from AND (r.valid_to IS NULL OR r.valid_to > p_effective_from)
      AND p.status = 'active';
  END IF;
  FOR v_customer, v_since IN
    SELECT s.customer_id, s.valid_from FROM customer_servicing s
    WHERE s.servicing_position_id = p_position AND s.valid_to IS NULL ORDER BY s.customer_id
  LOOP
    PERFORM crm_set_servicer(v_customer, v_target, 'reassignment', greatest(v_from, v_since + interval '1 microsecond'),
                             NULL, 'Servicing position terminated');
    v_moved := v_moved + 1;
  END LOOP;
  RETURN v_moved;
END $$;
