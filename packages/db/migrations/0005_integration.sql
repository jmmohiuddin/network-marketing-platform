-- INT tables: transactional outbox, export log, and API idempotency keys (engineering addition).

CREATE TABLE outbox_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  seq bigserial NOT NULL UNIQUE,
  topic text NOT NULL,
  key text NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  dispatched_at timestamptz,
  dead boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX outbox_event_pending_idx ON outbox_event (dispatched_at, available_at) WHERE dispatched_at IS NULL;

-- History is immutable: no DELETE, no change to a dispatched row, and only dispatch fields may change before that.
CREATE FUNCTION outbox_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  dispatch_fields constant text[] := ARRAY['available_at', 'attempts', 'dispatched_at', 'dead'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on outbox_event is not allowed (insert-only)';
  END IF;
  IF OLD.dispatched_at IS NOT NULL THEN
    RAISE EXCEPTION 'UPDATE on outbox_event is not allowed (already dispatched)';
  END IF;
  IF to_jsonb(NEW) - dispatch_fields <> to_jsonb(OLD) - dispatch_fields THEN
    RAISE EXCEPTION 'UPDATE on outbox_event may change only dispatch fields';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_event_immutable BEFORE UPDATE OR DELETE ON outbox_event
  FOR EACH ROW EXECUTE FUNCTION outbox_event_guard();

-- The dispatcher works across tenants and the runtime role has no UPDATE on outbox_event,
-- so dispatch goes through these two system-realm functions.

-- Locks and returns due events (oldest first) for the calling transaction.
CREATE FUNCTION outbox_claim(p_limit int) RETURNS SETOF outbox_event
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT * FROM outbox_event
    WHERE dispatched_at IS NULL AND NOT dead AND available_at <= now()
    ORDER BY seq
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED;
END $$;

-- Records one delivery attempt: delivered, or retry at p_retry_at, or dead when no retry time is given.
CREATE FUNCTION outbox_settle(p_id uuid, p_delivered boolean, p_retry_at timestamptz DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  UPDATE outbox_event
  SET attempts = attempts + 1,
      dispatched_at = CASE WHEN p_delivered THEN now() END,
      available_at = CASE WHEN p_delivered THEN available_at ELSE coalesce(p_retry_at, available_at) END,
      dead = NOT p_delivered AND p_retry_at IS NULL
  WHERE id = p_id AND dispatched_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'outbox_event % does not exist or is already dispatched', p_id;
  END IF;
END $$;

CREATE TABLE export_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  kind text NOT NULL,
  filters jsonb,
  row_count bigint,
  document_id uuid,
  destination text,
  requested_by uuid,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  -- Composite keys keep both references inside the tenant (see 0002).
  FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES user_account (tenant_id, id)
);
CREATE INDEX export_job_kind_idx ON export_job (tenant_id, kind);

-- response stays NULL while the first request is in flight.
CREATE TABLE idempotency_key (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  key text NOT NULL,
  route text NOT NULL,
  request_hash bytea NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key, route)
);
