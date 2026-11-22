-- V1-A tenant offboarding and archive (PLAN V1-A section 1.6; D-V1A-07, C-V1A-9, C-V1A-18, E-ADR-31): the vendor requests,
-- the tenant confirms (read-only from then on), the vendor archives with a full export made after the confirmation, and
-- once the retention has passed a vendor user requests the purge, an independent one approves it and the owner-only CLI
-- purges. Archived tenants stay readable; crons skip them.

-- 1. tenant_offboarding (modelled on support_session): each state carries exactly its columns.
CREATE TABLE tenant_offboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  state text NOT NULL CHECK (state IN ('requested', 'confirmed', 'archived', 'purge_requested', 'purge_approved', 'purged',
                                       'cancelled', 'restored')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  previous_state text NOT NULL CHECK (previous_state IN ('provisioning', 'implementation', 'live')),
  requested_by uuid NOT NULL REFERENCES user_account (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  retention_basis text CHECK (length(trim(retention_basis)) BETWEEN 1 AND 2000),
  retention_months int CHECK (retention_months BETWEEN 1 AND 240),
  acknowledged_warnings text[],
  export_id uuid,
  archived_by uuid REFERENCES user_account (id),
  archived_at timestamptz,
  retain_until date,
  purge_requested_by uuid REFERENCES user_account (id),
  purge_requested_at timestamptz,
  purge_approved_by uuid REFERENCES user_account (id),
  purge_approved_at timestamptz,
  purged_at timestamptz,
  purge_summary jsonb,
  closed_by uuid REFERENCES user_account (id),
  closed_at timestamptz,
  CONSTRAINT tenant_offboarding_confirmation
    CHECK (num_nonnulls(confirmed_by, confirmed_at, retention_basis, retention_months, acknowledged_warnings) IN (0, 5)),
  CONSTRAINT tenant_offboarding_archive CHECK (num_nonnulls(export_id, archived_by, archived_at, retain_until) IN (0, 4)),
  CONSTRAINT tenant_offboarding_purge_request CHECK (num_nonnulls(purge_requested_by, purge_requested_at) IN (0, 2)),
  CONSTRAINT tenant_offboarding_purge_approval CHECK (num_nonnulls(purge_approved_by, purge_approved_at) IN (0, 2)),
  CONSTRAINT tenant_offboarding_purge CHECK (num_nonnulls(purged_at, purge_summary) IN (0, 2)),
  CONSTRAINT tenant_offboarding_close CHECK (num_nonnulls(closed_by, closed_at) IN (0, 2)),
  CONSTRAINT tenant_offboarding_states CHECK (
    CASE state WHEN 'requested' THEN confirmed_at IS NULL WHEN 'cancelled' THEN true ELSE confirmed_at IS NOT NULL END
    AND (archived_at IS NOT NULL) = (state IN ('archived', 'purge_requested', 'purge_approved', 'purged', 'restored'))
    AND CASE WHEN state IN ('purge_requested', 'purge_approved', 'purged') THEN purge_requested_at IS NOT NULL
             WHEN state = 'restored' THEN true ELSE purge_requested_at IS NULL END
    AND (purge_approved_at IS NOT NULL) = (state IN ('purge_approved', 'purged'))
    AND (purged_at IS NOT NULL) = (state = 'purged')
    AND (closed_at IS NOT NULL) = (state IN ('cancelled', 'restored'))),
  CONSTRAINT tenant_offboarding_independent_purge CHECK (purge_approved_by IS NULL OR purge_approved_by <> purge_requested_by),
  FOREIGN KEY (tenant_id, confirmed_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, export_id) REFERENCES data_export (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX tenant_offboarding_open ON tenant_offboarding (tenant_id) WHERE state NOT IN ('purged', 'cancelled', 'restored');

-- 2. What stands in the way (D-V1A-07): every kind with its count; ids (first 20) only for the tenant's own staff, never
-- for the vendor realm (counts only). credits_outstanding is a warning the confirmation acknowledges.
CREATE FUNCTION offboarding_blockers(p_tenant uuid) RETURNS TABLE (kind text, blocking boolean, count bigint, ids uuid[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  own boolean := app_realm() = 'tenant' AND app_tenant_id() = p_tenant AND app_participant_id() IS NULL;
BEGIN
  IF NOT own AND app_realm() IS DISTINCT FROM 'vendor' THEN
    RAISE EXCEPTION 'offboarding blockers are read by the tenant''s staff or the vendor' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    WITH balances AS (
      SELECT a.id, a.type, sum(CASE WHEN a.type = 'clawback_receivable' THEN x.debit_minor - x.credit_minor
                                    ELSE x.credit_minor - x.debit_minor END) AS balance
      FROM ledger_account a JOIN posting x ON x.account_id = a.id
      WHERE a.tenant_id = p_tenant AND a.type IN ('payee_payable', 'clawback_receivable', 'credit_liability')
      GROUP BY a.id, a.type
    ), found (kind, blocking, id) AS (
      SELECT 'run_open', true, r.id FROM run r WHERE r.tenant_id = p_tenant AND r.state IN ('queued', 'running', 'calculated')
      UNION ALL SELECT 'period_not_closed', true, p.id FROM period p WHERE p.tenant_id = p_tenant AND p.state IN ('committed', 'paid')
      UNION ALL SELECT 'payout_batch_open', true, b.id FROM payout_batch b
        WHERE b.tenant_id = p_tenant AND b.state IN ('draft', 'reviewed', 'approved', 'instructing', 'partially_settled')
      UNION ALL SELECT 'payout_in_transit', true, i.id FROM payout_instruction i
        WHERE i.tenant_id = p_tenant AND i.state IN ('pending', 'instructed', 'accepted')
      UNION ALL SELECT 'payables_outstanding', true, b.id FROM balances b WHERE b.type = 'payee_payable' AND b.balance > 0
      UNION ALL SELECT 'receivables_outstanding', true, b.id FROM balances b WHERE b.type = 'clawback_receivable' AND b.balance > 0
      UNION ALL SELECT 'case_open', true, c.id FROM case_file c WHERE c.tenant_id = p_tenant AND c.state IN ('open', 'submitted')
      UNION ALL SELECT 'privacy_request_open', true, q.id FROM privacy_request q WHERE q.tenant_id = p_tenant AND q.closed_at IS NULL
      UNION ALL SELECT 'export_running', true, d.id FROM data_export d WHERE d.tenant_id = p_tenant AND d.state IN ('queued', 'running')
      UNION ALL SELECT 'credits_outstanding', false, b.id FROM balances b WHERE b.type = 'credit_liability' AND b.balance > 0
    )
    SELECT k.kind, k.blocking, count(f.id),
           CASE WHEN own THEN coalesce((array_agg(f.id ORDER BY f.id) FILTER (WHERE f.id IS NOT NULL))[1:20], '{}') END
    FROM (VALUES (1, 'run_open', true), (2, 'period_not_closed', true), (3, 'payout_batch_open', true),
                 (4, 'payout_in_transit', true), (5, 'payables_outstanding', true), (6, 'receivables_outstanding', true),
                 (7, 'case_open', true), (8, 'privacy_request_open', true), (9, 'export_running', true),
                 (10, 'credits_outstanding', false)) AS k (ord, kind, blocking)
    LEFT JOIN found f ON f.kind = k.kind
    GROUP BY k.ord, k.kind, k.blocking
    ORDER BY k.ord;
END $$;

-- 3. Read-only (D-V1A-07): archived, or confirmed for offboarding.
CREATE FUNCTION tenant_read_only(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM tenant t WHERE t.id = p_tenant AND t.state = 'archived')
      OR EXISTS (SELECT 1 FROM tenant_offboarding o WHERE o.tenant_id = p_tenant AND o.state = 'confirmed')
$$;

-- 4. Transitions (runtime role; the owner purges). Vendor realm: request, archive, purge request and approval, restore,
-- cancel, each in the acting vendor user's name. Tenant realm (the tenant's staff): confirm or cancel a request.
CREATE FUNCTION tenant_offboarding_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  identity constant text[] := ARRAY['id', 'tenant_id', 'reason', 'previous_state', 'requested_by', 'requested_at'];
  vendor boolean;
  staff boolean;
  changed text[];
  ok boolean;
BEGIN
  -- A vendor user acts in the vendor realm, or in the tenant's realm entered from it (support/vendor-tx.ts); the tenant's
  -- staff act in its realm. SECURITY DEFINER: the vendor realm cannot read the tenant's exports, holds and requests.
  vendor := EXISTS (SELECT 1 FROM user_account u WHERE u.id = app_user_id() AND u.realm = 'vendor' AND u.state = 'active')
    AND (app_realm() = 'vendor' OR (app_realm() = 'tenant' AND app_tenant_id() = NEW.tenant_id
                                    AND current_setting('app.actor_type', true) = 'vendor_user'));
  staff := app_realm() = 'tenant' AND app_tenant_id() = NEW.tenant_id AND app_participant_id() IS NULL
    AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = app_user_id() AND u.realm = 'tenant' AND u.tenant_id = NEW.tenant_id);
  IF TG_OP = 'INSERT' THEN
    IF NOT vendor OR NEW.state <> 'requested' OR NEW.requested_by IS DISTINCT FROM app_user_id()
       OR num_nonnulls(NEW.confirmed_at, NEW.archived_at, NEW.purge_requested_at, NEW.purge_approved_at, NEW.purged_at, NEW.closed_at) > 0
       OR NOT EXISTS (SELECT 1 FROM tenant t WHERE t.id = NEW.tenant_id AND t.state = NEW.previous_state) THEN
      RAISE EXCEPTION 'a vendor user requests an offboarding in its own name, from the tenant''s current state'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  changed := array(SELECT n.k FROM jsonb_each(to_jsonb(NEW)) n (k, v) WHERE n.v IS DISTINCT FROM to_jsonb(OLD) -> n.k);
  ok := NOT (changed && identity) AND CASE
    WHEN OLD.state = 'requested' AND NEW.state = 'confirmed' THEN staff AND NEW.confirmed_by = app_user_id()
      AND changed <@ ARRAY['state', 'confirmed_by', 'confirmed_at', 'retention_basis', 'retention_months', 'acknowledged_warnings']
    WHEN OLD.state IN ('requested', 'confirmed') AND NEW.state = 'cancelled' THEN (vendor OR staff) AND NEW.closed_by = app_user_id()
      AND changed <@ ARRAY['state', 'closed_by', 'closed_at']
    WHEN OLD.state = 'confirmed' AND NEW.state = 'archived' THEN vendor AND NEW.archived_by = app_user_id()
      AND changed <@ ARRAY['state', 'export_id', 'archived_by', 'archived_at', 'retain_until']
    WHEN OLD.state = 'archived' AND NEW.state = 'purge_requested' THEN vendor AND NEW.purge_requested_by = app_user_id()
      AND changed <@ ARRAY['state', 'purge_requested_by', 'purge_requested_at']
    WHEN OLD.state = 'purge_requested' AND NEW.state = 'purge_approved' THEN vendor AND NEW.purge_approved_by = app_user_id()
      AND changed <@ ARRAY['state', 'purge_approved_by', 'purge_approved_at']
    WHEN OLD.state IN ('archived', 'purge_requested') AND NEW.state = 'restored' THEN vendor AND NEW.closed_by = app_user_id()
      AND changed <@ ARRAY['state', 'closed_by', 'closed_at']
    ELSE false END;
  IF NOT ok THEN
    RAISE EXCEPTION 'offboarding cannot change from % to % here', OLD.state, NEW.state USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.state = 'confirmed' AND EXISTS (SELECT 1 FROM offboarding_blockers(NEW.tenant_id) b
                                         WHERE b.count > 0 AND (b.blocking OR NOT b.kind = ANY (NEW.acknowledged_warnings))) THEN
    RAISE EXCEPTION 'offboarding is confirmed with no blocking item and every warning acknowledged'
      USING ERRCODE = 'check_violation', DETAIL = 'offboarding_blocked';
  END IF;
  IF NEW.state = 'archived' AND (
       NOT EXISTS (SELECT 1 FROM data_export d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.export_id
                     AND d.state = 'completed' AND d.created_at > OLD.confirmed_at)
       OR EXISTS (SELECT 1 FROM offboarding_blockers(NEW.tenant_id) b WHERE b.blocking AND b.count > 0)) THEN
    RAISE EXCEPTION 'a tenant is archived with a completed full export made after the confirmation and no blocking item'
      USING ERRCODE = 'check_violation', DETAIL = 'export_required';
  END IF;
  IF NEW.state = 'purge_requested' AND (
       OLD.retain_until >= current_date
       OR EXISTS (SELECT 1 FROM legal_hold h WHERE h.tenant_id = NEW.tenant_id AND h.released_at IS NULL)
       OR EXISTS (SELECT 1 FROM privacy_request q WHERE q.tenant_id = NEW.tenant_id AND q.closed_at IS NULL)) THEN
    RAISE EXCEPTION 'a purge is requested once the retention has passed, with no active legal hold and no open privacy request'
      USING ERRCODE = 'check_violation', DETAIL = CASE WHEN OLD.retain_until >= current_date THEN 'retention_not_elapsed'
        WHEN EXISTS (SELECT 1 FROM legal_hold h WHERE h.tenant_id = NEW.tenant_id AND h.released_at IS NULL) THEN 'legal_hold_present'
        ELSE 'offboarding_blocked' END;
  END IF;
  IF NEW.state = 'purge_approved' THEN
    PERFORM assert_vendor_second_person(NEW.purge_approved_by, OLD.purge_requested_by);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_offboarding_guard BEFORE INSERT OR UPDATE ON tenant_offboarding
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION tenant_offboarding_guard();
CREATE TRIGGER tenant_offboarding_no_delete BEFORE DELETE ON tenant_offboarding FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- retain_until = archive date (UTC) + retention months, for every role.
CREATE FUNCTION tenant_offboarding_retain_until() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.retain_until := CASE WHEN NEW.archived_at IS NOT NULL
    THEN ((NEW.archived_at AT TIME ZONE 'UTC')::date + make_interval(months => NEW.retention_months))::date END;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_offboarding_retain_until BEFORE INSERT OR UPDATE ON tenant_offboarding
  FOR EACH ROW EXECUTE FUNCTION tenant_offboarding_retain_until();

-- 5. Archive and restore move the tenant to the offboarding's state (archived, or back to its previous state); run by the
-- trigger below, callable again (no-op). SECURITY DEFINER: it only aligns tenant.state with the record, in any realm.
CREATE FUNCTION tenant_set_offboarding_state(p_offboarding uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  o tenant_offboarding;
  target text;
BEGIN
  SELECT * INTO o FROM tenant_offboarding WHERE id = p_offboarding;
  IF NOT FOUND OR o.state NOT IN ('archived', 'restored') THEN
    RAISE EXCEPTION 'only an archived or restored offboarding moves its tenant' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  target := CASE o.state WHEN 'archived' THEN 'archived' ELSE o.previous_state END;
  UPDATE tenant SET state = target WHERE id = o.tenant_id AND state IS DISTINCT FROM target;
  RETURN target;
END $$;
CREATE FUNCTION tenant_offboarding_moves_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM tenant_set_offboarding_state(NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER tenant_offboarding_moves_tenant AFTER UPDATE OF state ON tenant_offboarding
  FOR EACH ROW WHEN (NEW.state IN ('archived', 'restored') AND OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION tenant_offboarding_moves_tenant();

SELECT apply_tenant_rls('tenant_offboarding');
CREATE POLICY vendor_manage ON tenant_offboarding USING (app_realm() = 'vendor') WITH CHECK (app_realm() = 'vendor');
CREATE POLICY portal_hidden ON tenant_offboarding AS RESTRICTIVE
  USING (app_participant_id() IS NULL) WITH CHECK (app_participant_id() IS NULL);
GRANT SELECT, INSERT ON tenant_offboarding TO nmp_app;
GRANT UPDATE (state, confirmed_by, confirmed_at, retention_basis, retention_months, acknowledged_warnings, export_id, archived_by,
  archived_at, purge_requested_by, purge_requested_at, purge_approved_by, purge_approved_at, closed_by, closed_at)
  ON tenant_offboarding TO nmp_app;
REVOKE ALL ON FUNCTION offboarding_blockers(uuid), tenant_read_only(uuid), tenant_set_offboarding_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION offboarding_blockers(uuid), tenant_read_only(uuid), tenant_set_offboarding_state(uuid) TO nmp_app;

-- 6. Archived tenants stay readable (C-V1A-9): their sessions resolve and the public privacy form finds them. Invitations
-- (auth_find_invitation), API keys (auth_find_api_key) and crons (system_tenant_ids) keep refusing them.
CREATE OR REPLACE FUNCTION auth_find_session(p_token_hash bytea) RETURNS SETOF session
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT s.* FROM session s
    JOIN user_account u ON u.id = s.user_id
    WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now() AND u.state = 'active';
END $$;

CREATE OR REPLACE FUNCTION tenant_by_slug(p_slug text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  found uuid;
BEGIN
  PERFORM require_system_realm();
  SELECT t.id INTO found FROM tenant t WHERE t.slug = p_slug AND t.state <> 'provisioning';
  RETURN found;
END $$;

-- 7. System candidate lookups skip archived tenants (outbox, webhooks, plan activations, payouts, provider reviews, dispute
-- and grievance escalation, path models, migration comparisons). Notices (dist_due_notifications) and privacy deadlines keep
-- running: data-subject rights outlive the archive (C-V1A-18).
CREATE OR REPLACE FUNCTION outbox_claim(p_limit int) RETURNS SETOF outbox_event
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT o.* FROM outbox_event o
    WHERE o.dispatched_at IS NULL AND NOT o.dead AND o.available_at <= now()
      AND NOT EXISTS (SELECT 1 FROM tenant t WHERE t.id = o.tenant_id AND t.state = 'archived')
    ORDER BY o.seq
    LIMIT p_limit
    FOR UPDATE OF o SKIP LOCKED;
END $$;

CREATE OR REPLACE FUNCTION webhook_claim_due(p_limit int, p_lease_seconds int) RETURNS TABLE (tenant_id uuid, delivery_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    UPDATE webhook_delivery d SET claimed_until = now() + make_interval(secs => p_lease_seconds)
    WHERE d.id IN (
      SELECT due.id FROM webhook_delivery due
      WHERE due.outcome = 'scheduled' AND due.next_attempt_at <= now()
        AND (due.claimed_until IS NULL OR due.claimed_until < now())
        AND NOT EXISTS (SELECT 1 FROM tenant t WHERE t.id = due.tenant_id AND t.state = 'archived')
      ORDER BY due.next_attempt_at
      LIMIT p_limit
      FOR UPDATE OF due SKIP LOCKED)
    RETURNING d.tenant_id, d.id;
END $$;

CREATE OR REPLACE FUNCTION pln_due_activations() RETURNS TABLE (tenant_id uuid, plan_version_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY SELECT v.tenant_id, v.id FROM plan_version v JOIN tenant t ON t.id = v.tenant_id AND t.state <> 'archived'
    WHERE v.state = 'scheduled' AND v.effective_from <= now() ORDER BY v.effective_from, v.tenant_id, v.id;
END $$;

CREATE OR REPLACE FUNCTION pay_due_instructions(p_limit int) RETURNS TABLE (tenant_id uuid, instruction_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT i.tenant_id, i.id FROM payout_instruction i
    JOIN payout_batch b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
    JOIN provider_config c ON c.tenant_id = b.tenant_id AND c.id = b.provider_config_id
    JOIN tenant t ON t.id = i.tenant_id AND t.state <> 'archived'
    WHERE i.state IN ('pending', 'instructed') AND i.next_attempt_at <= now() AND c.adapter = 'sandbox'
    ORDER BY i.next_attempt_at, i.id
    LIMIT p_limit;
END $$;

CREATE OR REPLACE FUNCTION pay_due_provider_reviews() RETURNS TABLE (tenant_id uuid, provider_config_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT c.tenant_id, c.id FROM provider_config c JOIN tenant t ON t.id = c.tenant_id AND t.state <> 'archived'
    WHERE c.kind IN ('payout', 'payment') AND c.state = 'recorded' AND c.review_due_on IS NOT NULL
    ORDER BY c.review_due_on, c.tenant_id, c.id;
END $$;

CREATE OR REPLACE FUNCTION comp_overdue_disputes(p_limit int) RETURNS TABLE (tenant_id uuid, case_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT c.tenant_id, c.id FROM case_file c JOIN tenant t ON t.id = c.tenant_id AND t.state <> 'archived'
    WHERE c.type = 'dispute' AND c.state = 'submitted' AND c.due_at < now()
      AND NOT EXISTS (SELECT 1 FROM case_event e WHERE e.tenant_id = c.tenant_id AND e.case_id = c.id AND e.kind = 'escalated')
    ORDER BY c.due_at, c.id
    LIMIT p_limit;
END $$;

CREATE OR REPLACE FUNCTION mig_due_comparisons(p_limit int) RETURNS TABLE (tenant_id uuid, parallel_run_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT r.tenant_id, r.id FROM parallel_run r JOIN simulation s ON s.tenant_id = r.tenant_id AND s.id = r.simulation_id
    JOIN tenant t ON t.id = r.tenant_id AND t.state <> 'archived'
    WHERE r.state = 'calculating' AND s.state IN ('completed', 'failed')
    ORDER BY r.requested_at, r.id
    LIMIT p_limit;
END $$;

CREATE OR REPLACE FUNCTION cpl_grievances_to_escalate(p_limit int) RETURNS TABLE (tenant_id uuid, case_id uuid, deadline text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT c.tenant_id, c.id, k.deadline
    FROM case_file c
    JOIN tenant t ON t.id = c.tenant_id AND t.state <> 'archived'
    CROSS JOIN LATERAL (SELECT CASE c.state WHEN 'open' THEN 'ack' ELSE 'resolution' END AS deadline) k
    CROSS JOIN LATERAL cpl_grievance_deadlines(c.id) d
    WHERE c.type = 'grievance' AND c.state IN ('open', 'submitted') AND cpl_grievance_escalation_due(c.id, k.deadline)
    ORDER BY CASE k.deadline WHEN 'ack' THEN d.ack_due_at ELSE d.resolution_due_at END, c.id
    LIMIT p_limit;
END $$;

CREATE OR REPLACE FUNCTION gen_stale_models() RETURNS TABLE (tenant_id uuid, kind text, stale_since timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY SELECT m.tenant_id, m.kind, coalesce(m.stale_since, m.valid_until) FROM path_model m
    JOIN tenant t ON t.id = m.tenant_id AND t.state <> 'archived'
    WHERE m.stale_since IS NOT NULL OR m.valid_until <= now()
    ORDER BY coalesce(m.stale_since, m.valid_until), m.tenant_id, m.kind;
END $$;

-- 8. Purge (owner only: no grant to nmp_app; run by the OPS CLI on the owner connection). Every row of the tenant in every
-- public and audit table with a tenant_id column or a key to tenant, its users' credentials and sign-in attempts, and its
-- pgboss jobs; the tenant row and its offboarding record stay as the vendor's record (purged, with the counts).
CREATE FUNCTION tenant_purge(p_tenant uuid, p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  o tenant_offboarding;
  target record;
  deleted bigint;
  tables jsonb := '{}';
  total bigint := 0;
  summary jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant t WHERE t.id = p_tenant AND t.slug = p_slug) THEN
    RAISE EXCEPTION 'the slug does not name this tenant' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO o FROM tenant_offboarding x WHERE x.tenant_id = p_tenant AND x.state NOT IN ('purged', 'cancelled', 'restored')
  FOR UPDATE;
  IF NOT FOUND OR o.state <> 'purge_approved' OR o.retain_until >= current_date
     OR EXISTS (SELECT 1 FROM legal_hold h WHERE h.tenant_id = p_tenant AND h.released_at IS NULL) THEN
    RAISE EXCEPTION 'a tenant is purged once its purge is approved, the retention has passed and no legal hold is active'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- Append-only and key triggers stand down for this transaction only; RLS policies see the tenant (FORCE RLS on owners).
  PERFORM set_config('session_replication_role', 'replica', true), set_config('app.realm', 'tenant', true),
          set_config('app.tenant_id', p_tenant::text, true);
  DELETE FROM password_credential c USING user_account u WHERE u.id = c.user_id AND u.tenant_id = p_tenant;
  DELETE FROM mfa_credential c USING user_account u WHERE u.id = c.user_id AND u.tenant_id = p_tenant;
  DELETE FROM login_attempt a WHERE a.account_key LIKE p_slug || ':%' OR a.account_key LIKE 'portal:' || p_slug || ':%';
  FOR target IN
    SELECT c.oid::regclass AS rel, 'tenant_id' AS col FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relnamespace IN ('public'::regnamespace, 'audit'::regnamespace)
      AND c.oid NOT IN ('tenant_offboarding'::regclass)
    UNION
    SELECT k.conrelid::regclass, a.attname::text FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
    WHERE k.contype = 'f' AND k.confrelid = 'tenant'::regclass AND cardinality(k.conkey) = 1 AND a.attname <> 'tenant_id'
      AND k.conrelid NOT IN ('tenant_offboarding'::regclass)
    ORDER BY 1, 2
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', target.rel, target.col) USING p_tenant;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    IF deleted > 0 THEN
      tables := tables || jsonb_build_object(target.rel::text, deleted);
      total := total + deleted;
    END IF;
  END LOOP;
  DELETE FROM pgboss.job j WHERE j.data ->> 'tenantId' = p_tenant::text;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  tables := tables || jsonb_build_object('pgboss.job', deleted);
  total := total + deleted;
  DELETE FROM pgboss.archive j WHERE j.data ->> 'tenantId' = p_tenant::text;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  tables := tables || jsonb_build_object('pgboss.archive', deleted);
  total := total + deleted;
  summary := jsonb_build_object('tables', tables, 'rows', total);
  UPDATE tenant_offboarding SET state = 'purged', purged_at = now(), purge_summary = summary WHERE id = o.id;
  PERFORM set_config('session_replication_role', 'origin', true);
  RETURN summary;
END $$;
REVOKE ALL ON FUNCTION tenant_purge(uuid, text) FROM PUBLIC;
