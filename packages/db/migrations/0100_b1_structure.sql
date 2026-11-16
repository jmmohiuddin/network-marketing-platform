-- B1 TEN structure (FR-TEN-002, FR-TEN-003; PLAN B1 sections 1.1 and 1.3): market guards, brand, calendar, period,
-- the money-key backstop on tenant_setting_version and setting_change_request. Same recipe as 0002/0006: composite
-- tenant keys, apply_tenant_rls, minimal grants. Existing rows are not changed.

-- 1. market. 0006 already grants SELECT, INSERT, UPDATE, DELETE to nmp_app: only guards are added.
-- D-B1-17: the runtime role creates markets as draft only; a market goes live only through an approved go-live request
-- (market_state_guard, 0101, once that table exists). The owner (migrations, test fixtures) is exempt from both.
CREATE FUNCTION market_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'draft' THEN
    RAISE EXCEPTION 'a market is created as draft; it goes live through its launch checklist'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER market_insert_guard BEFORE INSERT ON market
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION market_insert_guard();

-- Every role: only a draft market can be deleted (references are refused by the RESTRICT keys).
CREATE FUNCTION market_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'draft' THEN
    RAISE EXCEPTION 'only a draft market can be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER market_delete_guard BEFORE DELETE ON market FOR EACH ROW EXECUTE FUNCTION market_delete_guard();

-- 2. brand (spec).
CREATE TABLE brand (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

-- 3. calendar (spec + PLAN 1.1). Timing is immutable (D-B1-11): only the name changes.
CREATE TABLE calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  cadence text NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  cutoff_time_zone text NOT NULL,
  first_period_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  -- Monthly periods start on the first day of a month (PLAN 2.2).
  CONSTRAINT calendar_monthly_starts_on_day_one CHECK (cadence <> 'monthly' OR extract(day FROM first_period_start) = 1),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, market_id, name),
  UNIQUE (tenant_id, id)
);

-- BR-PER-01: the cut-off time zone is an IANA name the server knows (a CHECK cannot read the catalogue).
CREATE FUNCTION calendar_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.market_id, NEW.cadence, NEW.cutoff_time_zone, NEW.first_period_start)
       IS DISTINCT FROM (OLD.tenant_id, OLD.market_id, OLD.cadence, OLD.cutoff_time_zone, OLD.first_period_start) THEN
    RAISE EXCEPTION 'a calendar''s market and timing never change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.cutoff_time_zone) THEN
    RAISE EXCEPTION 'unknown time zone %', NEW.cutoff_time_zone USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER calendar_guard BEFORE INSERT OR UPDATE ON calendar FOR EACH ROW EXECUTE FUNCTION calendar_guard();

-- 4. period (spec). No UPDATE grant in B1: state transitions arrive with runs (B3).
CREATE TABLE period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  calendar_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'calculating', 'calculated', 'committed', 'paid', 'closed')),
  committed_run_id uuid, -- FK to run arrives in B3
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (tenant_id, calendar_id) REFERENCES calendar (tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (calendar_id, starts_at),
  CONSTRAINT period_no_overlap EXCLUDE USING gist (calendar_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&),
  UNIQUE (tenant_id, id)
);
CREATE INDEX period_state_idx ON period (tenant_id, state);

CREATE FUNCTION period_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'open' THEN
    RAISE EXCEPTION 'only an open period can be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER period_delete_guard BEFORE DELETE ON period FOR EACH ROW EXECUTE FUNCTION period_delete_guard();

-- 5. Money-affecting setting keys (FR-TEN-003, BR-MNY-02): one list, read by the guard below and by tests.
CREATE FUNCTION money_setting_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['money.rounding_mode', 'money.clawback_policy']
$$;

-- Backstop for D-B1-01: a version that changes a money key carries an approval. The baseline is the row in force at
-- NEW.effective_from when NEW is inserted: the highest version among the rows with effective_from <= NEW's. Appends
-- keep the chain's versions rising with effective_from, so for a change this is the chain row in force at its date,
-- and for a rebased row it is its new predecessor (rebase rows copy the approval of the row they rebase). No such row
-- = nothing in force ({}), as in the rebase function's base.
CREATE FUNCTION tenant_setting_version_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  baseline jsonb;
  changed text;
BEGIN
  IF NEW.approval_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT v.settings INTO baseline FROM tenant_setting_version v
  WHERE v.tenant_id = NEW.tenant_id AND v.effective_from <= NEW.effective_from
  ORDER BY v.version DESC LIMIT 1;
  SELECT k INTO changed FROM unnest(money_setting_keys()) AS k
  WHERE NEW.settings -> k IS DISTINCT FROM coalesce(baseline, '{}'::jsonb) -> k LIMIT 1;
  IF changed IS NOT NULL THEN
    RAISE EXCEPTION 'setting % is money-affecting: its change needs an approval', changed
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_setting_version_money_guard BEFORE INSERT ON tenant_setting_version
  FOR EACH ROW EXECUTE FUNCTION tenant_setting_version_money_guard();

-- 6. setting_change_request (PLAN 1.1): a money-key change waiting for a Finance approver.
CREATE TABLE setting_change_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  key text NOT NULL,
  value jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  base_version int NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  approval_id uuid,
  version_id uuid,
  CONSTRAINT setting_change_request_decider_is_not_requester CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT setting_change_request_decided_at CHECK ((state = 'pending') = (decided_at IS NULL)),
  CONSTRAINT setting_change_request_approved_complete
    CHECK (state <> 'approved' OR (approval_id IS NOT NULL AND version_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by) REFERENCES user_account (tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approval (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES tenant_setting_version (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX setting_change_request_one_pending ON setting_change_request (tenant_id, key) WHERE state = 'pending';

-- Shared by the pending-request tables (setting_change_request, market_go_live_request in 0101). A request is
-- decided once: pending -> approved | rejected (by a decider) | withdrawn (by its requester: no decider, no approval),
-- and only the decision columns given as trigger arguments change.
CREATE FUNCTION pending_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on % is not allowed (decisions are history)', TG_TABLE_NAME;
  END IF;
  IF (OLD.state = 'pending' AND NEW.state IN ('approved', 'rejected', 'withdrawn')
      AND to_jsonb(NEW) - TG_ARGV::text[] = to_jsonb(OLD) - TG_ARGV::text[]
      AND (NEW.state = 'withdrawn') = (NEW.decided_by IS NULL)
      AND (NEW.state <> 'withdrawn' OR NEW.approval_id IS NULL)) IS NOT TRUE THEN
    RAISE EXCEPTION '% changes once, from pending to its decision or withdrawal', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER setting_change_request_decided_once BEFORE UPDATE OR DELETE ON setting_change_request
  FOR EACH ROW EXECUTE FUNCTION pending_request_guard(
    'state', 'decided_by', 'decided_at', 'decision_reason', 'approval_id', 'version_id');

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['brand', 'calendar', 'period', 'setting_change_request']::regclass[]) AS t;

GRANT SELECT, INSERT, DELETE ON brand, calendar, period TO nmp_app;
GRANT UPDATE (name) ON brand, calendar TO nmp_app;
GRANT SELECT, INSERT ON setting_change_request TO nmp_app;
GRANT UPDATE (state, decided_by, decided_at, decision_reason, approval_id, version_id) ON setting_change_request TO nmp_app;
