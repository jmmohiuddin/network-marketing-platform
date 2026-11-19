-- B4 DB review fixes: one ledger entry per origin and event, bound to its posting rule (PLAN 4.3); market currency frozen
-- once the ledger or a payout batch uses it (DATABASE C-14); bank-detail versions as requested; payout instructions are
-- the approved batch lines, and a failed one is retried once, up to its amount, with lineage (D-B4-12); tax profiles
-- never close retroactively (D-B4-17).

-- 1. Market currency: frozen once a ledger account or a payout batch of the market exists. The account insert holds the
-- market row (FOR SHARE), so a concurrent currency change either waits and then sees the account or wins and the
-- insert finds another currency.
CREATE FUNCTION market_currency_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ledger_account a WHERE a.tenant_id = NEW.tenant_id AND a.market_id = NEW.id)
     OR EXISTS (SELECT 1 FROM payout_batch b WHERE b.tenant_id = NEW.tenant_id AND b.market_id = NEW.id) THEN
    RAISE EXCEPTION 'a market''s currency is fixed once its ledger or payouts use it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER market_currency_frozen BEFORE UPDATE OF currency ON market
  FOR EACH ROW WHEN (NEW.currency IS DISTINCT FROM OLD.currency) EXECUTE FUNCTION market_currency_frozen();

CREATE OR REPLACE FUNCTION ledger_account_currency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM market m WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.market_id AND m.currency = NEW.currency FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a ledger account is kept in its market''s currency' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 2. The key names the origin and event (PLAN 4.3), so the unique key allows one entry per origin and event; returned
-- and failed share a key and exclude each other.
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_key_is_origin CHECK (idempotency_key = CASE event_type
  WHEN 'run_committed' THEN 'run:' || origin_id::text
  WHEN 'write_off' THEN 'writeoff:' || origin_id::text
  WHEN 'payout_instructed' THEN 'instr:' || origin_id::text || ':instructed'
  WHEN 'payout_settled' THEN 'instr:' || origin_id::text || ':settled'
  ELSE 'instr:' || origin_id::text || ':returned' END);

-- An instruction's entry follows its state: instructed while pending (written with it), settled, returned or failed
-- after it reached that state.
CREATE OR REPLACE FUNCTION journal_entry_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ok boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
                 WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.period_id AND c.market_id = NEW.market_id) THEN
    RAISE EXCEPTION 'a journal entry is attributed to a period of its market' USING ERRCODE = 'check_violation';
  END IF;
  ok := CASE NEW.origin_type
    WHEN 'run' THEN EXISTS (
      SELECT 1 FROM run r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.origin_id AND r.state = 'committed'
        AND r.period_id = NEW.period_id AND r.approval_id = NEW.approval_id)
    WHEN 'payout_instruction' THEN EXISTS (
      SELECT 1 FROM payout_instruction i JOIN payout_batch b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
      WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.origin_id AND b.market_id = NEW.market_id AND b.period_id = NEW.period_id
        AND i.state = CASE NEW.event_type WHEN 'payout_instructed' THEN 'pending' WHEN 'payout_settled' THEN 'settled'
                                          WHEN 'payout_returned' THEN 'returned' ELSE 'failed' END
        AND (NEW.approval_id IS NULL OR EXISTS (
              SELECT 1 FROM approval a WHERE a.id = NEW.approval_id AND a.object_type = 'payout_batch'
                AND a.object_id = b.id AND a.decision = 'approved')))
    ELSE EXISTS (
      SELECT 1 FROM case_file c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.origin_id AND c.type = 'write_off'
        AND c.state = 'approved' AND c.approval_id = NEW.approval_id AND c.market_id = NEW.market_id) END;
  IF NOT ok THEN
    RAISE EXCEPTION 'a journal entry posts an existing origin of its market and period, in the origin''s state, with the origin''s approval'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- At COMMIT an instruction's or write-off's entry carries exactly the two lines of its posting rule for the origin's
-- amount and payee (PLAN 4.3); a run's lines are built and controlled by led_post_run (D-B4-02).
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_amount bigint;
  v_payee uuid;
