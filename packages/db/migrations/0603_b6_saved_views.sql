-- B6 saved views (PLAN B6 section 1.4; D-B6-08, D-B6-13): per user and list, written only by their owner, optionally
-- shared within a role of the tenant (or a base role).

CREATE TABLE saved_view (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL,
  list text NOT NULL CHECK (list IN ('orders', 'ledger_entries')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  filters jsonb NOT NULL CHECK (jsonb_typeof(filters) = 'object'),
  columns text[] NOT NULL CHECK (cardinality(columns) BETWEEN 1 AND 40),
  sort text NOT NULL CHECK (length(sort) BETWEEN 1 AND 40),
  is_default boolean NOT NULL DEFAULT false,
  shared_role_id uuid REFERENCES role (id), -- base roles have no tenant: trigger saved_view_role_in_tenant
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, user_id, list, name),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX saved_view_one_default ON saved_view (tenant_id, user_id, list) WHERE is_default;
CREATE INDEX saved_view_shared_idx ON saved_view (tenant_id, shared_role_id, list) WHERE shared_role_id IS NOT NULL;

-- As role_assignment_role_guard (0002): a role of the tenant or a base role.
CREATE FUNCTION saved_view_role_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shared_role_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM role r
       WHERE r.id = NEW.shared_role_id AND (r.tenant_id = NEW.tenant_id OR (r.tenant_id IS NULL AND r.is_base))) THEN
    RAISE EXCEPTION 'a view is shared within a role of its tenant or a base role' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER saved_view_role_in_tenant BEFORE INSERT OR UPDATE OF shared_role_id ON saved_view
  FOR EACH ROW EXECUTE FUNCTION saved_view_role_guard();

-- Only the owner writes its views (user_id frozen); at most SAVED_VIEWS_PER_USER_LIST per user and list (D-B6-16).
CREATE FUNCTION saved_view_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  saved_views_per_user_list constant int := 50;
  owner_id uuid := CASE TG_OP WHEN 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
BEGIN
  IF owner_id IS DISTINCT FROM app_user_id() OR (TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'a saved view is written by its owner only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('saved_view:' || NEW.user_id || ':' || NEW.list, 0));
    IF (SELECT count(*) FROM saved_view v WHERE v.user_id = NEW.user_id AND v.list = NEW.list) >= saved_views_per_user_list THEN
      RAISE EXCEPTION 'at most % saved views per user and list', saved_views_per_user_list USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER saved_view_owner_guard BEFORE INSERT OR UPDATE OR DELETE ON saved_view
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION saved_view_owner_guard();

SELECT apply_tenant_rls('saved_view');
CREATE POLICY portal_hidden ON saved_view AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);
GRANT SELECT, INSERT, DELETE ON saved_view TO nmp_app;
GRANT UPDATE (name, filters, columns, sort, is_default, shared_role_id, updated_at) ON saved_view TO nmp_app;
