-- B1 review fixes (PLAN B1 sections 1.1, 1.2, 1.6-1.8). Sign-offs are bound to the acting user and to the object they
-- decide, uploaded documents never change, the money-key backstop checks the effective chain at commit, and webhook
-- delivery history is consistent. The insert guards apply to the runtime role; the owner (migrations, test fixtures) is
-- exempt as in D-B1-17. Existing rows are not changed.

-- 1. D-B1-04: a document never changes once uploaded. 0006 granted UPDATE and nothing used it; with it a user could take
-- over someone else's evidence (uploaded_by) or swap the file behind a referenced document (sha256, storage_key).
REVOKE UPDATE ON document FROM nmp_app;
CREATE TRIGGER document_no_update BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation('a document never changes: upload a new one');

-- Referencing is serialised per document, so two concurrent transactions cannot both reference it (READ COMMITTED: each
-- statement of this VOLATILE function reads after the lock, so the second sees the first's committed reference).
CREATE OR REPLACE FUNCTION assert_document_referenceable(p_document_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('document_reference:' || p_document_id, 0));
  IF NOT EXISTS (SELECT 1 FROM document d
                 WHERE d.id = p_document_id AND d.class = 'evidence' AND d.uploaded_by = app_user_id())
     OR EXISTS (SELECT 1 FROM document_references(p_document_id)) THEN
    RAISE EXCEPTION 'document % cannot be referenced here', p_document_id USING ERRCODE = 'no_data_found';
  END IF;
END $$;

-- 2. FR-IAM-004: an approval is given by the acting user (recordApproval: approver = app.user_id).
CREATE FUNCTION approval_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.approver_id IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'an approval is given by the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_actor_guard BEFORE INSERT ON approval
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION approval_actor_guard();

-- The approval that decides an object: its own type and id, the same decision, given by the decider.
CREATE FUNCTION approval_decides(p_approval_id uuid, p_object_type text, p_object_id uuid, p_decision text,
                                 p_approver_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM approval a
                 WHERE a.id = p_approval_id AND a.object_type = p_object_type AND a.object_id = p_object_id
                   AND a.decision = p_decision AND a.approver_id = p_approver_id)
$$;

-- 3. Pending requests (setting_change_request, market_go_live_request) are created pending by their requester, with
-- the decision columns given as trigger arguments empty.
CREATE FUNCTION pending_request_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'pending' OR NEW.requested_by IS DISTINCT FROM app_user_id()
     OR jsonb_strip_nulls(to_jsonb(NEW)) ?| TG_ARGV::text[] THEN
    RAISE EXCEPTION '% is created pending, by its requester, with no decision', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER setting_change_request_created_pending BEFORE INSERT ON setting_change_request
  FOR EACH ROW WHEN (current_user = 'nmp_app')
  EXECUTE FUNCTION pending_request_insert_guard('decided_by', 'decided_at', 'decision_reason', 'approval_id', 'version_id');
CREATE TRIGGER market_go_live_request_created_pending BEFORE INSERT ON market_go_live_request
  FOR EACH ROW WHEN (current_user = 'nmp_app')
  EXECUTE FUNCTION pending_request_insert_guard('decided_by', 'decided_at', 'decision_reason', 'approval_id');

-- A request is decided once (unchanged), a withdrawal records its reason (PLAN 1.1), a decision carrying an approval
-- (always for approved) carries the decider's own approval of this request, and the runtime role decides as the acting
-- user and withdraws only its own request.
CREATE OR REPLACE FUNCTION pending_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on % is not allowed (decisions are history)', TG_TABLE_NAME;
  END IF;
  IF (OLD.state = 'pending' AND NEW.state IN ('approved', 'rejected', 'withdrawn')
      AND to_jsonb(NEW) - TG_ARGV::text[] = to_jsonb(OLD) - TG_ARGV::text[]
      AND (NEW.state = 'withdrawn') = (NEW.decided_by IS NULL)
      AND (NEW.state <> 'withdrawn' OR (NEW.approval_id IS NULL AND NEW.decision_reason IS NOT NULL))) IS NOT TRUE THEN
    RAISE EXCEPTION '% changes once, from pending to its decision or withdrawal', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.approval_id IS NOT NULL OR NEW.state = 'approved')
     AND NOT approval_decides(NEW.approval_id, TG_TABLE_NAME, NEW.id, NEW.state, NEW.decided_by) THEN
    RAISE EXCEPTION '% is decided with the decider''s own approval of it', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_user = 'nmp_app' AND app_user_id() IS DISTINCT FROM coalesce(NEW.decided_by, NEW.requested_by) THEN
    RAISE EXCEPTION '% is decided by the acting user and withdrawn by its requester', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- AC-TEN4-4: draft -> live needs an approved go-live request whose approval passes the same check.
CREATE OR REPLACE FUNCTION market_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.state = 'draft' AND NEW.state = 'live' AND EXISTS (
            SELECT 1 FROM market_go_live_request r
            WHERE r.tenant_id = NEW.tenant_id AND r.market_id = NEW.id AND r.state = 'approved'
              AND approval_decides(r.approval_id, 'market_go_live_request', r.id, 'approved', r.decided_by))) THEN
    RAISE EXCEPTION 'a market goes from draft to live only through an approved go-live request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 4. Cases (FR-CAS-001): opened by the acting user, undecided; decided only with an approval of this case
