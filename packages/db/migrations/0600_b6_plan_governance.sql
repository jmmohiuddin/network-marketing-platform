-- B6 plan-change governance (PLAN B6 section 1.1; D-B6-02, D-B6-05): the notice record on the version, filing records
-- per market, the filing gate's SQL, and the crediting-event and placement-width readers without their legacy settings.

-- 1. Notice record (D-B6-02 c): set once, together, in the transaction that schedules the version (the schedule update
-- itself or a later update of the same transaction, after notify_plan_change counted the recipients).
ALTER TABLE plan_version
  ADD COLUMN notice_sent_at timestamptz,
  ADD COLUMN notice_recipients int CHECK (notice_recipients >= 0),
  ADD CONSTRAINT plan_version_notice_pair CHECK ((notice_sent_at IS NULL) = (notice_recipients IS NULL));

-- approved -> scheduled marks its transaction with a transaction-local setting (kept on RELEASE SAVEPOINT, undone by
-- ROLLBACK TO; a row's xmin would be the savepoint's subtransaction id). The notice is accepted only in that transaction,
-- also after the same transaction activated the version.
CREATE FUNCTION plan_version_notice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'approved' AND NEW.state = 'scheduled' THEN
    PERFORM set_config('app.scheduled_plan_version', NEW.id::text, true);
  END IF;
  IF (NEW.notice_sent_at, NEW.notice_recipients) IS NOT DISTINCT FROM (OLD.notice_sent_at, OLD.notice_recipients) THEN
    RETURN NEW;
  END IF;
  IF OLD.notice_sent_at IS NOT NULL OR NEW.state NOT IN ('scheduled', 'active')
     OR current_setting('app.scheduled_plan_version', true) IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'a plan version''s notice is recorded once, in the transaction that schedules it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_version_notice_guard BEFORE UPDATE ON plan_version
  FOR EACH ROW EXECUTE FUNCTION plan_version_notice_guard();

