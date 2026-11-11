-- CPL review fixes (T-A11-R1): a snapshot's inputs are guarded in the database.
-- 1. A snapshot whose inputs change is retired: ready -> outdated, computing -> failed with the reason
--    (FR-CPL-006: computing -> ready | failed; ready -> outdated). Nothing moves computing -> outdated any more.
-- 2. A new import mapping version retires the snapshots computed on an earlier version (AC-40.1, TS-33).
-- 3. The facts of a batch change only while it is being loaded (state mapped), so recorded inputs reproduce.
-- Lock order on every path that changes snapshot state: cpl_lock_inputs of the market(s), then snapshot rows,
-- then the tenant audit chain (the compute job takes them in the same order, apps/api/src/modules/cpl/compute.ts).
-- These functions read IMP's import_batch and import_mapping: a database-level contract between IMP and CPL.

CREATE OR REPLACE FUNCTION compliance_report_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on compliance_report_snapshot is not allowed (immutable)';
  END IF;
  IF to_jsonb(NEW) - 'state' - 'failure_reason' <> to_jsonb(OLD) - 'state' - 'failure_reason' THEN
    RAISE EXCEPTION 'UPDATE on compliance_report_snapshot may change only state';
  END IF;
  IF NOT ((OLD.state = 'computing' AND NEW.state IN ('ready', 'failed'))
          OR (OLD.state = 'ready' AND NEW.state = 'outdated')) THEN
    RAISE EXCEPTION 'compliance_report_snapshot state cannot change from % to %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;

-- Same set as IMP's loadedBatches facade, which snapshot creation reads: a loaded batch always has a mapping.
CREATE OR REPLACE FUNCTION cpl_loaded_batch_ids(p_tenant_id uuid, p_market_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb) FROM import_batch
  WHERE tenant_id = p_tenant_id AND market_id = p_market_id AND state = 'loaded' AND mapping_id IS NOT NULL
    AND period_from <= p_to AND period_to >= p_from
$$;

-- Retires the listed snapshots still computing or ready, each with an audit event in the caller's transaction
-- under its actor (columns as in apps/api/src/lib/audit.ts). The caller holds cpl_lock_inputs of their markets.
CREATE FUNCTION cpl_retire_snapshots(p_tenant_id uuid, p_ids uuid[], p_cause jsonb, p_reason text) RETURNS void
LANGUAGE sql AS $$
  WITH retired AS (
    UPDATE compliance_report_snapshot s
    SET state = CASE s.state WHEN 'ready' THEN 'outdated' ELSE 'failed' END,
        failure_reason = CASE s.state WHEN 'ready' THEN NULL ELSE p_reason END
    WHERE s.tenant_id = p_tenant_id AND s.id = ANY (p_ids) AND s.state IN ('computing', 'ready')
    RETURNING s.id, s.state
  )
  INSERT INTO audit.audit_event (tenant_id, actor_type, actor_id, support_session_id, action, object_type, object_id,
    before_ref, after_ref, request_id)
  SELECT p_tenant_id,
    coalesce(nullif(current_setting('app.actor_type', true), ''), 'user'),
    nullif(nullif(current_setting('app.user_id', true), ''), '00000000-0000-0000-0000-000000000000')::uuid,
    nullif(current_setting('app.support_session_id', true), '')::uuid,
    CASE retired.state WHEN 'outdated' THEN 'SNAPSHOT.OUTDATED' ELSE 'SNAPSHOT.FAILED' END,
    'compliance_report_snapshot', retired.id,
    jsonb_build_object('state', CASE retired.state WHEN 'outdated' THEN 'ready' ELSE 'computing' END)::text,
    jsonb_build_object('after', jsonb_build_object('state', retired.state) || p_cause, 'reason', p_reason)::text,
    nullif(current_setting('app.request_id', true), '')
  FROM retired
$$;

-- A batch entering or leaving 'loaded' retires the snapshots of its market whose loaded batch set it changes.
CREATE OR REPLACE FUNCTION cpl_outdate_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM cpl_lock_inputs(NEW.tenant_id, NEW.market_id);
  PERFORM cpl_retire_snapshots(NEW.tenant_id, ARRAY(
      SELECT s.id FROM compliance_report_snapshot s
      WHERE s.tenant_id = NEW.tenant_id AND s.market_id = NEW.market_id AND s.state IN ('computing', 'ready')
        AND s.input_refs -> 'batch_ids' IS DISTINCT FROM cpl_loaded_batch_ids(s.tenant_id, s.market_id, s.period_from, s.period_to)),
    jsonb_build_object('import_batch_id', NEW.id),
    'The loaded import batches behind the snapshot period changed.');
  RETURN NULL;
END $$;

-- A new mapping version (saving a mapping always creates one, FR-IMP-002) retires the snapshots computed on an
-- earlier version. Only markets locked here are touched: a snapshot of another market commits after this
-- statement began, so it was created on the batches as they are and needs nothing.
CREATE FUNCTION cpl_outdate_on_mapping_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_markets uuid[] := ARRAY(SELECT DISTINCT market_id FROM compliance_report_snapshot
                            WHERE tenant_id = NEW.tenant_id AND state IN ('computing', 'ready') ORDER BY market_id);
  v_market uuid;
BEGIN
  FOREACH v_market IN ARRAY v_markets LOOP
    PERFORM cpl_lock_inputs(NEW.tenant_id, v_market);
  END LOOP;
  PERFORM cpl_retire_snapshots(NEW.tenant_id, ARRAY(
      SELECT s.id FROM compliance_report_snapshot s
      WHERE s.tenant_id = NEW.tenant_id AND s.market_id = ANY (v_markets) AND s.state IN ('computing', 'ready')
        AND EXISTS (SELECT 1 FROM import_mapping m
                    WHERE m.tenant_id = s.tenant_id AND m.version < NEW.version
                      AND m.id IN (SELECT jsonb_array_elements_text(s.input_refs -> 'mapping_ids')::uuid))),
    jsonb_build_object('import_mapping_id', NEW.id, 'mapping_version', NEW.version),
    'A new version of the import mapping behind the snapshot was created.');
  RETURN NULL;
END $$;

CREATE TRIGGER cpl_mapping_version_created AFTER INSERT ON import_mapping
  FOR EACH ROW EXECUTE FUNCTION cpl_outdate_on_mapping_version();

-- Facts are written by the load transaction while their batch is 'mapped' and never change afterwards
-- (BR-IMP-04, BR-CPL-01). Native facts (no batch, release B) are not covered here.
CREATE FUNCTION cpl_fact_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_batch_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_batch_id := OLD.batch_id;
  ELSE
    v_batch_id := NEW.batch_id;
  END IF;
  IF v_batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM import_batch WHERE id = v_batch_id AND state = 'mapped') THEN
    RAISE EXCEPTION '% on % is allowed only while its import batch is being loaded (state mapped)', TG_OP, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cpl_fact_participant_batch_guard BEFORE INSERT OR DELETE ON cpl_fact_participant
  FOR EACH ROW EXECUTE FUNCTION cpl_fact_batch_guard();
CREATE TRIGGER cpl_fact_order_batch_guard BEFORE INSERT OR DELETE ON cpl_fact_order
  FOR EACH ROW EXECUTE FUNCTION cpl_fact_batch_guard();
CREATE TRIGGER cpl_fact_payout_line_batch_guard BEFORE INSERT OR DELETE ON cpl_fact_payout_line
  FOR EACH ROW EXECUTE FUNCTION cpl_fact_batch_guard();
