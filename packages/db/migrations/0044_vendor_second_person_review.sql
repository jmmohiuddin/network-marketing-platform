-- Review fixes to BUG-031 (0043).
--   1. A tenant's creator is fixed: nulling or re-pointing created_by in the approving UPDATE got past
--      tenant_second_person_guard, and a tenant could be inserted straight into implementation or live.
--   2. Independence is transitive along the invitation line: A -> X1 -> X2 made X2 "independent" of A.
--   3. A deactivated (rejected, closed) vendor user's address can be invited again; it was burnt for good.
-- What these triggers protect against: API defects. A compromised nmp_app connection sets app.user_id and
-- app.actor_type itself and can still act in any vendor user's name (security MEMORY, residual).

-- 1. Tenant identity and creation. Every role, the owner too.
CREATE FUNCTION tenant_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.created_by, NEW.created_at, NEW.idempotency_key, NEW.request_hash)
       IS DISTINCT FROM (OLD.id, OLD.created_by, OLD.created_at, OLD.idempotency_key, OLD.request_hash) THEN
      RAISE EXCEPTION 'a tenant''s id, creator and creation request never change' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('app.actor_type', true) = 'vendor_user' AND NEW.created_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'a vendor user creates tenants in its own name' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Creator-less tenants come from the seed and test fixtures only (system or owner).
  IF NEW.created_by IS NOT NULL AND (NEW.state <> 'provisioning' OR NEW.approved_by IS NOT NULL
     OR NEW.went_live_by IS NOT NULL OR NEW.approval_idempotency_key IS NOT NULL) THEN
    RAISE EXCEPTION 'a created tenant starts in provisioning, before any second person' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tenant_identity_guard BEFORE INSERT OR UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION tenant_identity_guard();

-- 2. Two vendor users are tied when one is the other, either is an inviter-ancestor of the other (created_by, up to a
-- bootstrap user), or either approved the invitation of the other or of one of the other's inviter-ancestors.
-- Siblings (two invitees of one inviter) stay independent: tying every shared ancestor would tie everyone under one
-- bootstrap user and leave no second person. The invitation approver's identity check covers that case.
CREATE OR REPLACE FUNCTION vendor_users_linked(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH RECURSIVE line (member, ancestor) AS (
    SELECT u.id, u.id FROM user_account u WHERE u.id IN (p_a, p_b)
    UNION -- not ALL: a cycle ends instead of looping
    SELECT line.member, u.created_by FROM line JOIN user_account u ON u.id = line.ancestor WHERE u.created_by IS NOT NULL
  )
  SELECT p_a = p_b
    OR EXISTS (SELECT 1 FROM line WHERE (member = p_a AND ancestor = p_b) OR (member = p_b AND ancestor = p_a))
    OR EXISTS (SELECT 1 FROM line JOIN user_account u ON u.id = line.ancestor
               WHERE u.invitation_decision = 'approved'
                 AND ((line.member = p_b AND u.invitation_decided_by = p_a) OR (line.member = p_a AND u.invitation_decided_by = p_b)))
$$;

-- 3. Vendor emails are unique among vendor users that are not deactivated; tenant users stay unique per tenant.
ALTER TABLE user_account
  DROP CONSTRAINT user_account_tenant_id_email_key,
  ADD CONSTRAINT user_account_tenant_email_key UNIQUE (tenant_id, email); -- vendor rows (tenant_id NULL): index below
CREATE UNIQUE INDEX user_account_vendor_email_open ON user_account (email) WHERE tenant_id IS NULL AND state <> 'deactivated';

-- Sign-in by email now finds the open vendor user before any closed one with the same address.
CREATE OR REPLACE FUNCTION auth_find_user(p_tenant_slug text, p_email text)
RETURNS TABLE (user_id uuid, tenant_id uuid, realm text, state text, mfa_enrolled boolean,
               password_hash text, tenant_state text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT u.id, u.tenant_id, u.realm, u.state, u.mfa_enrolled, c.password_hash, t.state
    FROM user_account u
    LEFT JOIN tenant t ON t.id = u.tenant_id
    LEFT JOIN password_credential c ON c.user_id = u.id
    WHERE u.email = lower(p_email)
      AND CASE WHEN p_tenant_slug IS NULL THEN u.tenant_id IS NULL ELSE t.slug = p_tenant_slug END
    ORDER BY u.state = 'deactivated', u.created_at DESC
    LIMIT 1;
END $$;
