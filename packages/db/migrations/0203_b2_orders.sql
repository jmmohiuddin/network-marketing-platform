-- B2 orders and inbound events (PLAN B2 sections 1.4 and 1.5; D-B2-11, D-B2-12, D-B2-17, D-B2-18): product volumes,
-- inbound writes with their natural keys, orders with facts fixed at ingestion, insert-only lines and events, and the
-- late-transaction queue. Not partitioned (D-B2-18).

-- 1. product_volume_map: volumes per unit by named measure, effective-dated, one row at a time per market and SKU.
CREATE TABLE product_volume_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  market_id uuid NOT NULL,
  sku text NOT NULL CHECK (sku ~ '^[\x21-\x7e]{1,64}$'),
  item_class text NOT NULL CHECK (item_class IN ('product', 'starter_kit', 'service', 'shipping', 'fee')),
  volumes jsonb NOT NULL CHECK (jsonb_typeof(volumes) = 'object'),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT product_volume_map_no_overlap EXCLUDE USING gist
    (tenant_id WITH =, market_id WITH =, sku WITH =, tstzrange(valid_from, valid_to) WITH &&),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX product_volume_map_sku_idx ON product_volume_map (tenant_id, market_id, sku, valid_from);
CREATE TRIGGER product_volume_map_closed_once BEFORE UPDATE OR DELETE ON product_volume_map
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('valid_to');
CREATE TRIGGER product_volume_map_created_by_actor BEFORE INSERT ON product_volume_map
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('created_by');

