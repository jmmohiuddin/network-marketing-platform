-- V1-A money (PLAN V1-A sections 1.1, 1.2 and 4.2; D-V1A-03, D-V1A-04, C-V1A-4..6): non-cash credits owed by the tenant
-- (types, awards as run output, redemptions and lot events, posted through ledger_post) and FX rate batches approved by
-- a second person, whose immutable rates convert orders once, at acceptance. Recipe as 0300.

-- 1. credit_type (tenant-wide, D-V1A-09): no field has a default but active; the code never changes.
CREATE FUNCTION credit_scope_ok(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NULL OR (jsonb_keys_ok(p, '{}', ARRAY['markets', 'item_classes']) AND p <> '{}'::jsonb
    AND (NOT p ? 'markets'
         OR jsonb_string_set_ok(p -> 'markets', NULL, '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    AND (NOT p ? 'item_classes' OR jsonb_string_set_ok(p -> 'item_classes', NULL, '^.{1,50}$')))
$$;

CREATE TABLE credit_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  unit_value_minor bigint CHECK (unit_value_minor > 0),
  expiry_days int CHECK (expiry_days BETWEEN 1 AND 3650),
  expiry_notice_days int,
  redemption_scope jsonb CHECK (credit_scope_ok(redemption_scope)),
  taxable boolean NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL DEFAULT app_user_id(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_type_expiry CHECK ((expiry_days IS NULL) = (expiry_notice_days IS NULL)
    AND (expiry_notice_days IS NULL OR expiry_notice_days BETWEEN 1 AND expiry_days)),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE FUNCTION credit_type_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.code, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.code, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a credit type''s code and creation never change' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(NEW.redemption_scope -> 'markets', '[]')) s
             WHERE NOT EXISTS (SELECT 1 FROM market m WHERE m.tenant_id = NEW.tenant_id AND m.id = s::uuid)) THEN
    RAISE EXCEPTION 'a credit type''s redemption scope names markets of its tenant' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_type_guard BEFORE INSERT OR UPDATE ON credit_type FOR EACH ROW EXECUTE FUNCTION credit_type_guard();
CREATE TRIGGER credit_type_no_delete BEFORE DELETE ON credit_type
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation('a credit type is deactivated, not removed');
CREATE TRIGGER credit_type_created_by_actor BEFORE INSERT ON credit_type
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('created_by');
CREATE TRIGGER credit_type_updated_by_actor BEFORE INSERT OR UPDATE ON credit_type
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('updated_by');

-- 2. ledger_account: the credit type of a credit_liability account is a key (DATABASE C-4); credit_liability was never
-- used before, so no row violates the pairing.
ALTER TABLE ledger_account
  ADD FOREIGN KEY (tenant_id, credit_type_id) REFERENCES credit_type (tenant_id, id),
  ADD CONSTRAINT ledger_account_credit_type CHECK ((credit_type_id IS NOT NULL) = (type = 'credit_liability'));

-- 3. credit_award (run output, written by COMP while the run is running): the type's expiry, notice, taxable flag and
-- unit value are copied from the type at insert, whatever the caller sends.
CREATE TABLE credit_award (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  run_id uuid NOT NULL,
  market_id uuid NOT NULL,
  payee_participant_id uuid NOT NULL,
  payee_position_id uuid NOT NULL,
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  credit_type_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  expiry_days int,
  expiry_notice_days int,
  taxable boolean NOT NULL,
  unit_value_minor bigint,
  trace jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, run_id) REFERENCES run (tenant_id, id),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, payee_participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, credit_type_id) REFERENCES credit_type (tenant_id, id),
  UNIQUE (tenant_id, run_id, payee_position_id, rule_key),
  UNIQUE (tenant_id, id)
);
CREATE INDEX credit_award_payee_idx ON credit_award (tenant_id, payee_participant_id, credit_type_id);
CREATE INDEX credit_award_run_idx ON credit_award (tenant_id, run_id);

CREATE FUNCTION credit_award_copy_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT t.expiry_days, t.expiry_notice_days, t.taxable, t.unit_value_minor
  INTO NEW.expiry_days, NEW.expiry_notice_days, NEW.taxable, NEW.unit_value_minor
  FROM credit_type t WHERE t.tenant_id = NEW.tenant_id AND t.id = NEW.credit_type_id;
  IF NOT EXISTS (SELECT 1 FROM market m WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.market_id AND m.currency = NEW.currency) THEN
    RAISE EXCEPTION 'a credit award is valued in its market''s currency' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_award_copy_type BEFORE INSERT ON credit_award FOR EACH ROW EXECUTE FUNCTION credit_award_copy_type();
CREATE TRIGGER credit_award_no_mutation BEFORE UPDATE OR DELETE ON credit_award FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER credit_award_run_running AFTER INSERT ON credit_award REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT WHEN (current_user = 'nmp_app') EXECUTE FUNCTION rows_of_running_run();

-- 4. credit_redemption (key-writable, D-B2-03 actor pair): its entry is the journal entry with origin (credit_redemption,
-- id) and key credit-redeem:<id>, posted after the row in the same transaction; a commit without it is refused.
CREATE TABLE credit_redemption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  credit_type_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  source_system text NOT NULL CHECK (length(source_system) BETWEEN 1 AND 100),
  source_redemption_id text NOT NULL CHECK (length(source_redemption_id) BETWEEN 1 AND 100),
  item_class text CHECK (length(item_class) BETWEEN 1 AND 50),
  occurred_at timestamptz NOT NULL,
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type() CHECK (created_by_type IN ('user', 'service_account', 'system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, credit_type_id) REFERENCES credit_type (tenant_id, id),
  UNIQUE (tenant_id, source_system, source_redemption_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX credit_redemption_participant_idx ON credit_redemption (tenant_id, participant_id, credit_type_id, occurred_at);
CREATE TRIGGER credit_redemption_no_mutation BEFORE UPDATE OR DELETE ON credit_redemption
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- In the market's currency, within the type's redemption scope (backstop: LED answers REDEMPTION_OUT_OF_SCOPE first).
CREATE FUNCTION credit_redemption_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scope jsonb;
BEGIN
  SELECT t.redemption_scope INTO scope FROM credit_type t WHERE t.tenant_id = NEW.tenant_id AND t.id = NEW.credit_type_id;
  IF NOT EXISTS (SELECT 1 FROM market m WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.market_id AND m.currency = NEW.currency)
     OR (scope ? 'markets' AND NOT scope -> 'markets' ? NEW.market_id::text)
     OR (scope ? 'item_classes' AND NOT coalesce(scope -> 'item_classes' ? NEW.item_class, false)) THEN
    RAISE EXCEPTION 'a redemption is in its market''s currency and within its credit type''s scope' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_redemption_insert_guard BEFORE INSERT ON credit_redemption
  FOR EACH ROW EXECUTE FUNCTION credit_redemption_insert_guard();

-- At COMMIT: the redemption's entry exists and the holder's liability for the type in the market is not overdrawn.
CREATE FUNCTION credit_redemption_posted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal_entry e
                 WHERE e.tenant_id = NEW.tenant_id AND e.idempotency_key = 'credit-redeem:' || NEW.id
                   AND e.origin_type = 'credit_redemption' AND e.origin_id = NEW.id)
     OR (SELECT coalesce(sum(x.credit_minor - x.debit_minor), 0) FROM ledger_account a JOIN posting x ON x.account_id = a.id
         WHERE a.tenant_id = NEW.tenant_id AND a.market_id = NEW.market_id AND a.type = 'credit_liability'
           AND a.payee_participant_id = NEW.participant_id AND a.credit_type_id = NEW.credit_type_id) < 0 THEN
    RAISE EXCEPTION 'redemption % is posted in its transaction and never overdraws the credits owed', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER credit_redemption_posted AFTER INSERT ON credit_redemption DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION credit_redemption_posted();

-- 5. credit_lot_event: the expiry notice (once) and the expiry (once, with its entry) of one award's lot.
CREATE TABLE credit_lot_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  award_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('notified', 'expired')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_lot_event_entry CHECK ((kind = 'expired') = (entry_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, award_id) REFERENCES credit_award (tenant_id, id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES journal_entry (tenant_id, id),
  UNIQUE (tenant_id, award_id, kind),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER credit_lot_event_no_mutation BEFORE UPDATE OR DELETE ON credit_lot_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION credit_lot_event_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal_entry e
                 WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.entry_id AND e.event_type = 'credit_expired'
                   AND e.origin_type = 'credit_award' AND e.origin_id = NEW.award_id) THEN
    RAISE EXCEPTION 'an expiry names its award''s expiry entry' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_lot_event_entry_guard BEFORE INSERT ON credit_lot_event
  FOR EACH ROW WHEN (NEW.kind = 'expired') EXECUTE FUNCTION credit_lot_event_entry_guard();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['credit_type', 'credit_award', 'credit_redemption', 'credit_lot_event']::regclass[]) AS t;
CREATE POLICY portal_self ON credit_award AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR payee_participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR payee_participant_id = app_participant_id());
CREATE POLICY portal_self ON credit_redemption AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR participant_id = app_participant_id());
CREATE POLICY portal_hidden ON credit_lot_event AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);

GRANT SELECT, INSERT ON credit_type, credit_award, credit_redemption, credit_lot_event TO nmp_app;
GRANT UPDATE (name, unit_value_minor, expiry_days, expiry_notice_days, redemption_scope, taxable, active, updated_by, updated_at)
  ON credit_type TO nmp_app;

-- 6. Lots (D-V1A-03): every committed award is a lot expiring at the end of its commit date (market zone) + expiry_days.
-- Remainders replay the type's history in time order: an expiry empties its lot; a redemption consumes, FIFO by
-- (expires_on NULLS LAST, committed_at, award id), the lots committed by then and not yet due.
-- shortcut: a lot committed by a transaction that started before a redemption's but committed after it counts as
-- available to that redemption on replay (totals stay exact, only the split between lots can differ); record the
-- consumption per lot if a statement ever has to show it.
CREATE FUNCTION credit_lots(p_participant uuid, p_credit_type uuid, p_market uuid)
RETURNS TABLE (award_id uuid, run_id uuid, committed_at timestamptz, expires_on date, expires_at timestamptz,
               amount_minor bigint, remaining_minor bigint)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  lot record;
  ev record;
  ids uuid[] := '{}';
  runs uuid[] := '{}';
  commits timestamptz[] := '{}';
  ons date[] := '{}';
  ats timestamptz[] := '{}';
  amounts bigint[] := '{}';
  remains bigint[] := '{}';
  need bigint;
  take bigint;
  i int;
BEGIN
  FOR lot IN
    SELECT a.id, a.run_id, r.committed_at, a.amount_minor,
           (r.committed_at AT TIME ZONE m.time_zone)::date + a.expiry_days AS expires_on,
           ((r.committed_at AT TIME ZONE m.time_zone)::date + a.expiry_days + 1)::timestamp AT TIME ZONE m.time_zone AS expires_at
    FROM credit_award a
    JOIN run r ON r.tenant_id = a.tenant_id AND r.id = a.run_id AND r.state = 'committed'
    JOIN market m ON m.tenant_id = a.tenant_id AND m.id = a.market_id
    WHERE a.payee_participant_id = p_participant AND a.credit_type_id = p_credit_type AND a.market_id = p_market
    ORDER BY 5 NULLS LAST, r.committed_at, a.id
  LOOP
    ids := ids || lot.id; runs := runs || lot.run_id; commits := commits || lot.committed_at; ons := ons || lot.expires_on;
    ats := ats || lot.expires_at; amounts := amounts || lot.amount_minor; remains := remains || lot.amount_minor;
  END LOOP;
  FOR ev IN
    SELECT 1 AS ord, e.created_at AS at, e.award_id AS id, e.amount_minor
    FROM credit_lot_event e JOIN credit_award a ON a.tenant_id = e.tenant_id AND a.id = e.award_id
    WHERE e.kind = 'expired' AND a.payee_participant_id = p_participant AND a.credit_type_id = p_credit_type AND a.market_id = p_market
    UNION ALL
    SELECT 2, x.created_at, x.id, x.amount_minor FROM credit_redemption x
    WHERE x.participant_id = p_participant AND x.credit_type_id = p_credit_type AND x.market_id = p_market
    ORDER BY 2, 1, 3
  LOOP
    IF ev.ord = 1 THEN
      i := array_position(ids, ev.id);
      remains[i] := 0;
    ELSE
      need := ev.amount_minor;
      FOR i IN 1 .. coalesce(array_length(ids, 1), 0) LOOP
        EXIT WHEN need = 0;
        IF remains[i] > 0 AND commits[i] <= ev.at AND (ats[i] IS NULL OR ats[i] > ev.at) THEN
          take := least(need, remains[i]);
          remains[i] := remains[i] - take;
          need := need - take;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN QUERY SELECT * FROM unnest(ids, runs, commits, ons, ats, amounts, remains);
END $$;

-- 7. ledger_post (0601) with a credit type per line: a credit_liability line names it, every other line leaves it out.
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
  INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, credit_type_id, currency)
  SELECT DISTINCT app_tenant_id(), p_market, l ->> 'type', (l ->> 'payee_participant_id')::uuid, (l ->> 'credit_type_id')::uuid,
         v_currency
  FROM jsonb_array_elements(p_lines) l
  ON CONFLICT DO NOTHING;
  INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id, posted_at)
  VALUES (app_tenant_id(), p_market, p_period, p_event_type, p_origin_type, p_origin_id, p_key, p_approval, clock_timestamp())
  RETURNING id INTO v_entry;
  INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
  SELECT app_tenant_id(), v_entry, a.id, (l.line ->> 'debit_minor')::bigint, (l.line ->> 'credit_minor')::bigint, a.currency
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l (line, n)
  JOIN ledger_account a ON a.market_id = p_market AND a.type = l.line ->> 'type'
    AND a.credit_type_id IS NOT DISTINCT FROM (l.line ->> 'credit_type_id')::uuid
    AND a.payee_participant_id IS NOT DISTINCT FROM (l.line ->> 'payee_participant_id')::uuid
  ORDER BY l.n;
  RETURN v_entry;
