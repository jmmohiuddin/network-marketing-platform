-- B6 migration schema (PLAN B6 sections 1.5 and 1.6; D-B6-09, D-B6-10, D-B6-11): the migration clearing account and the
-- opening entry, the migration object with its opening balances and state, parallel runs and their differences, and the
-- separation of migration batches and mappings from the compliance overlay.

-- 1. LED: the company-level clearing account of a migration's opening entry, and the entry itself.
ALTER TABLE ledger_account DROP CONSTRAINT ledger_account_type_check,
  ADD CONSTRAINT ledger_account_type_check CHECK (type IN ('commission_expense', 'payee_payable', 'withholding_payable',
    'payout_in_transit', 'clawback_receivable', 'rounding_residue', 'write_off', 'credit_liability', 'breakage',
    'settled_clearing', 'migration_clearing'));
ALTER TABLE gl_account_map DROP CONSTRAINT gl_account_map_account_type_check,
  ADD CONSTRAINT gl_account_map_account_type_check CHECK (account_type IN ('commission_expense', 'payee_payable',
    'withholding_payable', 'payout_in_transit', 'clawback_receivable', 'rounding_residue', 'write_off', 'credit_liability',
    'breakage', 'settled_clearing', 'migration_clearing'));

ALTER TABLE journal_entry
  DROP CONSTRAINT journal_entry_event_type_check,
  DROP CONSTRAINT journal_entry_origin_type_check,
  DROP CONSTRAINT journal_entry_origin,
  DROP CONSTRAINT journal_entry_human_approval,
  DROP CONSTRAINT journal_entry_key_is_origin,
  ADD CONSTRAINT journal_entry_event_type_check CHECK (event_type IN ('run_committed', 'payout_instructed', 'payout_settled',
    'payout_returned', 'payout_failed', 'write_off', 'migration_opening')),
  ADD CONSTRAINT journal_entry_origin_type_check CHECK (origin_type IN ('run', 'payout_instruction', 'case', 'migration')),
  ADD CONSTRAINT journal_entry_origin CHECK (origin_type = CASE
    WHEN event_type = 'run_committed' THEN 'run' WHEN event_type = 'write_off' THEN 'case'
    WHEN event_type = 'migration_opening' THEN 'migration' ELSE 'payout_instruction' END),
  ADD CONSTRAINT journal_entry_human_approval
    CHECK ((approval_id IS NOT NULL) = (event_type IN ('run_committed', 'payout_instructed', 'write_off', 'migration_opening'))),
  ADD CONSTRAINT journal_entry_key_is_origin CHECK (idempotency_key = CASE event_type
    WHEN 'run_committed' THEN 'run:' || origin_id::text
    WHEN 'write_off' THEN 'writeoff:' || origin_id::text
    WHEN 'migration_opening' THEN 'migration:' || origin_id::text || ':opening'
    WHEN 'payout_instructed' THEN 'instr:' || origin_id::text || ':instructed'
    WHEN 'payout_settled' THEN 'instr:' || origin_id::text || ':settled'
    ELSE 'instr:' || origin_id::text || ':returned' END);

-- 2. Kind separation (D-B6-09): a migration batch or mapping never touches compliance snapshots, and a batch attaches only
-- a mapping of its own kind. Mapping versions stay one tenant-wide sequence.
CREATE OR REPLACE FUNCTION cpl_loaded_batch_ids(p_tenant_id uuid, p_market_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb) FROM import_batch
  WHERE tenant_id = p_tenant_id AND market_id = p_market_id AND state = 'loaded' AND mapping_id IS NOT NULL
    AND period_from <= p_to AND period_to >= p_from AND kind = 'overlay'
$$;

DROP TRIGGER cpl_batch_loaded ON import_batch;
DROP TRIGGER cpl_batch_load_changed ON import_batch;
CREATE TRIGGER cpl_batch_loaded AFTER INSERT ON import_batch
  FOR EACH ROW WHEN (NEW.state = 'loaded' AND NEW.kind = 'overlay') EXECUTE FUNCTION cpl_outdate_snapshots();
CREATE TRIGGER cpl_batch_load_changed AFTER UPDATE OF state ON import_batch
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND 'loaded' IN (OLD.state, NEW.state) AND NEW.kind = 'overlay')
  EXECUTE FUNCTION cpl_outdate_snapshots();

