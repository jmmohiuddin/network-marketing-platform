-- B2 participants (PLAN B2 sections 1.0, 1.1 and the document part of 1.7): helpers shared by the B2 tables, participant
-- types with approval (D-B2-09), participants, effective-dated types, hashed duplicate signals (D-B2-10), agreement
-- versions and acceptances (D-B2-15). Recipe of 0001-0109: composite tenant keys, apply_tenant_rls, minimal grants,
-- guards for the runtime role with the owner (migrations, test fixtures) exempt where stated.

-- 1. Helpers (PLAN 1.0).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The actor kind of the transaction (lib/db.ts sets app.actor_type); unset = the platform itself. Support sessions are
-- read-only, so 'vendor_user' never writes a B2 row: the actor-pair CHECKs refuse it.
CREATE FUNCTION app_actor_type() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.actor_type', true), ''), 'system')
$$;

-- E-ADR-32 (spike definition): the first k levels of a path, for the prefix GiST index of path_node.
CREATE FUNCTION ltree_prefix(p ltree, k int) RETURNS ltree LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN nlevel(p) <= k THEN p ELSE subpath(p, 0, k) END
$$;

CREATE FUNCTION to_base36(p bigint) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  n bigint := p;
  result text := '';
BEGIN
  IF n < 0 THEN
    RAISE EXCEPTION 'to_base36 takes a non-negative number' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  LOOP
    result := substr(digits, (n % 36)::int + 1, 1) || result;
    n := n / 36;
    EXIT WHEN n = 0;
  END LOOP;
  RETURN result;
END $$;

-- Position labels (D-B2-07): base 36 of this sequence, at most 6 characters (36^6 - 1).
CREATE SEQUENCE position_label_seq MAXVALUE 2176782335;
GRANT USAGE ON SEQUENCE position_label_seq TO nmp_app;

-- History rows: the columns given as trigger arguments go from NULL to a value once; nothing else changes; no DELETE.
CREATE FUNCTION set_once_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on % is not allowed (history)', TG_TABLE_NAME;
  END IF;
  IF to_jsonb(NEW) - TG_ARGV::text[] IS DISTINCT FROM to_jsonb(OLD) - TG_ARGV::text[] THEN
    RAISE EXCEPTION 'on %, only % may change', TG_TABLE_NAME, array_to_string(TG_ARGV, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  FOREACH col IN ARRAY TG_ARGV::text[] LOOP
    IF to_jsonb(OLD) -> col <> 'null'::jsonb AND to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION '%.% is set once', TG_TABLE_NAME, col USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- 2. Documents (PLAN 1.7): a document is referenced once, by its uploader, as the class the referencing object needs.
-- The one-argument form keeps its B1 meaning (evidence).
CREATE FUNCTION assert_document_referenceable(p_document_id uuid, p_class text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('document_reference:' || p_document_id, 0));
  IF NOT EXISTS (SELECT 1 FROM document d
                 WHERE d.id = p_document_id AND d.class = p_class AND d.uploaded_by = app_user_id())
     OR EXISTS (SELECT 1 FROM document_references(p_document_id)) THEN
    RAISE EXCEPTION 'document % cannot be referenced here', p_document_id USING ERRCODE = 'no_data_found';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION assert_document_referenceable(p_document_id uuid) RETURNS void LANGUAGE sql AS $$
  SELECT assert_document_referenceable(p_document_id, 'evidence')
$$;

-- Arguments: the column, and the document class (default evidence).
CREATE OR REPLACE FUNCTION document_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_document_referenceable((to_jsonb(NEW) ->> TG_ARGV[0])::uuid, coalesce(TG_ARGV[1], 'evidence'));
  RETURN NEW;
END $$;

-- 3. participant_type (D-B2-09): proposed by a Tenant admin, decided once by someone else with an approval of it.
-- Flags never change (a change is a new code).
CREATE TABLE participant_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  can_earn boolean NOT NULL,
  counts_as_end_customer boolean NOT NULL,
  can_sponsor boolean NOT NULL,
  can_hold_positions boolean NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'active', 'rejected', 'withdrawn')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(trim(decision_reason)) BETWEEN 1 AND 500),
  approval_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participant_type_decider_is_not_requester CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT participant_type_decided_at CHECK ((state = 'pending') = (decided_at IS NULL)),
  CONSTRAINT participant_type_decision_complete
    CHECK (state NOT IN ('active', 'rejected') OR (approval_id IS NOT NULL AND decided_by IS NOT NULL)),
  CONSTRAINT participant_type_withdrawal
    CHECK (state <> 'withdrawn' OR (decided_by IS NULL AND approval_id IS NULL AND decision_reason IS NOT NULL)),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX participant_type_code_in_use ON participant_type (tenant_id, code) WHERE state IN ('pending', 'active');