END $$;

-- 8. journal_entry rules (0604, every branch kept): redemption and expiry entries, without approval, keyed by their origin.
ALTER TABLE journal_entry
  DROP CONSTRAINT journal_entry_event_type_check,
  DROP CONSTRAINT journal_entry_origin_type_check,
  DROP CONSTRAINT journal_entry_origin,
  DROP CONSTRAINT journal_entry_human_approval,
  DROP CONSTRAINT journal_entry_key_is_origin,
  ADD CONSTRAINT journal_entry_event_type_check CHECK (event_type IN ('run_committed', 'payout_instructed', 'payout_settled',
    'payout_returned', 'payout_failed', 'write_off', 'migration_opening', 'credit_redeemed', 'credit_expired')),
  ADD CONSTRAINT journal_entry_origin_type_check
    CHECK (origin_type IN ('run', 'payout_instruction', 'case', 'migration', 'credit_redemption', 'credit_award')),
  ADD CONSTRAINT journal_entry_origin CHECK (origin_type = CASE
    WHEN event_type = 'run_committed' THEN 'run' WHEN event_type = 'write_off' THEN 'case'
    WHEN event_type = 'migration_opening' THEN 'migration' WHEN event_type = 'credit_redeemed' THEN 'credit_redemption'
    WHEN event_type = 'credit_expired' THEN 'credit_award' ELSE 'payout_instruction' END),
  ADD CONSTRAINT journal_entry_human_approval
    CHECK ((approval_id IS NOT NULL) = (event_type IN ('run_committed', 'payout_instructed', 'write_off', 'migration_opening'))),
  ADD CONSTRAINT journal_entry_key_is_origin CHECK (idempotency_key = CASE event_type
    WHEN 'run_committed' THEN 'run:' || origin_id::text
    WHEN 'write_off' THEN 'writeoff:' || origin_id::text
    WHEN 'migration_opening' THEN 'migration:' || origin_id::text || ':opening'
    WHEN 'payout_instructed' THEN 'instr:' || origin_id::text || ':instructed'
    WHEN 'payout_settled' THEN 'instr:' || origin_id::text || ':settled'
    WHEN 'credit_redeemed' THEN 'credit-redeem:' || origin_id::text
    WHEN 'credit_expired' THEN 'credit-expire:' || origin_id::text
    ELSE 'instr:' || origin_id::text || ':returned' END);

