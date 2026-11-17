-- B2 customer servicing (PLAN B2 section 1.3, FR-CRM-001): one servicer at a time per customer, effective-dated; a NULL
-- position is the company.
CREATE TABLE customer_servicing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  customer_id uuid NOT NULL,
  servicing_position_id uuid,
  source text NOT NULL CHECK (source IN ('enrolment', 'first_order', 'manual', 'reassignment', 'migration')),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  case_id uuid,
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT customer_servicing_no_overlap EXCLUDE USING gist
    (tenant_id WITH =, customer_id WITH =, tstzrange(valid_from, valid_to) WITH &&),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, servicing_position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX customer_servicing_customer_idx ON customer_servicing (customer_id, valid_from);
CREATE INDEX customer_servicing_current_idx ON customer_servicing (tenant_id, servicing_position_id) WHERE valid_to IS NULL;
CREATE TRIGGER customer_servicing_closed_once BEFORE UPDATE OR DELETE ON customer_servicing
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('valid_to');

SELECT apply_tenant_rls('customer_servicing');
GRANT SELECT, INSERT ON customer_servicing TO nmp_app;
GRANT UPDATE (valid_to) ON customer_servicing TO nmp_app;
