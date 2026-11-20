-- B6 migration SQL contracts (PLAN B6 sections 1.5, 1.6 and 4.2; D-B6-09, D-B6-10, D-B6-11): the opening entry's origin
-- and lines, its posting, the batch apply, the chain-start state read, the comparison and the blockers.

-- 1. journal_entry_origin_guard (0407) with the migration origin: the opening entry of a migration of the entry's market,
-- in its cutover period, approved by someone other than the opening's submitter. Nothing posts into a closed period
-- (D-B6-04), at the table level too.
CREATE OR REPLACE FUNCTION journal_entry_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ok boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
                 WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.period_id AND c.market_id = NEW.market_id) THEN
    RAISE EXCEPTION 'a journal entry is attributed to a period of its market' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM period p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.period_id AND p.state = 'closed') THEN
    RAISE EXCEPTION 'period % is closed', NEW.period_id USING ERRCODE = 'check_violation', DETAIL = 'period_closed';
  END IF;
  ok := CASE NEW.origin_type
    WHEN 'run' THEN EXISTS (
      SELECT 1 FROM run r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.origin_id AND r.state = 'committed'
        AND r.period_id = NEW.period_id AND r.approval_id = NEW.approval_id)
    WHEN 'payout_instruction' THEN EXISTS (
      SELECT 1 FROM payout_instruction i JOIN payout_batch b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
      WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.origin_id AND b.market_id = NEW.market_id AND b.period_id = NEW.period_id
        AND i.state = CASE NEW.event_type WHEN 'payout_instructed' THEN 'pending' WHEN 'payout_settled' THEN 'settled'
                                          WHEN 'payout_returned' THEN 'returned' ELSE 'failed' END
        AND (NEW.approval_id IS NULL OR EXISTS (
              SELECT 1 FROM approval a WHERE a.id = NEW.approval_id AND a.object_type = 'payout_batch'
                AND a.object_id = b.id AND a.decision = 'approved')))
    WHEN 'case' THEN EXISTS (
      SELECT 1 FROM case_file c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.origin_id AND c.type = 'write_off'
        AND c.state = 'approved' AND c.approval_id = NEW.approval_id AND c.market_id = NEW.market_id)
    WHEN 'migration' THEN EXISTS (
      SELECT 1 FROM migration m
      WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.origin_id AND m.market_id = NEW.market_id
        AND m.cutover_period_id = NEW.period_id
        AND (m.opening_approval_id = NEW.approval_id OR (m.state = 'opening_submitted' AND EXISTS (
              SELECT 1 FROM approval a WHERE a.id = NEW.approval_id AND a.object_type = 'migration' AND a.object_id = m.id
                AND a.decision = 'approved' AND a.approver_id <> m.opening_submitted_by))))
    ELSE false END;
  IF NOT ok THEN
    RAISE EXCEPTION 'a journal entry posts an existing origin of its market and period, in the origin''s state, with the origin''s approval'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- journal_entry_balanced (0407) with the migration rule (D-B6-10): per opening balance, Dr migration_clearing /
-- Cr payee_payable(p) for a positive amount, Dr clawback_receivable(p) / Cr migration_clearing for a negative one.
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_amount bigint;
  v_payee uuid;