-- 0605's origin guard with the credit branches: both attributed to the market's attribution period; an expiry only of a
-- committed award's lot that is due.
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
    WHEN 'credit_redemption' THEN NEW.period_id = led_attribution_period(NEW.market_id) AND EXISTS (
      SELECT 1 FROM credit_redemption x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.origin_id AND x.market_id = NEW.market_id)
    WHEN 'credit_award' THEN NEW.period_id = led_attribution_period(NEW.market_id) AND EXISTS (
      SELECT 1 FROM credit_award a CROSS JOIN LATERAL credit_lots(a.payee_participant_id, a.credit_type_id, a.market_id) l
      WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.origin_id AND a.market_id = NEW.market_id AND a.expiry_days IS NOT NULL
        AND l.award_id = a.id AND l.expires_at <= now())
    ELSE false END;
  IF NOT ok THEN
    RAISE EXCEPTION 'a journal entry posts an existing origin of its market and period, in the origin''s state, with the origin''s approval'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 0605's balance rule with the credit type in the comparison (NULL in every earlier rule): a redemption is Dr
-- credit_liability(holder, type) / Cr settled_clearing for its amount; an expiry Dr credit_liability(payee, type) / Cr
-- breakage for its lot event's amount (inserted after the entry in the same transaction; this trigger runs at COMMIT).
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_amount bigint;
  v_payee uuid;
  v_type uuid;
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
  ELSIF NEW.origin_type = 'credit_redemption' THEN
    SELECT x.amount_minor, x.participant_id, x.credit_type_id INTO v_amount, v_payee, v_type
    FROM credit_redemption x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.origin_id;
  ELSIF NEW.origin_type = 'credit_award' THEN
    SELECT e.amount_minor, a.payee_participant_id, a.credit_type_id INTO v_amount, v_payee, v_type
    FROM credit_award a JOIN credit_lot_event e ON e.tenant_id = a.tenant_id AND e.award_id = a.id AND e.kind = 'expired'
    WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.origin_id AND e.entry_id = NEW.id;
  ELSE
    SELECT CASE WHEN c.payload ->> 'amount_minor' ~ '^[1-9][0-9]{0,17}$' THEN (c.payload ->> 'amount_minor')::bigint END,
           a.payee_participant_id INTO v_amount, v_payee
    FROM case_file c JOIN ledger_account a ON a.tenant_id = c.tenant_id AND a.id = c.subject_id AND a.type = 'clawback_receivable'
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.origin_id;
  END IF;
  IF v_amount IS NULL OR EXISTS (
       WITH actual AS (
         SELECT a.type, a.payee_participant_id AS payee, a.credit_type_id AS credit_type, x.debit_minor AS debit,
                x.credit_minor AS credit
         FROM posting x JOIN ledger_account a ON a.id = x.account_id WHERE x.entry_id = NEW.id
       ), expected AS (
         SELECT e.type, e.payee, e.credit_type, e.debit, e.credit FROM (VALUES
           ('payout_instructed', 'payee_payable', v_payee, NULL::uuid, v_amount, 0::bigint),
           ('payout_instructed', 'payout_in_transit', NULL, NULL, 0, v_amount),
           ('payout_settled', 'payout_in_transit', NULL, NULL, v_amount, 0),
           ('payout_settled', 'settled_clearing', NULL, NULL, 0, v_amount),
           ('payout_returned', 'payout_in_transit', NULL, NULL, v_amount, 0),
           ('payout_returned', 'payee_payable', v_payee, NULL, 0, v_amount),
           ('payout_failed', 'payout_in_transit', NULL, NULL, v_amount, 0),
           ('payout_failed', 'payee_payable', v_payee, NULL, 0, v_amount),
           ('write_off', 'write_off', NULL, NULL, v_amount, 0),
           ('write_off', 'clawback_receivable', v_payee, NULL, 0, v_amount),
           ('credit_redeemed', 'credit_liability', v_payee, v_type, v_amount, 0),
           ('credit_redeemed', 'settled_clearing', NULL, NULL, 0, v_amount),
           ('credit_expired', 'credit_liability', v_payee, v_type, v_amount, 0),
           ('credit_expired', 'breakage', NULL, NULL, 0, v_amount)) AS e (event_type, type, payee, credit_type, debit, credit)
         WHERE e.event_type = NEW.event_type
       )
       (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
       UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) THEN
    RAISE EXCEPTION 'journal entry % does not carry the lines of its % posting rule for its origin', NEW.id, NEW.event_type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

-- 9. led_post_run (0404) with the run's credit awards: Dr commission_expense Σ awards, Cr credit_liability per payee and
-- type. A run without awards posts exactly what it posted before.
CREATE OR REPLACE FUNCTION led_post_run(p_run uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r run;
  v_market uuid;
  v_entry uuid;
  v_changed jsonb;
  v_lines jsonb;
  v_expense numeric;
BEGIN
  SELECT * INTO r FROM run WHERE id = p_run;
  IF NOT FOUND OR r.state <> 'committed' THEN
    RAISE EXCEPTION 'only a committed run is posted' USING ERRCODE = 'check_violation';
  END IF;
  SELECT c.market_id INTO v_market FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  WHERE p.id = r.period_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || r.tenant_id || ':' || v_market, 0));
  SELECT e.id INTO v_entry FROM journal_entry e WHERE e.idempotency_key = 'run:' || p_run;
  IF FOUND THEN
    RETURN v_entry;
  END IF;
  IF coalesce(r.totals ->> 'residue_minor', '0') <> '0' THEN
    RAISE EXCEPTION 'run % has a rounding residue; residue is not posted (C-B4-3)', p_run USING ERRCODE = 'check_violation';
  END IF;
  SELECT jsonb_agg(s.payee_participant_id ORDER BY s.payee_participant_id) INTO v_changed FROM run_settlement s
  WHERE s.run_id = p_run AND s.receivable_before_minor <> led_balance(v_market, s.payee_participant_id, 'clawback_receivable');
  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION 'receivables changed since run % was calculated', p_run USING ERRCODE = 'LD001', DETAIL = v_changed::text;
  END IF;
  SELECT coalesce(sum(s.gross_minor), 0) INTO v_expense FROM run_settlement s WHERE s.run_id = p_run;
  IF v_expense IS DISTINCT FROM (SELECT coalesce(sum(l.amount_minor), 0) FROM result_line l WHERE l.run_id = p_run)
     OR v_expense IS DISTINCT FROM (r.totals ->> 'gross_minor')::numeric THEN
    RAISE EXCEPTION 'run % settlement, lines and totals.gross_minor differ (control)', p_run USING ERRCODE = 'check_violation';
  END IF;
  WITH s AS (SELECT * FROM run_settlement WHERE run_id = p_run AND gross_minor <> 0),
  neg AS (
    SELECT s.payee_participant_id AS payee, -s.gross_minor AS owed,
           least(-s.gross_minor, greatest(led_balance(v_market, s.payee_participant_id, 'payee_payable'), 0)) AS offset_minor
    FROM s WHERE s.gross_minor < 0
  ), awards AS (SELECT * FROM credit_award a WHERE a.run_id = p_run),
  lines (type, payee, credit_type, debit, credit) AS (
    SELECT 'commission_expense', NULL::uuid, NULL::uuid, sum(s.gross_minor), 0::numeric FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'commission_expense', NULL, NULL, 0, -sum(s.gross_minor) FROM s WHERE s.gross_minor < 0
    UNION ALL SELECT 'withholding_payable', NULL, NULL, 0, sum(s.withheld_minor) FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'payee_payable', s.payee_participant_id, NULL, 0, s.gross_minor - s.withheld_minor FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'payee_payable', s.payee_participant_id, NULL, s.netted_minor, 0 FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'clawback_receivable', s.payee_participant_id, NULL, 0, s.netted_minor FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'payee_payable', neg.payee, NULL, neg.offset_minor, 0 FROM neg
    UNION ALL SELECT 'clawback_receivable', neg.payee, NULL, neg.owed - neg.offset_minor, 0 FROM neg
    UNION ALL SELECT 'commission_expense', NULL, NULL, sum(a.amount_minor), 0 FROM awards a HAVING count(*) > 0
    UNION ALL SELECT 'credit_liability', a.payee_participant_id, a.credit_type_id, 0, sum(a.amount_minor) FROM awards a
      GROUP BY a.payee_participant_id, a.credit_type_id
  )
  SELECT jsonb_agg(jsonb_build_object('type', type, 'payee_participant_id', payee, 'credit_type_id', credit_type,
                                      'debit_minor', debit::text, 'credit_minor', credit::text) ORDER BY type, payee, credit_type, debit)
  INTO v_lines FROM lines WHERE debit <> 0 OR credit <> 0;
  IF v_lines IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN ledger_post(v_market, r.period_id, 'run_committed', 'run', p_run, 'run:' || p_run, r.approval_id, v_lines);
