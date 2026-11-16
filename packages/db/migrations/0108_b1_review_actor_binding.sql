-- B1 review, second round. Every actor column a transition writes is the acting user (runtime role), a case's
-- submission and evidence cannot be forged or added late, a money setting scheduled with approval cannot be superseded
-- at its own date without approval, webhook attempts and pack rules stay consistent. The owner (migrations, test
-- fixtures) is exempt from the actor bindings as in D-B1-17.

-- 1. The named actor column of NEW is the acting user (trigger argument: the column).
CREATE FUNCTION actor_is_acting_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) ->> TG_ARGV[0])::uuid IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION '%.% must be the acting user', TG_TABLE_NAME, TG_ARGV[0] USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 2. Cases (FR-CAS-001, PLAN B1 section 3): submitted by the acting user, once; withdrawn by the opener; what was
-- submitted (reason, payload, preview, evidence) no longer changes; decided and withdrawn cases carry their time.
ALTER TABLE case_file
  ADD CONSTRAINT case_file_submission_complete CHECK ((submitted_by IS NULL) = (submitted_at IS NULL)),
  ADD CONSTRAINT case_file_submitted_before_decision CHECK (state IN ('open', 'withdrawn') OR submitted_by IS NOT NULL),
  ADD CONSTRAINT case_file_decided_at CHECK ((state IN ('approved', 'rejected', 'withdrawn')) = (decided_at IS NOT NULL));

CREATE TRIGGER case_file_submitted_by_actor BEFORE UPDATE ON case_file
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND OLD.state = 'open' AND NEW.state = 'submitted')
  EXECUTE FUNCTION actor_is_acting_user('submitted_by');
CREATE TRIGGER case_file_withdrawn_by_opener BEFORE UPDATE ON case_file
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND OLD.state <> 'withdrawn' AND NEW.state = 'withdrawn')
  EXECUTE FUNCTION actor_is_acting_user('opened_by');

CREATE OR REPLACE FUNCTION case_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on case_file is not allowed (cases are history)';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.type, NEW.subject_type, NEW.subject_id, NEW.opened_by, NEW.market_id, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.type, OLD.subject_type, OLD.subject_id, OLD.opened_by,
                         OLD.market_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a case''s type, subject, opener and market never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state IN ('approved', 'rejected', 'withdrawn')
     OR NOT (NEW.state = OLD.state
             OR (OLD.state = 'open' AND NEW.state IN ('submitted', 'withdrawn'))
             OR (OLD.state = 'submitted' AND NEW.state IN ('approved', 'rejected', 'withdrawn'))) THEN
    RAISE EXCEPTION 'case state cannot change from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.submitted_by, NEW.submitted_at) IS DISTINCT FROM (OLD.submitted_by, OLD.submitted_at)
     AND NOT (OLD.state = 'open' AND NEW.state = 'submitted') THEN
    RAISE EXCEPTION 'a case''s submission is recorded once, when it is submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'open'
     AND (NEW.reason_code, NEW.payload, NEW.effect_preview) IS DISTINCT FROM (OLD.reason_code, OLD.payload, OLD.effect_preview) THEN
    RAISE EXCEPTION 'a submitted case is decided as it was submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state IN ('approved', 'rejected') AND NOT EXISTS (
       SELECT 1 FROM approval a
       WHERE a.id = NEW.approval_id AND a.object_type = 'case' AND a.object_id = NEW.id AND a.decision = NEW.state
         AND a.approver_id <> NEW.opened_by AND a.approver_id <> NEW.submitted_by
         AND NOT EXISTS (SELECT 1 FROM case_evidence e
                         WHERE e.tenant_id = NEW.tenant_id AND e.case_id = NEW.id AND e.added_by = a.approver_id)) THEN
    RAISE EXCEPTION 'a case is decided with an approval of it by someone who did not prepare it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- Evidence only while open (PLAN B1 section 3). The share lock conflicts with the submit's row lock, so evidence
-- added concurrently with a submit is either in before it or refused (READ COMMITTED re-reads the submitted row).
CREATE FUNCTION case_evidence_case_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM case_file c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.state = 'open' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence is added only while the case is open' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER case_evidence_added_by_actor BEFORE INSERT ON case_evidence
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('added_by');
CREATE TRIGGER case_evidence_case_open BEFORE INSERT ON case_evidence
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION case_evidence_case_open();
CREATE TRIGGER case_event_actor BEFORE INSERT ON case_event
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND NEW.actor_id IS NOT NULL) EXECUTE FUNCTION actor_is_acting_user('actor_id');

