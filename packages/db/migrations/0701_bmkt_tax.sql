-- B-MKT tax (PLAN B-MKT sections 1.2 and 4.2; D-BM-03, D-BM-04, D-BM-06, D-BM-13): withholding instructions from the
-- market pack, tax lines written as run output, year-end totals and frozen year-end forms, and their notice.
-- Statements only: nothing is filed with a tax authority and no external service is called.

-- 1. tax_line (TAX's table, written by COMP in the run-output transaction, C-BM-2): one per payee and run, insert-only.
CREATE TABLE tax_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  run_id uuid NOT NULL,
  payee_participant_id uuid NOT NULL,
  rule_id text NOT NULL REFERENCES tax_rule (id),
  taxable_minor bigint NOT NULL CHECK (taxable_minor >= 0),
  withheld_minor bigint NOT NULL CHECK (withheld_minor >= 0 AND withheld_minor <= taxable_minor),
  rate numeric(9, 6) NOT NULL CHECK (rate BETWEEN 0 AND 1),
  rate_basis text NOT NULL CHECK (rate_basis IN ('rate', 'missing_id_rate', 'below_threshold', 'no_duty')),
  tax_year int NOT NULL,
  tax_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_line_zero_basis CHECK (rate_basis NOT IN ('below_threshold', 'no_duty') OR (rate = 0 AND withheld_minor = 0)),
  FOREIGN KEY (tenant_id, run_id) REFERENCES run (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_participant_id) REFERENCES participant (tenant_id, id),
  UNIQUE (tenant_id, run_id, payee_participant_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX tax_line_payee_year_idx ON tax_line (tenant_id, payee_participant_id, tax_year);
CREATE TRIGGER tax_line_no_mutation BEFORE UPDATE OR DELETE ON tax_line FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tax_line_run_running AFTER INSERT ON tax_line REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT WHEN (current_user = 'nmp_app') EXECUTE FUNCTION rows_of_running_run();

-- 2. tax_form_generation and tax_form (D-BM-06): one generation row per call of tax_generate_forms, and per changed
-- payee a new frozen form version (nothing is overwritten). The form is the row, rendered on read (C-BM-1).
CREATE TABLE tax_form_generation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  tax_year int NOT NULL,
  form_type text NOT NULL,
  rule_id text NOT NULL REFERENCES tax_rule (id),
  generated int NOT NULL CHECK (generated >= 0),
  unchanged int NOT NULL CHECK (unchanged >= 0),
  held jsonb NOT NULL CHECK (jsonb_typeof(held) = 'array'),
  withheld_total_minor bigint NOT NULL,
  ledger_withheld_minor bigint NOT NULL,
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_form_generation_ledger_equal CHECK (withheld_total_minor = ledger_withheld_minor),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX tax_form_generation_year_idx ON tax_form_generation (tenant_id, market_id, tax_year, created_at DESC);

CREATE TABLE tax_form (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  generation_id uuid NOT NULL,
  market_id uuid NOT NULL,
  tax_year int NOT NULL,
  form_type text NOT NULL,
  participant_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  payee_ref text NOT NULL,
  tax_id_masked text NOT NULL,
  currency char(3) NOT NULL,
  totals jsonb NOT NULL CHECK (jsonb_typeof(totals) = 'object'),
  totals_hash bytea NOT NULL CHECK (length(totals_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, generation_id) REFERENCES tax_form_generation (tenant_id, id),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  UNIQUE (tenant_id, tax_year, form_type, participant_id, version)
);
CREATE INDEX tax_form_participant_idx ON tax_form (tenant_id, participant_id, tax_year, form_type, version DESC);
CREATE INDEX tax_form_market_year_idx ON tax_form (tenant_id, market_id, tax_year);

-- Rows of either table are written only by tax_generate_forms (SECURITY DEFINER; nmp_app holds no INSERT on them). The
-- form's hash is always the hash of its totals.
CREATE FUNCTION tax_form_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.totals_hash := digest(NEW.totals::text, 'sha256');
  RETURN NEW;
END $$;
CREATE TRIGGER tax_form_hash BEFORE INSERT ON tax_form FOR EACH ROW EXECUTE FUNCTION tax_form_hash();
CREATE TRIGGER tax_form_generation_no_mutation BEFORE UPDATE OR DELETE ON tax_form_generation
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tax_form_no_mutation BEFORE UPDATE OR DELETE ON tax_form FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['tax_line', 'tax_form_generation', 'tax_form']::regclass[]) AS t;
-- D-BM-13: the payee's portal session sees its own lines and forms; generations (held lists) never.
CREATE POLICY portal_self ON tax_line AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR payee_participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR payee_participant_id = app_participant_id());
CREATE POLICY portal_self ON tax_form AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR participant_id = app_participant_id());
CREATE POLICY portal_hidden ON tax_form_generation AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);
GRANT SELECT, INSERT ON tax_line TO nmp_app;
GRANT SELECT ON tax_form_generation, tax_form TO nmp_app;