ALTER TABLE import_mapping ADD COLUMN kind text NOT NULL DEFAULT 'overlay' CHECK (kind IN ('overlay', 'migration'));
CREATE TRIGGER import_mapping_kind_fixed BEFORE UPDATE OF kind ON import_mapping
  FOR EACH ROW WHEN (NEW.kind IS DISTINCT FROM OLD.kind) EXECUTE FUNCTION forbid_mutation('a mapping keeps its kind');
DROP TRIGGER cpl_mapping_version_created ON import_mapping;
CREATE TRIGGER cpl_mapping_version_created AFTER INSERT ON import_mapping
  FOR EACH ROW WHEN (NEW.kind = 'overlay') EXECUTE FUNCTION cpl_outdate_on_mapping_version();

CREATE FUNCTION import_batch_mapping_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- An unknown mapping is left to the foreign key (23503).
  IF EXISTS (SELECT 1 FROM import_mapping m WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.mapping_id AND m.kind <> NEW.kind) THEN
    RAISE EXCEPTION 'a batch attaches a mapping of its own kind' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_batch_mapping_kind BEFORE INSERT OR UPDATE OF mapping_id ON import_batch
  FOR EACH ROW EXECUTE FUNCTION import_batch_mapping_kind_guard();

-- 3. inbound_event: the one shared event of a migration's orders.
ALTER TABLE inbound_event DROP CONSTRAINT inbound_event_source_check,
  ADD CONSTRAINT inbound_event_source_check CHECK (source ~ '^(api|connector):[\x21-\x7e]{1,100}$'
    OR source ~ '^provider:[0-9a-f-]{36}$' OR source ~ '^migration:[0-9a-f-]{36}$');

-- 4. migration: draft -> applied | cancelled, applied -> opening_submitted -> opening_posted | applied (rejected),
-- opening_posted -> signed_off. Apply cannot be undone, so cancel is draft-only (D-B6-09).
CREATE TABLE migration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  cutover_period_id uuid NOT NULL,
  volume_key text NOT NULL CHECK (volume_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'applied', 'opening_submitted', 'opening_posted', 'signed_off', 'cancelled')),
  applied_counts jsonb CHECK (applied_counts IS NULL OR jsonb_typeof(applied_counts) = 'object'),
  applied_at timestamptz,
  opening_submitted_by uuid,
  opening_submitted_at timestamptz,
  opening_approval_id uuid,
  opening_entry_id uuid,
  signoff_approval_id uuid,
  signed_off_at timestamptz,
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_applied
    CHECK ((state IN ('draft', 'cancelled')) = (applied_at IS NULL) AND (applied_at IS NULL) = (applied_counts IS NULL)),
  CONSTRAINT migration_opening_submitted CHECK ((state IN ('opening_submitted', 'opening_posted', 'signed_off'))
    = (opening_submitted_by IS NOT NULL) AND (opening_submitted_by IS NULL) = (opening_submitted_at IS NULL)),
  CONSTRAINT migration_opening_posted CHECK ((state IN ('opening_posted', 'signed_off')) = (opening_approval_id IS NOT NULL)
    AND (opening_entry_id IS NULL OR opening_approval_id IS NOT NULL)),
  CONSTRAINT migration_signed_off
    CHECK ((state = 'signed_off') = (signoff_approval_id IS NOT NULL) AND (signoff_approval_id IS NULL) = (signed_off_at IS NULL)),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, import_batch_id) REFERENCES import_batch (tenant_id, id),
  FOREIGN KEY (tenant_id, cutover_period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, opening_submitted_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, opening_approval_id) REFERENCES approval (tenant_id, id),
  FOREIGN KEY (tenant_id, opening_entry_id) REFERENCES journal_entry (tenant_id, id),
  FOREIGN KEY (tenant_id, signoff_approval_id) REFERENCES approval (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX migration_one_per_market ON migration (tenant_id, market_id) WHERE state <> 'cancelled';
CREATE UNIQUE INDEX migration_one_per_batch ON migration (tenant_id, import_batch_id) WHERE state <> 'cancelled';
CREATE INDEX migration_cutover_idx ON migration (tenant_id, cutover_period_id);

-- 5. Opening balances (signed: positive owed to the payee) and opening qualification state as of the start of the cutover
-- period, staged while the migration is applied and frozen after (D-B6-10). The state columns have qualification_state's
-- shapes (the engine's prior-state row: JSON arrays).
CREATE TABLE migration_opening_balance (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  migration_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  PRIMARY KEY (tenant_id, migration_id, participant_id),
  FOREIGN KEY (tenant_id, migration_id) REFERENCES migration (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id)
);

CREATE TABLE migration_opening_state (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  migration_id uuid NOT NULL,
  position_id uuid NOT NULL,
  paid_as_rank jsonb NOT NULL CHECK (jsonb_typeof(paid_as_rank) = 'array'),
  highest_titles jsonb NOT NULL CHECK (jsonb_typeof(highest_titles) = 'array'),
  grace_used jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(grace_used) = 'array'),
  counters jsonb NOT NULL CHECK (jsonb_typeof(counters) = 'array'),
  carry jsonb NOT NULL CHECK (jsonb_typeof(carry) = 'array'),
  one_time_flags text[] NOT NULL,
  banked jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(banked) = 'array'),
  PRIMARY KEY (tenant_id, migration_id, position_id),
  FOREIGN KEY (tenant_id, migration_id) REFERENCES migration (tenant_id, id),
  FOREIGN KEY (tenant_id, position_id) REFERENCES position (tenant_id, id)
);

