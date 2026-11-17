-- B2 changes to B1 tables (PLAN B2 sections 1.6 and 1.7): system-opened duplicate cases (D-B2-04), commerce connectors
-- on provider_config (D-B2-14), the setting-approval backstop over every key that needs an approval (D-B2-08), and the
-- market reference counts of the B2 tables.

-- 1. case_file (D-B2-04): a duplicate case may be opened by the system (no opener); it cannot be withdrawn.
ALTER TABLE case_file
  ALTER COLUMN opened_by DROP NOT NULL,
  ADD COLUMN opened_by_kind text NOT NULL DEFAULT 'user' CHECK (opened_by_kind IN ('user', 'system')),
  ADD CONSTRAINT case_file_opener CHECK ((opened_by_kind = 'user') = (opened_by IS NOT NULL)),
  ADD CONSTRAINT case_file_system_opened_duplicate CHECK (opened_by_kind = 'user' OR type = 'duplicate'),
  ADD CONSTRAINT case_file_withdrawn_by_user_opener CHECK (state <> 'withdrawn' OR opened_by_kind = 'user');

CREATE OR REPLACE FUNCTION case_file_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'open'
     OR NOT ((NEW.opened_by_kind = 'user' AND NEW.opened_by = app_user_id())
             OR (NEW.opened_by_kind = 'system' AND NEW.opened_by IS NULL AND NEW.type = 'duplicate'))
     OR jsonb_strip_nulls(to_jsonb(NEW)) ?| ARRAY['submitted_by', 'submitted_at', 'decided_at', 'approval_id'] THEN
    RAISE EXCEPTION 'a case is opened by the acting user (or by the system for a duplicate), open and undecided'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- As 0108, plus: the opener kind never changes, and a system case's approval is prepared by its submitter.
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
         AND a.approver_id IS DISTINCT FROM NEW.opened_by AND a.approver_id <> NEW.submitted_by
         AND (NEW.opened_by IS NOT NULL OR a.preparer_id = NEW.submitted_by)
         AND NOT EXISTS (SELECT 1 FROM case_evidence e
                         WHERE e.tenant_id = NEW.tenant_id AND e.case_id = NEW.id AND e.added_by = a.approver_id)) THEN
    RAISE EXCEPTION 'a case is decided with an approval of it by someone who did not prepare it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 2. provider_config (D-B2-14): a commerce connector carries its name and sealed webhook secret. The secret is rotated
-- only while recorded; last_ok_at moves freely; otherwise a record changes once, from recorded to withdrawn.
ALTER TABLE provider_config
  ADD COLUMN name text CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 100),
  ADD COLUMN webhook_secret_sealed text,
  ADD CONSTRAINT provider_config_commerce_connector CHECK (kind <> 'commerce'
    OR (provider IN ('shopify', 'woocommerce') AND market_id IS NOT NULL AND webhook_secret_sealed IS NOT NULL
        AND name IS NOT NULL));

CREATE OR REPLACE FUNCTION provider_config_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  changing_fields constant text[] := ARRAY['state', 'withdrawn_at', 'withdrawn_by', 'last_ok_at', 'webhook_secret_sealed'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on provider_config is not allowed (withdraw it instead)';
  END IF;
  IF (to_jsonb(NEW) - changing_fields = to_jsonb(OLD) - changing_fields
      AND ((NEW.state, NEW.withdrawn_at, NEW.withdrawn_by) IS NOT DISTINCT FROM (OLD.state, OLD.withdrawn_at, OLD.withdrawn_by)
           OR (OLD.state = 'recorded' AND NEW.state = 'withdrawn'))
      AND (NEW.webhook_secret_sealed IS NOT DISTINCT FROM OLD.webhook_secret_sealed
           OR (OLD.state = 'recorded' AND NEW.state = 'recorded'))) IS NOT TRUE THEN
    RAISE EXCEPTION 'a provider record changes once, from recorded to withdrawn (a connector''s secret is rotated while recorded)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

GRANT UPDATE (last_ok_at, webhook_secret_sealed) ON provider_config TO nmp_app;

-- 3. D-B2-08: every setting whose change needs an approval. The TEN registry pins it against the keys whose
-- approverPermission is set.
CREATE FUNCTION approval_setting_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['money.rounding_mode', 'money.clawback_policy', 'genealogy.visibility_policy']
$$;

-- As 0108, over approval_setting_keys().
-- shortcut: the backstop does not check the approver's permission per key (API-enforced); join approval_eligible_users
-- with the key's permission when a second writer of settings versions appears.
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
  CROSS JOIN unnest(approval_setting_keys()) AS k (key)
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
    RAISE EXCEPTION 'setting % needs an approval: version % changes it without one', unapproved.key,
      unapproved.version USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END $$;

-- 4. AC-TEN2-3: everything that keeps a market from being deleted (migrations.test.ts pins the tables).
CREATE OR REPLACE FUNCTION market_references(p_market_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'calendars', (SELECT count(*) FROM calendar WHERE market_id = p_market_id),
    'imports', (SELECT count(*) FROM import_batch WHERE market_id = p_market_id),
    'snapshots', (SELECT count(*) FROM compliance_report_snapshot WHERE market_id = p_market_id),
    'fact_participants', (SELECT count(*) FROM cpl_fact_participant WHERE market_id = p_market_id),
    'providers', (SELECT count(*) FROM provider_config WHERE market_id = p_market_id AND kind <> 'commerce'),
    'connectors', (SELECT count(*) FROM provider_config WHERE market_id = p_market_id AND kind = 'commerce'),
    'checklist_entries', (SELECT count(*) FROM market_checklist_entry WHERE market_id = p_market_id),
    'go_live_requests', (SELECT count(*) FROM market_go_live_request WHERE market_id = p_market_id),
    'cases', (SELECT count(*) FROM case_file WHERE market_id = p_market_id),
    'participants', (SELECT count(*) FROM participant WHERE market_id = p_market_id),
    'positions', (SELECT count(*) FROM position WHERE market_id = p_market_id),
    'orders', (SELECT count(*) FROM sales_order WHERE market_id = p_market_id),
    'product_volumes', (SELECT count(*) FROM product_volume_map WHERE market_id = p_market_id),
    'agreement_versions', (SELECT count(*) FROM agreement_version WHERE market_id = p_market_id),
    'grants', (SELECT count(*) FROM role_assignment WHERE p_market_id = ANY (market_ids))
            + (SELECT count(*) FROM role_grant_request WHERE p_market_id = ANY (market_ids)))
$$;
