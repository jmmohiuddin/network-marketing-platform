-- B1 case framework (FR-CAS-001, D-B1-13; PLAN B1 section 1.6). Types arrive with their subjects in later
-- increments; the value list is DATABASE section 7.

CREATE TABLE case_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  type text NOT NULL CHECK (type IN ('genealogy_change', 'genealogy_correction', 'duplicate', 'transfer', 'adjustment',
    'dispute', 'restatement', 'returned_payment', 'write_off', 'bank_detail', 'grievance', 'privacy')),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  reason_code text NOT NULL,
  state text NOT NULL CHECK (state IN ('open', 'submitted', 'approved', 'rejected', 'withdrawn')),
  payload jsonb NOT NULL,
  effect_preview jsonb,
  due_at timestamptz,
  market_id uuid,
  opened_by uuid NOT NULL, -- B5 portal-opened cases revisit
  assigned_to uuid,
  submitted_by uuid,
  submitted_at timestamptz,
  decided_at timestamptz,
  approval_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_file_decision_approved CHECK (state NOT IN ('approved', 'rejected') OR approval_id IS NOT NULL),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, opened_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, assigned_to) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, submitted_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX case_file_type_state_idx ON case_file (tenant_id, type, state);
CREATE INDEX case_file_subject_idx ON case_file (tenant_id, subject_type, subject_id);
CREATE INDEX case_file_due_idx ON case_file (tenant_id, due_at) WHERE state = 'submitted';

-- What a case is about never changes; its state moves open -> submitted -> approved | rejected, or open | submitted ->
-- withdrawn, and a decided or withdrawn case is final.
CREATE FUNCTION case_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  RETURN NEW;
END $$;
CREATE TRIGGER case_file_lifecycle BEFORE UPDATE OR DELETE ON case_file FOR EACH ROW EXECUTE FUNCTION case_file_guard();

-- The immutable history of a case (AC-CAS1-5).
CREATE TABLE case_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  case_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  kind text NOT NULL CHECK (kind IN ('opened', 'evidence_added', 'assigned', 'submitted', 'approved', 'rejected',
    'withdrawn', 'updated')),
  data jsonb,
  FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES user_account (tenant_id, id)
);
CREATE INDEX case_event_case_idx ON case_event (case_id, occurred_at);
CREATE TRIGGER case_event_no_mutation BEFORE UPDATE OR DELETE ON case_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE case_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  case_id uuid NOT NULL,
  document_id uuid NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  FOREIGN KEY (tenant_id, added_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (case_id, document_id)
);
CREATE TRIGGER case_evidence_no_mutation BEFORE UPDATE OR DELETE ON case_evidence
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['case_file', 'case_event', 'case_evidence']::regclass[]) AS t;

GRANT SELECT, INSERT ON case_file, case_event, case_evidence TO nmp_app;
GRANT UPDATE (state, reason_code, payload, effect_preview, due_at, assigned_to, submitted_by, submitted_at, decided_at,
  approval_id) ON case_file TO nmp_app;