-- Rows are added and removed only while the migration is applied, for participants and positions of its market.
CREATE FUNCTION migration_opening_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_market uuid;
BEGIN
  SELECT m.market_id INTO v_market FROM migration m
  WHERE m.tenant_id = (row_data ->> 'tenant_id')::uuid AND m.id = (row_data ->> 'migration_id')::uuid AND m.state = 'applied'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opening balances and state change only while the migration is applied' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NOT (EXISTS (SELECT 1 FROM participant p WHERE p.id = (row_data ->> 'participant_id')::uuid AND p.market_id = v_market)
          OR EXISTS (SELECT 1 FROM position p WHERE p.id = (row_data ->> 'position_id')::uuid AND p.market_id = v_market)) THEN
    RAISE EXCEPTION 'opening rows belong to the migration''s market' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER migration_opening_balance_guard BEFORE INSERT OR DELETE ON migration_opening_balance
  FOR EACH ROW EXECUTE FUNCTION migration_opening_guard();
CREATE TRIGGER migration_opening_balance_no_update BEFORE UPDATE ON migration_opening_balance
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER migration_opening_state_guard BEFORE INSERT OR DELETE ON migration_opening_state
  FOR EACH ROW EXECUTE FUNCTION migration_opening_guard();
CREATE TRIGGER migration_opening_state_no_update BEFORE UPDATE ON migration_opening_state
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 6. Parallel runs (D-B6-11): a COMP simulation of kind parallel_run on the cutover period, compared by mig_compare.
ALTER TABLE simulation DROP CONSTRAINT simulation_kind_check,
  ADD CONSTRAINT simulation_kind_check CHECK (kind IN ('simulation', 'restatement_sandbox', 'parallel_run'));