-- (object_type 'case', ApprovalInput) by someone who neither opened, submitted nor added evidence to it.
CREATE FUNCTION case_file_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'open' OR NEW.opened_by IS DISTINCT FROM app_user_id()
     OR jsonb_strip_nulls(to_jsonb(NEW)) ?| ARRAY['submitted_by', 'submitted_at', 'decided_at', 'approval_id'] THEN
    RAISE EXCEPTION 'a case is opened by the acting user, open and undecided' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER case_file_created_open BEFORE INSERT ON case_file
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION case_file_insert_guard();

CREATE OR REPLACE FUNCTION case_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on case_file is not allowed (cases are history)';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.type, NEW.subject_type, NEW.subject_id, NEW.opened_by, NEW.market_id, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.type, OLD.subject_type, OLD.subject_id, OLD.opened_by,
                         OLD.market_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a case''s type, subject, opener and market never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state IN ('approved', 'rejected', 'withdrawn')
     OR NOT (NEW.state = OLD.state
             OR (OLD.state = 'open' AND NEW.state IN ('submitted', 'withdrawn'))
             OR (OLD.state = 'submitted' AND NEW.state IN ('approved', 'rejected', 'withdrawn'))) THEN
    RAISE EXCEPTION 'case state cannot change from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state IN ('approved', 'rejected') AND NOT EXISTS (
       SELECT 1 FROM approval a
       WHERE a.id = NEW.approval_id AND a.object_type = 'case' AND a.object_id = NEW.id AND a.decision = NEW.state
         AND a.approver_id <> NEW.opened_by AND a.approver_id IS DISTINCT FROM NEW.submitted_by
         AND NOT EXISTS (SELECT 1 FROM case_evidence e
                         WHERE e.tenant_id = NEW.tenant_id AND e.case_id = NEW.id AND e.added_by = a.approver_id)) THEN
    RAISE EXCEPTION 'a case is decided with an approval of it by someone who did not prepare it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 5. D-B1-01 money-key backstop, at commit, over the effective chain (for each effective_from the highest version). A
-- rebase inserts rows that are briefly out of order, so the check is deferred, and it walks the chain rather than
-- trusting versions to rise with effective_from: a backdated row cannot become the baseline of a later one. Every chain
-- row from NEW's date on whose money key differs from its chain predecessor needs the approval of an approved
-- setting_change_request for exactly that key, value and effective_from (rebase rows copy that approval).
CREATE FUNCTION money_change_approved(p_approval_id uuid, p_key text, p_value jsonb, p_effective_from timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM approval a
    JOIN setting_change_request r ON r.tenant_id = a.tenant_id AND r.id = a.object_id AND r.approval_id = a.id
    WHERE a.id = p_approval_id AND a.object_type = 'setting_change_request' AND a.decision = 'approved'
      AND r.state = 'approved' AND r.key = p_key AND r.value = coalesce(p_value, 'null'::jsonb)
      AND r.effective_from = p_effective_from)
$$;

DROP TRIGGER tenant_setting_version_money_guard ON tenant_setting_version;
CREATE OR REPLACE FUNCTION tenant_setting_version_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  unapproved record;
BEGIN
  SELECT c.version, k.key INTO unapproved
  FROM (
    SELECT chain.version, chain.effective_from, chain.settings, chain.approval_id,
           coalesce(lag(chain.settings) OVER (ORDER BY chain.effective_from), '{}'::jsonb) AS previous
    FROM (SELECT DISTINCT ON (v.effective_from) v.version, v.effective_from, v.settings, v.approval_id
          FROM tenant_setting_version v WHERE v.tenant_id = NEW.tenant_id
          ORDER BY v.effective_from, v.version DESC) AS chain
  ) AS c
  CROSS JOIN unnest(money_setting_keys()) AS k (key)
  WHERE c.effective_from >= NEW.effective_from
    AND c.settings -> k.key IS DISTINCT FROM c.previous -> k.key
    AND NOT money_change_approved(c.approval_id, k.key, c.settings -> k.key, c.effective_from)
  ORDER BY c.effective_from
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'setting % is money-affecting: version % changes it without its approval', unapproved.key,
      unapproved.version USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tenant_setting_version_money_guard AFTER INSERT ON tenant_setting_version
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tenant_setting_version_money_guard();

-- 6. AC-INT1-3/4: an attempt is created scheduled and unattempted, and a settled outcome matches its response.
CREATE FUNCTION webhook_delivery_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.outcome <> 'scheduled'
     OR jsonb_strip_nulls(to_jsonb(NEW)) ?| ARRAY['attempted_at', 'status', 'error', 'duration_ms'] THEN
    RAISE EXCEPTION 'a webhook delivery attempt is created scheduled and unattempted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webhook_delivery_created_scheduled BEFORE INSERT ON webhook_delivery
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION webhook_delivery_insert_guard();
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_outcome_matches_response CHECK (
  (outcome <> 'delivered' OR (status IS NOT NULL AND status BETWEEN 200 AND 299 AND error IS NULL))
  AND (outcome NOT IN ('failed', 'dead') OR error IS NOT NULL OR (status IS NOT NULL AND status NOT BETWEEN 200 AND 299)));

-- 7. PLAN 1 recipe: every tenant table can be the target of a composite key.
ALTER TABLE case_event ADD UNIQUE (tenant_id, id);
ALTER TABLE case_evidence ADD UNIQUE (tenant_id, id);
ALTER TABLE webhook_delivery ADD UNIQUE (tenant_id, id);
