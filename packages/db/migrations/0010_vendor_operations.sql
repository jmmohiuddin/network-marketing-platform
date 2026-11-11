-- Vendor operations (T-A05 tenant provisioning, T-A06 support sessions). No new table, so no new policy.
--
-- Vendor creating POSTs need an Idempotency-Key (TR-API-13), but idempotency_key.tenant_id is NOT NULL and a
-- vendor request has no tenant of its own. A vendor request therefore keeps its key and request hash on the row
-- it creates, unique per creator. All columns are nullable: rows written before this migration (seeds, tests,
-- tenants created by hand) have none.

ALTER TABLE tenant
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash bytea,
  ADD CONSTRAINT tenant_idempotency_complete
    CHECK ((idempotency_key IS NULL) = (request_hash IS NULL) AND (request_hash IS NULL OR octet_length(request_hash) = 32)),
  ADD CONSTRAINT tenant_idempotency_key_unique UNIQUE (created_by, idempotency_key);

ALTER TABLE support_session
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash bytea,
  ADD CONSTRAINT support_session_idempotency_complete
    CHECK ((idempotency_key IS NULL) = (request_hash IS NULL) AND (request_hash IS NULL OR octet_length(request_hash) = 32)),
  ADD CONSTRAINT support_session_idempotency_key_unique UNIQUE (requester_id, idempotency_key);

-- Request expiry (auto-deny) and window expiry scan by state and time.
CREATE INDEX support_session_due_idx ON support_session (state, ends_at, created_at);