CREATE TABLE parallel_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  migration_id uuid NOT NULL,
  simulation_id uuid NOT NULL,
  bonus_map jsonb NOT NULL CHECK (jsonb_typeof(bonus_map) = 'object'),
  state text NOT NULL DEFAULT 'calculating' CHECK (state IN ('calculating', 'compared', 'failed', 'superseded')),
  legacy_total_minor bigint,
  platform_total_minor bigint,
  error jsonb CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
  requested_by uuid NOT NULL DEFAULT app_user_id(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  compared_at timestamptz,
  CONSTRAINT parallel_run_compared CHECK ((compared_at IS NULL) = (legacy_total_minor IS NULL)
    AND (compared_at IS NULL) = (platform_total_minor IS NULL) AND (state <> 'compared' OR compared_at IS NOT NULL)
    AND (compared_at IS NULL OR state IN ('compared', 'superseded'))),
  CONSTRAINT parallel_run_failed CHECK ((state <> 'failed' OR error IS NOT NULL) AND (error IS NULL OR state IN ('failed', 'superseded'))),
  FOREIGN KEY (tenant_id, migration_id) REFERENCES migration (tenant_id, id),
  FOREIGN KEY (tenant_id, simulation_id) REFERENCES simulation (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, simulation_id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX parallel_run_one_current ON parallel_run (tenant_id, migration_id) WHERE state <> 'superseded';

-- Requested calculating by the acting user for a posted opening, on a parallel_run simulation of the cutover period;
-- calculating -> compared | failed | superseded, compared | failed -> superseded. The runtime role only supersedes
-- (mig_compare, the owner, compares).
CREATE FUNCTION parallel_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'calculating' OR NEW.requested_by IS DISTINCT FROM app_user_id()
       OR num_nonnulls(NEW.legacy_total_minor, NEW.platform_total_minor, NEW.error, NEW.compared_at) > 0 THEN
      RAISE EXCEPTION 'a parallel run is requested calculating by the acting user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM 1 FROM migration m WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.migration_id FOR SHARE;
    IF NOT EXISTS (
         SELECT 1 FROM migration m JOIN simulation s ON s.tenant_id = m.tenant_id AND s.period_id = m.cutover_period_id
         WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.migration_id AND m.state = 'opening_posted'
           AND s.id = NEW.simulation_id AND s.kind = 'parallel_run') THEN
      RAISE EXCEPTION 'a parallel run compares a parallel_run simulation of the cutover period once the opening is posted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.migration_id, NEW.simulation_id, NEW.bonus_map, NEW.requested_by, NEW.requested_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.migration_id, OLD.simulation_id, OLD.bonus_map, OLD.requested_by,
                         OLD.requested_at)
     OR NOT ((OLD.state = 'calculating' AND NEW.state IN ('compared', 'failed', 'superseded'))
             OR (OLD.state IN ('compared', 'failed') AND NEW.state = 'superseded'))
     OR (current_user = 'nmp_app' AND (NEW.state <> 'superseded' OR to_jsonb(NEW) - 'state' IS DISTINCT FROM to_jsonb(OLD) - 'state')) THEN
    RAISE EXCEPTION 'parallel run cannot change from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER parallel_run_guard BEFORE INSERT OR UPDATE ON parallel_run FOR EACH ROW EXECUTE FUNCTION parallel_run_guard();

-- The facade inserts the simulation first and MIG the parallel run after, in one transaction.
CREATE FUNCTION simulation_parallel_run_has_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parallel_run r WHERE r.tenant_id = NEW.tenant_id AND r.simulation_id = NEW.id) THEN
    RAISE EXCEPTION 'a parallel_run simulation is committed with its parallel run' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER simulation_parallel_run_has_run AFTER INSERT ON simulation DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.kind = 'parallel_run') EXECUTE FUNCTION simulation_parallel_run_has_run();

-- Inserted by mig_compare only (no grant). Classified (class, note) by the consultant while the run is compared and the
-- difference not accepted; accepted once, by someone other than its classifier.
CREATE TABLE parallel_run_difference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  parallel_run_id uuid NOT NULL,
  participant_id uuid,
  payee_ref text NOT NULL CHECK (length(payee_ref) BETWEEN 1 AND 200),
  rule_key text,
  legacy_bonus_types text[] NOT NULL,
  bonus_detail boolean NOT NULL,
  legacy_minor bigint NOT NULL,
  platform_minor bigint NOT NULL,
  delta_minor bigint NOT NULL,
  class text CHECK (class IN ('rule', 'data', 'rounding')),
  class_note text CHECK (class_note IS NULL OR length(trim(class_note)) BETWEEN 1 AND 1000),
  classified_by uuid,
  classified_at timestamptz,
  acceptance_approval_id uuid,
  accepted_at timestamptz,
  CONSTRAINT parallel_run_difference_delta CHECK (delta_minor = platform_minor - legacy_minor),
  CONSTRAINT parallel_run_difference_detail CHECK (bonus_detail = (rule_key IS NOT NULL)),
  CONSTRAINT parallel_run_difference_classified
    CHECK (num_nonnulls(class, class_note, classified_by, classified_at) IN (0, 4) AND (class IS NULL OR delta_minor <> 0)),
  CONSTRAINT parallel_run_difference_accepted CHECK ((acceptance_approval_id IS NULL) = (accepted_at IS NULL)
    AND (accepted_at IS NULL OR class IS NOT NULL)),
  FOREIGN KEY (tenant_id, parallel_run_id) REFERENCES parallel_run (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, classified_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, acceptance_approval_id) REFERENCES approval (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (parallel_run_id, payee_ref, rule_key),
  UNIQUE (tenant_id, id)
);

