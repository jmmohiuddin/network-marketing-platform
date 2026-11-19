-- B4 changes to COMP, CAS, IAM and INT (PLAN B4 section 1.2; D-B4-02, D-B4-07, D-B4-09..11, D-B4-15): the engine's
-- per-payee settlement of a run, manual adjustment origins, a case's second approval, system-opened returned-payment
-- cases, related-party declarations and provider webhook sources.

-- 1. run_settlement (D-B4-07): the engine's pass-11 result per payee, written while its run is running.
CREATE TABLE run_settlement (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  run_id uuid NOT NULL,
  payee_participant_id uuid NOT NULL,
  gross_minor bigint NOT NULL,
  receivable_before_minor bigint NOT NULL CHECK (receivable_before_minor >= 0),
  netted_minor bigint NOT NULL,
  withheld_minor bigint NOT NULL CHECK (withheld_minor >= 0),
  net_payable_minor bigint NOT NULL CHECK (net_payable_minor >= 0),
  PRIMARY KEY (run_id, payee_participant_id),
  CONSTRAINT run_settlement_sum CHECK (gross_minor = netted_minor + withheld_minor + net_payable_minor),
  FOREIGN KEY (tenant_id, run_id) REFERENCES run (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_participant_id) REFERENCES participant (tenant_id, id)
);
CREATE TRIGGER run_settlement_no_mutation BEFORE UPDATE OR DELETE ON run_settlement
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER run_settlement_run_running AFTER INSERT ON run_settlement REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT WHEN (current_user = 'nmp_app') EXECUTE FUNCTION rows_of_running_run();

-- 2. adjustment_origin (D-B4-09): a manual origin comes from an approved adjustment case, belongs to no run and is paid
-- by the committed run of its own period.
ALTER TABLE adjustment_origin
  ADD COLUMN case_id uuid,
  ADD FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  DROP CONSTRAINT adjustment_origin_origin_type_check,
  ADD CONSTRAINT adjustment_origin_origin_type_check
    CHECK (origin_type IN ('late_transaction', 'clawback', 'restatement', 'manual')),
  DROP CONSTRAINT adjustment_origin_one_source,
  ADD CONSTRAINT adjustment_origin_one_source CHECK (num_nonnulls(late_transaction_id, restatement_id, case_id) = 1),
  ADD CONSTRAINT adjustment_origin_manual CHECK ((origin_type = 'manual') = (case_id IS NOT NULL)),
  DROP CONSTRAINT adjustment_origin_run,
  ADD CONSTRAINT adjustment_origin_run CHECK ((late_transaction_id IS NOT NULL) = (run_id IS NOT NULL));
CREATE UNIQUE INDEX adjustment_origin_case ON adjustment_origin (case_id) WHERE case_id IS NOT NULL;

-- Insert (runtime role): a manual origin is the approved adjustment case of its payee position, for its payload's
-- period and amount, a period of the position's market not yet committed (read FOR SHARE: a commit waits, or this
-- waits for the commit and is refused).
CREATE OR REPLACE FUNCTION adjustment_origin_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.consumed_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'an adjustment origin is created unconsumed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.case_id IS NOT NULL THEN
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

-- A line carrying a manual origin belongs to a run of the origin's own period.
CREATE OR REPLACE FUNCTION result_lines_match_origins() RETURNS trigger LANGUAGE plpgsql AS $$
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
           AND (CASE WHEN o.case_id IS NOT NULL THEN r.period_id = o.original_period_id
                     WHEN o.restatement_id IS NULL THEN o.run_id = l.run_id
                     ELSE s.state = 'approved' AND p.calendar_id = op.calendar_id AND p.starts_at >= op.ends_at END))) THEN
    RAISE EXCEPTION 'a result line carrying an adjustment origin matches it, unconsumed, in a run allowed to pay it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