CREATE TRIGGER participant_type_created_pending BEFORE INSERT ON participant_type
  FOR EACH ROW WHEN (current_user = 'nmp_app')
  EXECUTE FUNCTION pending_request_insert_guard('decided_by', 'decided_at', 'decision_reason', 'approval_id');

-- pending -> active | rejected (decider + the decider's own approval of this type) | withdrawn (by the requester).
CREATE FUNCTION participant_type_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  decision_fields constant text[] := ARRAY['state', 'decided_by', 'decided_at', 'decision_reason', 'approval_id'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on participant_type is not allowed (decisions are history)';
  END IF;
  IF (OLD.state = 'pending' AND NEW.state IN ('active', 'rejected', 'withdrawn')
      AND to_jsonb(NEW) - decision_fields = to_jsonb(OLD) - decision_fields) IS NOT TRUE THEN
    RAISE EXCEPTION 'participant_type changes once, from pending to its decision or withdrawal'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state IN ('active', 'rejected') AND NOT approval_decides(NEW.approval_id, 'participant_type', NEW.id,
       CASE NEW.state WHEN 'active' THEN 'approved' ELSE 'rejected' END, NEW.decided_by) THEN
    RAISE EXCEPTION 'participant_type is decided with the decider''s own approval of it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_user = 'nmp_app' AND app_user_id() IS DISTINCT FROM coalesce(NEW.decided_by, NEW.requested_by) THEN
    RAISE EXCEPTION 'participant_type is decided by the acting user and withdrawn by its requester'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participant_type_decided_once BEFORE UPDATE OR DELETE ON participant_type
  FOR EACH ROW EXECUTE FUNCTION participant_type_guard();

-- 4. participant (FR-PAR-001). The lifecycle lives on positions (D-B2-06): a participant is active or merged.
-- Actor pair (D-B2-03): key callers write it, so created_by has no key to user_account.
CREATE TABLE participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  external_ref text NOT NULL CHECK (external_ref ~ '^[\x21-\x7e]{1,100}$'),
  account_type text NOT NULL CHECK (account_type IN ('individual', 'joint', 'entity')),
  market_id uuid NOT NULL,
  display_name text CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 200),
  contact jsonb CHECK (contact IS NULL OR jsonb_typeof(contact) = 'object'),
  identity_doc_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged')),
  merged_into_id uuid,
  pseudonymised_at timestamptz,
  enrolled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CONSTRAINT participant_merged_into CHECK ((status = 'merged') = (merged_into_id IS NOT NULL)),
  CONSTRAINT participant_not_merged_into_itself CHECK (merged_into_id <> id),
  CONSTRAINT participant_pseudonymised CHECK (pseudonymised_at IS NULL OR (contact IS NULL AND display_name IS NULL)),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, identity_doc_id) REFERENCES document (tenant_id, id),
  FOREIGN KEY (tenant_id, merged_into_id) REFERENCES participant (tenant_id, id),
  UNIQUE (tenant_id, external_ref),
  UNIQUE (tenant_id, id)
);
CREATE INDEX participant_display_name_trgm_idx ON participant USING gin (display_name gin_trgm_ops);
CREATE INDEX participant_market_idx ON participant (tenant_id, market_id);

