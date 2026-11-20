-- B6 period close (PLAN B6 section 1.2; D-B6-04): paid -> closed after the blockers clear, with the GL export made at
-- close; nothing posts into a closed period and new attributions skip it.

ALTER TABLE period
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by uuid,
  ADD COLUMN close_note text CHECK (close_note IS NULL OR length(trim(close_note)) BETWEEN 1 AND 1000),
  ADD COLUMN close_journal_export_id uuid,
  ADD CONSTRAINT period_closed
    CHECK ((state = 'closed') = (closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_note IS NOT NULL)),
  ADD CONSTRAINT period_close_export_when_closed CHECK (close_journal_export_id IS NULL OR state = 'closed'),
  ADD FOREIGN KEY (tenant_id, closed_by) REFERENCES user_account (tenant_id, id),
  ADD FOREIGN KEY (tenant_id, close_journal_export_id) REFERENCES journal_export (tenant_id, id);

GRANT UPDATE (closed_at, closed_by, close_note, close_journal_export_id) ON period TO nmp_app;

-- D-B6-04 blockers, ordered by kind then id ('[]' when none). Batches are attributed to a period by payout_batch.period_id.
CREATE FUNCTION period_close_blockers(p_period uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(b.blocker ORDER BY b.kind, b.id), '[]') FROM (
    SELECT 'late_item_pending' AS kind, x.id, jsonb_build_object('kind', 'late_item_pending', 'late_id', x.id) AS blocker
    FROM late_transaction x WHERE x.original_period_id = p_period AND x.state = 'pending'
    UNION ALL
    -- A batch without instructions yet would later post payout_instructed into the period.
    SELECT 'payout_batch_open', b.id, jsonb_build_object('kind', 'payout_batch_open', 'batch_id', b.id)
    FROM payout_batch b WHERE b.period_id = p_period AND b.state IN ('draft', 'reviewed', 'approved', 'instructing')
    UNION ALL
    SELECT 'payout_exception', e.id, jsonb_build_object('kind', 'payout_exception', 'exception_id', e.id)
    FROM payout_exception e
    JOIN payout_instruction i ON i.tenant_id = e.tenant_id AND i.id = e.instruction_id
    JOIN payout_batch b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
    WHERE b.period_id = p_period AND e.state = 'open'
    UNION ALL
    SELECT 'payout_in_transit', i.id, jsonb_build_object('kind', 'payout_in_transit', 'instruction_id', i.id)
    FROM payout_instruction i JOIN payout_batch b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
    WHERE b.period_id = p_period AND i.state IN ('pending', 'instructed', 'accepted')
      AND NOT EXISTS (SELECT 1 FROM payout_instruction r WHERE r.tenant_id = i.tenant_id AND r.retry_of = i.id)
    UNION ALL
    SELECT 'restatement_open', c.id, jsonb_build_object('kind', 'restatement_open', 'case_id', c.id)
    FROM case_file c
    WHERE c.type = 'restatement' AND c.subject_type = 'period' AND c.subject_id = p_period AND c.state = 'submitted'
    UNION ALL
    SELECT 'returned_payment_case', c.id, jsonb_build_object('kind', 'returned_payment_case', 'case_id', c.id)
    FROM case_file c
    JOIN payout_instruction i ON i.tenant_id = c.tenant_id AND i.id = c.subject_id
    JOIN payout_batch b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
    WHERE c.type = 'returned_payment' AND c.subject_type = 'payout_instruction' AND c.state IN ('open', 'submitted')
      AND b.period_id = p_period
  ) b
$$;

-- period_state_guard (0402) plus paid -> closed: by the acting user, under the market's ledger lock (so it serialises with
-- ledger_post), with no blocker and with the journal export carrying every entry of the period (its debit total equals
-- the period's posted debits; NULL when the period has no entries); closed is terminal; the close columns are written
-- only then.
CREATE OR REPLACE FUNCTION period_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_market uuid;
  v_debits numeric;
BEGIN
  IF OLD.state = 'closed' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'a closed period never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (NEW.state = OLD.state
          OR (OLD.state, NEW.state) IN (('open', 'calculating'), ('calculating', 'calculated'), ('calculating', 'open'),
                                        ('calculated', 'calculating'), ('calculated', 'committed'), ('committed', 'paid'),
                                        ('paid', 'closed'))) THEN
    RAISE EXCEPTION 'period state cannot change from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.committed_run_id IS DISTINCT FROM OLD.committed_run_id AND NOT (OLD.state = 'calculated' AND NEW.state = 'committed') THEN
    RAISE EXCEPTION 'a period''s committed run is set once, when it is committed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'committed' AND OLD.state <> 'committed' AND NOT EXISTS (
       SELECT 1 FROM run r
       WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.committed_run_id AND r.period_id = NEW.id AND r.state = 'committed') THEN
    RAISE EXCEPTION 'a period is committed with a committed run of it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'paid' AND OLD.state = 'committed' AND NOT period_payouts_terminal(NEW.tenant_id, NEW.id) THEN
    RAISE EXCEPTION 'a period is paid once every instruction of its payout batches is terminal' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.closed_at, NEW.closed_by, NEW.close_note, NEW.close_journal_export_id)
       IS DISTINCT FROM (OLD.closed_at, OLD.closed_by, OLD.close_note, OLD.close_journal_export_id)
     AND NOT (OLD.state = 'paid' AND NEW.state = 'closed') THEN
    RAISE EXCEPTION 'a period''s close columns are written when it is closed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'paid' AND NEW.state = 'closed' THEN
    SELECT c.market_id INTO v_market FROM calendar c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.calendar_id;
    PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || NEW.tenant_id || ':' || v_market, 0));
    IF NEW.closed_by IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'a period is closed by the acting user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF period_close_blockers(NEW.id) <> '[]'::jsonb THEN
      RAISE EXCEPTION 'the period has close blockers' USING ERRCODE = 'check_violation', DETAIL = period_close_blockers(NEW.id)::text;
    END IF;
    SELECT sum(x.debit_minor) INTO v_debits
    FROM journal_entry e JOIN posting x ON x.tenant_id = e.tenant_id AND x.entry_id = e.id
    WHERE e.tenant_id = NEW.tenant_id AND e.period_id = NEW.id;
    IF (NEW.close_journal_export_id IS NULL) <> (v_debits IS NULL) OR (NEW.close_journal_export_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM journal_export j
         WHERE j.tenant_id = NEW.tenant_id AND j.id = NEW.close_journal_export_id AND j.period_id = NEW.id
           AND j.market_id = v_market AND j.debit_total_minor = v_debits)) THEN
      RAISE EXCEPTION 'a period is closed with a journal export carrying every entry of it (none when it has no entries)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Closes a paid period under the market's ledger lock; period_state_guard checks the closer, the blockers and the export.
