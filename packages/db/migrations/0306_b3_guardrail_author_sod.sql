-- B3 review fix (0300 is applied and cannot change): a guardrail override is refused to anyone who wrote one of the rules
-- the evaluation matched, not only to whoever triggered the evaluation (FR-CPL-008 SoD).

-- The authors of the plan rules an evaluation matched (detail.rule_keys): their current creator and editor, plus every
-- actor of a PLAN_RULE.SAVED / DELETED audit event of those keys in that version (a deleted or rewritten rule leaves no
-- row). shortcut: scans the tenant's plan_rule audit events (as pln contributors()); index the version id in audit if
-- that log grows large.
CREATE FUNCTION guardrail_rule_authors(p_evaluation uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  WITH e AS (
    SELECT d.plan_version_id, ARRAY(SELECT jsonb_array_elements_text(d.detail -> 'rule_keys')) AS keys
    FROM guardrail_decision d WHERE d.id = p_evaluation
  ), written AS (
    SELECT a.actor_id, CASE WHEN a.action = 'PLAN_RULE.SAVED' THEN a.after_ref::jsonb -> 'after' ELSE a.before_ref::jsonb END AS ref
    FROM audit.audit_event a
    WHERE a.actor_id IS NOT NULL AND a.object_type = 'plan_rule' AND a.action IN ('PLAN_RULE.SAVED', 'PLAN_RULE.DELETED')
  )
  SELECT unnest(ARRAY[r.created_by, r.updated_by]) FROM plan_rule r JOIN e ON r.plan_version_id = e.plan_version_id
  WHERE r.rule_key = ANY (e.keys)
  UNION
  SELECT w.actor_id FROM written w JOIN e ON w.ref ->> 'plan_version_id' = e.plan_version_id::text
  WHERE w.ref ->> 'rule_key' = ANY (e.keys)
$$;

CREATE OR REPLACE FUNCTION guardrail_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF NEW.decided_by IN (SELECT guardrail_rule_authors(evaluation.id)) THEN
      RAISE EXCEPTION 'an author of a rule the evaluation matched does not override it' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
