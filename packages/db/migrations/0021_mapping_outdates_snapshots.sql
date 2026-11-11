-- AC-40.1 (FR-IMP-002) and FR-CPL-006 "ready -> outdated (mapping changed)": approving a mapping version marks the
-- tenant's computing and ready snapshots built on an earlier version as outdated. The snapshots keep the version
-- they were computed with. Audited in the same transaction under that transaction's actor, as 0030 does for
-- batch changes (columns as in apps/api/src/lib/audit.ts).
CREATE FUNCTION import_mapping_outdate_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH outdated AS (
    UPDATE compliance_report_snapshot s SET state = 'outdated'
    WHERE s.tenant_id = NEW.tenant_id AND s.state IN ('computing', 'ready')
      AND EXISTS (
        SELECT 1 FROM import_mapping m
        WHERE m.tenant_id = s.tenant_id AND m.version < NEW.version
          AND (m.id = s.mapping_id OR s.input_refs -> 'mapping_ids' ? m.id::text))
    RETURNING s.id
  )
  INSERT INTO audit.audit_event (tenant_id, actor_type, actor_id, support_session_id, action, object_type, object_id,
    after_ref, request_id)
  SELECT NEW.tenant_id,
    coalesce(nullif(current_setting('app.actor_type', true), ''), 'user'),
    nullif(nullif(current_setting('app.user_id', true), ''), '00000000-0000-0000-0000-000000000000')::uuid,
    nullif(current_setting('app.support_session_id', true), '')::uuid,
    'SNAPSHOT.OUTDATED', 'compliance_report_snapshot', outdated.id,
    jsonb_build_object('after', jsonb_build_object('state', 'outdated', 'import_mapping_id', NEW.id,
        'mapping_version', NEW.version),
      'reason', 'A newer import mapping version was approved.')::text,
    nullif(current_setting('app.request_id', true), '')
  FROM outdated;
  RETURN NULL;
END $$;

CREATE TRIGGER import_mapping_approved AFTER INSERT ON import_mapping
  FOR EACH ROW WHEN (NEW.state = 'approved') EXECUTE FUNCTION import_mapping_outdate_snapshots();
CREATE TRIGGER import_mapping_approval AFTER UPDATE OF state ON import_mapping
  FOR EACH ROW WHEN (OLD.state <> 'approved' AND NEW.state = 'approved') EXECUTE FUNCTION import_mapping_outdate_snapshots();
