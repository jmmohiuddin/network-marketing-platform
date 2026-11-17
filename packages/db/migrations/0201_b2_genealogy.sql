-- B2 genealogy (PLAN B2 section 1.2; D-B2-01, D-B2-06, D-B2-07; E-ADR-32, E-ADR-33): positions with their status
-- history and effective-dated owners, the bitemporal relationship rows with their invariants in the database, and the
-- path read model.

-- 1. position (FR-GEN-001): a node of the tree; only its status changes (history in position_status_history).
CREATE TABLE position (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  position_ref text NOT NULL CHECK (position_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  label text NOT NULL DEFAULT to_base36(nextval('position_label_seq')) CHECK (label ~ '^[0-9a-z]{1,6}$'),
  market_id uuid NOT NULL,
  brand_id uuid,
  plan_id uuid, -- key to plan arrives in B3
  status text NOT NULL CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  status_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand (tenant_id, id),
  UNIQUE (tenant_id, position_ref),
  UNIQUE (tenant_id, label),
  UNIQUE (tenant_id, id)
);

CREATE FUNCTION position_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  status_fields constant text[] := ARRAY['status', 'status_from'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on position is not allowed (terminate it instead)';
  END IF;
  IF to_jsonb(NEW) - status_fields IS DISTINCT FROM to_jsonb(OLD) - status_fields THEN
    RAISE EXCEPTION 'only a position''s status changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER position_status_only BEFORE UPDATE OR DELETE ON position FOR EACH ROW EXECUTE FUNCTION position_guard();

-- 2. position_status_history (DATABASE C-8): every status change, dated, with reason and actor.
CREATE TABLE position_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  position_id uuid NOT NULL,
  from_status text CHECK (from_status IN ('pending', 'active', 'suspended', 'terminated')),
  to_status text NOT NULL CHECK (to_status IN ('pending', 'active', 'suspended', 'terminated')),
  effective_from timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  case_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  FOREIGN KEY (tenant_id, position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX position_status_history_position_idx ON position_status_history (position_id, effective_from);
CREATE TRIGGER position_status_history_no_mutation BEFORE UPDATE OR DELETE ON position_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 3. position_ownership: one owner at a time per position (EXCLUDE), closed once.
CREATE TABLE position_ownership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  position_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  case_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT position_ownership_no_overlap EXCLUDE USING gist
    (tenant_id WITH =, position_id WITH =, tstzrange(valid_from, valid_to) WITH &&),
  FOREIGN KEY (tenant_id, position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX position_ownership_position_idx ON position_ownership (position_id, valid_from);
CREATE INDEX position_ownership_participant_idx ON position_ownership (tenant_id, participant_id);
CREATE TRIGGER position_ownership_closed_once BEFORE UPDATE OR DELETE ON position_ownership
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('valid_to');

-- 4. relationship (FR-GEN-002): bitemporal sponsor/placement rows. valid_* = business time, recorded_at/superseded_at
-- = system time. Every row comes from an enrolment, a case or a rule.
CREATE TABLE relationship (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  kind text NOT NULL CHECK (kind IN ('sponsor', 'placement')),
  parent_position_id uuid NOT NULL,
  child_position_id uuid NOT NULL,
  leg text,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  event_type text NOT NULL CHECK (event_type IN ('enrolment', 'change', 'correction', 'rule', 'migration')),
  case_id uuid,
  rule_id text,
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CHECK (parent_position_id <> child_position_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT relationship_leg CHECK (leg IS NULL OR (kind = 'placement' AND leg ~ '^[1-9][0-9]?$')),
  CONSTRAINT relationship_rule CHECK ((event_type = 'rule') = (rule_id IS NOT NULL)),
  CONSTRAINT relationship_case CHECK (event_type NOT IN ('change', 'correction') OR case_id IS NOT NULL),
  FOREIGN KEY (tenant_id, parent_position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, child_position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX relationship_child_idx ON relationship (tenant_id, kind, child_position_id, valid_from);
CREATE INDEX relationship_parent_idx ON relationship (tenant_id, kind, parent_position_id) WHERE superseded_at IS NULL;
-- E-ADR-33: at most one open current row per child and kind (the trigger below covers closed ranges).
CREATE UNIQUE INDEX relationship_one_open_parent ON relationship (tenant_id, kind, child_position_id)
  WHERE superseded_at IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX relationship_one_open_leg ON relationship (tenant_id, parent_position_id, leg)
  WHERE kind = 'placement' AND leg IS NOT NULL AND superseded_at IS NULL AND valid_to IS NULL;

-- D-B2-01: under the per-tenant, per-kind tree lock, a new row must not overlap a current row of the same child, must
-- not take a leg in use during its range, and must not make the child its own ancestor. SQLSTATEs (PLAN 4.3): GN001
-- cycle, GN002 overlap, GN003 leg taken. The statements after the lock read what earlier lock holders committed (READ
-- COMMITTED, VOLATILE function), so concurrent writers of one tree are serialised.
CREATE FUNCTION relationship_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('genealogy:' || NEW.tenant_id || ':' || NEW.kind, 0));
  IF EXISTS (SELECT 1 FROM relationship r
             WHERE r.tenant_id = NEW.tenant_id AND r.kind = NEW.kind AND r.child_position_id = NEW.child_position_id
               AND r.superseded_at IS NULL
               AND tstzrange(r.valid_from, r.valid_to) && tstzrange(NEW.valid_from, NEW.valid_to)) THEN
    RAISE EXCEPTION 'position % already has a % parent in this period', NEW.child_position_id, NEW.kind
      USING ERRCODE = 'GN002';
  END IF;
  IF NEW.leg IS NOT NULL AND EXISTS (
       SELECT 1 FROM relationship r
       WHERE r.tenant_id = NEW.tenant_id AND r.kind = 'placement' AND r.parent_position_id = NEW.parent_position_id
         AND r.leg = NEW.leg AND r.superseded_at IS NULL
         AND tstzrange(r.valid_from, r.valid_to) && tstzrange(NEW.valid_from, NEW.valid_to)) THEN
    RAISE EXCEPTION 'leg % of position % is taken', NEW.leg, NEW.parent_position_id USING ERRCODE = 'GN003';
  END IF;
  -- shortcut: may refuse a move whose ancestor chain mixes rows from disjoint valid ranges, upgrade to per-change-point
  -- checks if a tenant hits it.
  IF EXISTS (
       WITH RECURSIVE ancestor (position_id) AS (
         SELECT NEW.parent_position_id
         UNION
         SELECT r.parent_position_id FROM relationship r JOIN ancestor a ON r.child_position_id = a.position_id
         WHERE r.tenant_id = NEW.tenant_id AND r.kind = NEW.kind AND r.superseded_at IS NULL
           AND (r.valid_to IS NULL OR r.valid_to > NEW.valid_from))
       SELECT 1 FROM ancestor WHERE position_id = NEW.child_position_id) THEN
    RAISE EXCEPTION 'position % would become its own % ancestor', NEW.child_position_id, NEW.kind
      USING ERRCODE = 'GN001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER relationship_guard BEFORE INSERT ON relationship FOR EACH ROW EXECUTE FUNCTION relationship_guard();
CREATE TRIGGER relationship_closed_once BEFORE UPDATE OR DELETE ON relationship
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('valid_to', 'superseded_at');

-- 5. Path read model (D-B2-07): one version per (tenant, kind); stale_since is set by every structural write.
CREATE TABLE path_model (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  kind text NOT NULL CHECK (kind IN ('sponsor', 'placement')),
  version bigint NOT NULL DEFAULT 0,
  stale_since timestamptz,
  built_at timestamptz,
  PRIMARY KEY (tenant_id, kind)
);

-- Derived, never a source of truth (deviation C-B2-2: version and parent in the key and columns).
CREATE TABLE path_node (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  kind text NOT NULL CHECK (kind IN ('sponsor', 'placement')),
  model_version bigint NOT NULL,
  position_id uuid NOT NULL,
  parent_position_id uuid,
  path ltree NOT NULL,
  depth int NOT NULL CHECK (depth >= 0),
  subtree_count int NOT NULL CHECK (subtree_count >= 0),
  PRIMARY KEY (tenant_id, kind, model_version, position_id),
  FOREIGN KEY (tenant_id, position_id) REFERENCES position (tenant_id, id)
);
CREATE INDEX path_node_prefix_gist ON path_node USING gist (ltree_prefix(path, 128));
CREATE INDEX path_node_parent_idx ON path_node (tenant_id, kind, model_version, parent_position_id);

SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
  'position', 'position_status_history', 'position_ownership', 'relationship', 'path_model', 'path_node'
]::regclass[]) AS t;

GRANT SELECT, INSERT ON position, position_status_history, position_ownership, relationship, path_model TO nmp_app;
GRANT UPDATE (status, status_from) ON position TO nmp_app;
GRANT UPDATE (valid_to) ON position_ownership TO nmp_app;
GRANT UPDATE (valid_to, superseded_at) ON relationship TO nmp_app;
GRANT UPDATE (version, stale_since, built_at) ON path_model TO nmp_app;
GRANT SELECT, INSERT, DELETE ON path_node TO nmp_app;