-- 3. D-BM-03 known limit: payments before the first committed run are not counted, so B4's reserved column goes.
ALTER TABLE tax_profile DROP COLUMN prior_year_totals;

-- 4. Tax dates and years (D-BM-03, C-BM-12): a run pays at its period's last microsecond; its tax date is that
-- instant's date in the market zone; the tax year comes from the pack's tax_year rule (label = year it starts in).
CREATE FUNCTION tax_date_of(p_period uuid) RETURNS date
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT ((p.ends_at - interval '1 microsecond') AT TIME ZONE m.time_zone)::date
  FROM period p
  JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  JOIN market m ON m.tenant_id = c.tenant_id AND m.id = c.market_id
  WHERE p.id = p_period
$$;

CREATE FUNCTION tax_year_of(p_market uuid, p_date date) RETURNS int
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_date >= make_date(d.y, (r.params ->> 'start_month')::int, (r.params ->> 'start_day')::int) THEN d.y ELSE d.y - 1 END
  FROM market_pack_rule(p_market, 'tax_year', p_date) r CROSS JOIN LATERAL (SELECT extract(year FROM p_date)::int AS y) d
  WHERE r.id IS NOT NULL
$$;

-- The year by the rule in force on some day of it, so it holds every date tax_year_of labels p_year, also when the rule
-- took effect after the year's start.
-- shortcut: a pack changing its tax-year start gets overlapping transitional years (the later rule wins), model a transitional year when a pack needs one
CREATE FUNCTION tax_year_bounds(p_market uuid, p_year int) RETURNS TABLE (starts_on date, ends_on date)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT x.s, x.e
  FROM market m
  JOIN pack_rule r ON r.market_pack = m.market_pack AND r.kind = 'tax_year'
  CROSS JOIN LATERAL (SELECT make_date(p_year, (r.params ->> 'start_month')::int, (r.params ->> 'start_day')::int) AS s) d
  CROSS JOIN LATERAL (SELECT d.s, (d.s + interval '1 year')::date - 1 AS e) x
  WHERE m.id = p_market AND r.effective_from <= x.e AND (r.effective_to IS NULL OR r.effective_to > x.s)
  ORDER BY r.effective_from DESC
  LIMIT 1
$$;

-- The committed runs of the market's calendars whose tax date lies in [p_from, p_to].
CREATE FUNCTION tax_committed_runs(p_market uuid, p_from date, p_to date) RETURNS TABLE (run_id uuid, period_id uuid)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.id, p.id
  FROM run r
  JOIN period p ON p.tenant_id = r.tenant_id AND p.id = r.period_id
  JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  JOIN market m ON m.tenant_id = c.tenant_id AND m.id = c.market_id
  WHERE m.id = p_market AND r.state = 'committed'
    AND ((p.ends_at - interval '1 microsecond') AT TIME ZONE m.time_zone)::date BETWEEN p_from AND p_to
$$;

