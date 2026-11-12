-- Ledger spike schema (MONEY.md §1, invariants I-2..I-5). Disposable prototype in database nmp_spike.
-- Objects are unqualified: db.ts creates a fresh schema and sets search_path before running this file.

CREATE TABLE ledger_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  market_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('commission_expense', 'payee_payable', 'withholding_payable', 'payout_in_transit',
    'clawback_receivable', 'rounding_residue', 'breakage', 'write_off', 'credit_liability', 'settled_clearing')),
  payee_participant_id uuid,
  credit_type_id uuid,
  currency char(3) NOT NULL,
  gl_code text,
  CHECK ((type IN ('payee_payable', 'clawback_receivable', 'credit_liability')) = (payee_participant_id IS NOT NULL))
);
CREATE UNIQUE INDEX ledger_account_key ON ledger_account (tenant_id, market_id, type, payee_participant_id, credit_type_id) NULLS NOT DISTINCT;

CREATE TABLE journal_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_type text NOT NULL,
  origin_type text NOT NULL,
  origin_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  approval_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_entry_idempotency UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX journal_entry_origin ON journal_entry (tenant_id, origin_type, origin_id);

-- Partitioned by posted month (MONEY.md §1.2). Every posting carries its entry's posted_at so lookups by entry prune to one partition.
CREATE TABLE posting (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES journal_entry (id),
  account_id uuid NOT NULL REFERENCES ledger_account (id),
  debit_minor bigint NOT NULL CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL CHECK (credit_minor >= 0),
  currency char(3) NOT NULL,
  posted_at timestamptz NOT NULL,
  CHECK ((debit_minor = 0) <> (credit_minor = 0)),
  PRIMARY KEY (id, posted_at)
) PARTITION BY RANGE (posted_at);
-- INCLUDE lets balance derivation run as an index-only scan (spec index is (account_id, id)).
CREATE INDEX posting_account ON posting (account_id) INCLUDE (posted_at, debit_minor, credit_minor);
CREATE INDEX posting_entry ON posting (entry_id, posted_at);
DO $$
DECLARE m date;
BEGIN
  FOR m IN SELECT generate_series(date_trunc('month', now()) - interval '2 months', date_trunc('month', now()) + interval '2 months', interval '1 month')::date LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF posting FOR VALUES FROM (%L) TO (%L)', 'posting_' || to_char(m, 'YYYYMM'), m, m + interval '1 month');
  END LOOP;
END $$;
CREATE TABLE posting_default PARTITION OF posting DEFAULT;

-- Balance projection: a cache of Σ postings per account, maintained in the posting transaction (I-4, FR-FIN-002).
CREATE TABLE account_balance (
  account_id uuid PRIMARY KEY REFERENCES ledger_account (id),
  debit_minor bigint NOT NULL,
  credit_minor bigint NOT NULL,
  postings bigint NOT NULL
);

-- One row per committed run: the run-level once-only guard (a second commit of the same run blocks, then finds it).
CREATE TABLE run_commit (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  approval_id uuid NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, run_id)
);

CREATE TABLE outbox_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  seq bigserial NOT NULL,
  topic text NOT NULL,
  key text NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  dispatched_at timestamptz,
  dead boolean NOT NULL DEFAULT false
);
CREATE INDEX outbox_event_pending ON outbox_event (dispatched_at, available_at) WHERE dispatched_at IS NULL;

-- I-2: Σ debit = Σ credit per entry, checked at COMMIT so an entry may be written posting by posting.
CREATE FUNCTION assert_entry_balanced(p_entry uuid, p_at timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n bigint;
BEGIN
  SELECT coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0), count(*) INTO d, c, n
  FROM posting WHERE entry_id = p_entry AND posted_at = p_at;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'unbalanced journal entry %: debit % credit % postings %', p_entry, d, c, n USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION posting_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE at timestamptz;
BEGIN
  SELECT posted_at INTO at FROM journal_entry WHERE id = NEW.entry_id;
  IF at IS DISTINCT FROM NEW.posted_at THEN
    RAISE EXCEPTION 'posting % posted_at % differs from its entry %', NEW.id, NEW.posted_at, at USING ERRCODE = '23514';
  END IF;
  PERFORM assert_entry_balanced(NEW.entry_id, NEW.posted_at);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER posting_balanced AFTER INSERT ON posting DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION posting_balanced();

-- An entry with no postings would pass the posting trigger vacuously.
CREATE FUNCTION entry_has_postings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_entry_balanced(NEW.id, NEW.posted_at);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entry_has_postings AFTER INSERT ON journal_entry DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION entry_has_postings();

-- I-3: append-only. Production also revokes UPDATE/DELETE/TRUNCATE from the app role; the trigger covers the owner too.
CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is forbidden: the ledger is append-only', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER journal_entry_append_only BEFORE UPDATE OR DELETE ON journal_entry FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER journal_entry_no_truncate BEFORE TRUNCATE ON journal_entry FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER posting_append_only BEFORE UPDATE OR DELETE ON posting FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER posting_no_truncate BEFORE TRUNCATE ON posting FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER run_commit_append_only BEFORE UPDATE OR DELETE ON run_commit FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Projection maintained set-based per INSERT statement; ORDER BY keeps row-lock order stable across concurrent writers.
CREATE FUNCTION project_balances() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_balance AS b (account_id, debit_minor, credit_minor, postings)
  SELECT account_id, sum(debit_minor), sum(credit_minor), count(*) FROM new_rows GROUP BY account_id ORDER BY account_id
  ON CONFLICT (account_id) DO UPDATE SET debit_minor = b.debit_minor + EXCLUDED.debit_minor,
    credit_minor = b.credit_minor + EXCLUDED.credit_minor, postings = b.postings + EXCLUDED.postings;
  RETURN NULL;
END $$;
CREATE TRIGGER posting_project AFTER INSERT ON posting REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION project_balances();
