-- V1-A orders (PLAN V1-A section 1.4; D-V1A-04, D-V1A-05, C-V1A-7): subscription references, the originals of a
-- converted order (amounts in the market currency, converted once at acceptance), subscription and dispute outcome events.

ALTER TABLE sales_order
  ADD COLUMN subscription_ref text CHECK (length(subscription_ref) BETWEEN 1 AND 100),
  ADD COLUMN original_currency char(3) CHECK (original_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN original_amount_minor bigint CHECK (original_amount_minor >= 0),
  ADD COLUMN original_tax_minor bigint CHECK (original_tax_minor >= 0),
  ADD COLUMN fx_rate_id uuid,
  ADD CONSTRAINT sales_order_converted CHECK (num_nonnulls(original_currency, original_amount_minor, original_tax_minor, fx_rate_id) IN (0, 4)),
  ADD CONSTRAINT sales_order_converted_currency CHECK (original_currency IS NULL OR original_currency <> currency),
  ADD FOREIGN KEY (tenant_id, fx_rate_id) REFERENCES fx_rate (tenant_id, id);
CREATE INDEX sales_order_subscription_idx ON sales_order (tenant_id, source_system, subscription_ref, ordered_at DESC)
  WHERE subscription_ref IS NOT NULL;

ALTER TABLE order_line ADD COLUMN original_amount_minor bigint CHECK (original_amount_minor >= 0);

ALTER TABLE order_event
  ADD COLUMN original_refund_minor bigint CHECK (original_refund_minor >= 0),
  ADD COLUMN original_fee_minor bigint CHECK (original_fee_minor >= 0),
  ADD COLUMN dispute_of_event_id uuid,
  ADD CONSTRAINT order_event_original_pair CHECK ((original_refund_minor IS NULL) = (original_fee_minor IS NULL)),
  ADD FOREIGN KEY (tenant_id, dispute_of_event_id) REFERENCES order_event (tenant_id, id),
  DROP CONSTRAINT order_event_type_check,
  ADD CONSTRAINT order_event_type_check CHECK (type IN ('refund', 'return', 'exchange', 'chargeback', 'chargeback_reversed',
    'renewal_failed', 'cancelled', 'subscription_cancelled', 'dispute_lost')),
  ADD CONSTRAINT order_event_dispute_lost CHECK ((type = 'dispute_lost') = (dispute_of_event_id IS NOT NULL));
-- One outcome per chargeback: won (chargeback_reversed) or lost (dispute_lost).
CREATE UNIQUE INDEX order_event_dispute_outcome ON order_event (tenant_id, coalesce(reverses_event_id, dispute_of_event_id))
  WHERE type IN ('chargeback_reversed', 'dispute_lost');

-- A lost dispute names a chargeback of the same order.
CREATE FUNCTION order_event_dispute_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM order_event e
                 WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.dispute_of_event_id AND e.order_id = NEW.order_id
                   AND e.type = 'chargeback') THEN
    RAISE EXCEPTION 'a lost dispute names a chargeback of the same order' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_event_dispute_guard BEFORE INSERT ON order_event
  FOR EACH ROW WHEN (NEW.dispute_of_event_id IS NOT NULL) EXECUTE FUNCTION order_event_dispute_guard();

ALTER TABLE inbound_event
  DROP CONSTRAINT inbound_event_hold_reason_check,
  ADD CONSTRAINT inbound_event_hold_reason_check CHECK (hold_reason IN ('UNKNOWN_SKU', 'ORDER_NOT_FOUND',
    'SUBSCRIPTION_NOT_FOUND', 'FX_RATE_MISSING', 'FX_RATE_STALE'));
