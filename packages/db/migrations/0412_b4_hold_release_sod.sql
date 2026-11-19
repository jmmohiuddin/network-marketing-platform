-- B4 review fix (FR-PAY-007 separation of duties; 0402 is applied and cannot change): a payout hold restrains whoever
-- prepares payouts, so a user holding payout.prepare over the hold's market never releases it. The API refuses first
-- (403 RELEASER_NOT_INDEPENDENT); this is the backstop. Role assignments are read as approval_eligible_users reads them,
-- without its MFA filter (a role held without MFA still counts).
CREATE FUNCTION payout_hold_release_independent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM role_assignment a JOIN role r ON r.id = a.role_id
    WHERE a.user_id = NEW.released_by AND a.tenant_id = NEW.tenant_id
      AND a.valid_from <= now() AND (a.valid_to IS NULL OR a.valid_to > now())
      AND 'payout.prepare' = ANY (r.permissions)
      AND (a.market_ids IS NULL OR NEW.market_id = ANY (a.market_ids))
  ) THEN
    RAISE EXCEPTION 'a payout hold is not released by a user who prepares payouts in its market' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_hold_release_independent BEFORE UPDATE ON payout_hold
  FOR EACH ROW WHEN (current_user = 'nmp_app' AND OLD.released_by IS NULL AND NEW.released_by IS NOT NULL)
  EXECUTE FUNCTION payout_hold_release_independent();
