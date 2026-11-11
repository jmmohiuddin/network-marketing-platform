-- Extensions, schemas, runtime-role guard and shared helpers.
-- Runs as the owner role. The runtime role nmp_app never owns objects and never bypasses RLS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS ltree;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nmp_app') THEN
    -- Login and password are deployment configuration, not schema.
    CREATE ROLE nmp_app NOLOGIN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nmp_app' AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'role nmp_app must not be SUPERUSER, BYPASSRLS, CREATEDB or CREATEROLE';
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nmp_app;

-- Audit store (E-ADR-05): separate schema, insert-only grants.
CREATE SCHEMA audit;
GRANT USAGE ON SCHEMA audit TO nmp_app;

-- Request context. set_config(..., true) leaves '' behind on a pooled connection after the
-- transaction ends, so '' is treated as "not set".
CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION app_realm() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.realm', true), '')
$$;

-- Guard for SECURITY DEFINER entry points that run before a tenant context exists.
CREATE FUNCTION require_system_realm() RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF app_realm() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'this function is only callable in the system realm' USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- Trigger: block UPDATE/DELETE. Optional argument = reason shown in the error.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, coalesce(TG_ARGV[0], 'insert-only');
END $$;

-- Standard tenant isolation for a table with a tenant_id column. Later migrations reuse it.
-- The realm is part of the predicate: a vendor or system transaction never matches a tenant policy,
-- whatever app.tenant_id holds.
CREATE FUNCTION apply_tenant_rls(target regclass) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  own_tenant constant text := '(app_realm() = ''tenant'' AND tenant_id = app_tenant_id())';
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s USING %s WITH CHECK %s', target, own_tenant, own_tenant);
END $$;

REVOKE ALL ON FUNCTION apply_tenant_rls(regclass) FROM PUBLIC;
