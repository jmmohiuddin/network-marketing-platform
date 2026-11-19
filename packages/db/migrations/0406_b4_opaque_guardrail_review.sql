-- B3 OI-3 (b), PLAN B4 D-B4-21: an opaque evaluation (detail.opaque = true) of a blocked rule is resolved only by a
-- Compliance officer's override, which the database allows even when the rule is not overridable; guardrail_outstanding
-- reports it as 'compliance_review_required'. Acknowledgement stays for warned evaluations only (0306 unchanged there).
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
       OR NOT ((evaluation.outcome = 'blocked' AND (evaluation.detail ->> 'opaque') IS NOT DISTINCT FROM 'true')
               OR EXISTS (SELECT 1 FROM guardrail_rule r WHERE r.id = NEW.rule_id AND r.overridable)) THEN
      RAISE EXCEPTION 'only a blocked or warned evaluation of an overridable rule, or an opaque blocked one, is overridden'
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

CREATE OR REPLACE FUNCTION guardrail_outstanding(p_version uuid)
RETURNS TABLE (decision_id uuid, rule_id text, outcome text, reason text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT e.id, e.rule_id, e.outcome,
         CASE WHEN e.outcome = 'warned' THEN 'acknowledgement_required'
              WHEN e.detail ->> 'opaque' = 'true' THEN 'compliance_review_required' -- blocked and opaque
              WHEN g.overridable THEN 'override_required' ELSE 'not_overridable' END
  FROM guardrail_decision e JOIN guardrail_rule g ON g.id = e.rule_id
  WHERE e.plan_version_id = p_version AND e.kind = 'evaluation' AND e.outcome IN ('warned', 'blocked')
    AND guardrail_rules_hash(p_version, ARRAY(SELECT jsonb_array_elements_text(e.detail -> 'rule_keys'))) = e.content_sha256
    AND NOT EXISTS (SELECT 1 FROM guardrail_decision d
                    WHERE d.refers_to_decision_id = e.id
                      AND (d.kind = 'override' OR (d.kind = 'acknowledgement' AND e.outcome = 'warned')))
  ORDER BY e.decided_at, e.id
$$;
