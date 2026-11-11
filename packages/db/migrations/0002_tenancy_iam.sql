-- TEN and IAM tables (DATABASE.md section 6) plus the in-app identity tables of E-ADR-02.
--
-- A reference from one tenant-scoped row to another is a composite key (tenant_id, <id>) against
-- UNIQUE (tenant_id, id) on the target. Referential checks bypass RLS, so a single-column key would
-- accept another tenant's row and tell an unknown id from a foreign one.

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  region text NOT NULL,
  isolation_tier text NOT NULL CHECK (isolation_tier IN ('pooled', 'dedicated')),
  db_route text NOT NULL,
  state text NOT NULL CHECK (state IN ('provisioning', 'implementation', 'live', 'archived')),
  dpa_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE market (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  code text NOT NULL,
  currency char(3) NOT NULL,
  minor_unit smallint NOT NULL CHECK (minor_unit >= 0),
  time_zone text NOT NULL,
  languages text[] NOT NULL,
  market_pack text NOT NULL,
  state text NOT NULL CHECK (state IN ('draft', 'live', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE user_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenant (id),
  realm text NOT NULL CHECK (realm IN ('tenant', 'portal', 'vendor')),
  idp_subject text NOT NULL,
  email text NOT NULL CHECK (email = lower(email)),
  display_name text,
  mfa_enrolled boolean NOT NULL DEFAULT false,
  -- Value list is not in the source documents; provisional.
  state text NOT NULL CHECK (state IN ('invited', 'active', 'locked', 'deactivated')),
  participant_id uuid, -- FK to participant is added in the release B migration
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT user_account_vendor_has_no_tenant CHECK ((realm = 'vendor') = (tenant_id IS NULL)),
  UNIQUE (realm, idp_subject),
  UNIQUE NULLS NOT DISTINCT (tenant_id, email),
  UNIQUE (tenant_id, id),
  UNIQUE (id, realm) -- target of session (user_id, realm)
);

CREATE TABLE approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  preparer_id uuid NOT NULL,
  approver_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text,
  factor_verified_at timestamptz,
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT approval_approver_is_not_preparer CHECK (approver_id <> preparer_id),
  FOREIGN KEY (tenant_id, preparer_id) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approver_id) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX approval_object_idx ON approval (tenant_id, object_type, object_id);
CREATE TRIGGER approval_no_mutation BEFORE UPDATE OR DELETE ON approval
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE tenant_setting_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  version int NOT NULL CHECK (version > 0),
  effective_from timestamptz NOT NULL,
  settings jsonb NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL,
  approval_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  UNIQUE (tenant_id, version),
  UNIQUE (tenant_id, id)
);
CREATE INDEX tenant_setting_version_effective_idx ON tenant_setting_version (tenant_id, effective_from);
CREATE TRIGGER tenant_setting_version_no_mutation BEFORE UPDATE OR DELETE ON tenant_setting_version
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenant (id),
  name text NOT NULL,
  permissions text[] NOT NULL,
  is_base boolean NOT NULL,
  mfa_required boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT role_base_has_no_tenant CHECK (NOT is_base OR tenant_id IS NULL),
  UNIQUE NULLS NOT DISTINCT (tenant_id, name)
);

CREATE TABLE role_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES role (id), -- tenant match: role_assignment_role_guard
  market_ids uuid[],
  brand_ids uuid[],
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  approval_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  FOREIGN KEY (tenant_id, user_id) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id)
);
CREATE INDEX role_assignment_user_idx ON role_assignment (tenant_id, user_id);

-- role_id may be a platform base role (tenant_id NULL), so it cannot be a composite key. Runs before the
-- foreign-key check, so an unknown role and another tenant's role are refused with the same error.
CREATE FUNCTION role_assignment_role_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM role r
    WHERE r.id = NEW.role_id AND (r.tenant_id = NEW.tenant_id OR (r.tenant_id IS NULL AND r.is_base))
  ) THEN
    RAISE EXCEPTION 'role_assignment.role_id must be a base role or a role of the same tenant'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER role_assignment_role_in_tenant BEFORE INSERT OR UPDATE OF role_id, tenant_id ON role_assignment
  FOR EACH ROW EXECUTE FUNCTION role_assignment_role_guard();