CREATE FUNCTION parallel_run_difference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  classification constant text[] := ARRAY['class', 'class_note', 'classified_by', 'classified_at'];
  acceptance constant text[] := ARRAY['acceptance_approval_id', 'accepted_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on parallel_run_difference is not allowed (history)';
  END IF;
  PERFORM 1 FROM parallel_run r WHERE r.tenant_id = OLD.tenant_id AND r.id = OLD.parallel_run_id FOR SHARE;
  IF to_jsonb(NEW) - classification - acceptance IS DISTINCT FROM to_jsonb(OLD) - classification - acceptance
     OR OLD.accepted_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM parallel_run r WHERE r.tenant_id = OLD.tenant_id AND r.id = OLD.parallel_run_id AND r.state = 'compared') THEN
    RAISE EXCEPTION 'a difference is classified and accepted while its parallel run is compared; accepted is final'
      USING ERRCODE = 'check_violation';
  END IF;
  IF current_user = 'nmp_app' AND to_jsonb(NEW) - acceptance IS DISTINCT FROM to_jsonb(OLD) - acceptance
     AND NEW.classified_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'a difference is classified by the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.accepted_at IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM approval a
       WHERE a.id = NEW.acceptance_approval_id AND a.object_type = 'parallel_run_difference' AND a.object_id = NEW.id
         AND a.decision = 'approved' AND a.approver_id <> NEW.classified_by) THEN
    RAISE EXCEPTION 'a difference is accepted with an approval of it by someone other than its classifier'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER parallel_run_difference_guard BEFORE UPDATE OR DELETE ON parallel_run_difference
  FOR EACH ROW EXECUTE FUNCTION parallel_run_difference_guard();

