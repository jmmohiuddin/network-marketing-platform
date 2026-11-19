-- B4 review fix: journal_entry.posted_at is the posting instant under the market's ledger lock (clock_timestamp()), not
-- the transaction start (now()). A commit that waited on the run, periods or ledger lock otherwise posted with a time
-- earlier than entries committed before it, and led_receivables (running balance by posted_at, entry id) could see a
-- false reset and start a receivable's outstanding streak late (D-B4-08 ageing). Entries of one market are now ordered
-- by their real posting order. Body as 0404 except the posted_at column.
CREATE OR REPLACE FUNCTION ledger_post(p_market uuid, p_period uuid, p_event_type text, p_origin_type text, p_origin_id uuid,
                                       p_key text, p_approval uuid, p_lines jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_existing journal_entry;
  v_currency char(3);
  v_entry uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || app_tenant_id() || ':' || p_market, 0));
  SELECT * INTO v_existing FROM journal_entry e WHERE e.idempotency_key = p_key;
  IF FOUND THEN
    IF (v_existing.origin_type, v_existing.origin_id) IS DISTINCT FROM (p_origin_type, p_origin_id) THEN
      RAISE EXCEPTION 'ledger key % already posts another origin', p_key USING ERRCODE = 'unique_violation';
    END IF;
    RETURN v_existing.id;
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) < 2 OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lines) l
       WHERE jsonb_typeof(l) <> 'object'
          OR jsonb_typeof(l -> 'debit_minor') IS DISTINCT FROM 'string' OR jsonb_typeof(l -> 'credit_minor') IS DISTINCT FROM 'string'
          OR (l ->> 'debit_minor') !~ '^(0|[1-9][0-9]{0,17})$' OR (l ->> 'credit_minor') !~ '^(0|[1-9][0-9]{0,17})$'
          OR ((l ->> 'debit_minor') = '0') = ((l ->> 'credit_minor') = '0')) THEN
    RAISE EXCEPTION 'ledger lines: at least two, each with exactly one non-zero side as a minor-unit string'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT sum((l ->> 'debit_minor')::numeric - (l ->> 'credit_minor')::numeric) FROM jsonb_array_elements(p_lines) l) <> 0 THEN
    RAISE EXCEPTION 'ledger lines do not balance' USING ERRCODE = 'check_violation';
  END IF;
  SELECT m.currency INTO v_currency FROM market m WHERE m.id = p_market;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'market % does not exist', p_market USING ERRCODE = 'foreign_key_violation';
  END IF;
  INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, currency)
  SELECT DISTINCT app_tenant_id(), p_market, l ->> 'type', (l ->> 'payee_participant_id')::uuid, v_currency
  FROM jsonb_array_elements(p_lines) l
  ON CONFLICT DO NOTHING;
  INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id, posted_at)
  VALUES (app_tenant_id(), p_market, p_period, p_event_type, p_origin_type, p_origin_id, p_key, p_approval, clock_timestamp())
  RETURNING id INTO v_entry;
  INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
  SELECT app_tenant_id(), v_entry, a.id, (l.line ->> 'debit_minor')::bigint, (l.line ->> 'credit_minor')::bigint, a.currency
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l (line, n)
  JOIN ledger_account a ON a.market_id = p_market AND a.type = l.line ->> 'type' AND a.credit_type_id IS NULL
    AND a.payee_participant_id IS NOT DISTINCT FROM (l.line ->> 'payee_participant_id')::uuid
  ORDER BY l.n;
  RETURN v_entry;
END $$;
