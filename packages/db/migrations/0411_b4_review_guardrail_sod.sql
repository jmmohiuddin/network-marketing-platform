-- B4 review fixes (CPL/IAM).
-- 1. D-B4-21 b on stored rows: an opaque evaluation goes to compliance review when its own outcome or its rule's current
--    outcome is 'blocked'. Evaluations are insert-only and deduplicated without the outcome, so an opaque match of a
--    blocking rule stored as 'warned' before B4 keeps that row: it is no longer acknowledged (an earlier acknowledgement
--    stops counting) and a Compliance officer's override resolves it.
CREATE OR REPLACE FUNCTION guardrail_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evaluation guardrail_decision;
  review boolean;
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
  review := (evaluation.detail ->> 'opaque') IS NOT DISTINCT FROM 'true'
            AND (evaluation.outcome = 'blocked' OR EXISTS (SELECT 1 FROM guardrail_rule r WHERE r.id = NEW.rule_id AND r.outcome = 'blocked'));
  IF NEW.kind = 'acknowledgement' AND (evaluation.outcome <> 'warned' OR review) THEN
    RAISE EXCEPTION 'only a warned evaluation that needs no compliance review is acknowledged' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'override' THEN
    IF evaluation.outcome NOT IN ('blocked', 'warned')
       OR NOT (review OR EXISTS (SELECT 1 FROM guardrail_rule r WHERE r.id = NEW.rule_id AND r.overridable)) THEN
      RAISE EXCEPTION 'only a blocked or warned evaluation of an overridable rule, or one under compliance review, is overridden'
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
         CASE WHEN review THEN 'compliance_review_required'
              WHEN e.outcome = 'warned' THEN 'acknowledgement_required'
              WHEN g.overridable THEN 'override_required' ELSE 'not_overridable' END
  FROM guardrail_decision e JOIN guardrail_rule g ON g.id = e.rule_id,
       LATERAL (SELECT (e.detail ->> 'opaque') IS NOT DISTINCT FROM 'true' AND 'blocked' IN (e.outcome, g.outcome) AS review) r
  WHERE e.plan_version_id = p_version AND e.kind = 'evaluation' AND e.outcome IN ('warned', 'blocked')
    AND guardrail_rules_hash(p_version, ARRAY(SELECT jsonb_array_elements_text(e.detail -> 'rule_keys'))) = e.content_sha256
    AND NOT EXISTS (SELECT 1 FROM guardrail_decision d
                    WHERE d.refers_to_decision_id = e.id
                      AND (d.kind = 'override' OR (d.kind = 'acknowledgement' AND e.outcome = 'warned' AND NOT review)))
  ORDER BY e.decided_at, e.id
$$;

-- 2. BR-ADJ-02/03 separation of duties: nobody withdraws a related-party declaration about themselves (it would lift
--    their own adjustment block and approver exclusion).
CREATE FUNCTION user_related_participant_not_own_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a related-party declaration is not withdrawn by the user it is about' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER user_related_participant_not_own_withdrawal BEFORE UPDATE ON user_related_participant
  FOR EACH ROW WHEN (NEW.withdrawn_by = OLD.user_id) EXECUTE FUNCTION user_related_participant_not_own_withdrawal();
