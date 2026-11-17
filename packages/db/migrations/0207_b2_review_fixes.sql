-- B2 review fixes (0200-0206 stay unchanged): ordered status history, back-dated terminations with later customers,
-- serialised servicing changes, system time owned by the database, held-only inbound payloads, pending-only late
-- transactions, chargeback reversals bound to their chargeback, the order_line actor pair, integer volume strings and
-- a stale path model on every relationship write.

-- 1. G5: a status change is never dated before the current status (the history stays in date order for B3 reads).
CREATE OR REPLACE FUNCTION gen_set_position_status(p_position uuid, p_status text, p_effective_from timestamptz,
                                                   p_reason text, p_case_id uuid) RETURNS int
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
  IF p_effective_from < pos.status_from THEN
    RAISE EXCEPTION 'position % is % from %, a later change cannot be dated before that', p_position, pos.status,
      pos.status_from USING ERRCODE = 'GN006';
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

-- 2. C1: one servicing change per customer at a time. Without the lock a concurrent caller's FOR UPDATE re-check skips
-- the row the first caller closed and its insert fails on the EXCLUDE constraint (unmapped 23P01).
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

-- 3. C3: notice_days must be 0..90 (DEC-14, no default). A customer whose servicing began after the reassignment date
-- (a back-dated termination) moves the instant after that start: servicing rows are history and are never rewritten.
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
      AND p.status <> 'terminated';
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

-- 4. System time (FR-GEN-003 "as known at T", current agreement version) is the transaction time for the runtime role:
-- the named columns are now() when inserted or changed. Owner exempt (D-B1-17 pattern).
CREATE FUNCTION system_time_is_now() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV::text[] LOOP
    IF (TG_OP = 'INSERT' OR to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col)
       AND to_jsonb(NEW) -> col <> 'null'::jsonb AND (to_jsonb(NEW) ->> col)::timestamptz <> now() THEN
      RAISE EXCEPTION '%.% is the transaction time', TG_TABLE_NAME, col USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER relationship_system_time BEFORE INSERT OR UPDATE ON relationship
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION system_time_is_now('recorded_at', 'superseded_at');
CREATE TRIGGER position_status_history_system_time BEFORE INSERT ON position_status_history
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION system_time_is_now('recorded_at');
CREATE TRIGGER agreement_version_system_time BEFORE INSERT ON agreement_version
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION system_time_is_now('published_at');

-- 5. D-B2-07: every relationship write marks the path model stale in the writing transaction, also writes that bypass
-- gen_apply_relationship (its own upsert is then a no-op).
CREATE FUNCTION relationship_marks_paths_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO path_model (tenant_id, kind, stale_since) VALUES (NEW.tenant_id, NEW.kind, now())
  ON CONFLICT (tenant_id, kind) DO UPDATE SET stale_since = coalesce(path_model.stale_since, now());
  RETURN NULL;
END $$;
CREATE TRIGGER relationship_marks_paths_stale AFTER INSERT OR UPDATE ON relationship
  FOR EACH ROW EXECUTE FUNCTION relationship_marks_paths_stale();

ALTER TABLE path_node ADD FOREIGN KEY (tenant_id, parent_position_id) REFERENCES position (tenant_id, id);

-- 6. PLAN 1.5: only a held event keeps its payload (buyer personal data).
ALTER TABLE inbound_event ADD CONSTRAINT inbound_event_payload_held_only CHECK (state = 'held' OR payload IS NULL);

-- 7. A late transaction is created pending with no decision (its CHECKs then keep decided_by/at and the run empty).
CREATE TRIGGER late_transaction_created_pending BEFORE INSERT ON late_transaction
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND (NEW.state <> 'pending' OR NEW.decision_reason IS NOT NULL))
  EXECUTE FUNCTION forbid_mutation('a late transaction is created pending, with no decision');

-- 8. A chargeback_reversed names a chargeback of the same order, with the same lines, and reverses it once.
CREATE FUNCTION order_event_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM order_event e
                 WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.reverses_event_id AND e.order_id = NEW.order_id
                   AND e.type = 'chargeback' AND e.lines @> NEW.lines AND NEW.lines @> e.lines) THEN
    RAISE EXCEPTION 'a chargeback reversal names a chargeback of the same order with the same lines'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_event_reversal_guard BEFORE INSERT ON order_event
  FOR EACH ROW WHEN (NEW.reverses_event_id IS NOT NULL) EXECUTE FUNCTION order_event_reversal_guard();
CREATE UNIQUE INDEX order_event_reversed_once ON order_event (tenant_id, reverses_event_id)
  WHERE reverses_event_id IS NOT NULL;

-- 9. D-B2-03 and the PLAN section 1 recipe: order_line carries created_at and the actor pair.
ALTER TABLE order_line
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN created_by uuid NOT NULL DEFAULT app_user_id(),
  ADD COLUMN created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system'));

-- 10. D-B2-17: volumes are {measure: "<integer minor units>"}; an event's effect is {lines: [{line_no, volumes}],
-- total: volumes}.
CREATE FUNCTION volumes_valid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN false ELSE NOT EXISTS (
    SELECT 1 FROM jsonb_each(v) e
    WHERE e.key !~ '^[a-z][a-z0-9_]{0,31}$' OR jsonb_typeof(e.value) <> 'string'
       OR e.value #>> '{}' !~ '^-?(0|[1-9][0-9]{0,18})$') END
$$;

CREATE FUNCTION volume_effect_valid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN false
    WHEN v - ARRAY['lines', 'total'] <> '{}'::jsonb THEN false
    WHEN v ? 'total' AND NOT volumes_valid(v -> 'total') THEN false
    WHEN NOT v ? 'lines' THEN true
    WHEN jsonb_typeof(v -> 'lines') <> 'array' THEN false
    ELSE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'lines') x
                     WHERE jsonb_typeof(x -> 'line_no') IS DISTINCT FROM 'number' OR NOT volumes_valid(x -> 'volumes'))
  END
$$;

ALTER TABLE product_volume_map ADD CONSTRAINT product_volume_map_volumes CHECK (volumes_valid(volumes));
ALTER TABLE order_line ADD CONSTRAINT order_line_volumes CHECK (volumes_valid(volumes));
ALTER TABLE order_event ADD CONSTRAINT order_event_volume_effect CHECK (volume_effect_valid(volume_effect));
