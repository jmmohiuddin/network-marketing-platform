-- BUG-031: two-person control between vendor users. One person could invite a vendor user at an address they control,
-- accept, enrol MFA and act as the "second vendor user". From here on:
--   1. A vendor user invited by a vendor user (created_by set) stays pending until a different, active, MFA-enrolled
--      vendor user who is independent of the inviter approves it. No invitation token can exist before that, and the
--      account cannot become active without it. Rejection closes the account. Bootstrap vendor users (created_by
--      NULL) come only from the seed or the operator CLI, never from a vendor user.
--   2. Second-person vendor actions (tenant provisioning approval, go-live, invitation approval) refuse an actor tied
--      to the initiator: the same user, one who invited or was invited by them, or one who approved or was approved
--      by them (vendor_users_linked). The acting user must be the session's user (app.user_id).

-- 1. Who decided a vendor user's invitation. Kept on user_account like its Idempotency-Key (0042).
ALTER TABLE user_account
  ADD COLUMN invitation_decision text CHECK (invitation_decision IN ('approved', 'rejected')),
  ADD COLUMN invitation_decided_by uuid, -- no FK, as tenant.approved_by (0011): the guard checks the decider
  ADD COLUMN invitation_decided_at timestamptz,
  ADD COLUMN decision_idempotency_key text,
  ADD COLUMN decision_request_hash bytea;

-- Accounts invited before this migration were never approved by a second person: their open invitations die, and
-- those already active are closed (a sock puppet among them would otherwise keep its approvals). Re-invite them.
UPDATE user_invitation SET revoked_at = now()
WHERE tenant_id IS NULL AND used_at IS NULL AND revoked_at IS NULL
  AND user_id IN (SELECT id FROM user_account WHERE realm = 'vendor' AND created_by IS NOT NULL);
UPDATE user_account SET state = 'deactivated'
WHERE realm = 'vendor' AND created_by IS NOT NULL AND state IN ('active', 'locked');

ALTER TABLE user_account
  ADD CONSTRAINT user_account_invitation_decision_complete
    CHECK ((invitation_decision IS NULL) = (invitation_decided_by IS NULL)
           AND (invitation_decision IS NULL) = (invitation_decided_at IS NULL)),
  ADD CONSTRAINT user_account_invitation_decision_vendor_invited
    CHECK (invitation_decision IS NULL OR (realm = 'vendor' AND created_by IS NOT NULL)),
  ADD CONSTRAINT user_account_invitation_approver_not_inviter CHECK (invitation_decided_by <> created_by),
  ADD CONSTRAINT user_account_vendor_active_needs_approval
    CHECK (realm <> 'vendor' OR created_by IS NULL OR state IN ('invited', 'deactivated')
           OR invitation_decision IS NOT DISTINCT FROM 'approved'), -- NULL must fail, not pass
  ADD CONSTRAINT user_account_rejected_is_closed CHECK (invitation_decision IS DISTINCT FROM 'rejected' OR state = 'deactivated'),
  ADD CONSTRAINT user_account_decision_idempotency_complete
    CHECK ((decision_idempotency_key IS NULL) = (decision_request_hash IS NULL)
           AND (decision_request_hash IS NULL OR octet_length(decision_request_hash) = 32)
           AND (decision_idempotency_key IS NULL OR invitation_decided_by IS NOT NULL)),
  ADD CONSTRAINT user_account_decision_idempotency_key_unique UNIQUE (invitation_decided_by, decision_idempotency_key);

-- 2. Tenant go-live names its second person, like provisioning approval (approved_by, 0011).
ALTER TABLE tenant ADD COLUMN went_live_by uuid;

