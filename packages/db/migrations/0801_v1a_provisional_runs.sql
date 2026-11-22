-- V1-A provisional runs (PLAN V1-A section 1.3; D-V1A-02, C-V1A-17): a calendar declares itself provisional for one final
-- calendar of its market at creation; its periods nest in the final periods; the final run consumes one provisional
-- adjustment origin per committed advance (run, payee position, rule key).

-- 1. calendar: the declaration is part of the calendar's fixed identity; the target is a final calendar of the same market.
ALTER TABLE calendar
  ADD COLUMN provisional_for_calendar_id uuid,
  ADD CONSTRAINT calendar_provisional_not_self CHECK (provisional_for_calendar_id <> id),
  ADD FOREIGN KEY (tenant_id, provisional_for_calendar_id) REFERENCES calendar (tenant_id, id);

CREATE OR REPLACE FUNCTION calendar_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.market_id, NEW.cadence, NEW.cutoff_time_zone, NEW.first_period_start,
                           NEW.provisional_for_calendar_id)
       IS DISTINCT FROM (OLD.tenant_id, OLD.market_id, OLD.cadence, OLD.cutoff_time_zone, OLD.first_period_start,
                         OLD.provisional_for_calendar_id) THEN
    RAISE EXCEPTION 'a calendar''s market and timing never change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.cutoff_time_zone) THEN
    RAISE EXCEPTION 'unknown time zone %', NEW.cutoff_time_zone USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.provisional_for_calendar_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM calendar f
       WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.provisional_for_calendar_id AND f.market_id = NEW.market_id
         AND f.provisional_for_calendar_id IS NULL) THEN
    RAISE EXCEPTION 'a provisional calendar is provisional for a final calendar of its market' USING ERRCODE = 'check_violation',
      DETAIL = 'provisional_target_invalid';
  END IF;
  RETURN NEW;
END $$;

-- 2. The final period containing a provisional period (NULL for a period of a final calendar or one that does not nest).
CREATE FUNCTION provisional_final_period(p_period uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT f.id FROM period p
  JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  JOIN period f ON f.tenant_id = p.tenant_id AND f.calendar_id = c.provisional_for_calendar_id
  WHERE p.id = p_period AND f.starts_at <= p.starts_at AND p.ends_at <= f.ends_at
$$;

-- The provisional periods nested in a final period, each with its committed run, else its latest run (NULL when none).
CREATE FUNCTION provisional_periods_of(p_final_period uuid)
RETURNS TABLE (period_id uuid, starts_at timestamptz, ends_at timestamptz, run_id uuid, run_state text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.starts_at, p.ends_at, r.id, r.state
  FROM period f
  JOIN calendar c ON c.tenant_id = f.tenant_id AND c.provisional_for_calendar_id = f.calendar_id
  JOIN period p ON p.tenant_id = c.tenant_id AND p.calendar_id = c.id AND f.starts_at <= p.starts_at AND p.ends_at <= f.ends_at
  LEFT JOIN LATERAL (SELECT x.id, x.state FROM run x WHERE x.tenant_id = p.tenant_id AND x.period_id = p.id
                     ORDER BY x.state = 'committed' DESC, x.created_at DESC, x.id DESC LIMIT 1) r ON true
  WHERE f.id = p_final_period
  ORDER BY p.starts_at
$$;

-- 3. A period of a provisional calendar lies inside one period of its final calendar (every role).
CREATE FUNCTION period_nested_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM calendar c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.calendar_id
               AND c.provisional_for_calendar_id IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM calendar c JOIN period f ON f.tenant_id = c.tenant_id AND f.calendar_id = c.provisional_for_calendar_id
                     WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.calendar_id
                       AND f.starts_at <= NEW.starts_at AND NEW.ends_at <= f.ends_at) THEN
    RAISE EXCEPTION 'a provisional period lies inside one period of its final calendar' USING ERRCODE = 'check_violation',
      DETAIL = 'periods_not_nested';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER period_nested_guard BEFORE INSERT ON period FOR EACH ROW EXECUTE FUNCTION period_nested_guard();

-- 4. Backstop (every role): no provisional run is requested or committed once its final period has a committed run.
CREATE FUNCTION run_final_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM run f WHERE f.tenant_id = NEW.tenant_id AND f.period_id = provisional_final_period(NEW.period_id)
               AND f.state = 'committed') THEN
    RAISE EXCEPTION 'the final period of provisional run % is committed', NEW.id USING ERRCODE = 'check_violation',
      DETAIL = 'final_period_committed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_final_period_open BEFORE INSERT OR UPDATE OF state ON run
  FOR EACH ROW WHEN (NEW.state IN ('queued', 'committed')) EXECUTE FUNCTION run_final_period_open();

