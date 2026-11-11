-- IMP API (T-A08, T-A09): validation results kept on the batch, a stable order for the row-error report,
-- and the batch lifecycle (FR-IMP-003) enforced in the database. No new table, so no new policy.

-- All nullable: rows written before this migration (and test seeds) have none of them.
ALTER TABLE import_batch
  ADD COLUMN files jsonb,          -- per file: sha256 (hex) and size_bytes of the upload, checked again at load
  ADD COLUMN source_values jsonb,  -- distinct partner codes with counts: the input to mapping (FR-IMP-002)
  ADD COLUMN report jsonb,         -- error_count, errors_stored, warnings
  ADD COLUMN data_quality jsonb;   -- set at load: unknown purposes, refunds without month, lines without order

-- Insertion order of findings; the paged report (GET /v1/imports/{id}/errors) uses it as its cursor.
ALTER TABLE import_row_error ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX import_row_error_seq_idx ON import_row_error (batch_id, seq);

-- What was validated is what gets loaded: only the lifecycle columns change after insert, and only along
-- uploaded -> validated | rejected, validated | mapped -> mapped, mapped -> loaded, loaded -> superseded.
CREATE FUNCTION import_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lifecycle constant text[] := ARRAY['state', 'mapping_id', 'superseded_by', 'data_quality'];
BEGIN
  IF to_jsonb(NEW) - lifecycle <> to_jsonb(OLD) - lifecycle THEN
    RAISE EXCEPTION 'import_batch may change only state, mapping_id, superseded_by and data_quality';
  END IF;
  IF NOT ((OLD.state = 'uploaded' AND NEW.state IN ('validated', 'rejected'))
          OR (OLD.state IN ('validated', 'mapped') AND NEW.state = 'mapped')
          OR (OLD.state = 'mapped' AND NEW.state = 'loaded')
          OR (OLD.state = 'loaded' AND NEW.state = 'superseded')) THEN
    RAISE EXCEPTION 'import_batch state cannot change from % to %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_batch_lifecycle BEFORE UPDATE ON import_batch
  FOR EACH ROW EXECUTE FUNCTION import_batch_guard();
