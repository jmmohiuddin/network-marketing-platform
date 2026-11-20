-- B6 full data export (PLAN B6 section 1.3; D-B6-06, D-B6-13): one export at a time per tenant, files written while it
-- runs, deleted once it fails or expires; the schedule window of exports.full_schedule.

CREATE TABLE data_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  export_job_id uuid,
  trigger text NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed', 'expired')),
  model_version int NOT NULL CHECK (model_version > 0),
  snapshot_at timestamptz,
  manifest jsonb CHECK (manifest IS NULL OR jsonb_typeof(manifest) = 'object'),
  signature bytea CHECK (length(signature) = 64),
  error jsonb CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
  requested_by uuid, -- no key: a key caller records its service account (as export_job)
  requested_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (requested_by_type IN ('user', 'service_account', 'system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT data_export_completed CHECK (state NOT IN ('completed', 'expired')
    OR (manifest IS NOT NULL AND signature IS NOT NULL AND snapshot_at IS NOT NULL AND export_job_id IS NOT NULL
        AND finished_at IS NOT NULL)),
  CONSTRAINT data_export_result_once_completed
    CHECK (state IN ('completed', 'expired') OR (manifest IS NULL AND signature IS NULL AND export_job_id IS NULL)),
  CONSTRAINT data_export_failed CHECK ((state = 'failed') = (error IS NOT NULL)),
  CONSTRAINT data_export_finished CHECK ((finished_at IS NOT NULL) = (state IN ('completed', 'failed', 'expired'))),
  FOREIGN KEY (tenant_id, export_job_id) REFERENCES export_job (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX data_export_created_idx ON data_export (tenant_id, created_at DESC);
-- One export at a time per tenant (409 EXPORT_RUNNING).
CREATE UNIQUE INDEX data_export_one_running ON data_export (tenant_id) WHERE state IN ('queued', 'running');

-- queued -> running -> completed | failed, queued -> failed, completed -> expired. Only a queued or running export changes
-- its result columns; identity never changes.
CREATE FUNCTION data_export_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued'
       OR num_nonnulls(NEW.export_job_id, NEW.snapshot_at, NEW.manifest, NEW.signature, NEW.error, NEW.finished_at) > 0 THEN
      RAISE EXCEPTION 'a data export is requested queued, without results' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on data_export is not allowed (history)';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.trigger, NEW.model_version, NEW.requested_by, NEW.requested_by_type, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.trigger, OLD.model_version, OLD.requested_by, OLD.requested_by_type,
                         OLD.created_at)
     OR NOT (NEW.state = OLD.state
             OR (OLD.state, NEW.state) IN (('queued', 'running'), ('running', 'completed'), ('running', 'failed'),
                                           ('queued', 'failed'), ('completed', 'expired')))
     OR (OLD.state NOT IN ('queued', 'running') AND to_jsonb(NEW) - 'state' IS DISTINCT FROM to_jsonb(OLD) - 'state') THEN
    RAISE EXCEPTION 'data export cannot change from % to % (identity and finished results are fixed)', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_export_guard BEFORE INSERT OR UPDATE OR DELETE ON data_export
  FOR EACH ROW EXECUTE FUNCTION data_export_guard();

CREATE TABLE data_export_file (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  export_id uuid NOT NULL,
  table_name text NOT NULL CHECK (table_name ~ '^[a-z][a-z0-9_.]{0,126}$'),
  row_count bigint NOT NULL CHECK (row_count >= 0),
  byte_size bigint NOT NULL,
  content bytea NOT NULL,
  content_sha256 bytea NOT NULL CHECK (length(content_sha256) = 32),
  PRIMARY KEY (tenant_id, export_id, table_name),
  FOREIGN KEY (tenant_id, export_id) REFERENCES data_export (tenant_id, id)
);

-- Written while the export runs (digest and size computed here); deleted once it failed or expired; never updated.
-- No row lock on the export: an erasure's UPDATE never waits for a generation transaction, whose final -> completed
-- then fails with 40001 (REPEATABLE READ) and rolls its files back (D-B6-13).
CREATE FUNCTION data_export_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM data_export d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.export_id AND d.state = 'running';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'export files are written while the export runs' USING ERRCODE = 'check_violation';
    END IF;
    NEW.content_sha256 := digest(NEW.content, 'sha256');
    NEW.byte_size := length(NEW.content);
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM data_export d WHERE d.tenant_id = OLD.tenant_id AND d.id = OLD.export_id AND d.state IN ('failed', 'expired')) THEN
    RAISE EXCEPTION 'export files are deleted once the export failed or expired' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER data_export_file_guard BEFORE INSERT OR DELETE ON data_export_file
  FOR EACH ROW EXECUTE FUNCTION data_export_file_guard();
CREATE TRIGGER data_export_file_no_update BEFORE UPDATE ON data_export_file FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['data_export', 'data_export_file']::regclass[]) AS t;
-- D-B6-13: every exported personal field: never in a portal transaction.
CREATE POLICY portal_hidden ON data_export AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);
CREATE POLICY portal_hidden ON data_export_file AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);

GRANT SELECT, INSERT ON data_export TO nmp_app;
GRANT UPDATE (state, snapshot_at, manifest, signature, error, export_job_id, finished_at) ON data_export TO nmp_app;
GRANT SELECT, INSERT, DELETE ON data_export_file TO nmp_app;

-- The latest scheduled instant at or before p_now (UTC) of an exports.full_schedule value: daily at hour_utc, weekly on
-- Mondays, monthly on the 1st; NULL for an unset or malformed value.
CREATE FUNCTION int_full_export_window(p_schedule jsonb, p_now timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN x.start > x.n THEN x.previous ELSE x.start END AT TIME ZONE 'UTC'
  FROM (SELECT p_now AT TIME ZONE 'UTC' AS n,
               CASE WHEN jsonb_typeof(p_schedule -> 'hour_utc') = 'number' AND (p_schedule ->> 'hour_utc') ~ '^([0-9]|1[0-9]|2[0-3])$'
                    THEN make_interval(hours => (p_schedule ->> 'hour_utc')::int) END AS h) t
  CROSS JOIN LATERAL (
    SELECT t.n,
           CASE p_schedule ->> 'cadence' WHEN 'daily' THEN date_trunc('day', t.n) WHEN 'weekly' THEN date_trunc('week', t.n)
                                         WHEN 'monthly' THEN date_trunc('month', t.n) END + t.h AS start,
           CASE p_schedule ->> 'cadence' WHEN 'daily' THEN date_trunc('day', t.n) - interval '1 day'
                                         WHEN 'weekly' THEN date_trunc('week', t.n) - interval '7 days'
                                         WHEN 'monthly' THEN date_trunc('month', t.n) - interval '1 month' END + t.h AS previous
  ) x
$$;

-- System realm (int.full-exports.schedule cron): tenants whose schedule is due and that have no scheduled export created
-- in the current window.
CREATE FUNCTION int_due_full_exports() RETURNS TABLE (tenant_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT t.id FROM tenant t
    CROSS JOIN LATERAL (SELECT int_full_export_window(setting_in_force(t.id, 'exports.full_schedule'), now()) AS since) w
    WHERE w.since IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM data_export d WHERE d.tenant_id = t.id AND d.trigger = 'schedule' AND d.created_at >= w.since)
    ORDER BY t.id;
END $$;
REVOKE ALL ON FUNCTION int_due_full_exports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION int_due_full_exports() TO nmp_app;
