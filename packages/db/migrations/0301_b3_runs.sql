-- B3 runs, results, simulations, golden datasets, adjustments and restatements (PLAN B3 sections 1.1 golden_dataset and
-- 1.3; D-B3-08..16, D-B3-19, D-B3-20, D-B3-22). No ledger (B4). Not partitioned (D-B3-22). Same recipe as 0300.

-- 1. run_snapshot (D-B3-08): the stored engine input, gzip of its canonical JSON, checked by sha256 when written.
CREATE TABLE run_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  period_id uuid NOT NULL,
  known_at timestamptz NOT NULL,
  prior_state_run_id uuid,
  content bytea NOT NULL,
  content_sha256 bytea NOT NULL CHECK (length(content_sha256) = 32),
  row_counts jsonb NOT NULL CHECK (jsonb_typeof(row_counts) = 'object'),
  order_ids uuid[] NOT NULL,
  order_event_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, period_id) REFERENCES period (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX run_snapshot_period_idx ON run_snapshot (period_id);
CREATE TRIGGER run_snapshot_no_mutation BEFORE UPDATE OR DELETE ON run_snapshot
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A trigger, not a CHECK: replay must still detect a row changed behind the database's back (AC-COMP8-1).
CREATE FUNCTION run_snapshot_hash_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content_sha256 IS DISTINCT FROM digest(NEW.content, 'sha256') THEN
    RAISE EXCEPTION 'run_snapshot.content_sha256 is the sha256 of its content' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_snapshot_hash_guard BEFORE INSERT ON run_snapshot FOR EACH ROW EXECUTE FUNCTION run_snapshot_hash_guard();

-- 2. run (D-B3-09, D-B3-12): queued -> running -> calculated -> committed | discarded; queued | running -> failed.
CREATE TABLE run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  period_id uuid NOT NULL,
  run_request_id text NOT NULL CHECK (length(run_request_id) BETWEEN 1 AND 100),
  plan_version_id uuid NOT NULL,
  settings_version_id uuid NOT NULL,
  snapshot_id uuid,
  engine_version text NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 50),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'failed', 'calculated', 'committed', 'discarded')),
  progress text CHECK (progress IS NULL OR length(progress) <= 200),
  totals jsonb,
  inputs_hash text,
  lines_hash text,
  outputs jsonb,
  error jsonb,
  prepared_by uuid NOT NULL,
  review_opened_at timestamptz,
  review_opened_by uuid,
  commit_requested_at timestamptz,
  commit_requested_by uuid,
  approval_id uuid,
  started_at timestamptz,
  finished_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_snapshot_taken CHECK (state IN ('queued', 'failed') OR snapshot_id IS NOT NULL),
  CONSTRAINT run_calculated CHECK (state NOT IN ('calculated', 'committed', 'discarded')
    OR (totals IS NOT NULL AND inputs_hash IS NOT NULL AND lines_hash IS NOT NULL AND outputs IS NOT NULL
        AND finished_at IS NOT NULL)),
  CONSTRAINT run_committed CHECK (state <> 'committed'
    OR (approval_id IS NOT NULL AND review_opened_at IS NOT NULL AND committed_at IS NOT NULL)),
  CONSTRAINT run_failed CHECK (state <> 'failed' OR error IS NOT NULL),
  CONSTRAINT run_review_opened CHECK ((review_opened_at IS NULL) = (review_opened_by IS NULL)),
  CONSTRAINT run_commit_requested CHECK ((commit_requested_at IS NULL) = (commit_requested_by IS NULL)),
  -- One calculated run per period; deferred so a re-run can flip itself and discard its predecessor in either order.
  CONSTRAINT run_one_calculated EXCLUDE (period_id WITH =) WHERE (state = 'calculated') DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id, period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_version_id) REFERENCES plan_version (tenant_id, id),
  FOREIGN KEY (tenant_id, settings_version_id) REFERENCES tenant_setting_version (tenant_id, id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES run_snapshot (tenant_id, id),
  FOREIGN KEY (tenant_id, prepared_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, review_opened_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, commit_requested_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  UNIQUE (tenant_id, period_id, run_request_id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX run_one_committed ON run (period_id) WHERE state = 'committed';
CREATE UNIQUE INDEX run_one_in_flight ON run (period_id) WHERE state IN ('queued', 'running');
CREATE INDEX run_period_idx ON run (tenant_id, period_id, created_at DESC);

ALTER TABLE run_snapshot ADD FOREIGN KEY (tenant_id, prior_state_run_id) REFERENCES run (tenant_id, id);

-- Runtime role: requested queued by the acting user; identity fixed; results written once, on running -> calculated,
-- with Σ result lines = totals.gross_minor (AC-COMP3-1); review and commit request recorded once by the acting user while
-- calculated; committed with an approval of the run (object 'run') by neither the preparer nor the commit requester.
CREATE FUNCTION run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' OR NEW.prepared_by IS DISTINCT FROM app_user_id()
       OR num_nonnulls(NEW.snapshot_id, NEW.totals, NEW.inputs_hash, NEW.lines_hash, NEW.outputs, NEW.error,
                       NEW.review_opened_at, NEW.commit_requested_at, NEW.approval_id, NEW.committed_at) > 0 THEN
      RAISE EXCEPTION 'a run is requested queued by the acting user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('failed', 'committed', 'discarded')
     OR (NEW.id, NEW.tenant_id, NEW.period_id, NEW.run_request_id, NEW.plan_version_id, NEW.settings_version_id,
         NEW.engine_version, NEW.prepared_by, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.period_id, OLD.run_request_id, OLD.plan_version_id,
                          OLD.settings_version_id, OLD.engine_version, OLD.prepared_by, OLD.created_at)
     OR (OLD.snapshot_id IS NOT NULL AND NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id)
     OR NOT (NEW.state = OLD.state
             OR (OLD.state, NEW.state) IN (('queued', 'running'), ('queued', 'failed'), ('running', 'calculated'),
                                           ('running', 'failed'), ('calculated', 'committed'), ('calculated', 'discarded'))) THEN
    RAISE EXCEPTION 'run cannot change from % to % (identity and terminal states are fixed)', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.totals, NEW.inputs_hash, NEW.lines_hash, NEW.outputs)
       IS DISTINCT FROM (OLD.totals, OLD.inputs_hash, OLD.lines_hash, OLD.outputs)
     AND NOT (OLD.state = 'running' AND NEW.state = 'calculated') THEN
    RAISE EXCEPTION 'run results are written once, when it is calculated' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'running' AND NEW.state = 'calculated'
     AND (SELECT coalesce(sum(l.amount_minor), 0) FROM result_line l WHERE l.tenant_id = NEW.tenant_id AND l.run_id = NEW.id)
         IS DISTINCT FROM (NEW.totals ->> 'gross_minor')::numeric THEN
    RAISE EXCEPTION 'run % lines do not sum to totals.gross_minor', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.review_opened_at, NEW.review_opened_by) IS DISTINCT FROM (OLD.review_opened_at, OLD.review_opened_by)
     AND NOT (OLD.review_opened_at IS NULL AND OLD.state = 'calculated' AND NEW.review_opened_by = app_user_id()) THEN
    RAISE EXCEPTION 'a run''s review is opened once, by the acting user, while it is calculated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.commit_requested_at, NEW.commit_requested_by) IS DISTINCT FROM (OLD.commit_requested_at, OLD.commit_requested_by)
     AND NOT (OLD.commit_requested_at IS NULL AND OLD.state = 'calculated' AND NEW.commit_requested_by = app_user_id()) THEN
    RAISE EXCEPTION 'a run''s commit is requested once, by the acting user, while it is calculated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.approval_id, NEW.committed_at) IS DISTINCT FROM (OLD.approval_id, OLD.committed_at)
     AND NOT (OLD.state = 'calculated' AND NEW.state = 'committed') THEN
    RAISE EXCEPTION 'a run''s approval is recorded once, when it is committed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'committed' AND OLD.state = 'calculated' AND NOT EXISTS (
       SELECT 1 FROM approval a
       WHERE a.id = NEW.approval_id AND a.object_type = 'run' AND a.object_id = NEW.id AND a.decision = 'approved'
         AND a.approver_id <> NEW.prepared_by AND a.approver_id IS DISTINCT FROM NEW.commit_requested_by) THEN
    RAISE EXCEPTION 'a run is committed with an approval of it by neither its preparer nor its commit requester'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_guard BEFORE INSERT OR UPDATE ON run
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION run_guard();