-- Consumed once, by a committed run that carries it: its own run (late), a run of its calendar (restatement), the run
-- of its own period (manual).
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
                   ELSE p.calendar_id = o.calendar_id AND (NEW.run_id IS NULL OR NEW.run_id = r.id) END))
     OR NOT EXISTS (
       SELECT 1 FROM result_line l WHERE l.tenant_id = NEW.tenant_id AND l.run_id = NEW.consumed_run_id AND l.origin_id = NEW.id) THEN
    RAISE EXCEPTION 'an adjustment origin is consumed once, by a committed run allowed to pay it that carries it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 3. case_file (D-B4-10): approvals_required pinned at submit; with two, a first approval is recorded while the case
-- stays submitted, and the final approver is someone else. Both approvers pass the same SoD predicates (0303).
ALTER TABLE case_file
  ADD COLUMN first_approval_id uuid,
  ADD COLUMN approvals_required smallint CHECK (approvals_required IN (1, 2)),
  ADD FOREIGN KEY (tenant_id, first_approval_id) REFERENCES approval (tenant_id, id),
  DROP CONSTRAINT case_file_system_opened_duplicate,
  ADD CONSTRAINT case_file_system_opened CHECK (opened_by_kind = 'user' OR type IN ('duplicate', 'returned_payment'));

ALTER TABLE case_event
  DROP CONSTRAINT case_event_kind_check,
  ADD CONSTRAINT case_event_kind_check CHECK (kind IN ('opened', 'evidence_added', 'assigned', 'submitted', 'first_approved',
                                                       'approved', 'rejected', 'withdrawn', 'updated'));

-- An approval of the case with this decision by someone who did not prepare it: neither its opener nor its submitter,
-- no evidence and no update of theirs on it; a system-opened case's approval is prepared by its submitter.
CREATE FUNCTION case_approval_eligible(c case_file, p_approval uuid, p_decision text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM approval a
    WHERE a.id = p_approval AND a.object_type = 'case' AND a.object_id = c.id AND a.decision = p_decision
      AND a.approver_id IS DISTINCT FROM c.opened_by AND a.approver_id <> c.submitted_by
      AND (c.opened_by IS NOT NULL OR a.preparer_id = c.submitted_by)
      AND NOT EXISTS (SELECT 1 FROM case_evidence e
                      WHERE e.tenant_id = c.tenant_id AND e.case_id = c.id AND e.added_by = a.approver_id)
      AND NOT EXISTS (SELECT 1 FROM case_event v
                      WHERE v.tenant_id = c.tenant_id AND v.case_id = c.id AND v.kind = 'updated'
                        AND v.actor_id = a.approver_id))
$$;

