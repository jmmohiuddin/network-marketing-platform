-- Firebase Authentication as an additional sign-in method. Never edit an applied migration: add the next number.
-- Numbered 0250 (between B2's 0208 and B3's 0300) so it sorts before later increments; it touches only user_account,
-- so it may also be applied after them.

-- The Firebase subject (the ID token's sub) an account is bound to; NULL until its first Firebase sign-in, which must
-- also prove the account's password (iam/sign-in.ts). Its own column, not idp_subject: idp_subject is unique per
-- realm, and one person may be staff in several tenants, each account bound to the same Firebase user.
ALTER TABLE user_account
  ADD COLUMN firebase_subject text CONSTRAINT user_account_firebase_subject_format
    CHECK (char_length(firebase_subject) BETWEEN 1 AND 128);

-- One account per Firebase subject in each tenant; vendor accounts (tenant_id NULL) count as one more tenant.
CREATE UNIQUE INDEX user_account_firebase_subject_key ON user_account (realm, tenant_id, firebase_subject)
  NULLS NOT DISTINCT WHERE firebase_subject IS NOT NULL;