-- 3. period (D-B3-20): created open; open -> calculating -> calculated | open; calculated -> calculating | committed,
-- committed with the committed run of the period. Paid and closed are B4.
ALTER TABLE period ADD FOREIGN KEY (tenant_id, committed_run_id) REFERENCES run (tenant_id, id);

CREATE TRIGGER period_created_open BEFORE INSERT ON period
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND (NEW.state <> 'open' OR NEW.committed_run_id IS NOT NULL))
  EXECUTE FUNCTION forbid_mutation('a period is created open');

CREATE FUNCTION period_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (NEW.state = OLD.state
          OR (OLD.state, NEW.state) IN (('open', 'calculating'), ('calculating', 'calculated'), ('calculating', 'open'),
                                        ('calculated', 'calculating'), ('calculated', 'committed'))) THEN
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
  RETURN NEW;
END $$;
CREATE TRIGGER period_state_guard BEFORE UPDATE ON period
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION period_state_guard();

-- 4. Lines and state are written only while their run (simulation) is running: one check per statement, for batches.
CREATE FUNCTION rows_of_running_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM new_rows n
             WHERE NOT EXISTS (SELECT 1 FROM run r WHERE r.tenant_id = n.tenant_id AND r.id = n.run_id AND r.state = 'running')) THEN
    RAISE EXCEPTION '% rows are written only while their run is running', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION rows_of_running_simulation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM new_rows n
             WHERE NOT EXISTS (SELECT 1 FROM simulation s
                               WHERE s.tenant_id = n.tenant_id AND s.id = n.simulation_id AND s.state = 'running')) THEN
    RAISE EXCEPTION '% rows are written only while their simulation is running', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

