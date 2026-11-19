-- B4 payouts (PLAN B4 section 1.3; D-B4-12..16, D-B4-20, D-B4-24): sandbox adapters on payout provider records, batches
-- with lines, signed instructions (the pending row is the outbox record), the sandbox provider's side, exceptions,
-- holds and versioned bank details. No real money moves (MONEY SAFETY): there is no endpoint column anywhere.

-- 1. provider_config: a payout record gets an adapter (sandbox or bank file, D-B4-14) and a review date (D-B4-20); a
-- webhook secret belongs to a commerce connector or a sandbox payout provider. Adapter, secret and review date change
-- only while recorded.
ALTER TABLE provider_config
  ADD COLUMN adapter text CHECK (adapter IN ('sandbox', 'bank_file_csv')),
  ADD COLUMN review_due_on date,
  ADD CONSTRAINT provider_config_adapter_payout CHECK (adapter IS NULL OR kind = 'payout'),
  ADD CONSTRAINT provider_config_webhook_secret CHECK (webhook_secret_sealed IS NULL OR kind = 'commerce' OR adapter = 'sandbox');

CREATE OR REPLACE FUNCTION provider_config_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  changing_fields constant text[] :=
    ARRAY['state', 'withdrawn_at', 'withdrawn_by', 'last_ok_at', 'webhook_secret_sealed', 'adapter', 'review_due_on'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on provider_config is not allowed (withdraw it instead)';
  END IF;
  IF (to_jsonb(NEW) - changing_fields = to_jsonb(OLD) - changing_fields
      AND ((NEW.state, NEW.withdrawn_at, NEW.withdrawn_by) IS NOT DISTINCT FROM (OLD.state, OLD.withdrawn_at, OLD.withdrawn_by)
           OR (OLD.state = 'recorded' AND NEW.state = 'withdrawn'))
      AND ((NEW.webhook_secret_sealed, NEW.adapter, NEW.review_due_on)
             IS NOT DISTINCT FROM (OLD.webhook_secret_sealed, OLD.adapter, OLD.review_due_on)
           OR (OLD.state = 'recorded' AND NEW.state = 'recorded'))) IS NOT TRUE THEN
    RAISE EXCEPTION 'a provider record changes once, from recorded to withdrawn (secret, adapter and review date change while recorded)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 2. bank_detail_request (D-B4-16): new details asked for by staff, sealed; only the mask and fingerprint are readable.
CREATE TABLE bank_detail_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  participant_id uuid NOT NULL,
  scheme text NOT NULL CHECK (scheme IN ('iban', 'local')),
  details_sealed text NOT NULL,
  contact_email_sealed text,
  fingerprint bytea NOT NULL CHECK (length(fingerprint) = 32),
  masked text NOT NULL CHECK (length(masked) BETWEEN 1 AND 40),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, participant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER bank_detail_request_no_mutation BEFORE UPDATE OR DELETE ON bank_detail_request
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER bank_detail_request_created_by_actor BEFORE INSERT ON bank_detail_request
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('created_by');

-- 3. bank_detail_version: one current version per participant; superseded once. The runtime role writes a version only
-- from the approved bank_detail case of its request (self-service arrives with the portal, migrations as the owner).
CREATE TABLE bank_detail_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  participant_id uuid NOT NULL,
  scheme text NOT NULL CHECK (scheme IN ('iban', 'local')),
  details_sealed text NOT NULL,
  fingerprint bytea NOT NULL CHECK (length(fingerprint) = 32),
  masked text NOT NULL CHECK (length(masked) BETWEEN 1 AND 40),
  created_via text NOT NULL CHECK (created_via IN ('self', 'case', 'migration')),
  request_id uuid,
  case_id uuid,
  cooling_off_until timestamptz NOT NULL,
  verified_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_detail_version_case CHECK ((created_via = 'case') = (case_id IS NOT NULL AND request_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id, request_id) REFERENCES bank_detail_request (tenant_id, participant_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES case_file (tenant_id, id),
  UNIQUE (tenant_id, participant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX bank_detail_version_current ON bank_detail_version (tenant_id, participant_id) WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX bank_detail_version_request ON bank_detail_version (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX bank_detail_version_fingerprint_idx ON bank_detail_version (tenant_id, fingerprint);
CREATE TRIGGER bank_detail_version_superseded_once BEFORE UPDATE OR DELETE ON bank_detail_version
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('superseded_at');

CREATE FUNCTION bank_detail_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.superseded_at IS NOT NULL OR NEW.created_via <> 'case' OR NOT EXISTS (
       SELECT 1 FROM case_file c
       WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.case_id AND c.type = 'bank_detail' AND c.state = 'approved'
         AND c.subject_type = 'participant' AND c.subject_id = NEW.participant_id
         AND c.payload ->> 'request_id' = NEW.request_id::text) THEN
    RAISE EXCEPTION 'a bank-detail version is created current, from the approved bank_detail case of its request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_detail_version_insert_guard BEFORE INSERT ON bank_detail_version
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION bank_detail_version_insert_guard();

-- 4. payout_batch (D-B4-12): draft -> reviewed -> approved -> instructing -> partially_settled | settled | failed;
-- reviewed -> draft on recalculation; failed -> instructing on retry; draft | reviewed -> cancelled. At most one open
-- batch per market.
CREATE TABLE payout_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  provider_config_id uuid NOT NULL,
  period_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'reviewed', 'approved', 'instructing', 'partially_settled',
                                                       'settled', 'failed', 'cancelled')),
  total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  exclusions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(exclusions) = 'array'),
  prepared_by uuid NOT NULL,
  submitted_by uuid,
  submitted_at timestamptz,
  approval_id uuid,
  approved_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(trim(cancel_reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_batch_submission CHECK ((submitted_by IS NULL) = (submitted_at IS NULL)),
  CONSTRAINT payout_batch_submitted CHECK (state IN ('draft', 'cancelled') OR submitted_by IS NOT NULL),
  CONSTRAINT payout_batch_approved
    CHECK (state IN ('draft', 'reviewed', 'cancelled') OR (approval_id IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT payout_batch_cancelled CHECK ((state = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT payout_batch_cancellation CHECK (num_nulls(cancelled_by, cancelled_at, cancel_reason) IN (0, 3)),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, provider_config_id) REFERENCES provider_config (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, prepared_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, submitted_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  FOREIGN KEY (tenant_id, cancelled_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX payout_batch_state_idx ON payout_batch (tenant_id, state);
CREATE INDEX payout_batch_period_idx ON payout_batch (tenant_id, period_id);
CREATE UNIQUE INDEX payout_batch_one_open ON payout_batch (tenant_id, market_id) WHERE state IN ('draft', 'reviewed');

-- 5. payout_batch_line: the payee's full payable, pinned to a bank-detail version of that payee; written while draft.
CREATE TABLE payout_batch_line (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  batch_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  bank_detail_version_id uuid NOT NULL,
  PRIMARY KEY (batch_id, participant_id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES payout_batch (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id, bank_detail_version_id) REFERENCES bank_detail_version (tenant_id, participant_id, id)
);

-- 6. payout_instruction (D-B4-13): key = id, sent on every attempt; signed; terminal states never change.
CREATE TABLE payout_instruction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  batch_id uuid NOT NULL,
  payee_participant_id uuid NOT NULL,
  bank_detail_version_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  idempotency_key text NOT NULL,
  signature bytea NOT NULL CHECK (length(signature) = 32),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'instructed', 'accepted', 'settled', 'returned', 'failed',
                                                         'cancelled')),
  provider_ref text CHECK (provider_ref IS NULL OR length(provider_ref) BETWEEN 1 AND 200),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  instructed_at timestamptz,
  accepted_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_instruction_key_is_id CHECK (idempotency_key = id::text),
  CONSTRAINT payout_instruction_terminal
    CHECK ((state IN ('settled', 'returned', 'failed', 'cancelled')) = (terminal_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES payout_batch (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_participant_id, bank_detail_version_id)
    REFERENCES bank_detail_version (tenant_id, participant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id)
);
CREATE INDEX payout_instruction_batch_idx ON payout_instruction (batch_id, state);
CREATE INDEX payout_instruction_ref_idx ON payout_instruction (tenant_id, provider_ref);
CREATE INDEX payout_instruction_payee_idx ON payout_instruction (tenant_id, payee_participant_id, state);
CREATE INDEX payout_instruction_due_idx ON payout_instruction (state, next_attempt_at) WHERE state IN ('pending', 'instructed');

-- Batch guard (runtime role): prepared draft by the acting user through a recorded payout provider of its market, in
-- the market's currency, for a committed period of it; identity fixed; lines and exclusions change while open; submitted
-- by the acting user with lines totalling the batch; approved by neither preparer nor submitter; instructing with
-- instructions totalling the batch; settled only when every instruction is; cancelled by the acting user.
CREATE FUNCTION payout_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
         AND OLD.state NOT IN ('draft', 'reviewed')) THEN
    RAISE EXCEPTION 'payout batch cannot change from % to % (identity fixed; lines change while open)', OLD.state, NEW.state
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
  IF OLD.state = 'approved' AND NEW.state = 'instructing' AND NEW.total_minor IS DISTINCT FROM (
       SELECT sum(i.amount_minor) FROM payout_instruction i WHERE i.tenant_id = NEW.tenant_id AND i.batch_id = NEW.id) THEN
    RAISE EXCEPTION 'a payout batch is instructed with instructions totalling it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'settled' AND OLD.state <> 'settled' AND EXISTS (
       SELECT 1 FROM payout_instruction i WHERE i.tenant_id = NEW.tenant_id AND i.batch_id = NEW.id AND i.state <> 'settled') THEN
    RAISE EXCEPTION 'a payout batch is settled only when every instruction is' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.cancelled_by, NEW.cancelled_at, NEW.cancel_reason) IS DISTINCT FROM (OLD.cancelled_by, OLD.cancelled_at, OLD.cancel_reason)
     AND NOT (OLD.state <> 'cancelled' AND NEW.state = 'cancelled' AND NEW.cancelled_by = app_user_id()) THEN
    RAISE EXCEPTION 'a payout batch is cancelled once, by the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_batch_guard BEFORE INSERT OR UPDATE ON payout_batch
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION payout_batch_guard();
CREATE TRIGGER payout_batch_no_delete BEFORE DELETE ON payout_batch
  FOR EACH ROW EXECUTE FUNCTION payout_batch_guard();

-- Lines are written and rewritten while their batch is a draft (FOR SHARE: a concurrent submit waits).
CREATE FUNCTION payout_batch_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_state text;
BEGIN
  SELECT b.state INTO batch_state FROM payout_batch b
  WHERE b.tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id) AND b.id = coalesce(NEW.batch_id, OLD.batch_id) FOR SHARE;
  IF batch_state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'payout batch lines change only while the batch is a draft' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_batch_line_guard BEFORE INSERT OR DELETE ON payout_batch_line
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION payout_batch_line_guard();
CREATE TRIGGER payout_batch_line_no_update BEFORE UPDATE ON payout_batch_line
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation('lines are deleted and written again');

-- Instruction guard (runtime role): created pending, unattempted, in its batch's currency while the batch is approved
-- (approval) or failed (retry); the signed facts never change; pending -> instructed | accepted | failed,
-- instructed -> instructed | accepted | settled | returned | failed, accepted -> settled | returned | failed; terminal
-- rows never change; the provider reference is set once; attempts only grow.
CREATE FUNCTION payout_instruction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on payout_instruction is not allowed (history)';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.attempts <> 0
       OR num_nonnulls(NEW.provider_ref, NEW.last_error, NEW.instructed_at, NEW.accepted_at, NEW.terminal_at) > 0
       OR NOT EXISTS (SELECT 1 FROM payout_batch b
                      WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.batch_id AND b.state IN ('approved', 'failed')
                        AND b.currency = NEW.currency
                      FOR SHARE) THEN
      RAISE EXCEPTION 'an instruction is created pending, in its batch''s currency, while the batch is approved or retried'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('settled', 'returned', 'failed', 'cancelled')
     OR (NEW.id, NEW.tenant_id, NEW.batch_id, NEW.payee_participant_id, NEW.bank_detail_version_id, NEW.amount_minor,
         NEW.currency, NEW.idempotency_key, NEW.signature, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.batch_id, OLD.payee_participant_id, OLD.bank_detail_version_id,
                          OLD.amount_minor, OLD.currency, OLD.idempotency_key, OLD.signature, OLD.created_at)
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
CREATE TRIGGER payout_instruction_guard BEFORE INSERT OR UPDATE ON payout_instruction
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION payout_instruction_guard();
CREATE TRIGGER payout_instruction_no_delete BEFORE DELETE ON payout_instruction
  FOR EACH ROW EXECUTE FUNCTION payout_instruction_guard();

-- 7. sandbox_provider_payment ("SANDBOX provider side", D-B4-14): at most one payment per provider and key.
CREATE TABLE sandbox_provider_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  provider_config_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider_ref text NOT NULL CHECK (length(provider_ref) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, provider_config_id) REFERENCES provider_config (tenant_id, id),
  UNIQUE (tenant_id, provider_config_id, idempotency_key),
  UNIQUE (tenant_id, provider_ref),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER sandbox_provider_payment_no_mutation BEFORE UPDATE OR DELETE ON sandbox_provider_payment
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 8. payout_exception (D-B4-15): resolved once, with a note, by the acting user.
CREATE TABLE payout_exception (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  provider_config_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('unknown_reference', 'amount_mismatch', 'duplicate_settlement')),
  instruction_id uuid,
  reference text NOT NULL CHECK (length(reference) BETWEEN 1 AND 200),
  amount_minor bigint,
  inbound_event_id uuid,
  detail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object'),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR length(trim(resolution_note)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_exception_resolution
    CHECK (num_nulls(resolved_by, resolved_at, resolution_note) = CASE state WHEN 'resolved' THEN 0 ELSE 3 END),
  FOREIGN KEY (tenant_id, provider_config_id) REFERENCES provider_config (tenant_id, id),
  FOREIGN KEY (tenant_id, instruction_id) REFERENCES payout_instruction (tenant_id, id),
  FOREIGN KEY (tenant_id, inbound_event_id) REFERENCES inbound_event (tenant_id, id),
  FOREIGN KEY (tenant_id, resolved_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX payout_exception_state_idx ON payout_exception (tenant_id, state, provider_config_id);

CREATE FUNCTION payout_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  resolution constant text[] := ARRAY['state', 'resolved_by', 'resolved_at', 'resolution_note'];
BEGIN
  IF TG_OP = 'DELETE' OR to_jsonb(NEW) - resolution IS DISTINCT FROM to_jsonb(OLD) - resolution
     OR NOT (OLD.state = 'open' AND NEW.state = 'resolved') THEN
    RAISE EXCEPTION 'a payout exception changes once, from open to resolved' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_exception_resolved_once BEFORE UPDATE OR DELETE ON payout_exception
  FOR EACH ROW EXECUTE FUNCTION payout_exception_guard();
CREATE TRIGGER payout_exception_resolved_by_actor BEFORE UPDATE ON payout_exception
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('resolved_by');

-- 9. payout_hold (FR-PAY-007): a dated hold with a reason, released once with a reason.
CREATE TABLE payout_hold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  participant_id uuid NOT NULL,
  market_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  placed_by uuid NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid,
  released_at timestamptz,
  release_reason text CHECK (release_reason IS NULL OR length(trim(release_reason)) BETWEEN 1 AND 500),
  CONSTRAINT payout_hold_release CHECK (num_nulls(released_by, released_at, release_reason) IN (0, 3)),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, placed_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, released_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX payout_hold_active_idx ON payout_hold (tenant_id, participant_id) WHERE released_at IS NULL;
CREATE TRIGGER payout_hold_released_once BEFORE UPDATE OR DELETE ON payout_hold
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('released_by', 'released_at', 'release_reason');
CREATE TRIGGER payout_hold_placed_by_actor BEFORE INSERT ON payout_hold
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('placed_by');
CREATE TRIGGER payout_hold_released_by_actor BEFORE UPDATE ON payout_hold
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('released_by');

-- 10. period (D-B4-24): committed -> paid once every instruction of the batches attributed to it is terminal (at least
-- one); paid is terminal in B4.
CREATE OR REPLACE FUNCTION period_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (NEW.state = OLD.state
          OR (OLD.state, NEW.state) IN (('open', 'calculating'), ('calculating', 'calculated'), ('calculating', 'open'),
                                        ('calculated', 'calculating'), ('calculated', 'committed'), ('committed', 'paid'))) THEN
    RAISE EXCEPTION 'period state cannot change from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.committed_run_id IS DISTINCT FROM OLD.committed_run_id AND NOT (OLD.state = 'calculated' AND NEW.state = 'committed') THEN
    RAISE EXCEPTION 'a period''s committed run is set once, when it is committed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'committed' AND OLD.state <> 'committed' AND NOT EXISTS (
       SELECT 1 FROM run r
       WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.committed_run_id AND r.period_id = NEW.id AND r.state = 'committed') THEN
    RAISE EXCEPTION 'a period is committed with a committed run of it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'paid' AND OLD.state = 'committed' AND NOT period_payouts_terminal(NEW.tenant_id, NEW.id) THEN
    RAISE EXCEPTION 'a period is paid once every instruction of its payout batches is terminal' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- At least one instruction of a batch attributed to the period, and none still pending, instructed or accepted.
CREATE FUNCTION period_payouts_terminal(p_tenant uuid, p_period uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*) > 0 AND count(*) FILTER (WHERE i.state IN ('pending', 'instructed', 'accepted')) = 0
  FROM payout_instruction i JOIN payout_batch b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
  WHERE b.tenant_id = p_tenant AND b.period_id = p_period
$$;

SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
  'bank_detail_request', 'bank_detail_version', 'payout_batch', 'payout_batch_line', 'payout_instruction',
  'sandbox_provider_payment', 'payout_exception', 'payout_hold'
]::regclass[]) AS t;

GRANT SELECT, INSERT ON bank_detail_request, bank_detail_version, payout_batch, payout_batch_line, payout_instruction,
  sandbox_provider_payment, payout_exception, payout_hold TO nmp_app;
GRANT UPDATE ON payout_batch, payout_instruction TO nmp_app;
GRANT DELETE ON payout_batch_line TO nmp_app;
GRANT UPDATE (superseded_at) ON bank_detail_version TO nmp_app;
GRANT UPDATE (state, resolved_by, resolved_at, resolution_note) ON payout_exception TO nmp_app;
GRANT UPDATE (released_by, released_at, release_reason) ON payout_hold TO nmp_app;
GRANT UPDATE (adapter, review_due_on) ON provider_config TO nmp_app;
