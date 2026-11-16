-- B1 outbound webhooks (FR-INT-001, D-B1-07..09; PLAN B1 section 1.7): tenant endpoints, one delivery row per attempt,
-- and the system-realm entry points of the dispatcher (outbox_claim / outbox_settle of 0005 are reused).

ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE webhook_endpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  url text NOT NULL CHECK (url ~ '^https://' AND length(url) <= 2048),
  description text CHECK (description IS NULL OR length(description) <= 200),
  secret_sealed text NOT NULL, -- lib/secret-box, context webhook:<endpoint id> (D-B1-07)
  previous_secret_sealed text,
  previous_secret_expires_at timestamptz,
  topics text[] NOT NULL CHECK (cardinality(topics) > 0),
  state text NOT NULL CHECK (state IN ('active', 'disabled')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CONSTRAINT webhook_endpoint_previous_secret_complete
    CHECK ((previous_secret_sealed IS NULL) = (previous_secret_expires_at IS NULL)),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX webhook_endpoint_tenant_idx ON webhook_endpoint (tenant_id);

CREATE TABLE webhook_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  endpoint_id uuid NOT NULL,
  outbox_event_id uuid NOT NULL,
  attempt int NOT NULL CHECK (attempt >= 1),
  outcome text NOT NULL CHECK (outcome IN ('scheduled', 'delivered', 'failed', 'dead', 'cancelled')),
  next_attempt_at timestamptz NOT NULL,
  claimed_until timestamptz,
  attempted_at timestamptz,
  status int CHECK (status BETWEEN 100 AND 599),
  error text CHECK (error IN ('ADDRESS_BLOCKED', 'DNS_FAILED', 'CONNECTION_FAILED', 'TLS_FAILED', 'TIMEOUT',
    'REDIRECT_REFUSED', 'HTTP_STATUS', 'ENDPOINT_DISABLED')),
  duration_ms int CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoint (tenant_id, id),
  FOREIGN KEY (tenant_id, outbox_event_id) REFERENCES outbox_event (tenant_id, id),
  UNIQUE (endpoint_id, outbox_event_id, attempt)
);
CREATE INDEX webhook_delivery_endpoint_idx ON webhook_delivery (endpoint_id, next_attempt_at);
CREATE INDEX webhook_delivery_due_idx ON webhook_delivery (next_attempt_at) WHERE outcome = 'scheduled';

-- An attempt is settled once (scheduled -> delivered | failed | dead | cancelled); while scheduled it may be claimed
-- and rescheduled. What it delivers (endpoint, event, attempt) never changes, and rows are never deleted.
CREATE FUNCTION webhook_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempt_fields constant text[] :=
    ARRAY['outcome', 'next_attempt_at', 'claimed_until', 'attempted_at', 'status', 'error', 'duration_ms'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on webhook_delivery is not allowed (delivery history)';
  END IF;
  IF (OLD.outcome = 'scheduled' AND to_jsonb(NEW) - attempt_fields = to_jsonb(OLD) - attempt_fields) IS NOT TRUE THEN
    RAISE EXCEPTION 'a webhook delivery attempt is settled once and delivers what it was scheduled for'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webhook_delivery_settled_once BEFORE UPDATE OR DELETE ON webhook_delivery
  FOR EACH ROW EXECUTE FUNCTION webhook_delivery_guard();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['webhook_endpoint', 'webhook_delivery']::regclass[]) AS t;

GRANT SELECT, INSERT ON webhook_endpoint, webhook_delivery TO nmp_app;
GRANT UPDATE (url, description, secret_sealed, previous_secret_sealed, previous_secret_expires_at, topics, state,
  updated_at) ON webhook_endpoint TO nmp_app;
GRANT UPDATE (outcome, next_attempt_at, claimed_until, attempted_at, status, error, duration_ms)
  ON webhook_delivery TO nmp_app;

-- Fan-out of one outbox event (AC-INT1-3): one scheduled first attempt per active endpoint of the event's tenant that
-- subscribes to the topic and existed when the event was written (no backlog replay to a new endpoint). The test
-- topic goes to its own endpoint only. Idempotent: a repeated call inserts nothing.
CREATE FUNCTION webhook_fan_out(p_outbox_event_id uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  inserted int;
BEGIN
  PERFORM require_system_realm();
  INSERT INTO webhook_delivery (tenant_id, endpoint_id, outbox_event_id, attempt, outcome, next_attempt_at)
  SELECT e.tenant_id, w.id, e.id, 1, 'scheduled', now()
  FROM outbox_event e
  JOIN webhook_endpoint w ON w.tenant_id = e.tenant_id AND w.state = 'active'
  WHERE e.id = p_outbox_event_id
    AND CASE WHEN e.topic = 'webhook.test' THEN w.id::text = e.payload ->> 'endpoint_id'
             ELSE e.topic = ANY (w.topics) AND w.created_at <= e.created_at END
  ON CONFLICT (endpoint_id, outbox_event_id, attempt) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $$;

-- Leases due attempts to one dispatcher for p_lease_seconds; a crashed dispatcher's lease runs out and the attempt is
-- claimed again.
CREATE FUNCTION webhook_claim_due(p_limit int, p_lease_seconds int) RETURNS TABLE (tenant_id uuid, delivery_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    UPDATE webhook_delivery d SET claimed_until = now() + make_interval(secs => p_lease_seconds)
    WHERE d.id IN (
      SELECT due.id FROM webhook_delivery due
      WHERE due.outcome = 'scheduled' AND due.next_attempt_at <= now()
        AND (due.claimed_until IS NULL OR due.claimed_until < now())
      ORDER BY due.next_attempt_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED)
    RETURNING d.tenant_id, d.id;
END $$;

REVOKE ALL ON FUNCTION webhook_fan_out(uuid), webhook_claim_due(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION webhook_fan_out(uuid), webhook_claim_due(int, int) TO nmp_app;