-- 5. adjustment_origin (0401, manual origins unchanged): a provisional origin names the committed provisional run whose
-- lines it offsets and the final run that consumes it.
ALTER TABLE adjustment_origin
  ADD COLUMN provisional_run_id uuid,
  ADD FOREIGN KEY (tenant_id, provisional_run_id) REFERENCES run (tenant_id, id),
  DROP CONSTRAINT adjustment_origin_origin_type_check,
  ADD CONSTRAINT adjustment_origin_origin_type_check
    CHECK (origin_type IN ('late_transaction', 'clawback', 'restatement', 'manual', 'provisional')),
  DROP CONSTRAINT adjustment_origin_one_source,
  ADD CONSTRAINT adjustment_origin_one_source
    CHECK (num_nonnulls(late_transaction_id, restatement_id, case_id, provisional_run_id) = 1),
  ADD CONSTRAINT adjustment_origin_provisional CHECK ((origin_type = 'provisional') = (provisional_run_id IS NOT NULL)),
  DROP CONSTRAINT adjustment_origin_run,
  ADD CONSTRAINT adjustment_origin_run CHECK ((run_id IS NOT NULL) = (late_transaction_id IS NOT NULL OR provisional_run_id IS NOT NULL));
CREATE UNIQUE INDEX adjustment_origin_provisional_line ON adjustment_origin (run_id, provisional_run_id, payee_position_id, rule_key)
  WHERE provisional_run_id IS NOT NULL;
CREATE INDEX adjustment_origin_provisional_idx ON adjustment_origin (tenant_id, provisional_run_id) WHERE provisional_run_id IS NOT NULL;

ALTER TABLE result_line
  DROP CONSTRAINT result_line_origin_type_check,
  ADD CONSTRAINT result_line_origin_type_check
    CHECK (origin_type IN ('late_transaction', 'clawback', 'manual', 'restatement', 'provisional'));

