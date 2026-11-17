-- B3 review fixes (0300/0301 are applied and cannot change): rows land only while their run or simulation is running,
-- even against a concurrent flip; adjustment origins are created unconsumed from a decided source, match the lines that
-- carry them and are paid by exactly one committed run; a restatement follows its case's decision; a version is based on
-- a version of its own plan; run and version timestamps are written by their own transitions.

-- 1. FOR SHARE on the parent waits for a concurrent running -> calculated|completed flip and holds off the next one until
-- this transaction ends, so the flip's Σ check sees every line. The FK's FOR KEY SHARE does not conflict with that
-- non-key UPDATE; this lock does (as plan_version_is_draft, 0300).
CREATE OR REPLACE FUNCTION rows_of_running_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM run r WHERE (r.tenant_id, r.id) IN (SELECT n.tenant_id, n.run_id FROM new_rows n) FOR SHARE OF r;
  IF EXISTS (SELECT 1 FROM new_rows n
             WHERE NOT EXISTS (SELECT 1 FROM run r WHERE r.tenant_id = n.tenant_id AND r.id = n.run_id AND r.state = 'running')) THEN
    RAISE EXCEPTION '% rows are written only while their run is running', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION rows_of_running_simulation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM simulation s WHERE (s.tenant_id, s.id) IN (SELECT n.tenant_id, n.simulation_id FROM new_rows n)
    FOR SHARE OF s;
  IF EXISTS (SELECT 1 FROM new_rows n
             WHERE NOT EXISTS (SELECT 1 FROM simulation s
                               WHERE s.tenant_id = n.tenant_id AND s.id = n.simulation_id AND s.state = 'running')) THEN
    RAISE EXCEPTION '% rows are written only while their simulation is running', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

-- 2. adjustment_origin INSERT (runtime role): unconsumed; a restatement origin belongs to an approved case's restatement
-- of the same period, not yet applied; a late origin to its late item's period and to a run not yet calculated (its
-- lines are written while it runs). The parent row is taken FOR SHARE against a concurrent flip.
CREATE FUNCTION adjustment_origin_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.consumed_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'an adjustment origin is created unconsumed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.restatement_id IS NOT NULL THEN
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
CREATE TRIGGER adjustment_origin_insert_guard BEFORE INSERT ON adjustment_origin
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION adjustment_origin_insert_guard();

-- Consumed once, by its own committed run (restatements: of its calendar), which carries it as a line.
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
         AND p.calendar_id = o.calendar_id AND (NEW.run_id IS NULL OR NEW.run_id = r.id))
     OR NOT EXISTS (
       SELECT 1 FROM result_line l WHERE l.tenant_id = NEW.tenant_id AND l.run_id = NEW.consumed_run_id AND l.origin_id = NEW.id) THEN
    RAISE EXCEPTION 'an adjustment origin is consumed once, by its own committed run (restatements: of its calendar) that carries it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 3. A line carrying an origin is that origin: same type, payee, rule, source, amount and original period, unconsumed;
-- a late origin only in its own run, a restatement origin (approved) only in a later period of the restated calendar.
CREATE FUNCTION result_lines_match_origins() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM new_rows l
       WHERE l.origin_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM adjustment_origin o
         JOIN run r ON r.tenant_id = l.tenant_id AND r.id = l.run_id
         JOIN period p ON p.tenant_id = r.tenant_id AND p.id = r.period_id
         JOIN period op ON op.tenant_id = o.tenant_id AND op.id = o.original_period_id
         LEFT JOIN restatement s ON s.tenant_id = o.tenant_id AND s.id = o.restatement_id
         WHERE o.tenant_id = l.tenant_id AND o.id = l.origin_id AND o.consumed_run_id IS NULL
           AND (o.origin_type, o.payee_position_id, o.rule_key, o.source_kind, o.amount_minor, o.original_period_id)
               = (l.origin_type, l.payee_position_id, l.rule_key, l.source_kind, l.amount_minor, l.original_period_id)
           AND (CASE WHEN o.restatement_id IS NULL THEN o.run_id = l.run_id
                     ELSE s.state = 'approved' AND p.calendar_id = op.calendar_id AND p.starts_at >= op.ends_at END))) THEN
    RAISE EXCEPTION 'a result line carrying an adjustment origin matches it, unconsumed, in a run allowed to pay it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER result_line_origin_matches AFTER INSERT ON result_line REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT WHEN (current_user = 'nmp_app') EXECUTE FUNCTION result_lines_match_origins();