END $$;

-- 10. Expiry (D-V1A-03): every due lot of the holder with a remainder is posted Dr credit_liability / Cr breakage in the
-- market's attribution period and recorded once; none open -> check_violation DETAIL no_committed_period. Takes the market
-- ledger lock first, so LED calls it before checking a redemption against the unexpired remainder.
CREATE FUNCTION credit_expire_due(p_participant uuid, p_credit_type uuid, p_market uuid) RETURNS int
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  lot record;
  v_period uuid;
  v_entry uuid;
  expired int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || app_tenant_id() || ':' || p_market, 0));
  FOR lot IN SELECT l.award_id, l.remaining_minor FROM credit_lots(p_participant, p_credit_type, p_market) l
             WHERE l.expires_at <= now() AND l.remaining_minor > 0 ORDER BY l.expires_at, l.award_id LOOP
    v_period := coalesce(v_period, led_attribution_period(p_market));
    IF v_period IS NULL THEN
      RAISE EXCEPTION 'no committed period of market % is open to attribute the expiry to', p_market
        USING ERRCODE = 'check_violation', DETAIL = 'no_committed_period';
    END IF;
    v_entry := ledger_post(p_market, v_period, 'credit_expired', 'credit_award', lot.award_id, 'credit-expire:' || lot.award_id, NULL,
      jsonb_build_array(
        jsonb_build_object('type', 'credit_liability', 'payee_participant_id', p_participant, 'credit_type_id', p_credit_type,
                           'debit_minor', lot.remaining_minor::text, 'credit_minor', '0'),
        jsonb_build_object('type', 'breakage', 'debit_minor', '0', 'credit_minor', lot.remaining_minor::text)));
    INSERT INTO credit_lot_event (tenant_id, award_id, kind, amount_minor, entry_id)
    VALUES (app_tenant_id(), lot.award_id, 'expired', lot.remaining_minor, v_entry);
    expired := expired + 1;
  END LOOP;
  RETURN expired;
