-- Audit store (E-ADR-05, E-ADR-06). No foreign keys: tenant_id and support_session_id are soft references.
-- seq, prev_hash and hash are assigned by the database, never by the caller.

CREATE FUNCTION audit.chain_hash(prev bytea, payload jsonb) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT sha256(coalesce(prev, ''::bytea) || convert_to(payload::text, 'UTF8'))
$$;

CREATE TABLE audit.audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  seq bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL,
  actor_id uuid,
  support_session_id uuid,
  action text NOT NULL,
  object_type text,
  object_id uuid,
  before_ref text,
  after_ref text,
  request_id text,
  prev_hash bytea,
  hash bytea NOT NULL,
  UNIQUE (tenant_id, seq)
);
CREATE INDEX audit_event_object_idx ON audit.audit_event (tenant_id, object_type, object_id);
CREATE INDEX audit_event_actor_idx ON audit.audit_event (tenant_id, actor_id, occurred_at);

-- Vendor-realm actions (E-ADR-06): one chain, no tenant column.
CREATE TABLE audit.vendor_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL,
  actor_id uuid,
  support_session_id uuid,
  action text NOT NULL,
  object_type text,
  object_id uuid,
  before_ref text,
  after_ref text,
  request_id text,
  prev_hash bytea,
  hash bytea NOT NULL
);
CREATE INDEX vendor_event_object_idx ON audit.vendor_event (object_type, object_id);
CREATE INDEX vendor_event_actor_idx ON audit.vendor_event (actor_id, occurred_at);

-- SECURITY DEFINER so the chain head is read regardless of the caller's row visibility.
-- timezone is pinned because the hashed payload contains timestamps rendered as text.
CREATE FUNCTION audit.audit_event_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET timezone = 'UTC' AS $$
DECLARE
  head record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit.audit_event:' || NEW.tenant_id, 0));
  SELECT seq, hash INTO head FROM audit.audit_event WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(head.seq, 0) + 1;
  NEW.prev_hash := head.hash;
  NEW.hash := audit.chain_hash(NEW.prev_hash, to_jsonb(NEW) - 'hash' - 'prev_hash');
  RETURN NEW;
END $$;

CREATE FUNCTION audit.vendor_event_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET timezone = 'UTC' AS $$
DECLARE
  head record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit.vendor_event', 0));
  SELECT seq, hash INTO head FROM audit.vendor_event ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(head.seq, 0) + 1;
  NEW.prev_hash := head.hash;
  NEW.hash := audit.chain_hash(NEW.prev_hash, to_jsonb(NEW) - 'hash' - 'prev_hash');
  RETURN NEW;
END $$;

CREATE TRIGGER audit_event_chain BEFORE INSERT ON audit.audit_event
  FOR EACH ROW EXECUTE FUNCTION audit.audit_event_chain();
CREATE TRIGGER audit_event_no_mutation BEFORE UPDATE OR DELETE ON audit.audit_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER vendor_event_chain BEFORE INSERT ON audit.vendor_event
  FOR EACH ROW EXECUTE FUNCTION audit.vendor_event_chain();
CREATE TRIGGER vendor_event_no_mutation BEFORE UPDATE OR DELETE ON audit.vendor_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Chain verification (SEC-38). Returns the first seq that breaks the chain, NULL when intact.
-- SECURITY INVOKER: a caller verifies only the rows its context can see.
CREATE FUNCTION audit.verify_audit_chain(p_tenant_id uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SET timezone = 'UTC' AS $$
DECLARE
  e audit.audit_event;
  prev bytea;
  expected_seq bigint := 1;
BEGIN
  FOR e IN SELECT * FROM audit.audit_event WHERE tenant_id = p_tenant_id ORDER BY seq LOOP
    IF e.seq <> expected_seq OR e.prev_hash IS DISTINCT FROM prev
       OR e.hash <> audit.chain_hash(prev, to_jsonb(e) - 'hash' - 'prev_hash') THEN
      RETURN e.seq;
    END IF;
    prev := e.hash;
    expected_seq := expected_seq + 1;
  END LOOP;
  RETURN NULL;
END $$;

CREATE FUNCTION audit.verify_vendor_chain() RETURNS bigint
LANGUAGE plpgsql STABLE SET timezone = 'UTC' AS $$
DECLARE
  e audit.vendor_event;
  prev bytea;
  expected_seq bigint := 1;
BEGIN
  FOR e IN SELECT * FROM audit.vendor_event ORDER BY seq LOOP
    IF e.seq <> expected_seq OR e.prev_hash IS DISTINCT FROM prev
       OR e.hash <> audit.chain_hash(prev, to_jsonb(e) - 'hash' - 'prev_hash') THEN
      RETURN e.seq;
    END IF;
    prev := e.hash;
    expected_seq := expected_seq + 1;
  END LOOP;
  RETURN NULL;
END $$;
