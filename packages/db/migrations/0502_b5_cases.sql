-- B5 cases (PLAN B5 section 1.3; D-B5-15, D-B5-16, D-B5-12; section B LOW-1): disputes opened only by the line owner in
-- a portal transaction, system-opened privacy and shared-account bank-detail cases, the escalation event, the overdue
-- lookup and the approvals-required backstop for money cases.

-- 1. One open dispute per statement line (409 DISPUTE_OPEN).
CREATE UNIQUE INDEX case_file_one_open_dispute ON case_file (tenant_id, subject_id)
  WHERE type = 'dispute' AND state IN ('open', 'submitted');

-- 2. System-opened types: privacy is never user-opened; bank_detail is system-opened by the self-service shared-account
-- review and user-opened by staff; a dispute is never system-opened.
ALTER TABLE case_file
  DROP CONSTRAINT case_file_system_opened,
  ADD CONSTRAINT case_file_system_opened
    CHECK (opened_by_kind = 'user' OR type IN ('duplicate', 'returned_payment', 'privacy', 'bank_detail')),
  ADD CONSTRAINT case_file_privacy_system_opened CHECK (type <> 'privacy' OR opened_by_kind = 'system'),
  -- LOW-1 (TK-B4-11/12): a submitted or decided adjustment or write-off carries the approvals it needs.
  ADD CONSTRAINT case_file_money_approvals_pinned
    CHECK (type NOT IN ('adjustment', 'write_off') OR state IN ('open', 'withdrawn') OR approvals_required IS NOT NULL) NOT VALID;

-- Insert guard (nmp_app): as 0401, plus: a portal transaction inserts only a dispute it opens or a system-opened privacy
-- or bank_detail case; a dispute is opened in a portal transaction by the payee of a committed line, about that line,
-- with the line's stored trace copied verbatim and the market of the line's position.
CREATE OR REPLACE FUNCTION case_file_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'open'
     OR NOT ((NEW.opened_by_kind = 'user' AND NEW.opened_by = app_user_id())
             OR (NEW.opened_by_kind = 'system' AND NEW.opened_by IS NULL
                 AND NEW.type IN ('duplicate', 'returned_payment', 'privacy', 'bank_detail')))
     OR jsonb_strip_nulls(to_jsonb(NEW))
          ?| ARRAY['submitted_by', 'submitted_at', 'decided_at', 'approval_id', 'first_approval_id', 'approvals_required'] THEN
    RAISE EXCEPTION 'a case is opened by the acting user (or by the system for a duplicate, a returned payment, a privacy request or a shared bank account), open and undecided'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_participant_id() IS NOT NULL
     AND NOT (NEW.type = 'dispute' OR (NEW.opened_by_kind = 'system' AND NEW.type IN ('privacy', 'bank_detail'))) THEN
    RAISE EXCEPTION 'a portal transaction opens only a dispute, a privacy request or a bank-detail review'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.type = 'dispute' AND NOT (
       app_participant_id() IS NOT NULL AND NEW.opened_by_kind = 'user'
       AND NEW.payload ->> 'participant_id' = app_participant_id()::text
       AND NEW.subject_type = 'result_line' AND NEW.payload ->> 'line_id' = NEW.subject_id::text
       AND EXISTS (
         SELECT 1 FROM result_line l
         JOIN run r ON r.tenant_id = l.tenant_id AND r.id = l.run_id
         JOIN position p ON p.tenant_id = l.tenant_id AND p.id = l.payee_position_id
         WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.subject_id AND r.state = 'committed'
           AND l.payee_participant_id = app_participant_id() AND l.trace = NEW.payload -> 'trace'
           AND NEW.payload ->> 'run_id' = r.id::text AND NEW.market_id IS NOT DISTINCT FROM p.market_id)) THEN
    RAISE EXCEPTION 'a dispute is opened by the payee of a committed line, in its portal session, with the line''s trace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 3. The overdue-dispute job's event (D-B5-15).
ALTER TABLE case_event
  DROP CONSTRAINT case_event_kind_check,
  ADD CONSTRAINT case_event_kind_check CHECK (kind IN ('opened', 'evidence_added', 'assigned', 'submitted', 'first_approved',
                                                       'approved', 'rejected', 'withdrawn', 'updated', 'escalated'));

-- System realm only: submitted disputes past their due date with no escalation yet (comp.disputes.overdue).
CREATE FUNCTION comp_overdue_disputes(p_limit int) RETURNS TABLE (tenant_id uuid, case_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT c.tenant_id, c.id FROM case_file c
    WHERE c.type = 'dispute' AND c.state = 'submitted' AND c.due_at < now()
      AND NOT EXISTS (SELECT 1 FROM case_event e WHERE e.tenant_id = c.tenant_id AND e.case_id = c.id AND e.kind = 'escalated')
    ORDER BY c.due_at, c.id
    LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION comp_overdue_disputes(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION comp_overdue_disputes(int) TO nmp_app;