END $$;

-- 11. credit.expiring (statement topic, not mandatory): once per lot, with its notice event; NULL when already sent.
CREATE OR REPLACE FUNCTION notification_template(p_template text, OUT topic text, OUT mandatory boolean)
LANGUAGE sql IMMUTABLE AS $$
  SELECT t.topic, t.mandatory FROM (VALUES
    ('statement.ready', 'statement', false), ('payout.sent', 'payout', false), ('payout.held', 'payout', false),
    ('payout.returned', 'payout', false), ('bank_detail.changed', 'security', true),
    ('tax_profile.changed', 'security', true), ('dispute.updated', 'dispute', false),
    ('privacy_request.updated', 'privacy', true), ('plan.change_scheduled', 'plan_change', true),
    ('tax_form.available', 'statement', false), ('credit.expiring', 'statement', false)
  ) AS t (template, topic, mandatory)
  WHERE t.template = p_template
$$;

CREATE FUNCTION notify_credit_expiring(p_award uuid, p_remaining bigint) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  lot record;
BEGIN
  SELECT a.tenant_id, a.payee_participant_id, a.currency, t.code, t.name, l.expires_on INTO lot
  FROM credit_award a JOIN credit_type t ON t.tenant_id = a.tenant_id AND t.id = a.credit_type_id
  CROSS JOIN LATERAL credit_lots(a.payee_participant_id, a.credit_type_id, a.market_id) l
  WHERE a.id = p_award AND l.award_id = a.id AND l.expires_on IS NOT NULL;
  IF NOT FOUND OR p_remaining IS NULL OR p_remaining <= 0 THEN
    RAISE EXCEPTION 'an expiry notice needs a committed lot that expires and a positive remainder' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO credit_lot_event (tenant_id, award_id, kind, amount_minor) VALUES (lot.tenant_id, p_award, 'notified', p_remaining)
  ON CONFLICT (tenant_id, award_id, kind) DO NOTHING;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN notify_participant(lot.payee_participant_id, 'credit.expiring', jsonb_build_object(
    'credit_type_code', lot.code, 'credit_type_name', lot.name, 'amount_minor', p_remaining::text, 'currency', lot.currency,
    'expires_on', lot.expires_on::text));