-- 2. plan_version_filing (C-B6-1): insert-only history per version and market; the latest row is the current status.
-- content_hash binds a row to the content it describes (BR-PLN-03): a rejected version edited in draft needs new filings.
CREATE TABLE plan_version_filing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  plan_version_id uuid NOT NULL,
  content_hash bytea NOT NULL CHECK (length(content_hash) = 32),
  market_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('filed', 'acknowledged', 'not_required')),
  reference text CHECK (reference IS NULL OR length(trim(reference)) BETWEEN 1 AND 200),
  filed_on date,
  document_id uuid,
  note text CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 1000),
  recorded_by uuid NOT NULL DEFAULT app_user_id(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_version_filing_filed
    CHECK (status = 'not_required' OR (reference IS NOT NULL AND filed_on IS NOT NULL AND document_id IS NOT NULL)),
  CONSTRAINT plan_version_filing_not_required CHECK (status <> 'not_required' OR (note IS NOT NULL AND document_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, plan_version_id) REFERENCES plan_version (tenant_id, id),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX plan_version_filing_current_idx ON plan_version_filing (tenant_id, plan_version_id, market_id, recorded_at DESC);
CREATE TRIGGER plan_version_filing_no_mutation BEFORE UPDATE OR DELETE ON plan_version_filing
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER plan_version_filing_recorded_by_actor BEFORE INSERT ON plan_version_filing
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('recorded_by');
CREATE TRIGGER plan_version_filing_document BEFORE INSERT ON plan_version_filing
  FOR EACH ROW EXECUTE FUNCTION document_reference_guard('document_id');

-- A filing is recorded for a market of the version's plan while the version is in review or approved, for its content now.
CREATE FUNCTION plan_version_filing_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT v.content_hash INTO NEW.content_hash FROM plan_version v
  WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.plan_version_id FOR SHARE;
  IF NOT EXISTS (
       SELECT 1 FROM plan_version v JOIN plan_market m ON m.tenant_id = v.tenant_id AND m.plan_id = v.plan_id
       WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.plan_version_id AND v.state IN ('in_review', 'approved')
         AND m.market_id = NEW.market_id) THEN
    RAISE EXCEPTION 'a filing is recorded for a market of the plan while its version is in review or approved'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_version_filing_insert_guard BEFORE INSERT ON plan_version_filing
  FOR EACH ROW EXECUTE FUNCTION plan_version_filing_insert_guard();

SELECT apply_tenant_rls('plan_version_filing');
GRANT SELECT, INSERT ON plan_version_filing TO nmp_app;

-- A filing's evidence is referenced by it (document reads and the reference-once rule).
CREATE OR REPLACE FUNCTION document_references(p_document_id uuid)
RETURNS TABLE (object_type text, object_id uuid, market_id uuid, case_type text)
LANGUAGE sql STABLE AS $$
  SELECT 'market_checklist_entry', e.id, e.market_id, NULL FROM market_checklist_entry e WHERE e.document_id = p_document_id
  UNION ALL
  SELECT 'provider_config', p.id, p.market_id, NULL FROM provider_config p WHERE p.approval_document_id = p_document_id
  UNION ALL
  SELECT 'market_go_live_request', g.id, g.market_id, NULL FROM market_go_live_request g WHERE g.risk_document_id = p_document_id
  UNION ALL
  SELECT 'case_file', c.id, c.market_id, c.type
  FROM case_evidence v JOIN case_file c ON c.tenant_id = v.tenant_id AND c.id = v.case_id
  WHERE v.document_id = p_document_id
  UNION ALL
  SELECT 'agreement_version', a.id, a.market_id, NULL FROM agreement_version a WHERE a.document_id = p_document_id
  UNION ALL
  SELECT 'guardrail_decision', d.id, NULL, NULL FROM guardrail_decision d WHERE d.evidence_document_id = p_document_id
  UNION ALL
  SELECT 'plan_version_filing', f.id, f.market_id, NULL FROM plan_version_filing f WHERE f.document_id = p_document_id
$$;

-- 3. The filing gate (D-B6-02 a): plan markets listed in the in-force plan.filing_requirements without a filing row for
-- the version's current content, sorted; '{}' when the setting is unset (no market requires a filing, DEC-14).
CREATE FUNCTION plan_filing_missing(p_version uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(m.market_id ORDER BY m.market_id), '{}')
  FROM plan_version v JOIN plan_market m ON m.tenant_id = v.tenant_id AND m.plan_id = v.plan_id
  WHERE v.id = p_version
    AND m.market_id::text IN (
      SELECT jsonb_array_elements_text(setting_in_force(v.tenant_id, 'plan.filing_requirements') -> 'market_ids'))
    AND NOT EXISTS (SELECT 1 FROM plan_version_filing f
                    WHERE f.tenant_id = v.tenant_id AND f.plan_version_id = v.id AND f.market_id = m.market_id
                      AND f.content_hash = v.content_hash)
$$;

-- 4. D-B6-05: the version in force at the instant, else the market's earliest scheduled/active/retired version (the
-- first plan's event and width apply before it), else NULL. No setting fallback.
CREATE OR REPLACE FUNCTION plan_crediting_event(p_market uuid, p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.crediting_event FROM plan_market m
  JOIN plan_version v ON v.tenant_id = m.tenant_id AND v.plan_id = m.plan_id
  WHERE m.market_id = p_market AND v.state IN ('scheduled', 'active', 'retired')
  ORDER BY v.effective_from <= p_at DESC, CASE WHEN v.effective_from <= p_at THEN v.effective_from END DESC NULLS LAST,
           v.effective_from, v.version DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION placement_width_for(p_market uuid) RETURNS int
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.placement_width FROM plan_market m
  JOIN plan_version v ON v.tenant_id = m.tenant_id AND v.plan_id = m.plan_id
  WHERE m.market_id = p_market AND v.state IN ('scheduled', 'active', 'retired')
  ORDER BY v.effective_from <= now() DESC, CASE WHEN v.effective_from <= now() THEN v.effective_from END DESC NULLS LAST,
           v.effective_from, v.version DESC
  LIMIT 1
$$;

-- 5. D-B6-05 data step (owner): scheduled/active versions without a width take the retired genealogy.placement_width
-- their tenant still has in force, audited with actor NULL.
WITH copied AS (
  UPDATE plan_version v SET placement_width = setting_in_force(v.tenant_id, 'genealogy.placement_width')::int
  WHERE v.state IN ('scheduled', 'active') AND v.placement_width IS NULL
    AND jsonb_typeof(setting_in_force(v.tenant_id, 'genealogy.placement_width')) = 'number'
  RETURNING v.tenant_id, v.id, v.placement_width
)
INSERT INTO audit.audit_event (tenant_id, actor_type, actor_id, action, object_type, object_id, before_ref, after_ref)
SELECT c.tenant_id, 'system', NULL, 'PLAN_VERSION.LEGACY_WIDTH_COPIED', 'plan_version', c.id,
       jsonb_build_object('placement_width', NULL)::text,
       jsonb_build_object('after', jsonb_build_object('placement_width', c.placement_width))::text
FROM copied c;

-- Markets that still credit orders through the retired orders.crediting_event: operators schedule a plan first.
DO $$
DECLARE
  pairs text;
BEGIN
  SELECT string_agg(m.tenant_id || ' ' || m.id, ', ' ORDER BY m.tenant_id, m.id) INTO pairs FROM market m
  WHERE setting_in_force(m.tenant_id, 'orders.crediting_event') IS NOT NULL
    AND plan_crediting_event(m.id, now()) IS NULL
    AND (EXISTS (SELECT 1 FROM sales_order o WHERE o.tenant_id = m.tenant_id AND o.market_id = m.id)
         OR EXISTS (SELECT 1 FROM provider_config c
                    WHERE c.tenant_id = m.tenant_id AND c.market_id = m.id AND c.kind = 'commerce' AND c.state = 'recorded'));
  IF pairs IS NOT NULL THEN
    RAISE NOTICE 'D-B6-05: schedule a plan version before the next order for (tenant market): %', pairs;
  END IF;
END $$;