-- Only a merge changes a participant: active -> merged with the participant it was merged into (FR-PAR-003).
CREATE FUNCTION participant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  merge_fields constant text[] := ARRAY['status', 'merged_into_id'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on participant is not allowed';
  END IF;
  IF (OLD.status = 'active' AND NEW.status = 'merged'
      AND to_jsonb(NEW) - merge_fields = to_jsonb(OLD) - merge_fields) IS NOT TRUE THEN
    RAISE EXCEPTION 'a participant changes only by a merge, once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participant_merged_once BEFORE UPDATE OR DELETE ON participant
  FOR EACH ROW EXECUTE FUNCTION participant_guard();

-- 5. participant_type_assignment: exactly one type at a time (EXCLUDE), only active types, closed once.
CREATE TABLE participant_type_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  participant_id uuid NOT NULL,
  type_id uuid NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT participant_type_assignment_no_overlap EXCLUDE USING gist
    (tenant_id WITH =, participant_id WITH =, tstzrange(valid_from, valid_to) WITH &&),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES participant_type (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX participant_type_assignment_participant_idx ON participant_type_assignment (participant_id, valid_from);

CREATE FUNCTION participant_type_assignment_type_active() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM participant_type t
                 WHERE t.tenant_id = NEW.tenant_id AND t.id = NEW.type_id AND t.state = 'active') THEN
    RAISE EXCEPTION 'only an active participant type is assigned' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participant_type_assignment_type_active BEFORE INSERT ON participant_type_assignment
  FOR EACH ROW EXECUTE FUNCTION participant_type_assignment_type_active();
CREATE TRIGGER participant_type_assignment_closed_once BEFORE UPDATE OR DELETE ON participant_type_assignment
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('valid_to');

-- 6. participant_signal (D-B2-10): HMAC-SHA256 digests only, never the raw value.
CREATE TABLE participant_signal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  participant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('identity_ref', 'payment_fingerprint', 'address', 'device_id')),
  digest bytea NOT NULL CHECK (length(digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  UNIQUE (participant_id, kind, digest),
  UNIQUE (tenant_id, id)
);
CREATE INDEX participant_signal_digest_idx ON participant_signal (tenant_id, kind, digest);
CREATE TRIGGER participant_signal_no_mutation BEFORE UPDATE OR DELETE ON participant_signal
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 7. agreement_version (D-B2-15): published by the acting user with an agreement document it uploaded.
CREATE TABLE agreement_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 50),
  document_id uuid NOT NULL,
  acceptance_required boolean NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  FOREIGN KEY (tenant_id, published_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, market_id, label),
  UNIQUE (tenant_id, id)
);
CREATE INDEX agreement_version_current_idx ON agreement_version (tenant_id, market_id, published_at DESC);
CREATE TRIGGER agreement_version_no_mutation BEFORE UPDATE OR DELETE ON agreement_version
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER agreement_version_published_by_actor BEFORE INSERT ON agreement_version
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('published_by');
CREATE TRIGGER document_reference_guard BEFORE INSERT ON agreement_version
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION document_reference_guard('document_id', 'agreement');

-- Deviation from the spec's document_id: an acceptance names the version (D-B2-15, C-B2-5).
CREATE TABLE agreement_acceptance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  participant_id uuid NOT NULL,
  agreement_version_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL,
  evidence jsonb CHECK (evidence IS NULL OR jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, agreement_version_id) REFERENCES agreement_version (tenant_id, id),
  UNIQUE (participant_id, agreement_version_id),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER agreement_acceptance_no_mutation BEFORE UPDATE OR DELETE ON agreement_acceptance
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- D-B1-04: agreement documents are referenced by their version; download access follows it.
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
$$;

SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
  'participant_type', 'participant', 'participant_type_assignment', 'participant_signal', 'agreement_version',
  'agreement_acceptance'
]::regclass[]) AS t;

GRANT SELECT, INSERT ON participant_type, participant, participant_type_assignment, participant_signal,
  agreement_version, agreement_acceptance TO nmp_app;
GRANT UPDATE (state, decided_by, decided_at, decision_reason, approval_id) ON participant_type TO nmp_app;
GRANT UPDATE (status, merged_into_id) ON participant TO nmp_app;
GRANT UPDATE (valid_to) ON participant_type_assignment TO nmp_app;