END $$;

-- 12. The daily cron's candidates (system realm, archived tenants skipped): lots inside their notice window not yet
-- noticed, and (holder, type, market) triples with a due lot and credits still owed.
CREATE FUNCTION credits_to_notify(p_limit int) RETURNS TABLE (tenant_id uuid, award_id uuid, remaining_minor bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT a.tenant_id, a.id, l.remaining_minor
    FROM credit_award a
    JOIN tenant t ON t.id = a.tenant_id AND t.state <> 'archived'
    JOIN run r ON r.tenant_id = a.tenant_id AND r.id = a.run_id AND r.state = 'committed'
    JOIN market m ON m.tenant_id = a.tenant_id AND m.id = a.market_id
    CROSS JOIN LATERAL credit_lots(a.payee_participant_id, a.credit_type_id, a.market_id) l
    WHERE a.expiry_days IS NOT NULL AND l.award_id = a.id AND l.remaining_minor > 0
      AND now() >= l.expires_at - make_interval(days => a.expiry_notice_days) AND now() < l.expires_at
      -- cheap pre-filter on the commit date before the lots are replayed
      AND (r.committed_at AT TIME ZONE m.time_zone)::date + a.expiry_days - a.expiry_notice_days <= (now() AT TIME ZONE m.time_zone)::date
      AND NOT EXISTS (SELECT 1 FROM credit_lot_event e WHERE e.tenant_id = a.tenant_id AND e.award_id = a.id AND e.kind = 'notified')
    ORDER BY l.expires_at, a.id
    LIMIT p_limit;
END $$;

CREATE FUNCTION credits_to_expire(p_limit int)
RETURNS TABLE (tenant_id uuid, market_id uuid, participant_id uuid, credit_type_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT DISTINCT a.tenant_id, a.market_id, a.payee_participant_id, a.credit_type_id
    FROM credit_award a
    JOIN tenant t ON t.id = a.tenant_id AND t.state <> 'archived'
    JOIN run r ON r.tenant_id = a.tenant_id AND r.id = a.run_id AND r.state = 'committed'
    JOIN market m ON m.tenant_id = a.tenant_id AND m.id = a.market_id
    WHERE a.expiry_days IS NOT NULL
      AND ((r.committed_at AT TIME ZONE m.time_zone)::date + a.expiry_days + 1)::timestamp AT TIME ZONE m.time_zone <= now()
      AND NOT EXISTS (SELECT 1 FROM credit_lot_event e WHERE e.tenant_id = a.tenant_id AND e.award_id = a.id AND e.kind = 'expired')
      AND (SELECT sum(x.credit_minor - x.debit_minor) FROM ledger_account c JOIN posting x ON x.account_id = c.id
           WHERE c.tenant_id = a.tenant_id AND c.market_id = a.market_id AND c.type = 'credit_liability'
             AND c.payee_participant_id = a.payee_participant_id AND c.credit_type_id = a.credit_type_id) > 0
    ORDER BY 1, 2, 3, 4
    LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION credits_to_notify(int), credits_to_expire(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credits_to_notify(int), credits_to_expire(int) TO nmp_app;

-- 13. FX (D-V1A-04): a batch of 1..500 rates proposed by one user, decided once by another; rates exist only once approved.
CREATE FUNCTION fx_rows_ok(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array' AND jsonb_array_length(p) BETWEEN 1 AND 500 THEN (
    SELECT bool_and(jsonb_keys_ok(r, ARRAY['base', 'quote', 'rate', 'valid_from'], '{}')
                    AND jsonb_typeof(r -> 'base') = 'string' AND r ->> 'base' ~ '^[A-Z]{3}$'
                    AND jsonb_typeof(r -> 'quote') = 'string' AND r ->> 'quote' ~ '^[A-Z]{3}$' AND r ->> 'base' <> r ->> 'quote'
                    AND jsonb_typeof(r -> 'rate') = 'string' AND r ->> 'rate' ~ '^[0-9]{1,10}\.[0-9]{10}$'
                    AND r ->> 'rate' !~ '^0+\.0+$'
                    AND jsonb_typeof(r -> 'valid_from') = 'string'
                    AND r ->> 'valid_from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
                    AND pg_input_is_valid(r ->> 'valid_from', 'timestamptz'))
       AND count(DISTINCT (r ->> 'base', r ->> 'quote', r ->> 'valid_from')) = count(*)
    FROM jsonb_array_elements(p) r)
  ELSE false END
$$;

CREATE TABLE fx_rate_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 200),
  rows jsonb NOT NULL CHECK (fx_rows_ok(rows)),
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'approved', 'rejected')),
  proposed_by uuid NOT NULL DEFAULT app_user_id(),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approval_id uuid,
  decided_at timestamptz,
  CONSTRAINT fx_rate_batch_decision CHECK ((state = 'proposed') = (approval_id IS NULL AND decided_at IS NULL)
                                           AND (approval_id IS NULL) = (decided_at IS NULL)),
  FOREIGN KEY (tenant_id, proposed_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX fx_rate_batch_state_idx ON fx_rate_batch (tenant_id, state, proposed_at DESC);

-- Proposed by the acting user; decided once (only state, approval and time change) with an approval of this batch whose
-- decision is the new state, by someone other than the proposer. Shared with retention_schedule (0804).
CREATE FUNCTION second_person_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'proposed' THEN
      RAISE EXCEPTION '% is created proposed', TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'proposed' OR NEW.state = 'proposed'
     OR to_jsonb(NEW) - ARRAY['state', 'approval_id', 'decided_at'] IS DISTINCT FROM to_jsonb(OLD) - ARRAY['state', 'approval_id', 'decided_at']
     OR NOT EXISTS (SELECT 1 FROM approval a
                    WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.approval_id AND a.object_type = TG_TABLE_NAME
                      AND a.object_id = NEW.id AND a.decision = NEW.state AND a.approver_id <> OLD.proposed_by) THEN
    RAISE EXCEPTION '% is decided once, with an approval of it by someone other than its proposer', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fx_rate_batch_guard BEFORE INSERT OR UPDATE ON fx_rate_batch
  FOR EACH ROW EXECUTE FUNCTION second_person_decision_guard();
CREATE TRIGGER fx_rate_batch_no_delete BEFORE DELETE ON fx_rate_batch FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER fx_rate_batch_proposed_by_actor BEFORE INSERT ON fx_rate_batch
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('proposed_by');

CREATE TABLE fx_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  batch_id uuid NOT NULL,
  base char(3) NOT NULL CHECK (base ~ '^[A-Z]{3}$'),
  quote char(3) NOT NULL CHECK (quote ~ '^[A-Z]{3}$'),
  rate numeric(20, 10) NOT NULL CHECK (rate > 0),
  source text NOT NULL,
  valid_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (base <> quote),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES fx_rate_batch (tenant_id, id),
  UNIQUE (tenant_id, base, quote, valid_from),
  UNIQUE (tenant_id, id)
);
CREATE INDEX fx_rate_pair_idx ON fx_rate (tenant_id, base, quote, valid_from DESC);
CREATE TRIGGER fx_rate_no_mutation BEFORE UPDATE OR DELETE ON fx_rate FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A rate is a row of its approved batch, with the batch's source.
CREATE FUNCTION fx_rate_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fx_rate_batch b CROSS JOIN LATERAL jsonb_array_elements(b.rows) r
                 WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.batch_id AND b.state = 'approved' AND b.source = NEW.source
                   AND r ->> 'base' = NEW.base AND r ->> 'quote' = NEW.quote AND (r ->> 'rate')::numeric = NEW.rate
                   AND (r ->> 'valid_from')::timestamptz = NEW.valid_from) THEN
    RAISE EXCEPTION 'a rate is a row of its approved batch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fx_rate_insert_guard BEFORE INSERT ON fx_rate FOR EACH ROW EXECUTE FUNCTION fx_rate_insert_guard();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['fx_rate_batch', 'fx_rate']::regclass[]) AS t;
GRANT SELECT, INSERT ON fx_rate_batch, fx_rate TO nmp_app;
GRANT UPDATE (state, approval_id, decided_at) ON fx_rate_batch TO nmp_app;

-- The rate in force at an instant: the latest valid_from at or before it.
CREATE FUNCTION fx_rate_at(p_base char(3), p_quote char(3), p_at timestamptz)
RETURNS TABLE (id uuid, rate numeric, valid_from timestamptz, source text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT f.id, f.rate, f.valid_from, f.source FROM fx_rate f
  WHERE f.base = p_base AND f.quote = p_quote AND f.valid_from <= p_at
  ORDER BY f.valid_from DESC
  LIMIT 1
$$;
