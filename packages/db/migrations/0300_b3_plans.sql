-- B3 plans and guardrail decisions (PLAN B3 sections 1.1 and 1.2; D-B3-02..04, D-B3-17). Recipe of 0001-0208:
-- composite tenant keys, apply_tenant_rls, minimal grants, guards for the runtime role with the owner (migrations, test
-- fixtures) exempt where stated (D-B1-17). Actor columns are the acting user (0108 actor_is_acting_user).

-- 1. plan: a name, an optional brand; markets and calendars are join tables (D-B3-03).
CREATE TABLE plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  brand_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER plan_created_by_actor BEFORE INSERT ON plan
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('created_by');

CREATE TABLE plan_market (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  plan_id uuid NOT NULL,
  market_id uuid NOT NULL,
  PRIMARY KEY (plan_id, market_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plan (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX plan_market_market_idx ON plan_market (tenant_id, market_id);

-- A calendar belongs to at most one plan, and its market is one of the plan's markets.
CREATE TABLE plan_calendar (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  plan_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  PRIMARY KEY (plan_id, calendar_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plan (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, calendar_id) REFERENCES calendar (tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, calendar_id)
);

CREATE FUNCTION plan_calendar_market_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM calendar c JOIN plan_market m ON m.tenant_id = c.tenant_id AND m.market_id = c.market_id
                 WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.calendar_id AND m.plan_id = NEW.plan_id) THEN
    RAISE EXCEPTION 'calendar % is not in a market of plan %', NEW.calendar_id, NEW.plan_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_calendar_market_guard BEFORE INSERT ON plan_calendar
  FOR EACH ROW EXECUTE FUNCTION plan_calendar_market_guard();

-- 2. plan_version (D-B3-04): draft -> in_review -> approved -> scheduled -> active -> retired.
CREATE TABLE plan_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  plan_id uuid NOT NULL,
  version int NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'in_review', 'approved', 'scheduled', 'active', 'retired')),
  revision int NOT NULL DEFAULT 1 CHECK (revision > 0),
  effective_from timestamptz,
  justification text CHECK (justification IS NULL OR length(trim(justification)) BETWEEN 1 AND 2000),
  engine_version text NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 50),
  crediting_event text CHECK (crediting_event IN ('paid', 'fulfilled')),
  placement_width int CHECK (placement_width BETWEEN 2 AND 20),
  compiled jsonb CHECK (compiled IS NULL OR jsonb_typeof(compiled) = 'object'),
  content_hash bytea CHECK (length(content_hash) = 32),
  based_on_version_id uuid,
  submitted_by uuid,
  submitted_at timestamptz,
  approval_id uuid,
  activation_approval_id uuid,
  activated_at timestamptz,
  retired_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_version_submitted CHECK (state = 'draft' OR (compiled IS NOT NULL AND crediting_event IS NOT NULL
    AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND content_hash = digest(compiled::text, 'sha256'))),
  CONSTRAINT plan_version_approved CHECK (state IN ('draft', 'in_review') OR approval_id IS NOT NULL),
  CONSTRAINT plan_version_scheduled CHECK (state IN ('draft', 'in_review', 'approved')
    OR (activation_approval_id IS NOT NULL AND effective_from IS NOT NULL AND justification IS NOT NULL)),
  CONSTRAINT plan_version_activated CHECK (state NOT IN ('active', 'retired') OR activated_at IS NOT NULL),
  CONSTRAINT plan_version_retired CHECK ((state = 'retired') = (retired_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plan (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, based_on_version_id) REFERENCES plan_version (tenant_id, id),
  FOREIGN KEY (tenant_id, submitted_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  FOREIGN KEY (tenant_id, activation_approval_id) REFERENCES approval (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (plan_id, version),
  UNIQUE (tenant_id, id)
);
CREATE INDEX plan_version_effective_idx ON plan_version (plan_id, effective_from);
CREATE INDEX plan_version_due_idx ON plan_version (effective_from) WHERE state = 'scheduled';
CREATE UNIQUE INDEX plan_version_one_authoring ON plan_version (plan_id) WHERE state IN ('draft', 'in_review');
CREATE UNIQUE INDEX plan_version_one_active ON plan_version (plan_id) WHERE state = 'active';

-- Runtime role: created as an empty draft by the acting user; legal transitions only; what was submitted (compiled,
-- hash, crediting event, width, engine) changes only in draft, the schedule (effective_from, justification) never after
-- it is scheduled; the compliance approval (object 'plan_version') is not the submitter's, the activation approval is
-- neither the submitter's nor the compliance approver's.
CREATE FUNCTION plan_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  compliance_approver uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.created_by IS DISTINCT FROM app_user_id()
       OR num_nonnulls(NEW.content_hash, NEW.submitted_by, NEW.submitted_at, NEW.approval_id, NEW.activation_approval_id,
                       NEW.activated_at, NEW.retired_at) > 0 THEN
      RAISE EXCEPTION 'a plan version is created as a draft by the acting user' USING ERRCODE = 'insufficient_privilege';
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
CREATE TRIGGER plan_version_guard BEFORE INSERT OR UPDATE OR DELETE ON plan_version
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION plan_version_guard();

-- 3. Version content: rules and transitions are written only while their version is a draft. FOR SHARE on the version
-- waits for a concurrent submit, so nothing lands after the content is frozen.
CREATE FUNCTION plan_version_is_draft(p_version uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plan_version v WHERE v.id = p_version AND v.state = 'draft' FOR SHARE) THEN
    RAISE EXCEPTION 'plan version % is not a draft', p_version USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- A calendar the rule or golden dataset names is one of its plan's calendars.
CREATE FUNCTION plan_calendar_of_version(p_version uuid, p_calendar uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_calendar IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM plan_version v JOIN plan_calendar c ON c.tenant_id = v.tenant_id AND c.plan_id = v.plan_id
       WHERE v.id = p_version AND c.calendar_id = p_calendar) THEN
    RAISE EXCEPTION 'calendar % is not a calendar of the plan', p_calendar USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE TABLE plan_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  plan_version_id uuid NOT NULL,
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  kind text NOT NULL CHECK (kind IN ('volume.personal', 'volume.group', 'volume.enrolled_group', 'count.customers',
    'count.enrolled', 'measure.derived', 'ladder', 'pay.retail_margin', 'pay.percent_by_level', 'pay.generations',
    'pay.percent_of_measure', 'pay.differential', 'pay.override', 'pay.matching', 'pay.fast_start', 'pay.flat',
    'pay.one_time', 'pay.pool', 'limit.max_per_period', 'limit.max_share_from_purpose', 'cap', 'carry', 'counter',
    'points_factor', 'customer_roll_up', 'genealogy.reparent_on_termination', 'genealogy.change_window',
    'genealogy.positions_limit')),
  pass text NOT NULL CHECK (pass IN ('1', '2', '3', '4', '5', '6', '7', '8', '10', 'structure')),
  params jsonb NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  depends_on text[] NOT NULL DEFAULT '{}',
  reversal_policy text CHECK (reversal_policy IN ('order_line', 'restatement')),
  calendar_id uuid,
  ordinal int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, plan_version_id) REFERENCES plan_version (tenant_id, id),
  FOREIGN KEY (tenant_id, calendar_id) REFERENCES calendar (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (plan_version_id, rule_key),
  UNIQUE (tenant_id, id)
);
CREATE INDEX plan_rule_kind_idx ON plan_rule (tenant_id, kind);

CREATE FUNCTION plan_rule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM plan_version_is_draft(OLD.plan_version_id);
    RETURN OLD;
  END IF;
  PERFORM plan_version_is_draft(NEW.plan_version_id);
  IF TG_OP = 'UPDATE' AND (NEW.plan_version_id, NEW.rule_key, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM (OLD.plan_version_id, OLD.rule_key, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a plan rule keeps its version, key and author' USING ERRCODE = 'check_violation';
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.created_by IS DISTINCT FROM app_user_id()) OR NEW.updated_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'plan_rule is written by the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM plan_calendar_of_version(NEW.plan_version_id, NEW.calendar_id);
  RETURN NEW;
END $$;
CREATE TRIGGER plan_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON plan_rule
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION plan_rule_guard();

CREATE TABLE plan_transition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  to_version_id uuid NOT NULL,
  state_item text NOT NULL CHECK (state_item ~ '^(title|paid_as|carry|counter|one_time|banked)\.([a-z0-9_]+|\*)$'),
  rule text NOT NULL CHECK (rule IN ('carry', 'map', 'reset')),
  map jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(map) = 'array'),
  reason text CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 500),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rule <> 'reset' OR reason IS NOT NULL),
  FOREIGN KEY (tenant_id, to_version_id) REFERENCES plan_version (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (to_version_id, state_item),
  UNIQUE (tenant_id, id)
);

