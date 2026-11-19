-- B4 obligations ledger (PLAN B4 section 1.1; D-B4-02..05, D-B4-19): accounts on first use, append-only balanced journal
-- entries, the GL mapping and stored GL exports. Obligations of the tenant, never funds. Recipe as 0300.

-- 1. ledger_account: one per (market, type, payee, credit type); payee-level types carry the payee (D-B4-04).
CREATE TABLE ledger_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('commission_expense', 'payee_payable', 'withholding_payable', 'payout_in_transit',
                                     'clawback_receivable', 'rounding_residue', 'write_off', 'credit_liability', 'breakage',
                                     'settled_clearing')),
  payee_participant_id uuid,
  credit_type_id uuid, -- V1 (no credit_type table yet)
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_account_payee_level
    CHECK ((payee_participant_id IS NOT NULL) = (type IN ('payee_payable', 'clawback_receivable', 'credit_liability'))),
  CONSTRAINT ledger_account_key UNIQUE NULLS NOT DISTINCT (tenant_id, market_id, type, payee_participant_id, credit_type_id),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, payee_participant_id) REFERENCES participant (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER ledger_account_no_mutation BEFORE UPDATE OR DELETE ON ledger_account
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION ledger_account_currency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM market m WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.market_id AND m.currency = NEW.currency) THEN
    RAISE EXCEPTION 'a ledger account is kept in its market''s currency' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_account_currency_guard BEFORE INSERT ON ledger_account
  FOR EACH ROW EXECUTE FUNCTION ledger_account_currency_guard();

-- 2. journal_entry: one per business event and idempotency key, attributed to a period of its market (D-B4-05); a human
-- approval where a human decided (section 4.3).
CREATE TABLE journal_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  period_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('run_committed', 'payout_instructed', 'payout_settled', 'payout_returned',
                                                 'payout_failed', 'write_off')),
  origin_type text NOT NULL CHECK (origin_type IN ('run', 'payout_instruction', 'case')),
  origin_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  approval_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type() CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CONSTRAINT journal_entry_origin CHECK (origin_type = CASE
    WHEN event_type = 'run_committed' THEN 'run' WHEN event_type = 'write_off' THEN 'case' ELSE 'payout_instruction' END),
  CONSTRAINT journal_entry_human_approval
    CHECK ((approval_id IS NOT NULL) = (event_type IN ('run_committed', 'payout_instructed', 'write_off'))),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id)
);
CREATE INDEX journal_entry_origin_idx ON journal_entry (tenant_id, origin_type, origin_id);
CREATE INDEX journal_entry_period_idx ON journal_entry (tenant_id, market_id, period_id);

-- 3. posting: one side of one line; same market as its entry, same currency as its account.
CREATE TABLE posting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  entry_id uuid NOT NULL,
  account_id uuid NOT NULL,
  debit_minor bigint NOT NULL CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL CHECK (credit_minor >= 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posting_one_side CHECK ((debit_minor <> 0) <> (credit_minor <> 0)),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES journal_entry (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES ledger_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX posting_account_idx ON posting (account_id, id);
CREATE INDEX posting_entry_idx ON posting (entry_id);

CREATE FUNCTION posting_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM ledger_account a JOIN journal_entry e ON e.tenant_id = a.tenant_id AND e.id = NEW.entry_id
       WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.account_id AND a.market_id = e.market_id AND a.currency = NEW.currency) THEN
    RAISE EXCEPTION 'a posting is in its entry''s market and its account''s currency' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posting_account_guard BEFORE INSERT ON posting FOR EACH ROW EXECUTE FUNCTION posting_account_guard();

-- 4. Append-only for every role (AC-14.3): the runtime role has no UPDATE or DELETE grant either; the error is logged.
CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_IMMUTABLE: % on % is not allowed (append-only ledger)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER journal_entry_immutable BEFORE UPDATE OR DELETE ON journal_entry FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER posting_immutable BEFORE UPDATE OR DELETE ON posting FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- 5. Balance (BR-LED-01). An entry's postings arrive in one INSERT statement, balanced (checked per statement, so a
-- run entry with thousands of postings is summed once); at COMMIT every new entry has at least two postings and
-- balances. Nothing joins an entry later.
CREATE FUNCTION postings_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM (SELECT n.entry_id, count(*) AS n, sum(n.debit_minor) - sum(n.credit_minor) AS diff
                      FROM new_rows n GROUP BY n.entry_id) s
       WHERE s.n < 2 OR s.diff <> 0 OR s.n <> (SELECT count(*) FROM posting p WHERE p.entry_id = s.entry_id)) THEN
    RAISE EXCEPTION 'an entry''s postings are written together, at least two, debits equal to credits'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER posting_balance AFTER INSERT ON posting REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION postings_balance();

