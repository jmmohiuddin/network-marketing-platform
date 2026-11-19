-- B4 payee tax profile (PLAN B4 section 1.4; D-B4-17): dated versions, the tax id sealed with only a mask readable; a new
-- version closes the previous one at the same instant (no overlap). Not a case (C-B4-7).
CREATE TABLE tax_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  participant_id uuid NOT NULL,
  residency char(2) CHECK (residency ~ '^[A-Z]{2}$'),
  entity_type text CHECK (entity_type IN ('individual', 'company', 'partnership', 'other')),
  tax_id_sealed text,
  tax_id_masked text CHECK (tax_id_masked IS NULL OR length(tax_id_masked) BETWEEN 1 AND 40),
  prior_year_totals jsonb, -- B-MKT
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_profile_tax_id CHECK ((tax_id_sealed IS NULL) = (tax_id_masked IS NULL)),
  CONSTRAINT tax_profile_validity CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT tax_profile_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, participant_id WITH =, tstzrange(valid_from, valid_to) WITH &&),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER tax_profile_closed_once BEFORE UPDATE OR DELETE ON tax_profile
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('valid_to');
CREATE TRIGGER tax_profile_created_by_actor BEFORE INSERT ON tax_profile
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('created_by');

SELECT apply_tenant_rls('tax_profile');

GRANT SELECT, INSERT ON tax_profile TO nmp_app;
GRANT UPDATE (valid_to) ON tax_profile TO nmp_app;
