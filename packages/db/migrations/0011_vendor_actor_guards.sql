-- Vendor actor guards (review of T-A05/T-A06, E-ADR-21).
--
-- 1. support_session. A vendor action that must reach both audit logs runs in one transaction that starts in the
--    vendor realm and then enters the tenant's realm (apps/api support/vendor-tx.ts); in-session requests and the
--    first-use start run in the tenant realm too. In those transactions app.realm is 'tenant' while app.actor_type
--    stays 'vendor_user', so policy vendor_end and the 0002 trigger, which test app_realm() = 'vendor' only, did not
--    apply: a bug there could approve a session with no tenant decision. The guard now follows the actor as well
--    as the realm. A vendor actor may only
--      - insert its own request (state requested, no decision, no window; in the vendor realm policy
--        vendor_request already says so),
--      - start an approved session it requested (approved -> active, nothing else changes),
--      - end an active session it requested (active -> ended, ends_at only earlier, nothing else changes).
--    The error text keeps the words of 0002 that callers and tests match.
CREATE OR REPLACE FUNCTION support_session_vendor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ending_fields constant text[] := ARRAY['state', 'ends_at'];
  actor constant uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.state = 'requested' AND NEW.decided_by IS NULL AND NEW.starts_at IS NULL AND NEW.ends_at IS NULL
        AND NEW.requester_id = actor) IS NOT TRUE THEN
      RAISE EXCEPTION 'a vendor user may only request a support session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.requester_id = actor AND (
        (OLD.state = 'active' AND NEW.state = 'ended' AND NEW.ends_at <= OLD.ends_at
         AND to_jsonb(NEW) - ending_fields = to_jsonb(OLD) - ending_fields)
     OR (OLD.state = 'approved' AND NEW.state = 'active' AND to_jsonb(NEW) - 'state' = to_jsonb(OLD) - 'state')
     )) IS NOT TRUE THEN
    RAISE EXCEPTION 'the vendor realm may only end an active support session it requested, or start an approved one'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER support_session_vendor_may_only_end ON support_session;
CREATE TRIGGER support_session_vendor_may_only_end BEFORE UPDATE ON support_session
  FOR EACH ROW WHEN (app_realm() = 'vendor' OR current_setting('app.actor_type', true) = 'vendor_user')
  EXECUTE FUNCTION support_session_vendor_guard();
-- In the vendor realm an insert stays with policy vendor_request (its RLS error is what callers see there).
CREATE TRIGGER support_session_vendor_may_only_request BEFORE INSERT ON support_session
  FOR EACH ROW WHEN (app_realm() IS DISTINCT FROM 'vendor' AND current_setting('app.actor_type', true) = 'vendor_user')
  EXECUTE FUNCTION support_session_vendor_guard();

-- 2. Region-bound support sessions (FR-IAM-005, AC-31.1, TS-57): where a vendor user works from is recorded by
--    vendor operations, never declared on the request. NULL = unknown, which every tenant treats as out of region.
ALTER TABLE user_account
  ADD COLUMN work_region text,
  ADD CONSTRAINT user_account_work_region_vendor_only CHECK (work_region IS NULL OR realm = 'vendor');

-- 3. Second-person approval of a tenant's provisioning (FR-TEN-001) is an approval action, so it takes an
--    Idempotency-Key (TR-API-13). Like 0010, the key and request hash live on the row, unique per approver.
ALTER TABLE tenant
  ADD COLUMN approved_by uuid,
  ADD COLUMN approval_idempotency_key text,
  ADD COLUMN approval_request_hash bytea,
  ADD CONSTRAINT tenant_approval_idempotency_complete
    CHECK ((approval_idempotency_key IS NULL) = (approval_request_hash IS NULL)
           AND (approval_request_hash IS NULL OR octet_length(approval_request_hash) = 32)
           AND (approval_idempotency_key IS NULL OR approved_by IS NOT NULL)),
  ADD CONSTRAINT tenant_approval_idempotency_key_unique UNIQUE (approved_by, approval_idempotency_key);