-- A committed run has consumed every origin its lines carry (checked at COMMIT: run -> committed comes first, D-B3-12),
-- so an origin carried by two runs is paid by one only.
CREATE FUNCTION run_origins_consumed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM result_line l JOIN adjustment_origin o ON o.tenant_id = l.tenant_id AND o.id = l.origin_id
             WHERE l.tenant_id = NEW.tenant_id AND l.run_id = NEW.id AND o.consumed_run_id IS DISTINCT FROM NEW.id) THEN
    RAISE EXCEPTION 'run % is committed only with every adjustment origin of its lines consumed by it', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER run_origins_consumed AFTER UPDATE ON run DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.state = 'committed' AND OLD.state <> 'committed') EXECUTE FUNCTION run_origins_consumed();

-- 4. restatement: approved or applied only once its case is approved, rejected only once it is rejected; applied at
-- approval only with no origins (empty diff); approved -> applied by the committed run that consumed all its origins.
CREATE OR REPLACE FUNCTION restatement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  case_state text;
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
     OR (OLD.state = 'approved' AND NEW.state = 'applied' AND (
           NOT EXISTS (SELECT 1 FROM run r
                       WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.applied_in_run_id AND r.state = 'committed')
           OR NOT EXISTS (SELECT 1 FROM adjustment_origin o
                          WHERE o.tenant_id = NEW.tenant_id AND o.restatement_id = NEW.id
                            AND o.consumed_run_id = NEW.applied_in_run_id)
           OR EXISTS (SELECT 1 FROM adjustment_origin o
                      WHERE o.tenant_id = NEW.tenant_id AND o.restatement_id = NEW.id
                        AND o.consumed_run_id IS DISTINCT FROM NEW.applied_in_run_id))) THEN
    RAISE EXCEPTION 'restatement cannot change from % to % (applied by the committed run that consumed its origins, once)',
      OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'calculated' AND NEW.state <> 'calculated' THEN
    SELECT c.state INTO case_state FROM case_file c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id;
    IF case_state IS DISTINCT FROM (CASE NEW.state WHEN 'rejected' THEN 'rejected' ELSE 'approved' END)
       OR (NEW.state = 'applied'
           AND EXISTS (SELECT 1 FROM adjustment_origin o WHERE o.tenant_id = NEW.tenant_id AND o.restatement_id = NEW.id)) THEN
      RAISE EXCEPTION 'a restatement follows its case''s decision and is applied at approval only with no origins'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 5. plan_version: based on a version of the same plan; activated_at written on -> active, retired_at on -> retired.