-- 3. Withdrawing a provider record and disabling a service account name who did it, the acting user.
ALTER TABLE provider_config
  ADD CONSTRAINT provider_config_withdrawn_by CHECK ((state = 'withdrawn') = (withdrawn_by IS NOT NULL));
CREATE TRIGGER provider_config_withdrawn_by_actor BEFORE UPDATE ON provider_config
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION actor_is_acting_user('withdrawn_by');
ALTER TABLE service_account
  ADD CONSTRAINT service_account_disabled_by CHECK ((state = 'disabled') = (disabled_by IS NOT NULL));
CREATE TRIGGER service_account_disabled_by_actor BEFORE UPDATE ON service_account
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION actor_is_acting_user('disabled_by');

-- 4. An approved setting change names the version that carries its approval.
CREATE FUNCTION setting_change_request_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_setting_version v
                 WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.version_id AND v.approval_id = NEW.approval_id) THEN
    RAISE EXCEPTION 'an approved setting change names the version carrying its approval'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER setting_change_request_version_guard BEFORE UPDATE ON setting_change_request
  FOR EACH ROW WHEN (NEW.state = 'approved' AND OLD.state IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION setting_change_request_version_guard();

-- 5. D-B1-01 money-key backstop, also against superseding at the same effective_from. For each chain row and money
-- key: when a version at that date (the row itself or one it supersedes) applied an approved change of the key, the
-- row keeps the value of the latest such version (only a new approval for that date changes or cancels a scheduled
-- approved change); otherwise the row keeps its chain predecessor's value (as in 0107). A rebase row (D-B1-01) inherits
-- upstream values and keeps the rebased row's approved values, so it passes with or without a copied approval_id.
CREATE OR REPLACE FUNCTION tenant_setting_version_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  unapproved record;
BEGIN
  SELECT c.version, k.key INTO unapproved
  FROM (
    SELECT chain.version, chain.effective_from, chain.settings,
           coalesce(lag(chain.settings) OVER (ORDER BY chain.effective_from), '{}'::jsonb) AS previous
    FROM (SELECT DISTINCT ON (v.effective_from) v.version, v.effective_from, v.settings
          FROM tenant_setting_version v WHERE v.tenant_id = NEW.tenant_id
          ORDER BY v.effective_from, v.version DESC) AS chain
  ) AS c
  CROSS JOIN unnest(money_setting_keys()) AS k (key)
  LEFT JOIN LATERAL (
    SELECT true AS found, s.settings -> k.key AS value
    FROM tenant_setting_version s
    WHERE s.tenant_id = NEW.tenant_id AND s.effective_from = c.effective_from
      AND money_change_approved(s.approval_id, k.key, s.settings -> k.key, s.effective_from)
    ORDER BY s.version DESC
    LIMIT 1
  ) AS approved ON true
  WHERE c.effective_from >= NEW.effective_from
    AND CASE WHEN approved.found THEN c.settings -> k.key IS DISTINCT FROM approved.value
             ELSE c.settings -> k.key IS DISTINCT FROM c.previous -> k.key END
  ORDER BY c.effective_from
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'setting % is money-affecting: version % changes it without its approval', unapproved.key,
      unapproved.version USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END $$;

-- 6. A scheduled webhook attempt has not been attempted yet (the insert guard of 0107, now for updates too).
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_scheduled_unattempted CHECK (
  outcome <> 'scheduled' OR (attempted_at IS NULL AND status IS NULL AND error IS NULL AND duration_ms IS NULL));

-- 7. Pack rules (DATABASE C-11: id = <rule>@<effective_from>): two versions of one rule never overlap in time, so
-- market_pack_rules returns at most one version of a rule for a date.
ALTER TABLE guardrail_rule
  ADD COLUMN rule_key text GENERATED ALWAYS AS (split_part(id, '@', 1)) STORED,
  ADD CONSTRAINT guardrail_rule_id_versioned CHECK (id = rule_key || '@' || to_char(effective_from, 'YYYY-MM-DD')),
  ADD CONSTRAINT guardrail_rule_versions_disjoint EXCLUDE USING gist
    (market_pack WITH =, rule_key WITH =, daterange(effective_from, effective_to) WITH &&);
ALTER TABLE tax_rule
  ADD COLUMN rule_key text GENERATED ALWAYS AS (split_part(id, '@', 1)) STORED,
  ADD CONSTRAINT tax_rule_id_versioned CHECK (id = rule_key || '@' || to_char(effective_from, 'YYYY-MM-DD')),
  ADD CONSTRAINT tax_rule_versions_disjoint EXCLUDE USING gist
    (market_pack WITH =, rule_key WITH =, daterange(effective_from, effective_to) WITH &&);
