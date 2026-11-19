-- B5 review fix (D-B5-24, AC-17.1): the approval stores the exclusions it recalculated, so notify_batch announces the
-- reasons in force when the money moved (a hold placed or a cooling-off restarted after submit), not those of submit.
-- payout_batch_guard as 0407, except exclusions may also change on reviewed -> approved (the total still may not).
CREATE OR REPLACE FUNCTION payout_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on payout_batch is not allowed (cancel it instead)';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.prepared_by IS DISTINCT FROM app_user_id()
       OR num_nonnulls(NEW.submitted_by, NEW.submitted_at, NEW.approval_id, NEW.approved_at, NEW.cancelled_by,
                       NEW.cancelled_at, NEW.cancel_reason) > 0 THEN
      RAISE EXCEPTION 'a payout batch is prepared as a draft by the acting user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM provider_config c
         JOIN market m ON m.tenant_id = c.tenant_id AND m.id = c.market_id
         JOIN period p ON p.tenant_id = NEW.tenant_id AND p.id = NEW.period_id
         JOIN calendar k ON k.tenant_id = p.tenant_id AND k.id = p.calendar_id
         WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.provider_config_id AND c.kind = 'payout' AND c.state = 'recorded'
           AND c.market_id = NEW.market_id AND m.currency = NEW.currency AND k.market_id = NEW.market_id
           AND p.state IN ('committed', 'paid', 'closed')) THEN
      RAISE EXCEPTION 'a payout batch pays in its market''s currency through a recorded payout provider of the market, for a committed period of it'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.market_id, NEW.provider_config_id, NEW.period_id, NEW.currency, NEW.prepared_by,
      NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.market_id, OLD.provider_config_id, OLD.period_id, OLD.currency,
                         OLD.prepared_by, OLD.created_at)
     OR NOT (NEW.state = OLD.state
             OR (OLD.state, NEW.state) IN (('draft', 'reviewed'), ('draft', 'cancelled'), ('reviewed', 'draft'),
                                           ('reviewed', 'approved'), ('reviewed', 'cancelled'), ('approved', 'instructing'),
                                           ('instructing', 'partially_settled'), ('instructing', 'settled'),
                                           ('instructing', 'failed'), ('partially_settled', 'settled'),
                                           ('partially_settled', 'failed'), ('failed', 'instructing')))
     OR (NEW.total_minor IS DISTINCT FROM OLD.total_minor AND OLD.state <> 'draft' AND NEW.state <> 'draft')
     OR (NEW.exclusions IS DISTINCT FROM OLD.exclusions AND OLD.state <> 'draft' AND NEW.state <> 'draft'
         AND (OLD.state, NEW.state) <> ('reviewed', 'approved')) THEN
    RAISE EXCEPTION 'payout batch cannot change from % to % (identity fixed; total changes in a draft, exclusions in a draft or at approval)', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.submitted_by, NEW.submitted_at) IS DISTINCT FROM (OLD.submitted_by, OLD.submitted_at)
     AND NOT (OLD.state = 'draft' AND NEW.state = 'reviewed' AND NEW.submitted_by = app_user_id()) THEN
    RAISE EXCEPTION 'a payout batch is submitted by the acting user, when it is submitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'draft' AND NEW.state = 'reviewed' AND (NEW.total_minor = 0 OR NEW.total_minor IS DISTINCT FROM (
       SELECT sum(l.amount_minor) FROM payout_batch_line l WHERE l.tenant_id = NEW.tenant_id AND l.batch_id = NEW.id)) THEN
    RAISE EXCEPTION 'a payout batch is submitted with lines totalling it' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.approval_id, NEW.approved_at) IS DISTINCT FROM (OLD.approval_id, OLD.approved_at)
     AND NOT (OLD.state = 'reviewed' AND NEW.state = 'approved') THEN
    RAISE EXCEPTION 'a payout batch''s approval is recorded once, when it is approved' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'reviewed' AND NEW.state = 'approved' AND NOT EXISTS (
       SELECT 1 FROM approval a
       WHERE a.id = NEW.approval_id AND a.object_type = 'payout_batch' AND a.object_id = NEW.id AND a.decision = 'approved'
         AND a.approver_id <> NEW.prepared_by AND a.approver_id IS DISTINCT FROM NEW.submitted_by) THEN
    RAISE EXCEPTION 'a payout batch is approved by neither its preparer nor its submitter' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'approved' AND NEW.state = 'instructing' AND EXISTS (
       (SELECT l.participant_id, l.amount_minor, l.bank_detail_version_id FROM payout_batch_line l
        WHERE l.tenant_id = NEW.tenant_id AND l.batch_id = NEW.id
        EXCEPT ALL
        SELECT i.payee_participant_id, i.amount_minor, i.bank_detail_version_id FROM payout_instruction i
        WHERE i.tenant_id = NEW.tenant_id AND i.batch_id = NEW.id)
       UNION ALL
       (SELECT i.payee_participant_id, i.amount_minor, i.bank_detail_version_id FROM payout_instruction i
        WHERE i.tenant_id = NEW.tenant_id AND i.batch_id = NEW.id
        EXCEPT ALL
        SELECT l.participant_id, l.amount_minor, l.bank_detail_version_id FROM payout_batch_line l
        WHERE l.tenant_id = NEW.tenant_id AND l.batch_id = NEW.id)) THEN
    RAISE EXCEPTION 'a payout batch is instructed with one instruction per line, as the line' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'settled' AND OLD.state <> 'settled' AND EXISTS (
       SELECT 1 FROM payout_instruction i
       WHERE i.tenant_id = NEW.tenant_id AND i.batch_id = NEW.id AND i.state <> 'settled'
         AND NOT EXISTS (SELECT 1 FROM payout_instruction r WHERE r.tenant_id = i.tenant_id AND r.retry_of = i.id)) THEN
    RAISE EXCEPTION 'a payout batch is settled only when every instruction no retry replaced is' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.cancelled_by, NEW.cancelled_at, NEW.cancel_reason) IS DISTINCT FROM (OLD.cancelled_by, OLD.cancelled_at, OLD.cancel_reason)
     AND NOT (OLD.state <> 'cancelled' AND NEW.state = 'cancelled' AND NEW.cancelled_by = app_user_id()) THEN
    RAISE EXCEPTION 'a payout batch is cancelled once, by the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

