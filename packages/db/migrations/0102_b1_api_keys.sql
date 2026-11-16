-- B1 service accounts and API keys (FR-IAM-006, D-B1-05; PLAN B1 section 1.5). Only the SHA-256 of a key is stored.
-- A key caller is resolved before any tenant context exists, through the system-realm functions at the end.

CREATE TABLE service_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  purpose text NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 500),
  state text NOT NULL CHECK (state IN ('active', 'disabled')),
  disabled_at timestamptz,
  disabled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CONSTRAINT service_account_disabled_at CHECK ((state = 'disabled') = (disabled_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, disabled_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

CREATE FUNCTION service_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  disabling_fields constant text[] := ARRAY['state', 'disabled_at', 'disabled_by'];
BEGIN
  IF (OLD.state = 'active' AND NEW.state = 'disabled'
      AND to_jsonb(NEW) - disabling_fields = to_jsonb(OLD) - disabling_fields) IS NOT TRUE THEN
    RAISE EXCEPTION 'a service account changes once, from active to disabled' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER service_account_disabled_once BEFORE UPDATE ON service_account
  FOR EACH ROW EXECUTE FUNCTION service_account_guard();

CREATE TABLE api_key (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  service_account_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  key_prefix text NOT NULL CHECK (key_prefix ~ '^nmpk_[A-Za-z0-9_-]{7}$'),
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL CHECK (cardinality(scopes) > 0),
  rate_tier text NOT NULL CHECK (rate_tier IN ('standard', 'high')),
  ip_allow cidr[],
  expires_at timestamptz,
  revoked_at timestamptz,
  rotated_from_id uuid,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  FOREIGN KEY (tenant_id, service_account_id) REFERENCES service_account (tenant_id, id),
  FOREIGN KEY (tenant_id, rotated_from_id) REFERENCES api_key (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX api_key_service_account_idx ON api_key (tenant_id, service_account_id);

-- A key's identity and authority never change: its expiry only moves earlier (or is set), a revocation is final,
-- and last_used_at is the usage stamp.
CREATE FUNCTION api_key_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lifecycle_fields constant text[] := ARRAY['expires_at', 'revoked_at', 'last_used_at'];
BEGIN
  IF to_jsonb(NEW) - lifecycle_fields <> to_jsonb(OLD) - lifecycle_fields
     OR (OLD.expires_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at > OLD.expires_at))
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'an API key''s expiry only moves earlier, a revocation is final, nothing else changes'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER api_key_lifecycle BEFORE UPDATE ON api_key FOR EACH ROW EXECUTE FUNCTION api_key_guard();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['service_account', 'api_key']::regclass[]) AS t;

GRANT SELECT, INSERT ON service_account, api_key TO nmp_app;
GRANT UPDATE (state, disabled_at, disabled_by) ON service_account TO nmp_app;
GRANT UPDATE (expires_at, revoked_at) ON api_key TO nmp_app;

-- The key behind a bearer token's hash, while it is usable: not revoked, not expired, its service account active, its
-- tenant not archived.
CREATE FUNCTION auth_find_api_key(p_key_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, service_account_id uuid, scopes text[], rate_tier text, ip_allow cidr[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT k.id, k.tenant_id, k.service_account_id, k.scopes, k.rate_tier, k.ip_allow
    FROM api_key k
    JOIN service_account s ON s.id = k.service_account_id
    JOIN tenant t ON t.id = k.tenant_id
    WHERE k.key_hash = p_key_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
      AND s.state = 'active' AND t.state <> 'archived';
END $$;

-- Usage stamp, written at most once a minute per key.
CREATE FUNCTION auth_touch_api_key(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  UPDATE api_key SET last_used_at = now()
  WHERE id = p_id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');
END $$;

REVOKE ALL ON FUNCTION auth_find_api_key(text), auth_touch_api_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_api_key(text), auth_touch_api_key(uuid) TO nmp_app;