CREATE TABLE support_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  requester_id uuid NOT NULL REFERENCES user_account (id), -- a vendor user: policy vendor_request (0006)
  reason text NOT NULL,
  scope jsonb NOT NULL,
  requested_minutes int NOT NULL CHECK (requested_minutes > 0),
  state text NOT NULL CHECK (state IN ('requested', 'approved', 'denied', 'active', 'expired', 'ended')),
  decided_by uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  -- Access exists only after a decision by a user of the tenant who is not the requester, and only
  -- for a window no longer than the minutes on the request.
  FOREIGN KEY (tenant_id, decided_by) REFERENCES user_account (tenant_id, id),
  CONSTRAINT support_session_decider_is_not_requester CHECK (decided_by IS DISTINCT FROM requester_id),
  CONSTRAINT support_session_access_needs_decision CHECK (state NOT IN ('approved', 'active') OR decided_by IS NOT NULL),
  CONSTRAINT support_session_active_has_window CHECK (state <> 'active' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)),
  CONSTRAINT support_session_window_within_request CHECK (ends_at - starts_at <= make_interval(mins => requested_minutes))
);
CREATE INDEX support_session_state_idx ON support_session (tenant_id, state);

-- SECURITY_IAM_TENANCY 5.1: approving, denying and starting a session belong to the tenant. The vendor
-- realm files requests and ends active sessions (policies in 0006); this pins every other column on
-- that ending update, and lets ends_at only move earlier.
CREATE FUNCTION support_session_vendor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ending_fields constant text[] := ARRAY['state', 'ends_at'];
BEGIN
  IF (OLD.state = 'active' AND NEW.state = 'ended' AND NEW.ends_at <= OLD.ends_at
      AND to_jsonb(NEW) - ending_fields = to_jsonb(OLD) - ending_fields) IS NOT TRUE THEN
    RAISE EXCEPTION 'the vendor realm may only end an active support session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER support_session_vendor_may_only_end BEFORE UPDATE ON support_session
  FOR EACH ROW WHEN (app_realm() = 'vendor') EXECUTE FUNCTION support_session_vendor_guard();

-- Engineering additions (E-ADR-02): server-side sessions and local credentials.

CREATE TABLE session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32), -- SHA-256 of the opaque token
  user_id uuid NOT NULL,
  tenant_id uuid REFERENCES tenant (id),
  realm text NOT NULL CHECK (realm IN ('tenant', 'portal', 'vendor')),
  assurance_level text NOT NULL CHECK (assurance_level IN ('aal1', 'aal2')),
  mfa_verified_at timestamptz,
  step_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip inet,
  user_agent text,
  CONSTRAINT session_vendor_has_no_tenant CHECK ((realm = 'vendor') = (tenant_id IS NULL)),
  CHECK (expires_at > created_at),
  -- A tenant session belongs to a user of that tenant. Vendor sessions have no tenant and skip this key
  -- (MATCH SIMPLE); the realm key below still ties them to a vendor user. Keep this key first: it is then
  -- checked first, so an unknown user and another tenant's user are refused by the same constraint.
  FOREIGN KEY (tenant_id, user_id) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (user_id, realm) REFERENCES user_account (id, realm)
);
CREATE INDEX session_live_by_user_idx ON session (user_id) WHERE revoked_at IS NULL;

CREATE TABLE password_credential (
  user_id uuid PRIMARY KEY REFERENCES user_account (id),
  password_hash text NOT NULL, -- argon2id encoded string
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mfa_credential (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_account (id),
  type text NOT NULL CHECK (type IN ('totp')),
  secret_encrypted text NOT NULL,
  confirmed_at timestamptz,
  last_used_step bigint, -- last accepted TOTP time step; a code is accepted once
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, type)
);

-- Lockout counter. account_key is an opaque caller-built key (for example '<tenant slug>:<email>'),
-- so attempts against unknown accounts are counted the same way as real ones.
CREATE TABLE login_attempt (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_key text NOT NULL,
  ip inet,
  succeeded boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempt_account_idx ON login_attempt (account_key, attempted_at DESC);