BEGIN
  IF (SELECT count(*) < 2 OR sum(p.debit_minor) <> sum(p.credit_minor) FROM posting p WHERE p.entry_id = NEW.id) THEN
    RAISE EXCEPTION 'journal entry % needs at least two postings and debits equal to credits', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.origin_type = 'run' THEN
    RETURN NULL;
  ELSIF NEW.origin_type = 'migration' THEN
    IF EXISTS (
         WITH actual AS (
           SELECT a.type, a.payee_participant_id AS payee, x.debit_minor AS debit, x.credit_minor AS credit
           FROM posting x JOIN ledger_account a ON a.id = x.account_id WHERE x.entry_id = NEW.id
         ), expected AS (
           SELECT CASE WHEN b.amount_minor > 0 THEN 'migration_clearing' ELSE 'clawback_receivable' END AS type,
                  CASE WHEN b.amount_minor > 0 THEN NULL ELSE b.participant_id END AS payee, abs(b.amount_minor) AS debit,
                  0::bigint AS credit
           FROM migration_opening_balance b WHERE b.tenant_id = NEW.tenant_id AND b.migration_id = NEW.origin_id
           UNION ALL
           SELECT CASE WHEN b.amount_minor > 0 THEN 'payee_payable' ELSE 'migration_clearing' END,
                  CASE WHEN b.amount_minor > 0 THEN b.participant_id END, 0, abs(b.amount_minor)
           FROM migration_opening_balance b WHERE b.tenant_id = NEW.tenant_id AND b.migration_id = NEW.origin_id
         )
         (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
         UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) THEN
      RAISE EXCEPTION 'journal entry % does not carry the lines of its migration''s opening balances', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  ELSIF NEW.origin_type = 'payout_instruction' THEN
    SELECT i.amount_minor, i.payee_participant_id INTO v_amount, v_payee
    FROM payout_instruction i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.origin_id;
  ELSE
    SELECT CASE WHEN c.payload ->> 'amount_minor' ~ '^[1-9][0-9]{0,17}$' THEN (c.payload ->> 'amount_minor')::bigint END,
           a.payee_participant_id INTO v_amount, v_payee
    FROM case_file c JOIN ledger_account a ON a.tenant_id = c.tenant_id AND a.id = c.subject_id AND a.type = 'clawback_receivable'
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.origin_id;
  END IF;
  IF v_amount IS NULL OR EXISTS (
       WITH actual AS (
         SELECT a.type, a.payee_participant_id AS payee, x.debit_minor AS debit, x.credit_minor AS credit
         FROM posting x JOIN ledger_account a ON a.id = x.account_id WHERE x.entry_id = NEW.id
       ), expected AS (
         SELECT e.type, e.payee, e.debit, e.credit FROM (VALUES
           ('payout_instructed', 'payee_payable', v_payee, v_amount, 0::bigint),
           ('payout_instructed', 'payout_in_transit', NULL, 0, v_amount),
           ('payout_settled', 'payout_in_transit', NULL, v_amount, 0),
           ('payout_settled', 'settled_clearing', NULL, 0, v_amount),
           ('payout_returned', 'payout_in_transit', NULL, v_amount, 0),
           ('payout_returned', 'payee_payable', v_payee, 0, v_amount),
           ('payout_failed', 'payout_in_transit', NULL, v_amount, 0),
           ('payout_failed', 'payee_payable', v_payee, 0, v_amount),
           ('write_off', 'write_off', NULL, v_amount, 0),
           ('write_off', 'clawback_receivable', v_payee, 0, v_amount)) AS e (event_type, type, payee, debit, credit)
         WHERE e.event_type = NEW.event_type
       )
       (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
       UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) THEN
    RAISE EXCEPTION 'journal entry % does not carry the lines of its % posting rule for its origin', NEW.id, NEW.event_type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

-- 2. The opening entry (D-B6-10): one entry in the cutover period, key migration:<id>:opening, posted once (ledger_post
-- returns the existing entry for the key); NULL when the migration has no opening balances.
CREATE FUNCTION led_post_migration_opening(p_migration uuid, p_approval uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_market uuid;
  v_period uuid;
  v_lines jsonb;
BEGIN
  SELECT m.market_id, m.cutover_period_id INTO v_market, v_period FROM migration m WHERE m.id = p_migration;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'migration % does not exist', p_migration USING ERRCODE = 'no_data_found';
  END IF;
  SELECT jsonb_agg(l.line ORDER BY l.participant_id, l.side) INTO v_lines FROM (
    SELECT b.participant_id, 1 AS side,
           jsonb_build_object('type', CASE WHEN b.amount_minor > 0 THEN 'migration_clearing' ELSE 'clawback_receivable' END,
                              'payee_participant_id', CASE WHEN b.amount_minor < 0 THEN b.participant_id END,
                              'debit_minor', abs(b.amount_minor)::text, 'credit_minor', '0') AS line
    FROM migration_opening_balance b WHERE b.migration_id = p_migration
    UNION ALL
    SELECT b.participant_id, 2,
           jsonb_build_object('type', CASE WHEN b.amount_minor > 0 THEN 'payee_payable' ELSE 'migration_clearing' END,
                              'payee_participant_id', CASE WHEN b.amount_minor > 0 THEN b.participant_id END,
                              'debit_minor', '0', 'credit_minor', abs(b.amount_minor)::text)
    FROM migration_opening_balance b WHERE b.migration_id = p_migration
  ) l;
  IF v_lines IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN ledger_post(v_market, v_period, 'migration_opening', 'migration', p_migration, 'migration:' || p_migration || ':opening',
                     p_approval, v_lines);
END $$;

-- 3. Apply (D-B6-09): the migration batch's facts become participants, positions, sponsor relationships, servicing,
-- orders and refunds, in the caller's transaction, and the migration becomes applied with the counts. Every refusal is
-- one finding {code, ref, detail}; any finding raises MG001 (DETAIL = findings JSON) and nothing is written.
-- shortcut: row by row through the B2 writers (fine for implementation-sized files); set-based inserts when a migration
-- exceeds ~100k participants.
CREATE FUNCTION mig_apply_batch(p_migration uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  m migration;
  v_zone text;
  v_currency char(3);
  findings jsonb;
  r record;
  v_ref text;
  v_id uuid;
  v_position uuid;
  v_inbound uuid;
  v_at timestamptz;
  v_effect jsonb;
  n_participants int := 0;
  n_positions int := 0;
  n_relationships int := 0;
  n_servicing int := 0;
  n_orders int := 0;
  n_refunds int := 0;
  counts jsonb;
BEGIN
  SELECT * INTO m FROM migration x WHERE x.id = p_migration FOR UPDATE;
  IF NOT FOUND OR m.state <> 'draft' THEN
    RAISE EXCEPTION 'a draft migration is applied once' USING ERRCODE = 'check_violation', DETAIL = coalesce(m.state, 'missing');
  END IF;
  SELECT k.time_zone, k.currency INTO v_zone, v_currency FROM market k WHERE k.id = m.market_id;

  WITH f AS (
    SELECT p.participant_ref AS ref, p.type_code, p.servicing_ref, t.id AS type_id, t.can_hold_positions AS holds,
           t.counts_as_end_customer AS customer
    FROM cpl_fact_participant p
    LEFT JOIN participant_type t ON t.tenant_id = p.tenant_id AND t.code = p.type_code AND t.state = 'active'
    WHERE p.batch_id = m.import_batch_id
  )
  SELECT jsonb_agg(x.finding ORDER BY x.code, x.ref) INTO findings FROM (
    SELECT 'TYPE_UNKNOWN' AS code, f.ref, jsonb_build_object('code', 'TYPE_UNKNOWN', 'ref', f.ref, 'detail', f.type_code) AS finding
    FROM f WHERE f.type_id IS NULL
    UNION ALL
    SELECT 'PARTICIPANT_EXISTS', f.ref, jsonb_build_object('code', 'PARTICIPANT_EXISTS', 'ref', f.ref, 'detail', NULL)
    FROM f JOIN participant x ON x.external_ref = f.ref
    UNION ALL
    SELECT 'REFERENCE_UNKNOWN', f.ref, jsonb_build_object('code', 'REFERENCE_UNKNOWN', 'ref', f.ref, 'detail', f.servicing_ref)
    FROM f WHERE f.servicing_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM f s WHERE s.ref = f.servicing_ref)
    UNION ALL
    SELECT 'SPONSOR_NOT_APPLICABLE', f.ref, jsonb_build_object('code', 'SPONSOR_NOT_APPLICABLE', 'ref', f.ref, 'detail', f.servicing_ref)
    FROM f WHERE f.servicing_ref IS NOT NULL AND NOT f.holds AND NOT f.customer
    UNION ALL
    SELECT c.code, f.ref, jsonb_build_object('code', c.code, 'ref', f.ref, 'detail', f.servicing_ref)
    FROM f JOIN f s ON s.ref = f.servicing_ref
    CROSS JOIN LATERAL (SELECT CASE WHEN f.holds THEN 'SPONSOR_WITHOUT_POSITION' ELSE 'SERVICER_WITHOUT_POSITION' END AS code) c
    WHERE (f.holds OR f.customer) AND s.type_id IS NOT NULL AND NOT s.holds
    UNION ALL
    SELECT 'BUYER_UNKNOWN', o.order_ref, jsonb_build_object('code', 'BUYER_UNKNOWN', 'ref', o.order_ref, 'detail', o.buyer_ref)
    FROM cpl_fact_order o WHERE o.batch_id = m.import_batch_id AND NOT EXISTS (SELECT 1 FROM f WHERE f.ref = o.buyer_ref)
  ) x;
  IF findings IS NOT NULL THEN
    RAISE EXCEPTION 'the migration batch cannot be applied' USING ERRCODE = 'MG001', DETAIL = findings::text;
  END IF;

  BEGIN
    FOR r IN
      SELECT p.participant_ref AS ref, t.id AS type_id, t.can_hold_positions AS holds,
             p.enrolled_month::timestamp AT TIME ZONE v_zone AS enrolled_at
      FROM cpl_fact_participant p JOIN participant_type t ON t.tenant_id = p.tenant_id AND t.code = p.type_code AND t.state = 'active'
      WHERE p.batch_id = m.import_batch_id ORDER BY p.enrolled_month, p.participant_ref
    LOOP
      v_ref := r.ref;
      INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at)
      VALUES (app_tenant_id(), r.ref, 'individual', m.market_id, r.enrolled_at) RETURNING id INTO v_id;
      INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from)
      VALUES (app_tenant_id(), v_id, r.type_id, r.enrolled_at);
      n_participants := n_participants + 1;
      IF r.holds THEN
        PERFORM gen_create_position(v_id, m.market_id, NULL, NULL, 'active', r.enrolled_at);
        n_positions := n_positions + 1;
      END IF;
    END LOOP;

    -- servicing_ref is the sponsor of a position holder and the servicer of an end customer.
    FOR r IN
      SELECT c.external_ref AS ref, c.id AS child_id, c.enrolled_at, t.can_hold_positions AS holds,
             (SELECT o.position_id FROM position_ownership o WHERE o.participant_id = c.id AND o.valid_to IS NULL) AS child_position,
             (SELECT o.position_id FROM position_ownership o JOIN participant s ON s.id = o.participant_id
              WHERE s.external_ref = p.servicing_ref AND o.valid_to IS NULL) AS parent_position
      FROM cpl_fact_participant p
      JOIN participant c ON c.external_ref = p.participant_ref
      JOIN participant_type t ON t.tenant_id = p.tenant_id AND t.code = p.type_code AND t.state = 'active'
      WHERE p.batch_id = m.import_batch_id AND p.servicing_ref IS NOT NULL ORDER BY c.enrolled_at, c.external_ref
    LOOP
      v_ref := r.ref;
      IF r.holds THEN
        PERFORM gen_apply_relationship('sponsor', r.child_position, r.parent_position, NULL, r.enrolled_at, 'migration', NULL, NULL);
        n_relationships := n_relationships + 1;
      ELSE
        PERFORM crm_set_servicer(r.child_id, r.parent_position, 'migration', r.enrolled_at, NULL, NULL);
        n_servicing := n_servicing + 1;
      END IF;
    END LOOP;

    FOR r IN
      SELECT o.*, b.id AS buyer_id, ta.type_id AS buyer_type_id,
             coalesce((SELECT w.position_id FROM position_ownership w WHERE w.participant_id = b.id AND w.valid_to IS NULL),
                      (SELECT s.servicing_position_id FROM customer_servicing s WHERE s.customer_id = b.id AND s.valid_to IS NULL))
               AS position_id,
             EXISTS (SELECT 1 FROM position_ownership w WHERE w.participant_id = b.id AND w.valid_to IS NULL) AS buyer_holds
      FROM cpl_fact_order o
      JOIN participant b ON b.external_ref = o.buyer_ref
      JOIN participant_type_assignment ta ON ta.participant_id = b.id AND ta.valid_to IS NULL
      WHERE o.batch_id = m.import_batch_id ORDER BY o.order_date, o.order_ref
    LOOP
      v_ref := r.order_ref;
      IF v_inbound IS NULL THEN
        INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state)
        VALUES (app_tenant_id(), 'migration:' || m.id, 'migration:' || m.id, digest('migration:' || m.id, 'sha256'), now(), 'processed')
        RETURNING id INTO v_inbound;
      END IF;
      v_at := r.order_date::timestamp AT TIME ZONE v_zone;
      INSERT INTO sales_order (tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose,
        purpose_missing, attributed_position_id, attribution_source, attribution_conflict, ordered_at, credited_at, period_id,
        amount_minor, tax_minor, currency, payload_hash, inbound_event_id)
      VALUES (app_tenant_id(), 'migration:' || m.id, r.order_ref, m.market_id, r.buyer_id, r.buyer_type_id,
        CASE r.purpose WHEN 'customer' THEN 'customer' WHEN 'resale' THEN 'resale' WHEN 'personal' THEN 'personal'
                       WHEN 'enrolment' THEN 'personal' ELSE 'unspecified' END,
        r.purpose = 'unknown', r.position_id,
        CASE WHEN r.position_id IS NULL THEN NULL WHEN r.buyer_holds THEN 'buyer' ELSE 'servicing' END, false, v_at, v_at,
        market_period_at(m.market_id, v_at), r.amount_minor, 0, v_currency,
        digest(jsonb_build_array(r.order_ref, r.order_date, r.buyer_ref, r.amount_minor, r.volume_minor, r.purpose,
                                 r.is_starter_kit, r.refunded_minor, r.refund_month)::text, 'sha256'),
        v_inbound)
      RETURNING id INTO v_id;
      INSERT INTO order_line (tenant_id, order_id, line_no, sku, item_class, quantity, amount_minor, volumes)
      VALUES (app_tenant_id(), v_id, 1, 'MIGRATED', CASE WHEN r.is_starter_kit THEN 'starter_kit' ELSE 'product' END, 1,
              r.amount_minor, jsonb_build_object(m.volume_key, r.volume_minor::text));
      n_orders := n_orders + 1;
      IF r.refunded_minor > 0 THEN
        -- Proportional volume effect, half up (round(numeric) rounds half away from zero).
        v_effect := jsonb_build_object(m.volume_key,
                      (-round(r.volume_minor::numeric * r.refunded_minor / r.amount_minor))::bigint::text);
        -- At the refund month's start, never before the order (a refund in the order's own month).
        v_at := greatest(r.refund_month::timestamp AT TIME ZONE v_zone, v_at);
        INSERT INTO order_event (tenant_id, order_id, source_system, source_event_id, type, occurred_at, lines, refund_minor,
          fee_minor, volume_effect, period_id, inbound_event_id)
        VALUES (app_tenant_id(), v_id, 'migration:' || m.id, r.order_ref || ':refund', 'refund', v_at, '[]', r.refunded_minor, 0,
          jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'volumes', v_effect)), 'total', v_effect),
          market_period_at(m.market_id, v_at), v_inbound);
        n_refunds := n_refunds + 1;
      END IF;
    END LOOP;
  EXCEPTION
    WHEN serialization_failure OR deadlock_detected OR lock_not_available OR query_canceled THEN
      RAISE; -- transient: the caller retries
    WHEN OTHERS THEN
      RAISE EXCEPTION 'the migration batch cannot be applied' USING ERRCODE = 'MG001',
        DETAIL = jsonb_build_array(jsonb_build_object('code', 'WRITE_REFUSED', 'ref', v_ref, 'detail', SQLSTATE || ': ' || SQLERRM))::text;
  END;

  counts := jsonb_build_object('participants', n_participants, 'positions', n_positions, 'relationships', n_relationships,
                               'servicing', n_servicing, 'orders', n_orders, 'refund_events', n_refunds);
  UPDATE migration SET state = 'applied', applied_counts = counts, applied_at = now() WHERE id = p_migration;
  RETURN counts;