BEGIN
  IF (SELECT count(*) < 2 OR sum(p.debit_minor) <> sum(p.credit_minor) FROM posting p WHERE p.entry_id = NEW.id) THEN
    RAISE EXCEPTION 'journal entry % needs at least two postings and debits equal to credits', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.origin_type = 'run' THEN
    RETURN NULL;
  ELSIF NEW.origin_type = 'payout_instruction' THEN
    SELECT i.amount_minor, i.payee_participant_id INTO v_amount, v_payee
    FROM payout_instruction i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.origin_id;
  ELSE
    SELECT CASE WHEN c.payload ->> 'amount_minor' ~ '^[1-9][0-9]{0,17}$' THEN (c.payload ->> 'amount_minor')::bigint END,
           a.payee_participant_id INTO v_amount, v_payee
    FROM case_file c JOIN ledger_account a ON a.tenant_id = c.tenant_id AND a.id = c.subject_id AND a.type = 'clawback_receivable'
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.origin_id;
  END IF;
  IF v_amount IS NULL OR EXISTS (
       WITH actual AS (
         SELECT a.type, a.payee_participant_id AS payee, x.debit_minor AS debit, x.credit_minor AS credit
         FROM posting x JOIN ledger_account a ON a.id = x.account_id WHERE x.entry_id = NEW.id
       ), expected AS (
         SELECT e.type, e.payee, e.debit, e.credit FROM (VALUES
           ('payout_instructed', 'payee_payable', v_payee, v_amount, 0::bigint),
           ('payout_instructed', 'payout_in_transit', NULL, 0, v_amount),
           ('payout_settled', 'payout_in_transit', NULL, v_amount, 0),
           ('payout_settled', 'settled_clearing', NULL, 0, v_amount),
           ('payout_returned', 'payout_in_transit', NULL, v_amount, 0),
           ('payout_returned', 'payee_payable', v_payee, 0, v_amount),
           ('payout_failed', 'payout_in_transit', NULL, v_amount, 0),
           ('payout_failed', 'payee_payable', v_payee, 0, v_amount),
           ('write_off', 'write_off', NULL, v_amount, 0),
           ('write_off', 'clawback_receivable', v_payee, 0, v_amount)) AS e (event_type, type, payee, debit, credit)
         WHERE e.event_type = NEW.event_type
       )
       (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
       UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) THEN
    RAISE EXCEPTION 'journal entry % does not carry the lines of its % posting rule for its origin', NEW.id, NEW.event_type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

-- 3. A bank-detail version is the request the approver decided on (scheme, fingerprint and mask; the sealed details are
-- sealed again under the version's context and cannot be compared).
CREATE OR REPLACE FUNCTION bank_detail_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.superseded_at IS NOT NULL OR NEW.created_via <> 'case' OR NOT EXISTS (
       SELECT 1 FROM case_file c
       WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.type = 'bank_detail' AND c.state = 'approved'
         AND c.subject_type = 'participant' AND c.subject_id = NEW.participant_id
         AND c.payload ->> 'request_id' = NEW.request_id::text)
     OR NOT EXISTS (
       SELECT 1 FROM bank_detail_request r
       WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.request_id
         AND (r.scheme, r.fingerprint, r.masked) = (NEW.scheme, NEW.fingerprint, NEW.masked)) THEN
    RAISE EXCEPTION 'a bank-detail version is created current, as requested, from the approved bank_detail case of its request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- 4. Retry lineage (D-B4-12): a retry names the failed instruction it replaces; at most one retry per failed row and one
-- first instruction per payee and batch.
ALTER TABLE payout_instruction
  ADD COLUMN retry_of uuid,
  ADD FOREIGN KEY (tenant_id, retry_of) REFERENCES payout_instruction (tenant_id, id);
CREATE UNIQUE INDEX payout_instruction_one_retry ON payout_instruction (retry_of) WHERE retry_of IS NOT NULL;
CREATE UNIQUE INDEX payout_instruction_one_per_line ON payout_instruction (batch_id, payee_participant_id) WHERE retry_of IS NULL;

-- Instruction guard: created pending, unattempted, in its batch's currency, on the payee's current bank-detail version;
-- while the batch is approved it is a line of the batch (payee, amount, version); while the batch is failed it retries
-- one failed instruction of the same payee in the batch, for at most that amount. Updates as in 0402, retry_of fixed.
CREATE OR REPLACE FUNCTION payout_instruction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on payout_instruction is not allowed (history)';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT b.state INTO batch_state FROM payout_batch b
    WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.batch_id AND b.currency = NEW.currency FOR SHARE;
    IF NEW.state <> 'pending' OR NEW.attempts <> 0
       OR num_nonnulls(NEW.provider_ref, NEW.last_error, NEW.instructed_at, NEW.accepted_at, NEW.terminal_at) > 0
       OR NOT EXISTS (SELECT 1 FROM bank_detail_version v
                      WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.bank_detail_version_id AND v.superseded_at IS NULL)
       OR NOT (CASE batch_state
         WHEN 'approved' THEN NEW.retry_of IS NULL AND EXISTS (
           SELECT 1 FROM payout_batch_line l
           WHERE l.tenant_id = NEW.tenant_id AND l.batch_id = NEW.batch_id AND l.participant_id = NEW.payee_participant_id
             AND l.amount_minor = NEW.amount_minor AND l.bank_detail_version_id = NEW.bank_detail_version_id)
         WHEN 'failed' THEN EXISTS (
           SELECT 1 FROM payout_instruction f
           WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.retry_of AND f.batch_id = NEW.batch_id
             AND f.payee_participant_id = NEW.payee_participant_id AND f.state = 'failed' AND NEW.amount_minor <= f.amount_minor)
         ELSE false END) THEN
      RAISE EXCEPTION 'an instruction is created pending on current bank details: a line of its approved batch, or a retry of a failed instruction for at most its amount'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('settled', 'returned', 'failed', 'cancelled')
     OR (NEW.id, NEW.tenant_id, NEW.batch_id, NEW.payee_participant_id, NEW.bank_detail_version_id, NEW.amount_minor,
         NEW.currency, NEW.idempotency_key, NEW.signature, NEW.created_at, NEW.retry_of)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.batch_id, OLD.payee_participant_id, OLD.bank_detail_version_id,
                          OLD.amount_minor, OLD.currency, OLD.idempotency_key, OLD.signature, OLD.created_at, OLD.retry_of)
     OR NOT (NEW.state = OLD.state
             OR (OLD.state, NEW.state) IN (('pending', 'instructed'), ('pending', 'accepted'), ('pending', 'failed'),
                                           ('instructed', 'accepted'), ('instructed', 'settled'), ('instructed', 'returned'),
                                           ('instructed', 'failed'), ('accepted', 'settled'), ('accepted', 'returned'),
                                           ('accepted', 'failed')))
     OR (OLD.provider_ref IS NOT NULL AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref)
     OR NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'payout instruction cannot change from % to % (signed facts and terminal states are fixed)',
      OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 5. Batch guard as 0402, except: total and exclusions change only in a draft (or when a recalculation returns the batch
-- to draft); approved -> instructing needs the instructions to be the lines exactly; settled counts the instructions no
-- retry replaced.
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
     OR ((NEW.total_minor, NEW.exclusions) IS DISTINCT FROM (OLD.total_minor, OLD.exclusions)
         AND OLD.state <> 'draft' AND NEW.state <> 'draft') THEN
    RAISE EXCEPTION 'payout batch cannot change from % to % (identity fixed; total and exclusions change in a draft)', OLD.state, NEW.state
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

-- 6. Tax profile (D-B4-17): the runtime role closes a version now or later, never in the past (milliseconds: a writer
-- passing a client timestamp taken after the transaction began is not refused for sub-millisecond precision).
CREATE FUNCTION tax_profile_not_retroactive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.valid_to < date_trunc('milliseconds', now()) THEN
    RAISE EXCEPTION 'a tax profile version is closed now or later, never retroactively' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_profile_not_retroactive BEFORE UPDATE OF valid_to ON tax_profile
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION tax_profile_not_retroactive();
