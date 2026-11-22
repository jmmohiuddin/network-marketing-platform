-- V1-A account types (PLAN V1-A section 1.5; D-V1A-06). participant.account_type exists since 0200 (NOT NULL, individual |
-- joint | entity): the PLAN's "business" is the existing "entity". Account holders are personal data: joint accounts name
-- joint holders, entity accounts authorised signatories (1..4 names); NULL = not recorded (every existing row); cleared
-- on erasure (0804).
CREATE FUNCTION participant_holders_ok(p_type text, p_holders jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_holders IS NULL THEN true
    WHEN p_type NOT IN ('joint', 'entity') OR jsonb_typeof(p_holders) <> 'array' OR jsonb_array_length(p_holders) NOT BETWEEN 1 AND 4
      THEN false
    ELSE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_holders) h
                     WHERE NOT jsonb_keys_ok(h, ARRAY['name', 'role'], '{}') OR jsonb_typeof(h -> 'name') <> 'string'
                        OR length(trim(h ->> 'name')) NOT BETWEEN 1 AND 200 OR jsonb_typeof(h -> 'role') <> 'string'
                        OR h ->> 'role' NOT IN ('joint_holder', 'authorised_signatory'))
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_holders) h
                 WHERE h ->> 'role' = CASE p_type WHEN 'joint' THEN 'joint_holder' ELSE 'authorised_signatory' END)
  END
$$;

ALTER TABLE participant
  ADD COLUMN account_holders jsonb,
  ADD CONSTRAINT participant_account_holders CHECK (participant_holders_ok(account_type, account_holders));

-- 0506's guard plus the account change (an active participant not pseudonymised, nothing else changing); erasure also
-- clears the holders.
CREATE OR REPLACE FUNCTION participant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  merge_fields constant text[] := ARRAY['status', 'merged_into_id'];
  account_fields constant text[] := ARRAY['account_type', 'account_holders'];
  personal_fields constant text[] := ARRAY['display_name', 'contact', 'identity_doc_id', 'account_holders', 'pseudonymised_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on participant is not allowed';
  END IF;
  IF (OLD.status = 'active' AND NEW.status = 'merged' AND to_jsonb(NEW) - merge_fields = to_jsonb(OLD) - merge_fields)
     OR (OLD.status = 'active' AND OLD.pseudonymised_at IS NULL AND to_jsonb(NEW) - account_fields = to_jsonb(OLD) - account_fields)
     OR (acting_as_owner() AND OLD.pseudonymised_at IS NULL
         AND to_jsonb(NEW) - personal_fields = to_jsonb(OLD) - personal_fields
         AND CASE WHEN NEW.pseudonymised_at IS NULL
                  THEN (NEW.identity_doc_id, NEW.account_holders) IS NOT DISTINCT FROM (OLD.identity_doc_id, OLD.account_holders)
                  ELSE num_nulls(NEW.display_name, NEW.contact, NEW.identity_doc_id, NEW.account_holders) = 4 END) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a participant changes only by a merge, once, by its account type and holders, or by its erasure or correction'
    USING ERRCODE = 'check_violation';
END $$;

GRANT UPDATE (account_type, account_holders) ON participant TO nmp_app;