CREATE FUNCTION period_close(p_period uuid, p_note text, p_journal_export uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_market uuid;
  v_state text;
BEGIN
  SELECT c.market_id INTO v_market FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  WHERE p.id = p_period;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'period % does not exist', p_period USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || app_tenant_id() || ':' || v_market, 0));
  SELECT p.state INTO v_state FROM period p WHERE p.id = p_period FOR UPDATE;
  IF v_state <> 'paid' THEN
    RAISE EXCEPTION 'only a paid period is closed' USING ERRCODE = 'check_violation', DETAIL = v_state;
  END IF;
  UPDATE period SET state = 'closed', closed_at = now(), closed_by = app_user_id(), close_note = p_note,
                    close_journal_export_id = p_journal_export
  WHERE id = p_period;
END $$;

-- ledger_post (0409) refusing a closed period once the market's ledger lock is held (an existing key still returns its
-- entry: nothing new is posted).
CREATE OR REPLACE FUNCTION ledger_post(p_market uuid, p_period uuid, p_event_type text, p_origin_type text, p_origin_id uuid,
                                       p_key text, p_approval uuid, p_lines jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_existing journal_entry;
  v_currency char(3);
  v_entry uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || app_tenant_id() || ':' || p_market, 0));
  SELECT * INTO v_existing FROM journal_entry e WHERE e.idempotency_key = p_key;
  IF FOUND THEN
    IF (v_existing.origin_type, v_existing.origin_id) IS DISTINCT FROM (p_origin_type, p_origin_id) THEN
      RAISE EXCEPTION 'ledger key % already posts another origin', p_key USING ERRCODE = 'unique_violation';
    END IF;
    RETURN v_existing.id;
  END IF;
  IF EXISTS (SELECT 1 FROM period p WHERE p.id = p_period AND p.state = 'closed') THEN
    RAISE EXCEPTION 'period % is closed', p_period USING ERRCODE = 'check_violation', DETAIL = 'period_closed';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) < 2 OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lines) l
       WHERE jsonb_typeof(l) <> 'object'
          OR jsonb_typeof(l -> 'debit_minor') IS DISTINCT FROM 'string' OR jsonb_typeof(l -> 'credit_minor') IS DISTINCT FROM 'string'
          OR (l ->> 'debit_minor') !~ '^(0|[1-9][0-9]{0,17})$' OR (l ->> 'credit_minor') !~ '^(0|[1-9][0-9]{0,17})$'
          OR ((l ->> 'debit_minor') = '0') = ((l ->> 'credit_minor') = '0')) THEN
    RAISE EXCEPTION 'ledger lines: at least two, each with exactly one non-zero side as a minor-unit string'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT sum((l ->> 'debit_minor')::numeric - (l ->> 'credit_minor')::numeric) FROM jsonb_array_elements(p_lines) l) <> 0 THEN
    RAISE EXCEPTION 'ledger lines do not balance' USING ERRCODE = 'check_violation';
  END IF;
  SELECT m.currency INTO v_currency FROM market m WHERE m.id = p_market;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'market % does not exist', p_market USING ERRCODE = 'foreign_key_violation';
  END IF;
  INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, currency)
  SELECT DISTINCT app_tenant_id(), p_market, l ->> 'type', (l ->> 'payee_participant_id')::uuid, v_currency
  FROM jsonb_array_elements(p_lines) l
  ON CONFLICT DO NOTHING;
  INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id, posted_at)
  VALUES (app_tenant_id(), p_market, p_period, p_event_type, p_origin_type, p_origin_id, p_key, p_approval, clock_timestamp())
  RETURNING id INTO v_entry;
  INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
  SELECT app_tenant_id(), v_entry, a.id, (l.line ->> 'debit_minor')::bigint, (l.line ->> 'credit_minor')::bigint, a.currency
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l (line, n)
  JOIN ledger_account a ON a.market_id = p_market AND a.type = l.line ->> 'type' AND a.credit_type_id IS NULL
    AND a.payee_participant_id IS NOT DISTINCT FROM (l.line ->> 'payee_participant_id')::uuid
  ORDER BY l.n;
  RETURN v_entry;
END $$;

-- D-B6-04: write-offs and new payout batches attribute to the newest committed or paid period (closed skipped).
CREATE OR REPLACE FUNCTION led_attribution_period(p_market uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  LEFT JOIN run r ON r.tenant_id = p.tenant_id AND r.id = p.committed_run_id
  WHERE c.market_id = p_market AND p.state IN ('committed', 'paid')
  ORDER BY r.committed_at DESC NULLS LAST, p.starts_at DESC, p.id
  LIMIT 1
$$;
