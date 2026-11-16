-- B1 market launch (FR-TEN-004, FR-CPL-012, D-B1-12, D-B1-14; PLAN B1 sections 1.2 and 1.4): evidence file names,
-- provider eligibility records (PAY), checklist entries, go-live requests, the market state guard and the platform
-- market-pack rule tables.

-- 1. document (AUD): the sanitised original file name of an evidence upload. NULL for rows written before B1.
ALTER TABLE document
  ADD COLUMN file_name text CHECK (file_name IS NULL OR file_name ~ '^[^/\\[:cntrl:]]{1,200}$');

-- 2. provider_config (spec, D-B1-12): B1 records eligibility only; credentials and the connected state arrive in B4.
CREATE TABLE provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid,
  kind text NOT NULL CHECK (kind IN ('payout', 'payment', 'commerce', 'messaging')),
  provider text NOT NULL CHECK (length(trim(provider)) BETWEEN 1 AND 100),
  credentials_secret_ref text,
  approved_description text,
  approval_document_id uuid,
  approved_at date,
  funds_holder text,
  state text NOT NULL CHECK (state IN ('recorded', 'withdrawn')),
  last_ok_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  -- BR-PAY-11: a payout or payment provider is recorded with its approval, evidence, date and funds holder.
  CONSTRAINT provider_config_money_provider_approved CHECK (kind NOT IN ('payout', 'payment')
    OR (approved_description IS NOT NULL AND approval_document_id IS NOT NULL AND approved_at IS NOT NULL
        AND funds_holder IS NOT NULL)),
  CONSTRAINT provider_config_withdrawn_at CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, approval_document_id) REFERENCES document (tenant_id, id),
  FOREIGN KEY (tenant_id, withdrawn_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
-- Deviation from the spec's full unique key: a withdrawn record may be recorded again.
CREATE UNIQUE INDEX provider_config_one_recorded ON provider_config (tenant_id, kind, provider, market_id)
  NULLS NOT DISTINCT WHERE state = 'recorded';

CREATE FUNCTION provider_config_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  withdrawal_fields constant text[] := ARRAY['state', 'withdrawn_at', 'withdrawn_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on provider_config is not allowed (withdraw it instead)';
  END IF;
  IF (OLD.state = 'recorded' AND NEW.state = 'withdrawn'
      AND to_jsonb(NEW) - withdrawal_fields = to_jsonb(OLD) - withdrawal_fields) IS NOT TRUE THEN
    RAISE EXCEPTION 'a provider record changes once, from recorded to withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_config_withdrawn_once BEFORE UPDATE OR DELETE ON provider_config
  FOR EACH ROW EXECUTE FUNCTION provider_config_guard();

-- 3. market_checklist_entry (insert-only): the latest entry per item counts (D-B1-15).
CREATE TABLE market_checklist_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  item text NOT NULL
    CHECK (item IN ('licence_evidence', 'tax_configuration', 'agreement_versions', 'data_region', 'plan_variant')),
  document_id uuid,
  note text CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 2000),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (document_id IS NOT NULL OR note IS NOT NULL),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX market_checklist_entry_item_idx ON market_checklist_entry (tenant_id, market_id, item, recorded_at DESC);
CREATE TRIGGER market_checklist_entry_no_mutation BEFORE UPDATE OR DELETE ON market_checklist_entry
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 4. market_go_live_request: the checklist snapshot taken when go-live was requested, and its decision.
CREATE TABLE market_go_live_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  checklist jsonb NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  approval_id uuid,
  risk_acceptance jsonb,
  risk_document_id uuid,
  CONSTRAINT market_go_live_request_decider_is_not_requester CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT market_go_live_request_decided_at CHECK ((state = 'pending') = (decided_at IS NULL)),
  CONSTRAINT market_go_live_request_decision_approved CHECK (state NOT IN ('approved', 'rejected') OR approval_id IS NOT NULL),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, requested_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  FOREIGN KEY (tenant_id, risk_document_id) REFERENCES document (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX market_go_live_request_one_pending ON market_go_live_request (tenant_id, market_id)
  WHERE state = 'pending';
CREATE TRIGGER market_go_live_request_decided_once BEFORE UPDATE OR DELETE ON market_go_live_request
  FOR EACH ROW EXECUTE FUNCTION pending_request_guard(
    'state', 'decided_by', 'decided_at', 'decision_reason', 'approval_id', 'risk_acceptance', 'risk_document_id');

-- 5. AC-TEN4-4: the runtime role moves a market draft -> live only with an approved go-live request for it (in practice
-- approved in the same transaction); live -> suspended is reserved for B6. The owner is exempt (D-B1-17).
CREATE FUNCTION market_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.state = 'draft' AND NEW.state = 'live' AND EXISTS (
            SELECT 1 FROM market_go_live_request r
            WHERE r.tenant_id = NEW.tenant_id AND r.market_id = NEW.id AND r.state = 'approved')) THEN
    RAISE EXCEPTION 'a market goes from draft to live only through an approved go-live request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER market_state_guard BEFORE UPDATE OF state ON market
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND current_user = 'nmp_app')
  EXECUTE FUNCTION market_state_guard();