CREATE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) < 2 OR sum(p.debit_minor) <> sum(p.credit_minor) FROM posting p WHERE p.entry_id = NEW.id) THEN
    RAISE EXCEPTION 'journal entry % needs at least two postings and debits equal to credits', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_entry_balanced AFTER INSERT ON journal_entry DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- 6. No human posting route (BR-LED-02): the runtime role posts only for an origin that exists, in the origin's period
-- and market, with the origin's approval: a committed run (its approval), an instruction of a batch (an approval of that
-- batch when instructed), an approved write-off case (its final approval).
CREATE FUNCTION journal_entry_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
        AND (NEW.approval_id IS NULL OR EXISTS (
              SELECT 1 FROM approval a WHERE a.id = NEW.approval_id AND a.object_type = 'payout_batch'
                AND a.object_id = b.id AND a.decision = 'approved')))
    ELSE EXISTS (
      SELECT 1 FROM case_file c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.origin_id AND c.type = 'write_off'
        AND c.state = 'approved' AND c.approval_id = NEW.approval_id AND c.market_id = NEW.market_id) END;
  IF NOT ok THEN
    RAISE EXCEPTION 'a journal entry posts an existing origin of its market and period, with the origin''s approval'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entry_origin_guard BEFORE INSERT ON journal_entry
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION journal_entry_origin_guard();

-- 7. gl_account_map (D-B4-19): one GL code per market and account type.
CREATE TABLE gl_account_map (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('commission_expense', 'payee_payable', 'withholding_payable',
                                                     'payout_in_transit', 'clawback_receivable', 'rounding_residue',
                                                     'write_off', 'credit_liability', 'breakage', 'settled_clearing')),
  gl_code text NOT NULL CHECK (gl_code ~ '^[A-Za-z0-9._:-]{1,64}$'),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, market_id, account_type),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id)
);
CREATE TRIGGER gl_account_map_updated_by_actor BEFORE INSERT OR UPDATE ON gl_account_map
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('updated_by');
CREATE TRIGGER gl_account_map_no_delete BEFORE DELETE ON gl_account_map
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation('a mapping is changed, not removed');

-- 8. export_job (0005): a service-account key may request an export (requested_by NULL, D-B2-03 actor pair).
ALTER TABLE export_job ADD COLUMN created_by_type text;
UPDATE export_job SET created_by_type = CASE WHEN requested_by IS NOT NULL THEN 'user' ELSE 'system' END;
ALTER TABLE export_job
  ALTER COLUMN created_by_type SET DEFAULT app_actor_type(),
  ALTER COLUMN created_by_type SET NOT NULL,
  ADD CONSTRAINT export_job_created_by_type_check CHECK (created_by_type IN ('user', 'service_account', 'system')),
  ADD CONSTRAINT export_job_requester CHECK ((created_by_type = 'user') = (requested_by IS NOT NULL)),
  ADD UNIQUE (tenant_id, id);

-- 9. journal_export (FR-FIN-005): the gzip CSV of one period's entries of one market, checked by sha256 when written.
CREATE TABLE journal_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  period_id uuid NOT NULL,
  export_job_id uuid NOT NULL,
  content bytea NOT NULL,
  content_sha256 bytea NOT NULL CHECK (length(content_sha256) = 32),
  line_count int NOT NULL CHECK (line_count > 0),
  debit_total_minor bigint NOT NULL,
  credit_total_minor bigint NOT NULL,
  created_by uuid NOT NULL DEFAULT app_user_id(), -- no key: a service-account key may create it
  created_by_type text NOT NULL DEFAULT app_actor_type() CHECK (created_by_type IN ('user', 'service_account', 'system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_export_balanced CHECK (debit_total_minor = credit_total_minor),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, export_job_id) REFERENCES export_job (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX journal_export_period_idx ON journal_export (tenant_id, market_id, period_id);
CREATE TRIGGER journal_export_no_mutation BEFORE UPDATE OR DELETE ON journal_export
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION journal_export_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content_sha256 IS DISTINCT FROM digest(NEW.content, 'sha256') THEN
    RAISE EXCEPTION 'journal_export.content_sha256 is the sha256 of its content' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
                 WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.period_id AND c.market_id = NEW.market_id) THEN
    RAISE EXCEPTION 'a journal export covers a period of its market' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_export_guard BEFORE INSERT ON journal_export FOR EACH ROW EXECUTE FUNCTION journal_export_guard();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
  'ledger_account', 'journal_entry', 'posting', 'gl_account_map', 'journal_export'
]::regclass[]) AS t;

GRANT SELECT, INSERT ON ledger_account, journal_entry, posting, gl_account_map, journal_export TO nmp_app;
GRANT UPDATE (gl_code, updated_by, updated_at) ON gl_account_map TO nmp_app;