-- 5. Withholding (D-BM-03, D-BM-04). The matching rules per participant of the market whose type holds positions at the
-- pay instant: every condition present must contain the value of the tax profile in force then (no profile or a NULL
-- value matches only a rule without that condition).
CREATE FUNCTION tax_withholding_matches(p_market uuid, p_tax_date date, p_pay_at timestamptz)
RETURNS TABLE (participant_id uuid, rule_id text, has_tax_id boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT x.id, t.id, coalesce(tp.tax_id_sealed IS NOT NULL, false)
  FROM market m
  JOIN participant x ON x.tenant_id = m.tenant_id AND x.market_id = m.id
  JOIN tax_rule t ON t.market_pack = m.market_pack AND t.kind = 'withholding' AND t.effective_from <= p_tax_date
    AND (t.effective_to IS NULL OR t.effective_to > p_tax_date)
  LEFT JOIN tax_profile tp ON tp.tenant_id = x.tenant_id AND tp.participant_id = x.id AND tp.valid_from <= p_pay_at
    AND (tp.valid_to IS NULL OR tp.valid_to > p_pay_at)
  WHERE m.id = p_market
    AND EXISTS (
      SELECT 1 FROM participant_type_assignment a
      JOIN participant_type ty ON ty.tenant_id = a.tenant_id AND ty.id = a.type_id AND ty.can_hold_positions
      WHERE a.tenant_id = x.tenant_id AND a.participant_id = x.id AND a.valid_from <= p_pay_at
        AND (a.valid_to IS NULL OR a.valid_to > p_pay_at))
    AND (NOT (t.conditions ? 'entity_types') OR coalesce(t.conditions -> 'entity_types' ? tp.entity_type, false))
    AND (NOT (t.conditions ? 'residency') OR coalesce(t.conditions -> 'residency' ? tp.residency::text, false))
$$;

-- One instruction per matching participant: rate NULL -> no duty (rate 0); prior_year_payer_total resolved here (gross
-- from this payer in this market in the previous tax year must exceed the threshold); current_year_cumulative passed
-- to the engine as threshold_minor + prior_minor (this year's gross so far: committed runs of other periods paid on or
-- before this run's tax date, whatever their commit order; a re-run or simulation never counts its own period). Refusals: SQLSTATE TX001, DETAIL JSON.
CREATE FUNCTION tax_withholding_instructions(p_period uuid)
RETURNS TABLE (participant_id uuid, rule_id text, rate numeric, rounding text, threshold_minor bigint, prior_minor bigint,
               rate_basis text)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  run_at record;
  ambiguous record;
  this_year int;
  this_year_bounds record;
  last_year_bounds record;
BEGIN
  SELECT m.id AS market_id, m.market_pack, p.ends_at - interval '1 microsecond' AS pay_at,
         ((p.ends_at - interval '1 microsecond') AT TIME ZONE m.time_zone)::date AS tax_date
  INTO run_at
  FROM period p
  JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  JOIN market m ON m.tenant_id = c.tenant_id AND m.id = c.market_id
  WHERE p.id = p_period;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'withholding instructions need a period of the tenant' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT array_agg(DISTINCT w.rule_id ORDER BY w.rule_id) AS rule_ids,
         (array_agg(DISTINCT w.participant_id ORDER BY w.participant_id))[1:20] AS participant_ids
  INTO ambiguous
  FROM (SELECT m.*, count(*) OVER (PARTITION BY m.participant_id) AS n
        FROM tax_withholding_matches(run_at.market_id, run_at.tax_date, run_at.pay_at) m) w
  WHERE w.n > 1;
  IF ambiguous.rule_ids IS NOT NULL THEN
    RAISE EXCEPTION 'more than one withholding rule matches a payee' USING ERRCODE = 'TX001',
      DETAIL = jsonb_build_object('code', 'TAX_RULE_AMBIGUOUS', 'rule_ids', ambiguous.rule_ids,
                                  'participant_ids', ambiguous.participant_ids)::text;
  END IF;

  this_year := tax_year_of(run_at.market_id, run_at.tax_date);
  IF this_year IS NULL AND EXISTS (
       SELECT 1 FROM tax_rule t
       WHERE t.market_pack = run_at.market_pack AND t.kind = 'withholding' AND t.threshold_basis IS NOT NULL
         AND t.effective_from <= run_at.tax_date AND (t.effective_to IS NULL OR t.effective_to > run_at.tax_date)) THEN
    RAISE EXCEPTION 'a withholding threshold needs the pack''s tax year' USING ERRCODE = 'TX001',
      DETAIL = jsonb_build_object('code', 'TAX_YEAR_NOT_DEFINED')::text;
  END IF;
  SELECT * INTO this_year_bounds FROM tax_year_bounds(run_at.market_id, this_year);
  SELECT * INTO last_year_bounds FROM tax_year_bounds(run_at.market_id, this_year - 1);

  RETURN QUERY
    WITH g AS (
      SELECT s.payee_participant_id AS pid,
             sum(s.gross_minor) FILTER (WHERE y.period_id IS NOT NULL AND y.this_year)::bigint AS this_year_gross,
             sum(s.gross_minor) FILTER (WHERE y.period_id IS NOT NULL AND NOT y.this_year)::bigint AS last_year_gross
      FROM (SELECT r.run_id, r.period_id, true AS this_year
            FROM tax_committed_runs(run_at.market_id, this_year_bounds.starts_on, run_at.tax_date) r
            WHERE r.period_id <> p_period
            UNION ALL
            SELECT r.run_id, r.period_id, false
            FROM tax_committed_runs(run_at.market_id, last_year_bounds.starts_on, last_year_bounds.ends_on) r) y
      JOIN run_settlement s ON s.run_id = y.run_id
      GROUP BY s.payee_participant_id),
    i AS (
      SELECT w.participant_id, t.id AS rule_id, t.rounding, t.rate AS rule_rate, t.threshold_minor AS rule_threshold,
             t.threshold_basis,
             CASE WHEN NOT w.has_tax_id AND t.missing_id_rate IS NOT NULL THEN t.missing_id_rate ELSE t.rate END AS applied,
             CASE WHEN NOT w.has_tax_id AND t.missing_id_rate IS NOT NULL THEN 'missing_id_rate' ELSE 'rate' END AS applied_basis,
             coalesce(g.this_year_gross, 0) AS this_year_gross, coalesce(g.last_year_gross, 0) AS last_year_gross
      FROM tax_withholding_matches(run_at.market_id, run_at.tax_date, run_at.pay_at) w
      JOIN tax_rule t ON t.id = w.rule_id
      LEFT JOIN g ON g.pid = w.participant_id)
    SELECT i.participant_id, i.rule_id,
           (CASE WHEN i.rule_rate IS NULL THEN 0
                 WHEN i.threshold_basis = 'prior_year_payer_total' AND i.last_year_gross <= i.rule_threshold THEN 0
                 ELSE i.applied END)::numeric(9, 6),
           i.rounding,
           CASE WHEN i.threshold_basis = 'current_year_cumulative' THEN i.rule_threshold END,
           CASE i.threshold_basis WHEN 'current_year_cumulative' THEN i.this_year_gross
                                  WHEN 'prior_year_payer_total' THEN i.last_year_gross END,
           CASE WHEN i.rule_rate IS NULL THEN 'no_duty'
                WHEN i.threshold_basis = 'prior_year_payer_total' AND i.last_year_gross <= i.rule_threshold THEN 'below_threshold'
                ELSE i.applied_basis END
    FROM i
    ORDER BY i.participant_id;
END $$;

-- 6. Year-end (D-BM-06). Per payee of the committed runs whose tax date lies in the tax year: gross from the settlements,
-- taxable and withheld from the tax lines (also per rule and applied rate); included when something was withheld or
-- the form's min_gross_minor is reached; has_tax_id from the tax profile in force now.
CREATE FUNCTION tax_year_end_form_rule(p_market uuid, p_year int) RETURNS tax_rule
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT t.* FROM market m
  JOIN tax_year_bounds(p_market, p_year) b ON true
  JOIN tax_rule t ON t.market_pack = m.market_pack AND t.kind = 'year_end_form' AND t.effective_from <= b.ends_on
    AND (t.effective_to IS NULL OR t.effective_to > b.ends_on)
  WHERE m.id = p_market
$$;

CREATE FUNCTION tax_year_end_totals(p_market uuid, p_year int)
RETURNS TABLE (participant_id uuid, payee_ref text, gross_minor bigint, taxable_minor bigint, withheld_minor bigint, by_rule jsonb,
               has_tax_id boolean, included boolean, latest_version int, period_ids uuid[])
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH form AS (SELECT * FROM tax_year_end_form_rule(p_market, p_year)),
  runs AS (SELECT r.* FROM tax_year_bounds(p_market, p_year) b, tax_committed_runs(p_market, b.starts_on, b.ends_on) r),
  settled AS (
    SELECT s.payee_participant_id AS pid, sum(s.gross_minor)::bigint AS gross,
           array_agg(DISTINCT runs.period_id ORDER BY runs.period_id) AS periods
    FROM runs JOIN run_settlement s ON s.run_id = runs.run_id
    GROUP BY 1),
  lines AS (
    SELECT l.payee_participant_id AS pid, l.rule_id, l.rate, sum(l.taxable_minor)::bigint AS taxable,
           sum(l.withheld_minor)::bigint AS withheld
    FROM runs JOIN tax_line l ON l.run_id = runs.run_id
    GROUP BY 1, 2, 3),
  per_payee AS (
    SELECT pid, sum(taxable)::bigint AS taxable, sum(withheld)::bigint AS withheld,
           jsonb_agg(jsonb_build_object('rule_id', rule_id, 'rate', rate::text, 'taxable_minor', taxable::text,
                                        'withheld_minor', withheld::text) ORDER BY rule_id, rate) AS by_rule
    FROM lines GROUP BY pid)
  SELECT s.pid, x.external_ref, s.gross, coalesce(t.taxable, 0), coalesce(t.withheld, 0), coalesce(t.by_rule, '[]'),
         EXISTS (SELECT 1 FROM tax_profile tp
                 WHERE tp.tenant_id = x.tenant_id AND tp.participant_id = s.pid AND tp.tax_id_sealed IS NOT NULL
                   AND tp.valid_from <= now() AND (tp.valid_to IS NULL OR tp.valid_to > now())),
         coalesce(t.withheld, 0) > 0
           OR coalesce(s.gross >= (SELECT (f.conditions ->> 'min_gross_minor')::bigint FROM form f), false),
         (SELECT max(v.version) FROM tax_form v
          WHERE v.tenant_id = x.tenant_id AND v.participant_id = s.pid AND v.tax_year = p_year
            AND v.form_type = (SELECT f.conditions ->> 'form_type' FROM form f)),
         s.periods
  FROM settled s
  JOIN participant x ON x.id = s.pid
  LEFT JOIN per_payee t ON t.pid = s.pid
  ORDER BY x.external_ref
$$;

-- Σ credits − debits on the market's withholding_payable accounts in the run_committed entries of the year's runs.
CREATE FUNCTION tax_ledger_withheld(p_market uuid, p_year int) RETURNS bigint
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(sum(po.credit_minor - po.debit_minor), 0)::bigint
  FROM tax_year_bounds(p_market, p_year) b
  CROSS JOIN tax_committed_runs(p_market, b.starts_on, b.ends_on) r
  JOIN journal_entry e ON e.event_type = 'run_committed' AND e.origin_type = 'run' AND e.origin_id = r.run_id
  JOIN posting po ON po.tenant_id = e.tenant_id AND po.entry_id = e.id
  JOIN ledger_account a ON a.tenant_id = po.tenant_id AND a.id = po.account_id AND a.type = 'withholding_payable'
$$;

-- The year-end preview: bounds, whether the year ended (market zone), the periods keeping it open in the ledger (a
-- committed or paid period, or a run queued/running/calculated, C-BM-14), the form rule, refusal reasons and totals.
CREATE FUNCTION tax_year_end_status(p_market uuid, p_year int) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  zone text;
  bounds record;
  form tax_rule;
  ended boolean := false;
  open_periods uuid[] := '{}';
  totals record;
  ledger bigint;
  reasons text[] := '{}';
BEGIN
  SELECT m.time_zone INTO zone FROM market m WHERE m.id = p_market;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'year-end status needs a market of the tenant' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO bounds FROM tax_year_bounds(p_market, p_year);
  form := tax_year_end_form_rule(p_market, p_year);
  -- Without a tax year the form rule (in force on the year's last day) cannot be looked up either.
  IF bounds.starts_on IS NULL THEN
    reasons := reasons || 'TAX_YEAR_NOT_DEFINED'::text;
  ELSE
    IF form.id IS NULL THEN
      reasons := reasons || 'FORM_NOT_DEFINED'::text;
    END IF;
    ended := bounds.ends_on < (now() AT TIME ZONE zone)::date;
    SELECT coalesce(array_agg(p.id ORDER BY p.starts_at, p.id), '{}') INTO open_periods
    FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
    WHERE c.market_id = p_market
      AND ((p.ends_at - interval '1 microsecond') AT TIME ZONE zone)::date BETWEEN bounds.starts_on AND bounds.ends_on
      AND (p.state IN ('committed', 'paid') OR EXISTS (
            SELECT 1 FROM run r WHERE r.tenant_id = p.tenant_id AND r.period_id = p.id AND r.state IN ('queued', 'running', 'calculated')));
    IF NOT ended THEN
      reasons := reasons || 'TAX_YEAR_NOT_ENDED'::text;
    END IF;
    IF cardinality(open_periods) > 0 THEN
      reasons := reasons || 'TAX_YEAR_NOT_CLOSED'::text;
    END IF;
  END IF;
  SELECT coalesce(sum(t.withheld_minor) FILTER (WHERE t.included), 0)::bigint AS withheld, count(*) FILTER (WHERE t.included) AS included,
         count(*) FILTER (WHERE t.included AND NOT t.has_tax_id) AS held
  INTO totals FROM tax_year_end_totals(p_market, p_year) t;
  ledger := tax_ledger_withheld(p_market, p_year);
  RETURN jsonb_build_object(
    'bounds', CASE WHEN bounds.starts_on IS NOT NULL THEN jsonb_build_object('starts_on', bounds.starts_on, 'ends_on', bounds.ends_on) END,
    'ended', ended,
    'open_period_ids', to_jsonb(open_periods),
    'form_rule', CASE WHEN form.id IS NOT NULL THEN jsonb_build_object(
      'id', form.id, 'form_type', form.conditions ->> 'form_type', 'title', form.conditions ->> 'title',
      'min_gross_minor', form.conditions -> 'min_gross_minor') END,
    'reasons', to_jsonb(reasons),
    'totals', jsonb_build_object('withheld_minor', totals.withheld::text, 'ledger_withheld_minor', ledger::text,
                                 'equal', totals.withheld = ledger, 'included', totals.included, 'held', totals.held));
END $$;

-- 7. tax_form.available (D-BM-06): in-app always, e-mail by the statement preference (notify_participant).
CREATE OR REPLACE FUNCTION notification_template(p_template text, OUT topic text, OUT mandatory boolean)
LANGUAGE sql IMMUTABLE AS $$
  SELECT t.topic, t.mandatory FROM (VALUES
    ('statement.ready', 'statement', false), ('payout.sent', 'payout', false), ('payout.held', 'payout', false),
    ('payout.returned', 'payout', false), ('bank_detail.changed', 'security', true),
    ('tax_profile.changed', 'security', true), ('dispute.updated', 'dispute', false),
    ('privacy_request.updated', 'privacy', true), ('plan.change_scheduled', 'plan_change', true),
    ('tax_form.available', 'statement', false)
  ) AS t (template, topic, mandatory)
  WHERE t.template = p_template
$$;

CREATE FUNCTION notify_tax_form(p_form uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  form record;
BEGIN
  SELECT f.id, f.participant_id, f.tax_year, f.form_type INTO form FROM tax_form f WHERE f.id = p_form;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a tax form notice needs a form of the tenant' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN notify_participant(form.participant_id, 'tax_form.available',
    jsonb_build_object('tax_year', form.tax_year, 'form_type', form.form_type, 'form_id', form.id));
END $$;

-- 8. Generation (D-BM-06): one at a time per market and year (try-lock, TX002), refused with the first status reason
-- (TX001), the ledger check (23514), then a generation row and a new form version for every included payee with a tax
-- id whose totals differ from its latest form; held payees get none.
-- SECURITY DEFINER: the only writer of generations and forms. RLS does not apply, so the market must be the acting
-- tenant's and every own query names the tenant; the INVOKER helpers are keyed by that market and its runs.
-- shortcut: generation runs synchronously in one set-based SQL statement under an advisory lock; move it to a job when one generation exceeds 30 s
CREATE FUNCTION tax_generate_forms(p_market uuid, p_year int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own_tenant uuid := app_tenant_id();
  status jsonb;
  generation_id uuid := gen_random_uuid();
  pending jsonb;
  unchanged int;
  held jsonb;
  withheld_total bigint;
  form record;
BEGIN
  IF app_realm() IS DISTINCT FROM 'tenant' OR own_tenant IS NULL OR app_participant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'year-end forms are generated in a staff transaction of the tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM market m WHERE m.tenant_id = own_tenant AND m.id = p_market;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'year-end forms need a market of the tenant' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('tax_forms:' || own_tenant || ':' || p_market || ':' || p_year, 0)) THEN
    RAISE EXCEPTION 'a generation of these forms is running' USING ERRCODE = 'TX002';
  END IF;
  status := tax_year_end_status(p_market, p_year);
  IF jsonb_array_length(status -> 'reasons') > 0 THEN
    RAISE EXCEPTION 'year-end forms refused' USING ERRCODE = 'TX001', DETAIL = jsonb_strip_nulls(jsonb_build_object(
      'code', status -> 'reasons' ->> 0,
      'period_ids', CASE WHEN status -> 'reasons' ->> 0 = 'TAX_YEAR_NOT_CLOSED' THEN status -> 'open_period_ids' END))::text;
  END IF;
  IF NOT (status -> 'totals' ->> 'equal')::boolean THEN
    RAISE EXCEPTION 'withheld % differs from the ledger''s withholding payable %', status -> 'totals' ->> 'withheld_minor',
      status -> 'totals' ->> 'ledger_withheld_minor' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('participant_id', z.participant_id, 'payee_ref', z.payee_ref,
                                               'version', coalesce(z.latest_version, 0) + 1, 'totals', z.totals)
                            ORDER BY z.payee_ref) FILTER (WHERE z.has_tax_id AND z.changed), '[]'),
         count(*) FILTER (WHERE z.has_tax_id AND NOT z.changed),
         coalesce(jsonb_agg(jsonb_build_object('participant_id', z.participant_id, 'payee_ref', z.payee_ref) ORDER BY z.payee_ref)
                  FILTER (WHERE NOT z.has_tax_id), '[]'),
         coalesce(sum(z.withheld_minor), 0)
  INTO pending, unchanged, held, withheld_total
  FROM (
    SELECT y.*, (SELECT f.totals FROM tax_form f
                 WHERE f.tenant_id = own_tenant AND f.participant_id = y.participant_id AND f.tax_year = p_year AND f.version = y.latest_version
                   AND f.form_type = status -> 'form_rule' ->> 'form_type') IS DISTINCT FROM y.totals AS changed
    FROM (SELECT t.*, jsonb_build_object('gross_minor', t.gross_minor::text, 'taxable_minor', t.taxable_minor::text,
                                         'withheld_minor', t.withheld_minor::text, 'by_rule', t.by_rule,
                                         'period_ids', to_jsonb(t.period_ids)) AS totals
          FROM tax_year_end_totals(p_market, p_year) t WHERE t.included) y
  ) z;

  INSERT INTO tax_form_generation (id, tenant_id, market_id, tax_year, form_type, rule_id, generated, unchanged, held,
                                   withheld_total_minor, ledger_withheld_minor)
  VALUES (generation_id, own_tenant, p_market, p_year, status -> 'form_rule' ->> 'form_type', status -> 'form_rule' ->> 'id',
          jsonb_array_length(pending), unchanged, held, withheld_total, (status -> 'totals' ->> 'ledger_withheld_minor')::bigint);
  FOR form IN
    INSERT INTO tax_form (tenant_id, generation_id, market_id, tax_year, form_type, participant_id, version, payee_ref,
                          tax_id_masked, currency, totals)
    SELECT own_tenant, generation_id, p_market, p_year, status -> 'form_rule' ->> 'form_type', x.participant_id, x.version,
           x.payee_ref, tp.tax_id_masked, m.currency, x.totals
    FROM jsonb_to_recordset(pending) AS x (participant_id uuid, payee_ref text, version int, totals jsonb)
    JOIN market m ON m.tenant_id = own_tenant AND m.id = p_market
    JOIN tax_profile tp ON tp.tenant_id = own_tenant AND tp.participant_id = x.participant_id AND tp.tax_id_masked IS NOT NULL AND tp.valid_from <= now()
      AND (tp.valid_to IS NULL OR tp.valid_to > now())
    ORDER BY x.payee_ref
    RETURNING id
  LOOP
    PERFORM notify_tax_form(form.id);
  END LOOP;
  RETURN jsonb_build_object('generation_id', generation_id, 'generated', jsonb_array_length(pending), 'unchanged', unchanged,
                            'held', held);
END $$;
REVOKE ALL ON FUNCTION tax_generate_forms(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tax_generate_forms(uuid, int) TO nmp_app;