SELECT apply_tenant_rls(t)
FROM unnest(ARRAY['provider_config', 'market_checklist_entry', 'market_go_live_request']::regclass[]) AS t;

GRANT SELECT, INSERT ON provider_config, market_checklist_entry, market_go_live_request TO nmp_app;
GRANT UPDATE (state, withdrawn_at, withdrawn_by) ON provider_config TO nmp_app;
GRANT UPDATE (state, decided_by, decided_at, decision_reason, approval_id, risk_acceptance, risk_document_id)
  ON market_go_live_request TO nmp_app;

-- 6. Market-pack rules (FR-CPL-012, BR-CPL-03): platform tables without tenant_id, written by migrations only. Every
-- realm reads them; nmp_app has SELECT and nothing else. No rows ship in B1 (DEC-14, E-ADR-15).
CREATE TABLE guardrail_rule (
  id text PRIMARY KEY, -- version-specific: <rule>@<effective_from> (DATABASE C-11)
  market_pack text NOT NULL,
  title text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('blocked', 'warned', 'reported')),
  predicate jsonb NOT NULL,
  overridable boolean NOT NULL,
  mandatory boolean NOT NULL,
  basis text NOT NULL CHECK (basis <> ''),
  basis_status text NOT NULL CHECK (basis_status IN ('screening', 'primary_read', 'counsel_confirmed')),
  source_ref text NOT NULL CHECK (source_ref <> ''),
  reviewed_by text,
  reviewed_at date,
  effective_from date NOT NULL,
  effective_to date CHECK (effective_to IS NULL OR effective_to > effective_from),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guardrail_rule_pack_idx ON guardrail_rule (market_pack, effective_from);

CREATE TABLE tax_rule (
  id text PRIMARY KEY,
  market_pack text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  conditions jsonb NOT NULL,
  rate numeric(9, 6),
  threshold_minor bigint,
  threshold_basis text,
  missing_id_rate numeric(9, 6),
  rounding text NOT NULL,
  mandatory boolean NOT NULL,
  effective_from date NOT NULL,
  effective_to date CHECK (effective_to IS NULL OR effective_to > effective_from),
  basis text NOT NULL CHECK (basis <> ''),
  basis_status text NOT NULL CHECK (basis_status IN ('screening', 'primary_read', 'counsel_confirmed')),
  source_ref text NOT NULL CHECK (source_ref <> ''),
  reviewed_by text,
  reviewed_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tax_rule_pack_idx ON tax_rule (market_pack, effective_from);

ALTER TABLE guardrail_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrail_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON guardrail_rule FOR SELECT USING (app_realm() IN ('tenant', 'vendor', 'system'));
ALTER TABLE tax_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON tax_rule FOR SELECT USING (app_realm() IN ('tenant', 'vendor', 'system'));
GRANT SELECT ON guardrail_rule, tax_rule TO nmp_app;

-- The rules of a pack in force on a date (TEN's go-live gate and CPL's rules view read them through this).
CREATE FUNCTION market_pack_rules(p_pack text, p_on date)
RETURNS TABLE (kind text, id text, title text, mandatory boolean, basis text, basis_status text, source_ref text,
               reviewed_by text, reviewed_at date, effective_from date, effective_to date)
LANGUAGE sql STABLE AS $$
  SELECT r.* FROM (
    SELECT 'guardrail'::text, g.id, g.title, g.mandatory, g.basis, g.basis_status, g.source_ref, g.reviewed_by,
           g.reviewed_at, g.effective_from, g.effective_to
    FROM guardrail_rule g
    WHERE g.market_pack = p_pack AND g.effective_from <= p_on AND (g.effective_to IS NULL OR g.effective_to > p_on)
    UNION ALL
    SELECT 'tax'::text, t.id, t.title, t.mandatory, t.basis, t.basis_status, t.source_ref, t.reviewed_by,
           t.reviewed_at, t.effective_from, t.effective_to
    FROM tax_rule t
    WHERE t.market_pack = p_pack AND t.effective_from <= p_on AND (t.effective_to IS NULL OR t.effective_to > p_on)
  ) AS r (kind, id, title, mandatory, basis, basis_status, source_ref, reviewed_by, reviewed_at, effective_from,
          effective_to)
  ORDER BY r.kind, r.id
$$;