-- 2. inbound_event: one row per order/event write. Held rows keep their payload until processed or rejected; the
-- natural key is unique among held and processed rows (rejections are history).
CREATE TABLE inbound_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  source text NOT NULL CHECK (source ~ '^(api|connector):[\x21-\x7e]{1,100}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 300),
  payload_hash bytea NOT NULL CHECK (length(payload_hash) = 32),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result jsonb,
  state text NOT NULL CHECK (state IN ('held', 'processed', 'rejected')),
  payload jsonb,
  hold_reason text CHECK (hold_reason IN ('UNKNOWN_SKU', 'ORDER_NOT_FOUND')),
  hold_ref text,
  attempts int NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CONSTRAINT inbound_event_held CHECK ((state = 'held') = (payload IS NOT NULL AND hold_reason IS NOT NULL)),
  CONSTRAINT inbound_event_processed_at CHECK (state = 'held' OR processed_at IS NOT NULL),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX inbound_event_natural_key ON inbound_event (tenant_id, source, idempotency_key)
  WHERE state IN ('held', 'processed');
CREATE INDEX inbound_event_source_idx ON inbound_event (tenant_id, source, received_at DESC);
CREATE INDEX inbound_event_held_idx ON inbound_event (tenant_id, hold_reason, hold_ref) WHERE state = 'held';

-- held -> held (another attempt) | processed | rejected; processed and rejected are final.
CREATE FUNCTION inbound_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  processing_fields constant text[] :=
    ARRAY['processed_at', 'state', 'result', 'payload', 'hold_reason', 'hold_ref', 'attempts'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on inbound_event is not allowed (history)';
  END IF;
  IF OLD.state <> 'held' OR to_jsonb(NEW) - processing_fields IS DISTINCT FROM to_jsonb(OLD) - processing_fields THEN
    RAISE EXCEPTION 'an inbound event changes only while held' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inbound_event_processed_once BEFORE UPDATE OR DELETE ON inbound_event
  FOR EACH ROW EXECUTE FUNCTION inbound_event_guard();

-- 3. sales_order: facts fixed at ingestion (BR-ORD-01, BR-ATT-02); period and attribution are set once (DATABASE C-16).
CREATE TABLE sales_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  source_system text NOT NULL CHECK (length(source_system) BETWEEN 1 AND 100),
  source_order_id text NOT NULL CHECK (length(source_order_id) BETWEEN 1 AND 100),
  market_id uuid NOT NULL,
  brand_id uuid,
  buyer_id uuid NOT NULL,
  buyer_type_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('resale', 'personal', 'unspecified', 'customer')),
  purpose_missing boolean NOT NULL,
  attributed_position_id uuid,
  attribution_source text CHECK (attribution_source IS NULL OR attribution_source IN ('link', 'code', 'servicing', 'buyer')),
  attribution_conflict boolean NOT NULL,
  ordered_at timestamptz NOT NULL,
  credited_at timestamptz NOT NULL,
  period_id uuid,
  amount_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payload_hash bytea NOT NULL CHECK (length(payload_hash) = 32),
  inbound_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CHECK (amount_minor >= 0 AND tax_minor >= 0),
  FOREIGN KEY (tenant_id, market_id) REFERENCES market (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand (tenant_id, id),
  FOREIGN KEY (tenant_id, buyer_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, buyer_type_id) REFERENCES participant_type (tenant_id, id),
  FOREIGN KEY (tenant_id, attributed_position_id) REFERENCES position (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, inbound_event_id) REFERENCES inbound_event (tenant_id, id),
  UNIQUE (tenant_id, source_system, source_order_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX sales_order_period_idx ON sales_order (tenant_id, period_id);
CREATE INDEX sales_order_buyer_idx ON sales_order (tenant_id, buyer_id, credited_at);
CREATE INDEX sales_order_attributed_idx ON sales_order (tenant_id, attributed_position_id, credited_at);
CREATE TRIGGER sales_order_facts_fixed BEFORE UPDATE OR DELETE ON sales_order
  FOR EACH ROW EXECUTE FUNCTION set_once_guard('period_id', 'attributed_position_id', 'attribution_source');

-- 4. order_line (insert-only): volumes are the per-unit map values times the quantity (D-B2-17).
CREATE TABLE order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  order_id uuid NOT NULL,
  line_no int NOT NULL,
  sku text NOT NULL CHECK (sku ~ '^[\x21-\x7e]{1,64}$'),
  item_class text NOT NULL CHECK (item_class IN ('product', 'starter_kit', 'service', 'shipping', 'fee')),
  quantity int NOT NULL,
  amount_minor bigint NOT NULL,
  volumes jsonb NOT NULL CHECK (jsonb_typeof(volumes) = 'object'),
  source_line_id text CHECK (source_line_id IS NULL OR length(source_line_id) BETWEEN 1 AND 100),
  CHECK (quantity > 0 AND amount_minor >= 0),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales_order (tenant_id, id),
  UNIQUE (order_id, line_no),
  UNIQUE (tenant_id, order_id, line_no),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER order_line_no_mutation BEFORE UPDATE OR DELETE ON order_line
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 5. order_event (insert-only). Deviation C-B2-6: the source event id is unique per source system.
CREATE TABLE order_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  order_id uuid NOT NULL,
  source_system text NOT NULL CHECK (length(source_system) BETWEEN 1 AND 100),
  source_event_id text NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 100),
  type text NOT NULL CHECK (type IN ('refund', 'return', 'exchange', 'chargeback', 'chargeback_reversed',
    'renewal_failed', 'cancelled')),
  occurred_at timestamptz NOT NULL,
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  refund_minor bigint NOT NULL,
  fee_minor bigint NOT NULL,
  equal_value boolean NOT NULL DEFAULT false,
  volume_effect jsonb NOT NULL CHECK (jsonb_typeof(volume_effect) = 'object'),
  period_id uuid,
  reverses_event_id uuid,
  inbound_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CHECK (refund_minor >= 0 AND fee_minor >= 0),
  CONSTRAINT order_event_equal_value_exchange CHECK (equal_value = false OR type = 'exchange'),
  CONSTRAINT order_event_reversal CHECK ((type = 'chargeback_reversed') = (reverses_event_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales_order (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, reverses_event_id) REFERENCES order_event (tenant_id, id),
  FOREIGN KEY (tenant_id, inbound_event_id) REFERENCES inbound_event (tenant_id, id),
  UNIQUE (tenant_id, source_system, source_event_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX order_event_order_idx ON order_event (order_id);
CREATE TRIGGER order_event_no_mutation BEFORE UPDATE OR DELETE ON order_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- BR-RET-01 backstop (the API checks first under SELECT ... FOR UPDATE of the order): per line, returned quantities
-- (return, unequal exchange, refund with lines, chargeback, cancelled) minus re-credited ones (chargeback_reversed)
-- stay within 0..purchased. OR001 = RETURN_EXCEEDS_PURCHASED. The order row lock serialises events of one order.
CREATE FUNCTION order_event_quantity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bad_line int;
BEGIN
  PERFORM 1 FROM sales_order o WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.order_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.lines) x
             WHERE jsonb_typeof(x -> 'line_no') IS DISTINCT FROM 'number' OR jsonb_typeof(x -> 'quantity') IS DISTINCT FROM 'number'
               OR (x ->> 'quantity')::int <= 0
               OR NOT EXISTS (SELECT 1 FROM order_line l
                              WHERE l.tenant_id = NEW.tenant_id AND l.order_id = NEW.order_id
                                AND l.line_no = (x ->> 'line_no')::int)) THEN
    RAISE EXCEPTION 'order event lines name lines of the order with a positive quantity' USING ERRCODE = 'check_violation';
  END IF;
  WITH events AS (
    SELECT e.type, e.equal_value, e.lines FROM order_event e
    WHERE e.tenant_id = NEW.tenant_id AND e.order_id = NEW.order_id
    UNION ALL
    SELECT NEW.type, NEW.equal_value, NEW.lines
  ), moved AS (
    SELECT (x ->> 'line_no')::int AS line_no,
           CASE WHEN ev.type = 'chargeback_reversed' THEN -1 ELSE 1 END * (x ->> 'quantity')::int AS quantity
    FROM events ev CROSS JOIN jsonb_array_elements(ev.lines) x
    WHERE ev.type IN ('return', 'refund', 'chargeback', 'cancelled', 'chargeback_reversed')
       OR (ev.type = 'exchange' AND NOT ev.equal_value)
  )
  SELECT m.line_no INTO bad_line
  FROM moved m JOIN order_line l ON l.tenant_id = NEW.tenant_id AND l.order_id = NEW.order_id AND l.line_no = m.line_no
  GROUP BY m.line_no, l.quantity
  HAVING sum(m.quantity) NOT BETWEEN 0 AND l.quantity
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'line % would return more than was purchased', bad_line USING ERRCODE = 'OR001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_event_quantity_guard BEFORE INSERT ON order_event
  FOR EACH ROW EXECUTE FUNCTION order_event_quantity_guard();

-- 6. late_transaction (FR-ORD-005). Deviation C-B2-18: the polymorphic origin is two keyed columns.
CREATE TABLE late_transaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  order_id uuid,
  order_event_id uuid,
  origin_type text GENERATED ALWAYS AS (CASE WHEN order_id IS NOT NULL THEN 'order' ELSE 'order_event' END) STORED,
  original_period_id uuid NOT NULL,
  effect_estimate jsonb,
  handling text NOT NULL CHECK (handling IN ('adjust', 'restatement')),
  state text NOT NULL CHECK (state IN ('pending', 'decided', 'consumed')),
  consumed_by_run_id uuid, -- key to run arrives in B3
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(trim(decision_reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app_user_id(),
  created_by_type text NOT NULL DEFAULT app_actor_type()
    CHECK (created_by_type IN ('user', 'service_account', 'system')),
  CONSTRAINT late_transaction_one_origin CHECK (num_nonnulls(order_id, order_event_id) = 1),
  CONSTRAINT late_transaction_decided_at CHECK ((state = 'pending') = (decided_at IS NULL)),
  CONSTRAINT late_transaction_decided_by CHECK ((state = 'pending') = (decided_by IS NULL)),
  CONSTRAINT late_transaction_consumed CHECK ((state = 'consumed') = (consumed_by_run_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales_order (tenant_id, id),
  FOREIGN KEY (tenant_id, order_event_id) REFERENCES order_event (tenant_id, id),
  FOREIGN KEY (tenant_id, original_period_id) REFERENCES period (tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by) REFERENCES user_account (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX late_transaction_order_period ON late_transaction (tenant_id, order_id, original_period_id)
  WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX late_transaction_event_period ON late_transaction (tenant_id, order_event_id, original_period_id)
  WHERE order_event_id IS NOT NULL;
CREATE INDEX late_transaction_state_idx ON late_transaction (tenant_id, state);

-- The handling changes while pending; pending -> decided once, by the acting user; decided -> consumed once (B3).
-- origin_type is excluded from the comparison: a generated column is still NULL in NEW in a BEFORE trigger.
CREATE FUNCTION late_transaction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  decision_fields constant text[] :=
    ARRAY['handling', 'state', 'decided_by', 'decided_at', 'decision_reason', 'consumed_by_run_id', 'origin_type'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on late_transaction is not allowed (history)';
  END IF;
  IF to_jsonb(NEW) - decision_fields IS DISTINCT FROM to_jsonb(OLD) - decision_fields
     OR NOT ((OLD.state = 'pending' AND NEW.state IN ('pending', 'decided'))
             OR (OLD.state = 'decided' AND NEW.state = 'consumed'
                 AND (NEW.handling, NEW.decided_by, NEW.decided_at, NEW.decision_reason)
                     IS NOT DISTINCT FROM (OLD.handling, OLD.decided_by, OLD.decided_at, OLD.decision_reason))) THEN
    RAISE EXCEPTION 'a late transaction is decided once, then consumed once' USING ERRCODE = 'check_violation';
  END IF;
  IF current_user = 'nmp_app' AND OLD.state = 'pending' AND NEW.state = 'decided'
     AND NEW.decided_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'late_transaction.decided_by must be the acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER late_transaction_decided_once BEFORE UPDATE OR DELETE ON late_transaction
  FOR EACH ROW EXECUTE FUNCTION late_transaction_guard();

SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
  'product_volume_map', 'inbound_event', 'sales_order', 'order_line', 'order_event', 'late_transaction'
]::regclass[]) AS t;

GRANT SELECT, INSERT ON product_volume_map, inbound_event, sales_order, order_line, order_event, late_transaction
  TO nmp_app;
GRANT UPDATE (valid_to) ON product_volume_map TO nmp_app;
GRANT UPDATE (processed_at, state, result, payload, hold_reason, hold_ref, attempts) ON inbound_event TO nmp_app;
GRANT UPDATE (period_id, attributed_position_id, attribution_source) ON sales_order TO nmp_app;
GRANT UPDATE (handling, state, decided_by, decided_at, decision_reason) ON late_transaction TO nmp_app;