-- 7. migration guard (runtime role): created draft by the acting user from a loaded migration batch of a draft market,
-- cutting over in an open period of it without a live or committed run (no run snapshotted C before the migration);
-- each transition writes exactly its columns.
CREATE FUNCTION migration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed text[];
  latest parallel_run;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.created_by IS DISTINCT FROM app_user_id()
       OR num_nonnulls(NEW.applied_counts, NEW.applied_at, NEW.opening_submitted_by, NEW.opening_submitted_at,
                       NEW.opening_approval_id, NEW.opening_entry_id, NEW.signoff_approval_id, NEW.signed_off_at) > 0 THEN
      RAISE EXCEPTION 'a migration is created as a draft by the acting user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM market k WHERE k.tenant_id = NEW.tenant_id AND k.id = NEW.market_id AND k.state = 'draft')
       OR NOT EXISTS (SELECT 1 FROM import_batch b
                      WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.import_batch_id AND b.kind = 'migration'
                        AND b.state = 'loaded' AND b.market_id = NEW.market_id)
       OR NOT EXISTS (SELECT 1 FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
                      WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.cutover_period_id AND c.market_id = NEW.market_id
                        AND p.state = 'open'
                        AND NOT EXISTS (SELECT 1 FROM run r WHERE r.tenant_id = p.tenant_id AND r.period_id = p.id
                                          AND r.state IN ('queued', 'running', 'calculated', 'committed'))) THEN
      RAISE EXCEPTION 'a migration loads a loaded migration batch of a market in implementation, cutting over in an open, uncalculated period of it'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  allowed := CASE OLD.state || '>' || NEW.state
    WHEN 'draft>applied' THEN ARRAY['state', 'applied_counts', 'applied_at']
    WHEN 'draft>cancelled' THEN ARRAY['state']
    WHEN 'applied>opening_submitted' THEN ARRAY['state', 'opening_submitted_by', 'opening_submitted_at']
    WHEN 'opening_submitted>applied' THEN ARRAY['state', 'opening_submitted_by', 'opening_submitted_at']
    WHEN 'opening_submitted>opening_posted' THEN ARRAY['state', 'opening_approval_id', 'opening_entry_id']
    WHEN 'opening_posted>signed_off' THEN ARRAY['state', 'signoff_approval_id', 'signed_off_at'] END;
  IF allowed IS NULL OR to_jsonb(NEW) - allowed IS DISTINCT FROM to_jsonb(OLD) - allowed THEN
    RAISE EXCEPTION 'migration cannot change from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'applied' AND OLD.state = 'draft'
     AND NOT EXISTS (SELECT 1 FROM market k WHERE k.tenant_id = NEW.tenant_id AND k.id = NEW.market_id AND k.state = 'draft') THEN
    RAISE EXCEPTION 'a migration is applied while its market is in implementation' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'opening_submitted' AND NEW.opening_submitted_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'an opening is submitted by the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.state = 'opening_posted' AND NOT (
       EXISTS (SELECT 1 FROM approval a
               WHERE a.id = NEW.opening_approval_id AND a.object_type = 'migration' AND a.object_id = NEW.id
                 AND a.decision = 'approved' AND a.approver_id <> OLD.opening_submitted_by)
       AND CASE WHEN NEW.opening_entry_id IS NULL
                THEN NOT EXISTS (SELECT 1 FROM migration_opening_balance b WHERE b.tenant_id = NEW.tenant_id AND b.migration_id = NEW.id)
                ELSE EXISTS (SELECT 1 FROM journal_entry e
                             WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.opening_entry_id
                               AND e.idempotency_key = 'migration:' || NEW.id || ':opening' AND e.approval_id = NEW.opening_approval_id) END) THEN
    RAISE EXCEPTION 'an opening is posted with an approval by someone other than its submitter, and its entry when it has balances'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.state = 'signed_off' THEN
    SELECT * INTO latest FROM parallel_run r WHERE r.tenant_id = NEW.tenant_id AND r.migration_id = NEW.id AND r.state <> 'superseded';
    IF latest.state IS DISTINCT FROM 'compared' OR EXISTS (
         SELECT 1 FROM parallel_run_difference d
         WHERE d.tenant_id = NEW.tenant_id AND d.parallel_run_id = latest.id AND d.delta_minor <> 0 AND d.accepted_at IS NULL) THEN
      RAISE EXCEPTION 'a migration is signed off on a compared parallel run without unexplained differences'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM approval a
         WHERE a.id = NEW.signoff_approval_id AND a.id <> NEW.opening_approval_id AND a.object_type = 'migration'
           AND a.object_id = NEW.id AND a.decision = 'approved' AND a.approver_id <> NEW.created_by
           AND NOT EXISTS (SELECT 1 FROM parallel_run_difference d
                           WHERE d.tenant_id = NEW.tenant_id AND d.parallel_run_id = latest.id AND d.classified_by = a.approver_id)) THEN
      RAISE EXCEPTION 'a migration is signed off by neither its creator nor a classifier of its differences'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER migration_guard BEFORE INSERT OR UPDATE ON migration
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION migration_guard();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
  'migration', 'migration_opening_balance', 'migration_opening_state', 'parallel_run', 'parallel_run_difference'
]::regclass[]) AS t;
-- D-B6-13: one participant's money and qualification records: never in a portal transaction.
CREATE POLICY portal_hidden ON migration_opening_balance AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);
CREATE POLICY portal_hidden ON migration_opening_state AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);
CREATE POLICY portal_hidden ON parallel_run_difference AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);

GRANT SELECT, INSERT ON migration, parallel_run TO nmp_app;
GRANT UPDATE (state, applied_counts, applied_at, opening_submitted_by, opening_submitted_at, opening_approval_id,
              opening_entry_id, signoff_approval_id, signed_off_at) ON migration TO nmp_app;
GRANT UPDATE (state) ON parallel_run TO nmp_app;
GRANT SELECT, INSERT, DELETE ON migration_opening_balance, migration_opening_state TO nmp_app;
GRANT SELECT ON parallel_run_difference TO nmp_app;
GRANT UPDATE (class, class_note, classified_by, classified_at, acceptance_approval_id, accepted_at)
  ON parallel_run_difference TO nmp_app;