-- Insert (runtime role): a provisional origin offsets exactly the provisional run's lines for its payee position and rule
-- (amount = -their sum), the run committed, of its original period; its run is a not yet calculated run of the final
-- period containing that period (FOR SHARE: a concurrent flip waits or the insert is refused).
CREATE OR REPLACE FUNCTION adjustment_origin_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.consumed_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'an adjustment origin is created unconsumed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.provisional_run_id IS NOT NULL THEN
    IF NOT EXISTS (
         SELECT 1 FROM run pr JOIN run r ON r.tenant_id = pr.tenant_id AND r.id = NEW.run_id
         WHERE pr.tenant_id = NEW.tenant_id AND pr.id = NEW.provisional_run_id AND pr.state = 'committed'
           AND pr.period_id = NEW.original_period_id AND r.period_id = provisional_final_period(NEW.original_period_id)
           AND r.state IN ('queued', 'running')
           AND NEW.amount_minor = -(SELECT sum(l.amount_minor) FROM result_line l
                                    WHERE l.tenant_id = pr.tenant_id AND l.run_id = pr.id
                                      AND l.payee_position_id = NEW.payee_position_id AND l.rule_key = NEW.rule_key)
         FOR SHARE OF r) THEN
      RAISE EXCEPTION 'a provisional origin offsets a committed provisional run''s lines in a run of its final period not yet calculated'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.case_id IS NOT NULL THEN
    IF NOT EXISTS (
         SELECT 1 FROM case_file c
         JOIN position s ON s.tenant_id = c.tenant_id AND s.id = c.subject_id
         JOIN period o ON o.tenant_id = NEW.tenant_id AND o.id = NEW.original_period_id
         JOIN calendar k ON k.tenant_id = o.tenant_id AND k.id = o.calendar_id
         WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.type = 'adjustment' AND c.state = 'approved'
           AND c.subject_type = 'position' AND c.subject_id = NEW.payee_position_id
           AND c.payload ->> 'period_id' = NEW.original_period_id::text AND c.payload ->> 'amount_minor' = NEW.amount_minor::text
           AND k.market_id = s.market_id AND o.state NOT IN ('committed', 'paid', 'closed')
         FOR SHARE OF o) THEN
      RAISE EXCEPTION 'a manual origin is its approved adjustment case, for a period of the position''s market not yet committed'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.restatement_id IS NOT NULL THEN
    IF NOT EXISTS (
         SELECT 1 FROM restatement s JOIN case_file c ON c.tenant_id = s.tenant_id AND c.id = s.case_id
         WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.restatement_id AND s.state IN ('calculated', 'approved')
           AND c.state = 'approved' AND s.period_id = NEW.original_period_id
         FOR SHARE OF s) THEN
      RAISE EXCEPTION 'a restatement origin belongs to an approved restatement of its original period'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT EXISTS (
         SELECT 1 FROM late_transaction t JOIN run r ON r.tenant_id = t.tenant_id AND r.id = NEW.run_id
         WHERE t.tenant_id = NEW.tenant_id AND t.id = NEW.late_transaction_id AND t.original_period_id = NEW.original_period_id
           AND r.state IN ('queued', 'running')
         FOR SHARE OF r) THEN
    RAISE EXCEPTION 'a late origin belongs to its late item''s period and to a run not yet calculated'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Consumption (0401, other types unchanged): a provisional origin only by its own run, committed, of the final period
-- containing its original period.
CREATE OR REPLACE FUNCTION adjustment_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on adjustment_origin is not allowed (history)';
  END IF;
  IF to_jsonb(NEW) - 'consumed_run_id' IS DISTINCT FROM to_jsonb(OLD) - 'consumed_run_id' OR OLD.consumed_run_id IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM run r JOIN period p ON p.tenant_id = r.tenant_id AND p.id = r.period_id
       JOIN period o ON o.tenant_id = NEW.tenant_id AND o.id = NEW.original_period_id
       WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.consumed_run_id AND r.state = 'committed'
         AND (CASE WHEN NEW.case_id IS NOT NULL THEN r.period_id = NEW.original_period_id
                   WHEN NEW.provisional_run_id IS NOT NULL
                     THEN NEW.run_id = r.id AND r.period_id = provisional_final_period(NEW.original_period_id)
                   ELSE p.calendar_id = o.calendar_id AND (NEW.run_id IS NULL OR NEW.run_id = r.id) END))
     OR NOT EXISTS (
       SELECT 1 FROM result_line l WHERE l.tenant_id = NEW.tenant_id AND l.run_id = NEW.consumed_run_id AND l.origin_id = NEW.id) THEN
    RAISE EXCEPTION 'an adjustment origin is consumed once, by a committed run allowed to pay it that carries it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 6. market_period_at (0205): orders are credited to the period of the market's one final calendar; a provisional
-- calendar's periods nest in it (an order paid in advance and trued up is still credited once).
CREATE OR REPLACE FUNCTION market_period_at(p_market_id uuid, p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  WHERE c.market_id = p_market_id AND c.provisional_for_calendar_id IS NULL AND p.starts_at <= p_at AND p.ends_at > p_at
    AND (SELECT count(*) FROM calendar x WHERE x.market_id = p_market_id AND x.provisional_for_calendar_id IS NULL) = 1
$$;
