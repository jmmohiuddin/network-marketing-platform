-- CPL report snapshots (T-A11, FR-CPL-001..006): what a figure needs to be read on its own, a failure reason,
-- and the rule that a snapshot is outdated once the loaded batches behind its period range change.

-- Unconstrained numeric keeps the scale the method states ('62.50', '16000') and fits any bigint value.
ALTER TABLE compliance_figure
  ALTER COLUMN value_num TYPE numeric,
  ADD COLUMN period_kind text CHECK (period_kind IN ('month', 'year')),
  ADD COLUMN position int CHECK (position >= 0),
  -- NULL unit = an omitted indicator: value is NULL and note holds the reason (E-ADR-11).
  ADD COLUMN unit text CHECK (unit IN ('percent', 'minor', 'count', 'currency', 'ratio')),
  ADD COLUMN population text,
  ADD COLUMN method text,
  ADD COLUMN method_version text,
  ADD COLUMN partial boolean NOT NULL DEFAULT false,
  ADD COLUMN period_notes text[] NOT NULL DEFAULT '{}',
  DROP CONSTRAINT compliance_figure_snapshot_id_report_period_key_key,
  -- R3 has a month and a year period starting on the same date: the period kind tells them apart.
  ADD CONSTRAINT compliance_figure_snapshot_period_key UNIQUE NULLS NOT DISTINCT (snapshot_id, report, period_kind, period, key);

ALTER TABLE compliance_report_snapshot
  ADD COLUMN failure_reason text CHECK (failure_reason IS NULL OR state = 'failed');

-- Immutable except state (computing -> ready | failed | outdated, ready -> outdated) and the reason of a failure.
CREATE OR REPLACE FUNCTION compliance_report_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on compliance_report_snapshot is not allowed (immutable)';
  END IF;
  IF to_jsonb(NEW) - 'state' - 'failure_reason' <> to_jsonb(OLD) - 'state' - 'failure_reason' THEN
    RAISE EXCEPTION 'UPDATE on compliance_report_snapshot may change only state';
  END IF;
  IF NOT ((OLD.state = 'computing' AND NEW.state IN ('ready', 'failed', 'outdated'))
          OR (OLD.state = 'ready' AND NEW.state = 'outdated')) THEN
    RAISE EXCEPTION 'compliance_report_snapshot state cannot change from % to %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;

-- Serialises reading a market's loaded batches (snapshot creation) with changing them (batch load or supersede),
-- so a snapshot is either created on the new batch set or seen and outdated by the change.
CREATE FUNCTION cpl_lock_inputs(p_tenant_id uuid, p_market_id uuid) RETURNS void LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('cpl_inputs:' || p_tenant_id::text || ':' || p_market_id::text, 0))
$$;

-- The loaded batches of a market whose period overlaps the range, as a sorted JSON array of ids. A snapshot
-- stores this array as input_refs.batch_ids; it is outdated as soon as the array for its range differs.
CREATE FUNCTION cpl_loaded_batch_ids(p_tenant_id uuid, p_market_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb) FROM import_batch
  WHERE tenant_id = p_tenant_id AND market_id = p_market_id AND state = 'loaded'
    AND period_from <= p_to AND period_to >= p_from
$$;

-- A batch entering or leaving 'loaded' outdates the snapshots whose inputs it changes, audited in the same
-- transaction under the actor of that transaction (columns as in apps/api/src/lib/audit.ts).
CREATE FUNCTION cpl_outdate_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM cpl_lock_inputs(NEW.tenant_id, NEW.market_id);
  WITH outdated AS (
    UPDATE compliance_report_snapshot s SET state = 'outdated'
    WHERE s.tenant_id = NEW.tenant_id AND s.market_id = NEW.market_id AND s.state IN ('computing', 'ready')
      AND s.input_refs -> 'batch_ids' IS DISTINCT FROM cpl_loaded_batch_ids(s.tenant_id, s.market_id, s.period_from, s.period_to)
    RETURNING s.id
  )
  INSERT INTO audit.audit_event (tenant_id, actor_type, actor_id, support_session_id, action, object_type, object_id,
    after_ref, request_id)
  SELECT NEW.tenant_id,
    coalesce(nullif(current_setting('app.actor_type', true), ''), 'user'),
    nullif(nullif(current_setting('app.user_id', true), ''), '00000000-0000-0000-0000-000000000000')::uuid,
    nullif(current_setting('app.support_session_id', true), '')::uuid,
    'SNAPSHOT.OUTDATED', 'compliance_report_snapshot', outdated.id,
    jsonb_build_object('after', jsonb_build_object('state', 'outdated', 'import_batch_id', NEW.id),
      'reason', 'The loaded import batches behind the snapshot period changed.')::text,
    nullif(current_setting('app.request_id', true), '')
  FROM outdated;
  RETURN NULL;
END $$;

CREATE TRIGGER cpl_batch_loaded AFTER INSERT ON import_batch
  FOR EACH ROW WHEN (NEW.state = 'loaded') EXECUTE FUNCTION cpl_outdate_snapshots();
CREATE TRIGGER cpl_batch_load_changed AFTER UPDATE OF state ON import_batch
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND 'loaded' IN (OLD.state, NEW.state))
  EXECUTE FUNCTION cpl_outdate_snapshots();