CREATE OR REPLACE FUNCTION case_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on case_file is not allowed (cases are history)';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.type, NEW.subject_type, NEW.subject_id, NEW.opened_by, NEW.opened_by_kind, NEW.market_id,
      NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.type, OLD.subject_type, OLD.subject_id, OLD.opened_by,
                         OLD.opened_by_kind, OLD.market_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a case''s type, subject, opener and market never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state IN ('approved', 'rejected', 'withdrawn')
     OR NOT (NEW.state = OLD.state
             OR (OLD.state = 'open' AND NEW.state IN ('submitted', 'withdrawn'))
             OR (OLD.state = 'submitted' AND NEW.state IN ('approved', 'rejected', 'withdrawn'))) THEN
    RAISE EXCEPTION 'case state cannot change from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF ((NEW.submitted_by, NEW.submitted_at) IS DISTINCT FROM (OLD.submitted_by, OLD.submitted_at)
      OR NEW.approvals_required IS DISTINCT FROM OLD.approvals_required)
     AND NOT (OLD.state = 'open' AND NEW.state = 'submitted') THEN
    RAISE EXCEPTION 'a case''s submission and the approvals it needs are recorded once, when it is submitted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'open'
     AND (NEW.reason_code, NEW.payload, NEW.effect_preview) IS DISTINCT FROM (OLD.reason_code, OLD.payload, OLD.effect_preview) THEN
    RAISE EXCEPTION 'a submitted case is decided as it was submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.first_approval_id IS DISTINCT FROM OLD.first_approval_id
     AND (OLD.first_approval_id IS NOT NULL OR OLD.state <> 'submitted' OR NEW.state <> 'submitted'
          OR NEW.approvals_required IS DISTINCT FROM 2 OR NOT case_approval_eligible(NEW, NEW.first_approval_id, 'approved')) THEN
    RAISE EXCEPTION 'a case''s first approval is recorded once, while it awaits a second, by someone who did not prepare it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.state IN ('approved', 'rejected') AND NOT case_approval_eligible(NEW, NEW.approval_id, NEW.state) THEN
    RAISE EXCEPTION 'a case is decided with an approval of it by someone who did not prepare it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.state = 'approved' AND NEW.approvals_required = 2 AND (
       NEW.first_approval_id IS NULL
       OR (SELECT a.approver_id FROM approval a WHERE a.id = NEW.approval_id)
          = (SELECT a.approver_id FROM approval a WHERE a.id = NEW.first_approval_id)) THEN
    RAISE EXCEPTION 'a case needing two approvals is approved by a second person after its first approval'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION case_file_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'open'
     OR NOT ((NEW.opened_by_kind = 'user' AND NEW.opened_by = app_user_id())
             OR (NEW.opened_by_kind = 'system' AND NEW.opened_by IS NULL AND NEW.type IN ('duplicate', 'returned_payment')))
     OR jsonb_strip_nulls(to_jsonb(NEW))
          ?| ARRAY['submitted_by', 'submitted_at', 'decided_at', 'approval_id', 'first_approval_id', 'approvals_required'] THEN
    RAISE EXCEPTION 'a case is opened by the acting user (or by the system for a duplicate or a returned payment), open and undecided'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 4. user_related_participant (D-B4-11): a staff user's declared own or relative's participant account; withdrawn once.
CREATE TABLE user_related_participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('self', 'relative')),
  declared_by uuid NOT NULL,
  declared_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdraw_reason text CHECK (withdraw_reason IS NULL OR length(trim(withdraw_reason)) BETWEEN 1 AND 500),
  CONSTRAINT user_related_participant_withdrawal
    CHECK (num_nulls(withdrawn_at, withdrawn_by, withdraw_reason) IN (0, 3)),
  FOREIGN KEY (tenant_id, user_id) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, declared_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, withdrawn_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX user_related_participant_active ON user_related_participant (tenant_id, user_id, participant_id)
  WHERE withdrawn_at IS NULL;
CREATE INDEX user_related_participant_participant_idx ON user_related_participant (tenant_id, participant_id)
  WHERE withdrawn_at IS NULL;
CREATE TRIGGER user_related_participant_withdrawn_once BEFORE UPDATE OR DELETE ON user_related_participant
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('withdrawn_at', 'withdrawn_by', 'withdraw_reason');
CREATE TRIGGER user_related_participant_declared_by_actor BEFORE INSERT ON user_related_participant
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('declared_by');
CREATE TRIGGER user_related_participant_withdrawn_by_actor BEFORE UPDATE ON user_related_participant
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('withdrawn_by');

-- 5. inbound_event (C-B4-17): sandbox provider webhooks are deduplicated under source 'provider:<config id>'.
ALTER TABLE inbound_event
  DROP CONSTRAINT inbound_event_source_check,
  ADD CONSTRAINT inbound_event_source_check
    CHECK (source ~ '^(api|connector):[\x21-\x7e]{1,100}$' OR source ~ '^provider:[0-9a-f-]{36}$');

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['run_settlement', 'user_related_participant']::regclass[]) AS t;

GRANT SELECT, INSERT ON run_settlement, user_related_participant TO nmp_app;
GRANT UPDATE (withdrawn_at, withdrawn_by, withdraw_reason) ON user_related_participant TO nmp_app;
GRANT UPDATE (first_approval_id, approvals_required) ON case_file TO nmp_app;