-- Two vendor users are tied when one is the other, invited the other, or approved the other's invitation.
-- SECURITY DEFINER: the answer is needed in every realm, and only a boolean leaves the function.
CREATE FUNCTION vendor_users_linked(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_a = p_b OR EXISTS (
    SELECT 1 FROM user_account a, user_account b
    WHERE a.id = p_a AND b.id = p_b
      AND (a.created_by = p_b OR b.created_by = p_a
           OR (a.invitation_decision = 'approved' AND a.invitation_decided_by = p_b)
           OR (b.invitation_decision = 'approved' AND b.invitation_decided_by = p_a)))
$$;

-- The second person: the session's own user, an active MFA-enrolled vendor user, not tied to the initiator
-- (NULL initiator = a seeded or hand-made row, nothing to be independent of).
CREATE FUNCTION assert_vendor_second_person(p_actor uuid, p_initiator uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_actor IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'a vendor second-person approval is recorded in the acting user''s own name'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_account WHERE id = p_actor AND realm = 'vendor' AND state = 'active' AND mfa_enrolled) THEN
    RAISE EXCEPTION 'the second person must be an active vendor user with MFA' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_initiator IS NOT NULL AND vendor_users_linked(p_actor, p_initiator) THEN
    RAISE EXCEPTION 'APPROVER_NOT_INDEPENDENT: the second person is tied to the initiator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

REVOKE ALL ON FUNCTION vendor_users_linked(uuid, uuid), assert_vendor_second_person(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vendor_users_linked(uuid, uuid), assert_vendor_second_person(uuid, uuid) TO nmp_app;

-- Every role, the owner too: a vendor user's inviter never changes, its decision is taken once, by the session's
-- user, on a pending invitation; a vendor user creates only pending vendor users in its own name.
CREATE FUNCTION user_account_vendor_invitation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.invitation_decision IS NOT NULL OR NEW.decision_idempotency_key IS NOT NULL THEN
      RAISE EXCEPTION 'a vendor user is created pending; its invitation is decided later' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF current_setting('app.actor_type', true) = 'vendor_user'
       AND (NEW.created_by IS DISTINCT FROM app_user_id() OR NEW.state <> 'invited') THEN
      RAISE EXCEPTION 'a vendor user only invites vendor users, in its own name' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a vendor user''s inviter never changes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.invitation_decision, NEW.invitation_decided_by, NEW.invitation_decided_at, NEW.decision_idempotency_key,
      NEW.decision_request_hash) IS NOT DISTINCT FROM (OLD.invitation_decision, OLD.invitation_decided_by,
      OLD.invitation_decided_at, OLD.decision_idempotency_key, OLD.decision_request_hash) THEN
    RETURN NEW;
  END IF;
  IF OLD.invitation_decision IS NOT NULL OR OLD.state <> 'invited' THEN
    RAISE EXCEPTION 'this invitation is already decided or closed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM assert_vendor_second_person(NEW.invitation_decided_by, NEW.created_by);
  RETURN NEW;
END $$;

CREATE TRIGGER user_account_vendor_invitation_guard BEFORE INSERT OR UPDATE ON user_account
  FOR EACH ROW WHEN (NEW.realm = 'vendor') EXECUTE FUNCTION user_account_vendor_invitation_guard();

-- No invitation token for a vendor user whose invitation is not approved (bootstrap users have no inviter).
CREATE FUNCTION user_invitation_vendor_approved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM user_account u WHERE u.id = NEW.user_id AND u.realm = 'vendor' AND u.created_by IS NOT NULL
             AND u.invitation_decision IS DISTINCT FROM 'approved') THEN
    RAISE EXCEPTION 'a vendor user''s invitation must be approved by a second vendor user first'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER user_invitation_vendor_approved BEFORE INSERT ON user_invitation
  FOR EACH ROW WHEN (NEW.tenant_id IS NULL) EXECUTE FUNCTION user_invitation_vendor_approved();

-- Tenant second-person steps (FR-TEN-001): approved_by is set once while provisioning, went_live_by once while in
-- implementation, each by an independent second person; a tenant with a creator leaves those states only with them.
CREATE FUNCTION tenant_second_person_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    IF OLD.approved_by IS NOT NULL OR OLD.state <> 'provisioning' THEN
      RAISE EXCEPTION 'a tenant''s provisioning is approved once, while provisioning' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM assert_vendor_second_person(NEW.approved_by, NEW.created_by);
  END IF;
  IF NEW.went_live_by IS DISTINCT FROM OLD.went_live_by THEN
    IF OLD.went_live_by IS NOT NULL OR OLD.state <> 'implementation' THEN
      RAISE EXCEPTION 'a tenant goes live once, from implementation' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM assert_vendor_second_person(NEW.went_live_by, NEW.created_by);
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NEW.created_by IS NOT NULL
     AND ((OLD.state = 'provisioning' AND NEW.approved_by IS NULL) OR (NEW.state = 'live' AND NEW.went_live_by IS NULL)) THEN
    RAISE EXCEPTION 'this tenant step needs its second vendor user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tenant_second_person_guard BEFORE UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION tenant_second_person_guard();