END $$;

-- 4. Chain start (D-B6-10): the approved opening state of the migration cutting over in the period.
CREATE FUNCTION mig_opening_state_for(p_period uuid) RETURNS SETOF migration_opening_state
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT s.* FROM migration_opening_state s JOIN migration m ON m.tenant_id = s.tenant_id AND m.id = s.migration_id
  WHERE m.cutover_period_id = p_period AND m.state IN ('opening_posted', 'signed_off')
  ORDER BY s.position_id
$$;

-- 5. Readiness (D-B6-11): a market goes live with no non-cancelled migration or a signed-off one; its cutover period runs
-- and commits only once the migration is signed off.
CREATE FUNCTION mig_market_ready(p_market uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM migration m WHERE m.market_id = p_market AND m.state NOT IN ('cancelled', 'signed_off'))
$$;

CREATE FUNCTION mig_period_blocker(p_period uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('migration_id', m.id, 'state', m.state) FROM migration m
  WHERE m.cutover_period_id = p_period AND m.state NOT IN ('cancelled', 'signed_off')
  ORDER BY m.created_at, m.id
  LIMIT 1
$$;

-- 6. Comparison (D-B6-11), SECURITY DEFINER (parallel_run_difference has no runtime INSERT grant): in the tenant realm for
-- the acting tenant's runs, in the system realm for any. Legacy payout lines of the cutover month (matched to participants
-- by external_ref) against the simulation's lines: per payee and mapped rule key, and one payee-level row for unmapped
-- bonus types against unmapped rule keys; a row only where either side is non-zero. Idempotent per run.
CREATE FUNCTION mig_compare(p_parallel_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid;
  pr parallel_run;
  sim simulation;
  mig migration;
  v_month date;
  v_rows int;
BEGIN
  IF app_realm() = 'tenant' AND app_tenant_id() IS NOT NULL AND app_participant_id() IS NULL THEN
    own_tenant := app_tenant_id();
  ELSIF app_realm() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'a comparison runs in a staff transaction or the system realm' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO pr FROM parallel_run r WHERE r.id = p_parallel_run AND (own_tenant IS NULL OR r.tenant_id = own_tenant) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parallel run % does not exist', p_parallel_run USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO sim FROM simulation s WHERE s.tenant_id = pr.tenant_id AND s.id = pr.simulation_id;
  IF pr.state = 'calculating' AND sim.state = 'failed' THEN
    UPDATE parallel_run SET state = 'failed', error = jsonb_build_object('code', coalesce(sim.error -> 'code', '"SIMULATION_FAILED"'))
    WHERE id = pr.id RETURNING * INTO pr;
  ELSIF pr.state = 'calculating' AND sim.state = 'completed' THEN
    SELECT * INTO mig FROM migration x WHERE x.tenant_id = pr.tenant_id AND x.id = pr.migration_id;
    SELECT date_trunc('month', p.starts_at AT TIME ZONE k.time_zone)::date INTO v_month
    FROM period p JOIN market k ON k.tenant_id = mig.tenant_id AND k.id = mig.market_id
    WHERE p.tenant_id = mig.tenant_id AND p.id = mig.cutover_period_id;
    INSERT INTO parallel_run_difference (tenant_id, parallel_run_id, participant_id, payee_ref, rule_key, legacy_bonus_types,
                                         bonus_detail, legacy_minor, platform_minor, delta_minor)
    WITH map AS (
      SELECT e.key AS bonus_type, e.value #>> '{}' AS rule_key FROM jsonb_each(pr.bonus_map) e
    ), legacy AS (
      SELECT l.payee_ref, l.bonus_type, map.rule_key, l.amount_minor FROM cpl_fact_payout_line l
      LEFT JOIN map ON map.bonus_type = l.bonus_type
      WHERE l.tenant_id = pr.tenant_id AND l.batch_id = mig.import_batch_id AND l.pay_month = v_month
    ), platform AS (
      SELECT p.external_ref AS payee_ref, s.rule_key, s.amount_minor, s.rule_key IN (SELECT map.rule_key FROM map) AS mapped
      FROM sim_result_line s JOIN participant p ON p.tenant_id = s.tenant_id AND p.id = s.payee_participant_id
      WHERE s.tenant_id = pr.tenant_id AND s.simulation_id = sim.id
    ), compared AS (
      SELECT x.payee_ref, x.rule_key, sum(x.legacy)::bigint AS legacy, sum(x.platform)::bigint AS platform FROM (
        SELECT payee_ref, rule_key, amount_minor AS legacy, 0 AS platform FROM legacy
        UNION ALL
        SELECT payee_ref, CASE WHEN mapped THEN rule_key END, 0, amount_minor FROM platform
      ) x GROUP BY x.payee_ref, x.rule_key
    )
    SELECT pr.tenant_id, pr.id,
           (SELECT p.id FROM participant p WHERE p.tenant_id = pr.tenant_id AND p.external_ref = c.payee_ref), c.payee_ref, c.rule_key,
           CASE WHEN c.rule_key IS NULL
                THEN ARRAY(SELECT DISTINCT l.bonus_type FROM legacy l WHERE l.payee_ref = c.payee_ref AND l.rule_key IS NULL ORDER BY 1)
                ELSE ARRAY(SELECT map.bonus_type FROM map WHERE map.rule_key = c.rule_key ORDER BY 1) END,
           c.rule_key IS NOT NULL, c.legacy, c.platform, c.platform - c.legacy
    FROM compared c WHERE c.legacy <> 0 OR c.platform <> 0;
    UPDATE parallel_run SET state = 'compared', compared_at = now(),
      legacy_total_minor = (SELECT coalesce(sum(l.amount_minor), 0) FROM cpl_fact_payout_line l
                            WHERE l.tenant_id = pr.tenant_id AND l.batch_id = mig.import_batch_id AND l.pay_month = v_month),
      platform_total_minor = (SELECT coalesce(sum(s.amount_minor), 0) FROM sim_result_line s
                              WHERE s.tenant_id = pr.tenant_id AND s.simulation_id = sim.id)
    WHERE id = pr.id RETURNING * INTO pr;
  END IF;
  SELECT count(*) INTO v_rows FROM parallel_run_difference d WHERE d.tenant_id = pr.tenant_id AND d.parallel_run_id = pr.id;
  RETURN jsonb_build_object('state', pr.state, 'differences', v_rows, 'legacy_total_minor', pr.legacy_total_minor::text,
                            'platform_total_minor', pr.platform_total_minor::text, 'error', pr.error);
END $$;

-- System realm (mig.parallel-runs.compare cron): calculating runs whose simulation finished.
CREATE FUNCTION mig_due_comparisons(p_limit int) RETURNS TABLE (tenant_id uuid, parallel_run_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT r.tenant_id, r.id FROM parallel_run r JOIN simulation s ON s.tenant_id = r.tenant_id AND s.id = r.simulation_id
    WHERE r.state = 'calculating' AND s.state IN ('completed', 'failed')
    ORDER BY r.requested_at, r.id
    LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION mig_compare(uuid), mig_due_comparisons(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mig_compare(uuid), mig_due_comparisons(int) TO nmp_app;
