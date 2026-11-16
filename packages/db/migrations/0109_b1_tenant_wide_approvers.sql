-- B1 review, third round. A tenant-wide object (a setting change request) is approved only by a holder of the
-- permission for all markets: p_all_markets lists only assignments without a market list. With p_all_markets false a
-- NULL market still means "any assignment" (cases without a market keep their semantics).
DROP FUNCTION approval_eligible_users(text, uuid, uuid[]);

CREATE FUNCTION approval_eligible_users(p_permission text, p_market_id uuid, p_exclude uuid[], p_all_markets boolean)
RETURNS TABLE (user_id uuid, display_name text, email text)
LANGUAGE sql STABLE AS $$
  SELECT u.id, u.display_name, u.email FROM user_account u
  WHERE u.realm = 'tenant' AND u.state = 'active' AND u.id <> ALL (coalesce(p_exclude, '{}'))
    AND EXISTS (
      SELECT 1 FROM role_assignment a JOIN role r ON r.id = a.role_id
      WHERE a.user_id = u.id AND a.tenant_id = u.tenant_id
        AND a.valid_from <= now() AND (a.valid_to IS NULL OR a.valid_to > now())
        AND p_permission = ANY (r.permissions)
        AND (a.market_ids IS NULL
             OR (NOT p_all_markets AND (p_market_id IS NULL OR p_market_id = ANY (a.market_ids))))
        AND (NOT r.mfa_required OR u.mfa_enrolled))
  ORDER BY u.display_name, u.email
$$;