CREATE FUNCTION plan_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM plan_version_is_draft(OLD.to_version_id);
    RETURN OLD;
  END IF;
  PERFORM plan_version_is_draft(NEW.to_version_id);
  IF TG_OP = 'UPDATE' AND (NEW.to_version_id, NEW.state_item) IS DISTINCT FROM (OLD.to_version_id, OLD.state_item) THEN
    RAISE EXCEPTION 'a plan transition keeps its version and state item' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.created_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'plan_transition is written by the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_transition_guard BEFORE INSERT OR UPDATE OR DELETE ON plan_transition
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION plan_transition_guard();

-- 4. guardrail_decision (D-B3-17): insert-only evaluations, acknowledgements and overrides. An acknowledgement or
-- override repeats its evaluation's rule, version, outcome and content; an override needs an overridable rule and an
-- approval of the evaluation (object 'guardrail_decision') by its decider, prepared by the evaluation's decider.
CREATE TABLE guardrail_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  rule_id text NOT NULL REFERENCES guardrail_rule (id),
  plan_version_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('evaluation', 'acknowledgement', 'override')),
  outcome text NOT NULL CHECK (outcome IN ('blocked', 'warned', 'reported')),
  content_sha256 bytea NOT NULL CHECK (length(content_sha256) = 32),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  refers_to_decision_id uuid,
  justification text CHECK (justification IS NULL OR length(trim(justification)) BETWEEN 20 AND 2000),
  evidence_document_id uuid,
  approval_id uuid,
  decided_by uuid NOT NULL DEFAULT app_user_id(),
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guardrail_decision_refers CHECK ((kind = 'evaluation') = (refers_to_decision_id IS NULL)),
  CONSTRAINT guardrail_decision_override CHECK (kind <> 'override' OR (justification IS NOT NULL AND approval_id IS NOT NULL)),
  CONSTRAINT guardrail_decision_not_override
    CHECK (kind = 'override' OR (justification IS NULL AND approval_id IS NULL AND evidence_document_id IS NULL)),
  FOREIGN KEY (tenant_id, plan_version_id) REFERENCES plan_version (tenant_id, id),
  FOREIGN KEY (tenant_id, refers_to_decision_id) REFERENCES guardrail_decision (tenant_id, id),
  FOREIGN KEY (tenant_id, evidence_document_id) REFERENCES document (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX guardrail_decision_version_idx ON guardrail_decision (tenant_id, plan_version_id);
CREATE UNIQUE INDEX guardrail_decision_evaluated_once ON guardrail_decision
  (plan_version_id, rule_id, content_sha256, md5(detail::text)) WHERE kind = 'evaluation';
CREATE UNIQUE INDEX guardrail_decision_overridden_once ON guardrail_decision (refers_to_decision_id)
  WHERE kind = 'override';
CREATE UNIQUE INDEX guardrail_decision_acknowledged_once ON guardrail_decision (refers_to_decision_id)
  WHERE kind = 'acknowledgement';
CREATE TRIGGER guardrail_decision_no_mutation BEFORE UPDATE OR DELETE ON guardrail_decision
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION guardrail_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evaluation guardrail_decision;
BEGIN
  IF current_user = 'nmp_app' AND NEW.decided_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'guardrail_decision.decided_by must be the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.kind = 'evaluation' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO evaluation FROM guardrail_decision d
  WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.refers_to_decision_id AND d.kind = 'evaluation';
  IF NOT FOUND OR (evaluation.rule_id, evaluation.plan_version_id, evaluation.outcome, evaluation.content_sha256)
                  IS DISTINCT FROM (NEW.rule_id, NEW.plan_version_id, NEW.outcome, NEW.content_sha256) THEN
    RAISE EXCEPTION 'a guardrail acknowledgement or override repeats the evaluation it refers to'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'acknowledgement' AND evaluation.outcome <> 'warned' THEN
    RAISE EXCEPTION 'only a warned evaluation is acknowledged' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'override' THEN
    IF evaluation.outcome NOT IN ('blocked', 'warned')
       OR NOT EXISTS (SELECT 1 FROM guardrail_rule r WHERE r.id = NEW.rule_id AND r.overridable) THEN
      RAISE EXCEPTION 'only a blocked or warned evaluation of an overridable rule is overridden'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM approval a
                   WHERE a.id = NEW.approval_id AND a.object_type = 'guardrail_decision' AND a.object_id = evaluation.id
                     AND a.decision = 'approved' AND a.approver_id = NEW.decided_by
                     AND a.preparer_id = evaluation.decided_by) THEN
      RAISE EXCEPTION 'an override carries its decider''s approval of the evaluation, prepared by the evaluation''s decider'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guardrail_decision_guard BEFORE INSERT ON guardrail_decision
  FOR EACH ROW EXECUTE FUNCTION guardrail_decision_guard();
CREATE TRIGGER document_reference_guard BEFORE INSERT ON guardrail_decision
  FOR EACH ROW WHEN (NEW.evidence_document_id IS NOT NULL AND current_user = 'nmp_app')
  EXECUTE FUNCTION document_reference_guard('evidence_document_id', 'evidence');

SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
  'plan', 'plan_market', 'plan_calendar', 'plan_version', 'plan_rule', 'plan_transition', 'guardrail_decision'
]::regclass[]) AS t;

GRANT SELECT, INSERT ON plan, plan_market, plan_calendar, plan_version, guardrail_decision TO nmp_app;
GRANT UPDATE (name) ON plan TO nmp_app;
GRANT UPDATE ON plan_version TO nmp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_rule, plan_transition TO nmp_app;