-- 5. Simulations (D-B3-15): queued -> running -> completed | failed; content_hash is the version's compiled digest when
-- requested (the activation gate compares it with the frozen content_hash).
CREATE TABLE simulation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  plan_version_id uuid NOT NULL,
  period_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('simulation', 'restatement_sandbox')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  baseline_run_id uuid,
  snapshot_id uuid,
  content_hash bytea NOT NULL CHECK (length(content_hash) = 32),
  totals jsonb,
  comparison jsonb,
  outputs jsonb,
  error jsonb,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT simulation_completed CHECK (state <> 'completed' OR (totals IS NOT NULL AND comparison IS NOT NULL)),
  CONSTRAINT simulation_failed CHECK (state <> 'failed' OR error IS NOT NULL),
  FOREIGN KEY (tenant_id, plan_version_id) REFERENCES plan_version (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, baseline_run_id) REFERENCES run (tenant_id, id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES run_snapshot (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX simulation_version_period_idx ON simulation (plan_version_id, period_id);

CREATE FUNCTION simulation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' OR NEW.requested_by IS DISTINCT FROM app_user_id()
       OR num_nonnulls(NEW.snapshot_id, NEW.totals, NEW.comparison, NEW.outputs, NEW.error, NEW.finished_at) > 0 THEN
      RAISE EXCEPTION 'a simulation is requested queued by the acting user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM plan_version v
                   WHERE v.id = NEW.plan_version_id AND v.compiled IS NOT NULL
                     AND digest(v.compiled::text, 'sha256') = NEW.content_hash) THEN
      RAISE EXCEPTION 'simulation.content_hash is the digest of the version''s compiled plan' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('completed', 'failed')
     OR (NEW.id, NEW.tenant_id, NEW.plan_version_id, NEW.period_id, NEW.kind, NEW.content_hash, NEW.requested_by,
         NEW.requested_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.plan_version_id, OLD.period_id, OLD.kind, OLD.content_hash,
                          OLD.requested_by, OLD.requested_at)
     OR (OLD.baseline_run_id IS NOT NULL AND NEW.baseline_run_id IS DISTINCT FROM OLD.baseline_run_id)
     OR (OLD.snapshot_id IS NOT NULL AND NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id)
     OR NOT (NEW.state = OLD.state
             OR (OLD.state, NEW.state) IN (('queued', 'running'), ('queued', 'failed'), ('running', 'completed'),
                                           ('running', 'failed'))) THEN
    RAISE EXCEPTION 'simulation cannot change from % to % (identity and terminal states are fixed)', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER simulation_guard BEFORE INSERT OR UPDATE ON simulation
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION simulation_guard();

-- 6. golden_dataset (D-B3-16): inline input and expected lines; added and removed only while the version is a draft,
-- re-run in any state (last_result).
CREATE TABLE golden_dataset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  plan_version_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  input jsonb NOT NULL,
  expected jsonb NOT NULL,
  covers text[] NOT NULL DEFAULT '{}',
  source_simulation_id uuid,
  last_result jsonb,
  last_run_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(input::text) <= 5242880 AND octet_length(expected::text) <= 5242880),
  FOREIGN KEY (tenant_id, plan_version_id) REFERENCES plan_version (tenant_id, id),
  FOREIGN KEY (tenant_id, calendar_id) REFERENCES calendar (tenant_id, id),
  FOREIGN KEY (tenant_id, source_simulation_id) REFERENCES simulation (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (plan_version_id, name),
  UNIQUE (tenant_id, id)
);

