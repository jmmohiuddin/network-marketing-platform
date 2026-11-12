-- Vendor-user management (BUG-011): a vendor user invites another vendor user, who sets a password through the
-- same one-time invitation as tenant users. FR-TEN-001's two-person provisioning needs a second vendor user.

-- A vendor invitation has no tenant (E-ADR-08). The composite key keeps a tenant invitation in its tenant; the
-- plain key covers vendor invitations, which the vendor policy below limits to vendor users.
ALTER TABLE user_invitation
  ALTER COLUMN tenant_id DROP NOT NULL,
  ADD CONSTRAINT user_invitation_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_account (id);

CREATE POLICY vendor_invitations ON user_invitation
  USING (app_realm() = 'vendor' AND tenant_id IS NULL)
  WITH CHECK (app_realm() = 'vendor' AND tenant_id IS NULL
              AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = user_invitation.user_id AND u.realm = 'vendor'));

-- Vendor creating POSTs keep their Idempotency-Key on the created row (as tenant and support_session, 0010).
ALTER TABLE user_account
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash bytea,
  ADD CONSTRAINT user_account_idempotency_complete
    CHECK ((idempotency_key IS NULL) = (request_hash IS NULL) AND (request_hash IS NULL OR octet_length(request_hash) = 32)),
  ADD CONSTRAINT user_account_idempotency_key_unique UNIQUE (created_by, idempotency_key);

-- An open invitation: unused, unrevoked, unexpired, for a user still invited; a tenant user's tenant is not archived.
CREATE OR REPLACE FUNCTION auth_find_invitation(p_token_hash bytea)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT i.id, i.tenant_id, i.user_id
    FROM user_invitation i
    JOIN user_account u ON u.id = i.user_id
    LEFT JOIN tenant t ON t.id = i.tenant_id
    WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
      AND u.state = 'invited'
      AND CASE WHEN i.tenant_id IS NULL THEN u.realm = 'vendor' ELSE t.state <> 'archived' END;
END $$;
