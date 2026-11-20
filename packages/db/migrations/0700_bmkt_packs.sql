-- B-MKT market packs (PLAN B-MKT section 1.1; D-BM-02, D-BM-03, D-BM-06): the pack-rule kinds beyond guardrail and tax in
-- a new platform table, the tax_rule value checks, and pack rows immutable (a change is a new version id). No rows ship
-- here: IN-2026.0 is a test fixture until the founder confirms C-9 (C-BM-4), and nothing else is sourced (DEC-14).

-- 1. Small JSON validators the pack and tax checks share (IMMUTABLE: they back CHECK constraints).
CREATE FUNCTION jsonb_keys_ok(p jsonb, p_required text[], p_optional text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'object' THEN
    p ?& p_required AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k <> ALL (p_required || p_optional))
  ELSE false END
$$;

CREATE FUNCTION jsonb_int_between(p jsonb, p_low int, p_high int) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'number' THEN p::numeric = trunc(p::numeric) AND p::numeric BETWEEN p_low AND p_high
  ELSE false END
$$;

CREATE FUNCTION jsonb_text_between(p jsonb, p_low int, p_high int) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'string' THEN length(p #>> '{}') BETWEEN p_low AND p_high ELSE false END
$$;

-- A non-empty array of distinct strings, each in p_allowed (NULL: any) and matching p_pattern.
CREATE FUNCTION jsonb_string_set_ok(p jsonb, p_allowed text[], p_pattern text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array' AND jsonb_array_length(p) > 0 THEN (
    SELECT count(DISTINCT e) = count(*)
       AND bool_and(jsonb_typeof(e) = 'string' AND (p_allowed IS NULL OR e #>> '{}' = ANY (p_allowed)) AND e #>> '{}' ~ p_pattern)
    FROM jsonb_array_elements(p) e)
  ELSE false END
$$;

-- 2. pack_rule params per kind: exact key sets, no extra keys (section 1.1).
CREATE FUNCTION pack_rule_params_ok(p_kind text, p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'grievance_register' THEN
      jsonb_keys_ok(p, '{ack_hours,resolution}', '{escalation_lead_hours}') AND jsonb_int_between(p -> 'ack_hours', 1, 720)
      AND (NOT (p ? 'escalation_lead_hours') OR jsonb_int_between(p -> 'escalation_lead_hours', 1, 720))
      AND ((jsonb_keys_ok(p -> 'resolution', '{days}', '{}') AND jsonb_int_between(p -> 'resolution' -> 'days', 1, 365))
           OR (jsonb_keys_ok(p -> 'resolution', '{months}', '{}') AND jsonb_int_between(p -> 'resolution' -> 'months', 1, 12)))
    WHEN 'delisted_register' THEN
      jsonb_keys_ok(p, '{fields}', '{window_days}')
      AND jsonb_string_set_ok(p -> 'fields', '{external_ref,display_name,terminated_on}', '')
      AND (NOT (p ? 'window_days') OR jsonb_int_between(p -> 'window_days', 1, 3650))
    WHEN 'plan_filing' THEN jsonb_keys_ok(p, '{authority}', '{}') AND jsonb_text_between(p -> 'authority', 1, 200)
    WHEN 'tax_year' THEN
      jsonb_keys_ok(p, '{start_month,start_day}', '{}') AND jsonb_int_between(p -> 'start_month', 1, 12)
      AND jsonb_int_between(p -> 'start_day', 1, 28)
    WHEN 'tax_id_format' THEN
      jsonb_keys_ok(p, '{pattern,label}', '{}') AND jsonb_text_between(p -> 'pattern', 3, 200)
      AND coalesce(left(p ->> 'pattern', 1) = '^' AND right(p ->> 'pattern', 1) = '$', false) AND jsonb_text_between(p -> 'label', 1, 40)
    ELSE false
  END
$$;

-- 3. pack_rule (platform data, no tenant_id): one rule per kind in force per pack, written by migrations or the owner only.
CREATE TABLE pack_rule (
  id text PRIMARY KEY, -- version-specific: <rule>@<effective_from> (DATABASE C-11)
  rule_key text GENERATED ALWAYS AS (split_part(id, '@', 1)) STORED,
  market_pack text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('grievance_register', 'delisted_register', 'plan_filing', 'tax_year', 'tax_id_format')),
  title text NOT NULL CHECK (title <> ''),
  params jsonb NOT NULL,
  mandatory boolean NOT NULL,
  basis text NOT NULL CHECK (basis <> ''),
  basis_status text NOT NULL CHECK (basis_status IN ('screening', 'primary_read', 'counsel_confirmed')),
  source_ref text NOT NULL CHECK (source_ref <> ''),
  reviewed_by text,
  reviewed_at date,
  effective_from date NOT NULL,
  effective_to date CHECK (effective_to IS NULL OR effective_to > effective_from),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pack_rule_params CHECK (pack_rule_params_ok(kind, params)),
  CONSTRAINT pack_rule_id_versioned CHECK (id = rule_key || '@' || to_char(effective_from, 'YYYY-MM-DD')),
  CONSTRAINT pack_rule_one_per_kind EXCLUDE USING gist
    (market_pack WITH =, kind WITH =, daterange(effective_from, effective_to) WITH &&)
);
CREATE TRIGGER pack_rule_no_mutation BEFORE UPDATE OR DELETE ON pack_rule
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE pack_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON pack_rule FOR SELECT USING (app_realm() IN ('tenant', 'vendor', 'system'));
GRANT SELECT ON pack_rule TO nmp_app;

-- The pack rule of a kind in force on a date for a market's pack (a row of NULLs when none).
CREATE FUNCTION market_pack_rule(p_market uuid, p_kind text, p_on date) RETURNS pack_rule
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.* FROM market m JOIN pack_rule r ON r.market_pack = m.market_pack AND r.kind = p_kind
  WHERE m.id = p_market AND r.effective_from <= p_on AND (r.effective_to IS NULL OR r.effective_to > p_on)
$$;

-- 4. tax_rule (D-BM-03, D-BM-06): kinds, rates, thresholds, conditions; one year-end form per pack in force; immutable.
CREATE FUNCTION tax_rule_conditions_ok(p_kind text, c jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'withholding' THEN
      jsonb_keys_ok(c, '{}', '{entity_types,residency}')
      AND (NOT (c ? 'entity_types') OR jsonb_string_set_ok(c -> 'entity_types', '{individual,company,partnership,other}', ''))
      AND (NOT (c ? 'residency') OR jsonb_string_set_ok(c -> 'residency', NULL, '^[A-Z]{2}$'))
    WHEN 'year_end_form' THEN
      jsonb_keys_ok(c, '{form_type,title}', '{min_gross_minor}')
      AND coalesce(jsonb_typeof(c -> 'form_type') = 'string' AND c ->> 'form_type' ~ '^[A-Z0-9-]{1,40}$', false)
      AND jsonb_text_between(c -> 'title', 1, 200)
      AND (NOT (c ? 'min_gross_minor')
           OR coalesce(jsonb_typeof(c -> 'min_gross_minor') = 'string' AND c ->> 'min_gross_minor' ~ '^[0-9]{1,18}$', false))
    ELSE false
  END
$$;

ALTER TABLE tax_rule
  ADD CONSTRAINT tax_rule_kind CHECK (kind IN ('withholding', 'year_end_form')),
  ADD CONSTRAINT tax_rule_rate CHECK (rate IS NULL OR rate BETWEEN 0 AND 1),
  ADD CONSTRAINT tax_rule_missing_id_rate CHECK (missing_id_rate IS NULL OR (rate IS NOT NULL AND missing_id_rate BETWEEN 0 AND 1)),
  ADD CONSTRAINT tax_rule_threshold CHECK (
    (threshold_minor IS NULL) = (threshold_basis IS NULL) AND (threshold_minor IS NULL OR (threshold_minor >= 0 AND rate IS NOT NULL))
    AND (threshold_basis IS NULL OR threshold_basis IN ('prior_year_payer_total', 'current_year_cumulative'))),
  ADD CONSTRAINT tax_rule_withholding_rounding CHECK (kind <> 'withholding' OR rate IS NULL OR rounding IN ('half_up', 'half_even')),
  ADD CONSTRAINT tax_rule_year_end_form CHECK (
    kind <> 'year_end_form' OR (rate IS NULL AND missing_id_rate IS NULL AND threshold_minor IS NULL AND rounding = 'none')),
  ADD CONSTRAINT tax_rule_conditions CHECK (tax_rule_conditions_ok(kind, conditions)),
  ADD CONSTRAINT tax_rule_one_year_end_form EXCLUDE USING gist
    (market_pack WITH =, daterange(effective_from, effective_to) WITH &&) WHERE (kind = 'year_end_form');
CREATE TRIGGER tax_rule_no_mutation BEFORE UPDATE OR DELETE ON tax_rule
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 5. The rules of a pack in force on a date: guardrail, tax and the pack_rule kinds (same signature and columns as 0101).
CREATE OR REPLACE FUNCTION market_pack_rules(p_pack text, p_on date)
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
    UNION ALL
    SELECT k.kind, k.id, k.title, k.mandatory, k.basis, k.basis_status, k.source_ref, k.reviewed_by,
           k.reviewed_at, k.effective_from, k.effective_to
    FROM pack_rule k
    WHERE k.market_pack = p_pack AND k.effective_from <= p_on AND (k.effective_to IS NULL OR k.effective_to > p_on)
  ) AS r (kind, id, title, mandatory, basis, basis_status, source_ref, reviewed_by, reviewed_at, effective_from,
          effective_to)
  ORDER BY r.kind, r.id
$$;