CREATE OR REPLACE FUNCTION plan_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  compliance_approver uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.created_by IS DISTINCT FROM app_user_id()
       OR num_nonnulls(NEW.content_hash, NEW.submitted_by, NEW.submitted_at, NEW.approval_id, NEW.activation_approval_id,
                       NEW.activated_at, NEW.retired_at) > 0 THEN
      RAISE EXCEPTION 'a plan version is created as a draft by the acting user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.based_on_version_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM plan_version b
         WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.based_on_version_id AND b.plan_id = NEW.plan_id) THEN
      RAISE EXCEPTION 'a plan version is based on a version of the same plan' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on plan_version is not allowed (history)';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.plan_id, NEW.version, NEW.based_on_version_id, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.plan_id, OLD.version, OLD.based_on_version_id, OLD.created_by,
                         OLD.created_at)
     OR NOT (NEW.state = OLD.state
             OR (OLD.state, NEW.state) IN (('draft', 'in_review'), ('in_review', 'draft'), ('in_review', 'approved'),
                                           ('approved', 'scheduled'), ('approved', 'active'), ('scheduled', 'active'),
                                           ('active', 'retired'))) THEN
    RAISE EXCEPTION 'plan version state cannot change from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.activated_at IS DISTINCT FROM OLD.activated_at AND NOT (NEW.state = 'active' AND OLD.state <> 'active'))
     OR (NEW.retired_at IS DISTINCT FROM OLD.retired_at AND NOT (NEW.state = 'retired' AND OLD.state <> 'retired')) THEN
    RAISE EXCEPTION 'a plan version''s activation and retirement times are written when it is activated or retired'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'draft'
     AND (NEW.compiled, NEW.content_hash, NEW.crediting_event, NEW.placement_width, NEW.engine_version, NEW.revision)
         IS DISTINCT FROM (OLD.compiled, OLD.content_hash, OLD.crediting_event, OLD.placement_width, OLD.engine_version,
                           OLD.revision) THEN
    RAISE EXCEPTION 'a plan version''s content changes only in draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state IN ('scheduled', 'active', 'retired')
     AND (NEW.effective_from, NEW.justification) IS DISTINCT FROM (OLD.effective_from, OLD.justification) THEN
    RAISE EXCEPTION 'a scheduled plan version keeps its effective time' USING ERRCODE = 'check_violation';
  END IF;
  IF (CASE WHEN OLD.state = 'draft' AND NEW.state = 'in_review' THEN NEW.submitted_by IS DISTINCT FROM app_user_id()
           ELSE (NEW.submitted_by, NEW.submitted_at) IS DISTINCT FROM (OLD.submitted_by, OLD.submitted_at) END) THEN
    RAISE EXCEPTION 'a plan version is submitted by the acting user, when it is submitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.approval_id IS DISTINCT FROM OLD.approval_id AND NOT (OLD.state = 'in_review' AND NEW.state = 'approved') THEN
    RAISE EXCEPTION 'a plan version''s approval is recorded once, when it is approved' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.activation_approval_id IS DISTINCT FROM OLD.activation_approval_id
     AND NOT (OLD.state = 'approved' AND NEW.state IN ('scheduled', 'active')) THEN
    RAISE EXCEPTION 'a plan version''s activation approval is recorded once, when it is scheduled'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'in_review' AND NEW.state = 'approved' AND NOT EXISTS (
       SELECT 1 FROM approval a
       WHERE a.id = NEW.approval_id AND a.object_type = 'plan_version' AND a.object_id = NEW.id
         AND a.decision = 'approved' AND a.approver_id <> NEW.submitted_by) THEN
    RAISE EXCEPTION 'a plan version is approved with an approval of it by someone who did not submit it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'approved' AND NEW.state IN ('scheduled', 'active') THEN
    SELECT a.approver_id INTO compliance_approver FROM approval a WHERE a.id = NEW.approval_id;
    IF NOT EXISTS (
         SELECT 1 FROM approval a
         WHERE a.id = NEW.activation_approval_id AND a.object_type = 'plan_version' AND a.object_id = NEW.id
           AND a.decision = 'approved' AND a.approver_id <> NEW.submitted_by AND a.approver_id <> compliance_approver) THEN
      RAISE EXCEPTION 'a plan version is activated with an approval by someone other than its submitter and approver'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 6. run: started_at written on queued -> running, finished_at on -> calculated|failed, error on -> failed, progress
-- only while queued or running.
CREATE OR REPLACE FUNCTION run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF (NEW.started_at IS DISTINCT FROM OLD.started_at AND NOT (OLD.state = 'queued' AND NEW.state = 'running'))
     OR (NEW.finished_at IS DISTINCT FROM OLD.finished_at
         AND NOT (OLD.state IN ('queued', 'running') AND NEW.state IN ('calculated', 'failed')))
     OR (NEW.error IS DISTINCT FROM OLD.error AND NEW.state <> 'failed')
     OR (NEW.progress IS DISTINCT FROM OLD.progress AND OLD.state NOT IN ('queued', 'running')) THEN
    RAISE EXCEPTION 'a run''s times, progress and error are written by its own transitions' USING ERRCODE = 'check_violation';
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