CREATE FUNCTION golden_dataset_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM plan_version_is_draft(OLD.plan_version_id);
    RETURN OLD;
  END IF;
  PERFORM plan_version_is_draft(NEW.plan_version_id);
  IF NEW.created_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'golden_dataset.created_by must be the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM plan_calendar_of_version(NEW.plan_version_id, NEW.calendar_id);
  RETURN NEW;
END $$;
CREATE TRIGGER golden_dataset_guard BEFORE INSERT OR DELETE ON golden_dataset
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION golden_dataset_guard();

-- 7. restatement (D-B3-14): created at case submit, calculated with its sandbox and diff; approved -> applied by the
-- run that consumed its origins; an empty diff is applied at approval.
CREATE TABLE restatement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  period_id uuid NOT NULL,
  case_id uuid NOT NULL UNIQUE,
  simulation_id uuid,
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'calculated', 'approved', 'applied', 'rejected')),
  diff jsonb,
  applied_in_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restatement_calculated CHECK (state = 'requested' OR (simulation_id IS NOT NULL AND diff IS NOT NULL)),
  FOREIGN KEY (tenant_id, period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  FOREIGN KEY (tenant_id, simulation_id) REFERENCES simulation (tenant_id, id),
  FOREIGN KEY (tenant_id, applied_in_run_id) REFERENCES run (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX restatement_period_idx ON restatement (tenant_id, period_id);

CREATE FUNCTION restatement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('requested', 'calculated') OR NEW.applied_in_run_id IS NOT NULL OR NOT EXISTS (
         SELECT 1 FROM case_file c
         WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.type = 'restatement'
           AND c.subject_type = 'period' AND c.subject_id = NEW.period_id) THEN
      RAISE EXCEPTION 'a restatement is created for a restatement case of its period, not yet decided'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.period_id, NEW.case_id, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.period_id, OLD.case_id, OLD.created_at)
     OR ((NEW.simulation_id, NEW.diff) IS DISTINCT FROM (OLD.simulation_id, OLD.diff)
         AND NOT (OLD.state = 'requested' AND NEW.state = 'calculated'))
     OR NOT (NEW.state = OLD.state
             OR (OLD.state, NEW.state) IN (('requested', 'calculated'), ('calculated', 'approved'), ('calculated', 'applied'),
                                           ('calculated', 'rejected'), ('approved', 'applied')))
     OR (NEW.applied_in_run_id IS DISTINCT FROM OLD.applied_in_run_id
         AND NOT (OLD.state = 'approved' AND NEW.state = 'applied'))
     OR (OLD.state = 'approved' AND NEW.state = 'applied' AND NOT EXISTS (
           SELECT 1 FROM run r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.applied_in_run_id AND r.state = 'committed')) THEN
    RAISE EXCEPTION 'restatement cannot change from % to % (applied by a committed run, once)', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER restatement_guard BEFORE INSERT OR UPDATE ON restatement
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION restatement_guard();

-- 8. adjustment_origin (D-B3-13, D-B3-14): late origins belong to the run that computed them and are consumed by its
-- commit; restatement origins are consumed by a committed run of the restated period's calendar. Consumed once.
CREATE TABLE adjustment_origin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  origin_type text NOT NULL CHECK (origin_type IN ('late_transaction', 'clawback', 'restatement')),
  late_transaction_id uuid,
  restatement_id uuid,
  run_id uuid,
  payee_position_id uuid NOT NULL,
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  source_kind text NOT NULL
    CHECK (source_kind IN ('retail_sale', 'downline_volume', 'enrolment_order', 'pool', 'match', 'clawback', 'other')),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  original_period_id uuid NOT NULL,
  reason_code text CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 100),
  consumed_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adjustment_origin_one_source CHECK (num_nonnulls(late_transaction_id, restatement_id) = 1),
  CONSTRAINT adjustment_origin_restatement CHECK ((origin_type = 'restatement') = (restatement_id IS NOT NULL)),
  CONSTRAINT adjustment_origin_run CHECK ((restatement_id IS NOT NULL) = (run_id IS NULL)),
  FOREIGN KEY (tenant_id, late_transaction_id) REFERENCES late_transaction (tenant_id, id),
  FOREIGN KEY (tenant_id, restatement_id) REFERENCES restatement (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES run (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, original_period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, consumed_run_id) REFERENCES run (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX adjustment_origin_restatement_line ON adjustment_origin (restatement_id, payee_position_id, rule_key)
  WHERE restatement_id IS NOT NULL;
CREATE UNIQUE INDEX adjustment_origin_late_line ON adjustment_origin (run_id, late_transaction_id, payee_position_id, rule_key)
  WHERE late_transaction_id IS NOT NULL;
CREATE INDEX adjustment_origin_run_idx ON adjustment_origin (tenant_id, run_id);
CREATE INDEX adjustment_origin_open_idx ON adjustment_origin (tenant_id, original_period_id) WHERE consumed_run_id IS NULL;

CREATE FUNCTION adjustment_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on adjustment_origin is not allowed (history)';
  END IF;
  IF to_jsonb(NEW) - 'consumed_run_id' IS DISTINCT FROM to_jsonb(OLD) - 'consumed_run_id' OR OLD.consumed_run_id IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM run r JOIN period p ON p.tenant_id = r.tenant_id AND p.id = r.period_id
       JOIN period o ON o.tenant_id = NEW.tenant_id AND o.id = NEW.original_period_id
       WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.consumed_run_id AND r.state = 'committed'
         AND p.calendar_id = o.calendar_id AND (NEW.run_id IS NULL OR NEW.run_id = r.id)) THEN
    RAISE EXCEPTION 'an adjustment origin is consumed once, by its own committed run (restatements: of its calendar)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER adjustment_origin_consumed_once BEFORE UPDATE OR DELETE ON adjustment_origin
  FOR EACH ROW EXECUTE FUNCTION adjustment_origin_guard();

-- 9. result_line (insert-only; FR-COMP-003/007): one line per (payee position, rule) plus one per adjustment origin.
CREATE TABLE result_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  run_id uuid NOT NULL,
  payee_position_id uuid NOT NULL,
  payee_participant_id uuid NOT NULL,
  rule_key text NOT NULL,
  bonus_type text NOT NULL,
  source_kind text NOT NULL
    CHECK (source_kind IN ('retail_sale', 'downline_volume', 'enrolment_order', 'pool', 'match', 'clawback', 'other')),
  pass smallint NOT NULL CHECK (pass BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reversal_policy text CHECK (reversal_policy IN ('order_line', 'restatement')),
  origin_type text CHECK (origin_type IN ('late_transaction', 'clawback', 'manual', 'restatement')),
  origin_id uuid,
  original_period_id uuid,
  trace jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT result_line_origin CHECK ((origin_type IS NULL) = (origin_id IS NULL)),
  FOREIGN KEY (tenant_id, run_id) REFERENCES run (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, origin_id) REFERENCES adjustment_origin (tenant_id, id),
  FOREIGN KEY (tenant_id, original_period_id) REFERENCES period (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX result_line_origin_once ON result_line (run_id, origin_type, origin_id) WHERE origin_id IS NOT NULL;
CREATE INDEX result_line_run_payee_idx ON result_line (run_id, payee_participant_id);
CREATE INDEX result_line_payee_idx ON result_line (tenant_id, payee_participant_id, run_id);
CREATE INDEX result_line_run_rule_idx ON result_line (run_id, rule_key);
CREATE TRIGGER result_line_no_mutation BEFORE UPDATE OR DELETE ON result_line
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER result_line_run_running AFTER INSERT ON result_line REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT WHEN (current_user = 'nmp_app') EXECUTE FUNCTION rows_of_running_run();

-- 10. qualification_state (D-B3-19): written by its run only; authoritative only through a committed run.
CREATE TABLE qualification_state (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  run_id uuid NOT NULL,
  position_id uuid NOT NULL,
  paid_as_rank jsonb NOT NULL,
  highest_titles jsonb NOT NULL,
  grace_used jsonb NOT NULL,
  counters jsonb NOT NULL,
  carry jsonb NOT NULL,
  one_time_flags text[] NOT NULL,
  banked jsonb NOT NULL,
  measures jsonb NOT NULL,
  PRIMARY KEY (run_id, position_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES run (tenant_id, id),
  FOREIGN KEY (tenant_id, position_id) REFERENCES position (tenant_id, id)
);
CREATE INDEX qualification_state_position_idx ON qualification_state (tenant_id, position_id);
CREATE TRIGGER qualification_state_no_mutation BEFORE UPDATE OR DELETE ON qualification_state
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER qualification_state_run_running AFTER INSERT ON qualification_state REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT WHEN (current_user = 'nmp_app') EXECUTE FUNCTION rows_of_running_run();

-- 11. sim_result_line: the lines of a simulation (origins stripped, D-B3-15), separate from run results.
CREATE TABLE sim_result_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  simulation_id uuid NOT NULL,
  payee_position_id uuid NOT NULL,
  payee_participant_id uuid NOT NULL,
  rule_key text NOT NULL,
  bonus_type text NOT NULL,
  source_kind text NOT NULL
    CHECK (source_kind IN ('retail_sale', 'downline_volume', 'enrolment_order', 'pool', 'match', 'clawback', 'other')),
  pass smallint NOT NULL CHECK (pass BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reversal_policy text CHECK (reversal_policy IN ('order_line', 'restatement')),
  origin_type text CHECK (origin_type IN ('late_transaction', 'clawback', 'manual', 'restatement')),
  origin_id uuid,
  original_period_id uuid,
  trace jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sim_result_line_origin CHECK ((origin_type IS NULL) = (origin_id IS NULL)),
  FOREIGN KEY (tenant_id, simulation_id) REFERENCES simulation (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, original_period_id) REFERENCES period (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX sim_result_line_payee_idx ON sim_result_line (simulation_id, payee_participant_id);
CREATE TRIGGER sim_result_line_no_mutation BEFORE UPDATE OR DELETE ON sim_result_line
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sim_result_line_simulation_running AFTER INSERT ON sim_result_line REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT WHEN (current_user = 'nmp_app') EXECUTE FUNCTION rows_of_running_simulation();

-- 12. late_transaction (B2): consumed by a committed run, adjust items only (D-B3-12).
ALTER TABLE late_transaction ADD FOREIGN KEY (tenant_id, consumed_by_run_id) REFERENCES run (tenant_id, id);

CREATE FUNCTION late_transaction_consumed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.handling <> 'adjust' OR NOT EXISTS (
       SELECT 1 FROM run r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.consumed_by_run_id AND r.state = 'committed') THEN
    RAISE EXCEPTION 'a late transaction is consumed by a committed run, as an adjustment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER late_transaction_consumed_by_committed_run BEFORE UPDATE ON late_transaction
  FOR EACH ROW WHEN (NEW.state = 'consumed' AND OLD.state <> 'consumed') EXECUTE FUNCTION late_transaction_consumed_guard();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
  'run_snapshot', 'run', 'simulation', 'golden_dataset', 'restatement', 'adjustment_origin', 'result_line',
  'qualification_state', 'sim_result_line'
]::regclass[]) AS t;

GRANT SELECT, INSERT ON run_snapshot, run, simulation, golden_dataset, restatement, adjustment_origin, result_line,
  qualification_state, sim_result_line TO nmp_app;
GRANT UPDATE ON run, simulation, restatement TO nmp_app;
GRANT DELETE, UPDATE (last_result, last_run_at) ON golden_dataset TO nmp_app;
GRANT UPDATE (consumed_run_id) ON adjustment_origin TO nmp_app;
GRANT UPDATE (state, committed_run_id) ON period TO nmp_app;
GRANT UPDATE (consumed_by_run_id) ON late_transaction TO nmp_app;
