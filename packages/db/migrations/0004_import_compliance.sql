-- AUD document, IMP and CPL tables. cpl_fact_* are not partitioned in release A (E-ADR-12).
-- References between tenant rows are composite (tenant_id, <id>), as explained in 0002.

CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  class text NOT NULL CHECK (class IN ('evidence', 'agreement', 'tax_form', 'export', 'sensitive_id', 'disclosure')),
  storage_key text NOT NULL,
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  uploaded_by uuid,
  version int NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  FOREIGN KEY (tenant_id, uploaded_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX document_class_idx ON document (tenant_id, class);

CREATE TABLE import_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  version int NOT NULL CHECK (version > 0),
  mappings jsonb NOT NULL,
  notes text,
  -- Value list is not in the source documents; MVP_A_SPEC proposes draft -> approved.
  state text NOT NULL CHECK (state IN ('draft', 'approved')),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CHECK (state <> 'approved' OR approved_by IS NOT NULL),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, version),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER import_mapping_approved_immutable BEFORE UPDATE OR DELETE ON import_mapping
  FOR EACH ROW WHEN (OLD.state = 'approved') EXECUTE FUNCTION forbid_mutation('approved versions are immutable');

CREATE TABLE import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('overlay', 'migration')),
  period_from date NOT NULL,
  period_to date NOT NULL,
  state text NOT NULL CHECK (state IN ('uploaded', 'rejected', 'validated', 'mapped', 'loaded', 'superseded')),
  mapping_id uuid,
  row_counts jsonb,
  control_totals jsonb,
  superseded_by uuid,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CHECK (period_to >= period_from),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, mapping_id) REFERENCES import_mapping (tenant_id, id),
  FOREIGN KEY (tenant_id, superseded_by) REFERENCES import_batch (tenant_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id, uploaded_by) REFERENCES user_account (tenant_id, id)
);
CREATE INDEX import_batch_period_idx ON import_batch (tenant_id, market_id, period_from, state);

CREATE TABLE import_row_error (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  batch_id uuid NOT NULL,
  file text NOT NULL,
  row_no int,
  column_name text,
  code text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batch (tenant_id, id)
);
CREATE INDEX import_row_error_batch_idx ON import_row_error (batch_id, code);

-- tenant.region is immutable after the first data load (a batch that reached 'loaded').
-- SECURITY DEFINER: the vendor realm that updates tenant rows cannot see import_batch.
CREATE FUNCTION tenant_region_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM import_batch WHERE tenant_id = OLD.id AND state IN ('loaded', 'superseded')) THEN
    RAISE EXCEPTION 'tenant.region cannot change after the first data load';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_region_immutable BEFORE UPDATE OF region ON tenant
  FOR EACH ROW WHEN (NEW.region IS DISTINCT FROM OLD.region) EXECUTE FUNCTION tenant_region_guard();

CREATE TABLE cpl_fact_participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  source text NOT NULL CHECK (source IN ('import', 'native')),
  batch_id uuid,
  participant_ref text NOT NULL,
  type_code text NOT NULL,
  counts_as_end_customer boolean NOT NULL,
  can_earn boolean NOT NULL,
  enrolled_month date NOT NULL,
  servicing_ref text,
  market_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CHECK ((source = 'import') = (batch_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batch (tenant_id, id),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  UNIQUE NULLS NOT DISTINCT (tenant_id, batch_id, participant_ref)
);

CREATE TABLE cpl_fact_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  source text NOT NULL CHECK (source IN ('import', 'native')),
  batch_id uuid,
  order_ref text NOT NULL,
  order_date date NOT NULL,
  buyer_ref text NOT NULL,
  amount_minor bigint NOT NULL,
  volume_minor bigint NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('customer', 'personal', 'resale', 'enrolment', 'unknown')),
  is_starter_kit boolean NOT NULL,
  refunded_minor bigint NOT NULL,
  refund_month date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CHECK ((source = 'import') = (batch_id IS NOT NULL)),
  CHECK (refunded_minor <= amount_minor),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batch (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, batch_id, order_ref)
);
CREATE INDEX cpl_fact_order_date_idx ON cpl_fact_order (tenant_id, order_date);

CREATE TABLE cpl_fact_payout_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  source text NOT NULL CHECK (source IN ('import', 'native')),
  batch_id uuid,
  line_ref text NOT NULL,
  pay_month date NOT NULL,
  payee_ref text NOT NULL,
  bonus_type text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN
    ('retail_sale', 'downline_volume', 'enrolment_order', 'pool', 'match', 'clawback', 'other', 'unknown')),
  source_order_ref text,
  amount_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CHECK ((source = 'import') = (batch_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batch (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, batch_id, line_ref)
);
CREATE INDEX cpl_fact_payout_line_month_idx ON cpl_fact_payout_line (tenant_id, pay_month, source_kind);

CREATE TABLE compliance_report_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  method_version text NOT NULL,
  mapping_id uuid,
  settings_version_id uuid,
  input_refs jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('computing', 'ready', 'outdated', 'failed')),
  created_by uuid NOT NULL,
  inputs_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, mapping_id) REFERENCES import_mapping (tenant_id, id),
  FOREIGN KEY (tenant_id, settings_version_id) REFERENCES tenant_setting_version (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);
CREATE INDEX compliance_report_snapshot_period_idx
  ON compliance_report_snapshot (tenant_id, market_id, period_from, period_to);

-- Immutable except state: computing -> ready | failed | outdated, ready -> outdated.
CREATE FUNCTION compliance_report_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on compliance_report_snapshot is not allowed (immutable)';
  END IF;
  IF to_jsonb(NEW) - 'state' <> to_jsonb(OLD) - 'state' THEN
    RAISE EXCEPTION 'UPDATE on compliance_report_snapshot may change only state';
  END IF;
  IF NOT ((OLD.state = 'computing' AND NEW.state IN ('ready', 'failed', 'outdated'))
          OR (OLD.state = 'ready' AND NEW.state = 'outdated')) THEN
    RAISE EXCEPTION 'compliance_report_snapshot state cannot change from % to %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compliance_report_snapshot_immutable BEFORE UPDATE OR DELETE ON compliance_report_snapshot
  FOR EACH ROW EXECUTE FUNCTION compliance_report_snapshot_guard();

CREATE TABLE compliance_figure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  snapshot_id uuid NOT NULL,
  report text NOT NULL CHECK (report IN ('R1', 'R2', 'R3', 'R4', 'R5')),
  period date,
  key text NOT NULL,
  value_num numeric(20, 6),
  numerator bigint,
  denominator bigint,
  population_count int,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES compliance_report_snapshot (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (snapshot_id, report, period, key)
);
