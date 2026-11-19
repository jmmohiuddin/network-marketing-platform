-- B4 shared SQL (PLAN B4 section 4.2): posting, derived balances, receivables, attribution, the Paid flip, related
-- parties, the system-realm payout lookups, and the setting and market catalogues extended with the B4 objects.

-- Normal-side balance of an account type (D-B4-03): debit-normal types count debits, the others credits.
CREATE FUNCTION led_balance(p_market uuid, p_participant uuid, p_type text) RETURNS bigint
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(sum(CASE WHEN p_type IN ('commission_expense', 'clawback_receivable', 'write_off', 'rounding_residue')
                           THEN x.debit_minor - x.credit_minor ELSE x.credit_minor - x.debit_minor END), 0)::bigint
  FROM ledger_account a JOIN posting x ON x.account_id = a.id
  WHERE a.market_id = p_market AND a.type = p_type AND a.payee_participant_id IS NOT DISTINCT FROM p_participant
    AND a.credit_type_id IS NULL
$$;

-- D-B4-07: positive clawback receivables of the market (the run snapshot's receivables).
CREATE FUNCTION led_receivable_balances(p_market uuid) RETURNS TABLE (participant_id uuid, amount_minor bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT a.payee_participant_id, sum(x.debit_minor - x.credit_minor)::bigint
  FROM ledger_account a JOIN posting x ON x.account_id = a.id
  WHERE a.market_id = p_market AND a.type = 'clawback_receivable'
  GROUP BY a.payee_participant_id HAVING sum(x.debit_minor - x.credit_minor) > 0
  ORDER BY a.payee_participant_id
$$;

-- D-B4-08: positive receivables with the start of their current positive streak: the first entry after the last one
-- (by posted_at, entry id) that left the running balance at or below zero.
CREATE FUNCTION led_receivables(p_market uuid)
RETURNS TABLE (participant_id uuid, amount_minor bigint, outstanding_since timestamptz)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH moves AS (
    SELECT a.payee_participant_id AS p, e.posted_at, e.id AS entry_id, sum(x.debit_minor - x.credit_minor) AS delta
    FROM ledger_account a JOIN posting x ON x.account_id = a.id JOIN journal_entry e ON e.id = x.entry_id
    WHERE a.market_id = p_market AND a.type = 'clawback_receivable'
    GROUP BY a.payee_participant_id, e.posted_at, e.id
  ), running AS (
    SELECT p, posted_at, entry_id, sum(delta) OVER w AS balance FROM moves
    WINDOW w AS (PARTITION BY p ORDER BY posted_at, entry_id)
  ), streaks AS (
    SELECT p, posted_at, balance, count(*) FILTER (WHERE balance <= 0) OVER w AS resets,
           last_value(balance) OVER (PARTITION BY p ORDER BY posted_at, entry_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS final
    FROM running
    WINDOW w AS (PARTITION BY p ORDER BY posted_at, entry_id)
  ), latest AS (
    SELECT p, final, posted_at, resets, max(resets) OVER (PARTITION BY p) AS last_reset, balance FROM streaks WHERE final > 0
  )
  SELECT p, final::bigint, min(posted_at) FROM latest WHERE resets = last_reset AND balance > 0 GROUP BY p, final ORDER BY p
$$;

-- D-B4-05: the market's most recently committed period (committed or later), NULL when none.
CREATE FUNCTION led_attribution_period(p_market uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  LEFT JOIN run r ON r.tenant_id = p.tenant_id AND r.id = p.committed_run_id
  WHERE c.market_id = p_market AND p.state IN ('committed', 'paid', 'closed')
  ORDER BY r.committed_at DESC NULLS LAST, p.starts_at DESC, p.id
  LIMIT 1
$$;

-- One balanced entry under the market's ledger lock (D-B4-07): an existing key returns its entry (another origin under
-- the key: 23505); lines [{type, payee_participant_id | null, debit_minor, credit_minor}] are minor-unit strings with
-- exactly one side non-zero; accounts are created on first use in the market's currency (D-B4-04).
CREATE FUNCTION ledger_post(p_market uuid, p_period uuid, p_event_type text, p_origin_type text, p_origin_id uuid,
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
  INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id)
  VALUES (app_tenant_id(), p_market, p_period, p_event_type, p_origin_type, p_origin_id, p_key, p_approval)
  RETURNING id INTO v_entry;
  INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
  SELECT app_tenant_id(), v_entry, a.id, (l.line ->> 'debit_minor')::bigint, (l.line ->> 'credit_minor')::bigint, a.currency
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l (line, n)
  JOIN ledger_account a ON a.market_id = p_market AND a.type = l.line ->> 'type' AND a.credit_type_id IS NULL
    AND a.payee_participant_id IS NOT DISTINCT FROM (l.line ->> 'payee_participant_id')::uuid
  ORDER BY l.n;
  RETURN v_entry;
END $$;

-- D-B4-02: the committed run's one entry, from its settlement. Receivables gate first (LD001, DETAIL = the payees whose
-- receivable moved since the snapshot), residue must be 0, control: net expense = Σ result lines = totals.gross_minor.
-- A negative gross reduces the payee's current payable first and books the rest as receivable (C-B4-4). NULL when the
-- run has nothing to post.
CREATE FUNCTION led_post_run(p_run uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r run;
  v_market uuid;
  v_entry uuid;
  v_changed jsonb;
  v_lines jsonb;
  v_expense numeric;
BEGIN
  SELECT * INTO r FROM run WHERE id = p_run;
  IF NOT FOUND OR r.state <> 'committed' THEN
    RAISE EXCEPTION 'only a committed run is posted' USING ERRCODE = 'check_violation';
  END IF;
  SELECT c.market_id INTO v_market FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
  WHERE p.id = r.period_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || r.tenant_id || ':' || v_market, 0));
  SELECT e.id INTO v_entry FROM journal_entry e WHERE e.idempotency_key = 'run:' || p_run;
  IF FOUND THEN
    RETURN v_entry;
  END IF;
  IF coalesce(r.totals ->> 'residue_minor', '0') <> '0' THEN
    RAISE EXCEPTION 'run % has a rounding residue; residue is not posted (C-B4-3)', p_run USING ERRCODE = 'check_violation';
  END IF;
  SELECT jsonb_agg(s.payee_participant_id ORDER BY s.payee_participant_id) INTO v_changed FROM run_settlement s
  WHERE s.run_id = p_run AND s.receivable_before_minor <> led_balance(v_market, s.payee_participant_id, 'clawback_receivable');
  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION 'receivables changed since run % was calculated', p_run USING ERRCODE = 'LD001', DETAIL = v_changed::text;
  END IF;
  SELECT coalesce(sum(s.gross_minor), 0) INTO v_expense FROM run_settlement s WHERE s.run_id = p_run;
  IF v_expense IS DISTINCT FROM (SELECT coalesce(sum(l.amount_minor), 0) FROM result_line l WHERE l.run_id = p_run)
     OR v_expense IS DISTINCT FROM (r.totals ->> 'gross_minor')::numeric THEN
    RAISE EXCEPTION 'run % settlement, lines and totals.gross_minor differ (control)', p_run USING ERRCODE = 'check_violation';
  END IF;
  WITH s AS (SELECT * FROM run_settlement WHERE run_id = p_run AND gross_minor <> 0),
  neg AS (
    SELECT s.payee_participant_id AS payee, -s.gross_minor AS owed,
           least(-s.gross_minor, greatest(led_balance(v_market, s.payee_participant_id, 'payee_payable'), 0)) AS offset_minor
    FROM s WHERE s.gross_minor < 0
  ), lines (type, payee, debit, credit) AS (
    SELECT 'commission_expense', NULL::uuid, sum(s.gross_minor), 0::numeric FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'commission_expense', NULL, 0, -sum(s.gross_minor) FROM s WHERE s.gross_minor < 0
    UNION ALL SELECT 'withholding_payable', NULL, 0, sum(s.withheld_minor) FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'payee_payable', s.payee_participant_id, 0, s.gross_minor - s.withheld_minor FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'payee_payable', s.payee_participant_id, s.netted_minor, 0 FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'clawback_receivable', s.payee_participant_id, 0, s.netted_minor FROM s WHERE s.gross_minor > 0
    UNION ALL SELECT 'payee_payable', neg.payee, neg.offset_minor, 0 FROM neg
    UNION ALL SELECT 'clawback_receivable', neg.payee, neg.owed - neg.offset_minor, 0 FROM neg
  )
  SELECT jsonb_agg(jsonb_build_object('type', type, 'payee_participant_id', payee, 'debit_minor', debit::text,
                                      'credit_minor', credit::text) ORDER BY type, payee, debit)
  INTO v_lines FROM lines WHERE debit <> 0 OR credit <> 0;
  IF v_lines IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN ledger_post(v_market, r.period_id, 'run_committed', 'run', p_run, 'run:' || p_run, r.approval_id, v_lines);
END $$;

-- D-B4-15: committed -> paid when every instruction of the period's batches is terminal. The period row is locked first,
-- so of two transactions settling its last instructions the later one sees the other's and flips it.
CREATE FUNCTION period_mark_paid(p_period uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM period WHERE id = p_period FOR UPDATE;
  UPDATE period SET state = 'paid'
  WHERE id = p_period AND state = 'committed' AND period_payouts_terminal(tenant_id, id);
  RETURN FOUND;
END $$;

-- D-B4-11: users with an active related-party declaration for the participant.
CREATE FUNCTION staff_related_users(p_participant uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT d.user_id FROM user_related_participant d WHERE d.participant_id = p_participant AND d.withdrawn_at IS NULL
  ORDER BY d.user_id
$$;

-- System realm only, before any tenant context: the provider a sandbox webhook names (D-B4-15), the due sandbox
-- instructions of the dispatcher (D-B4-13), the providers with a review date (D-B4-20).
CREATE FUNCTION pay_provider_for_webhook(p_id uuid)
RETURNS TABLE (tenant_id uuid, market_id uuid, adapter text, webhook_secret_sealed text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT c.tenant_id, c.market_id, c.adapter, c.webhook_secret_sealed FROM provider_config c
    WHERE c.id = p_id AND c.kind = 'payout' AND c.state = 'recorded';
END $$;

CREATE FUNCTION pay_due_instructions(p_limit int) RETURNS TABLE (tenant_id uuid, instruction_id uuid)
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
    WHERE i.state IN ('pending', 'instructed') AND i.next_attempt_at <= now() AND c.adapter = 'sandbox'
    ORDER BY i.next_attempt_at, i.id
    LIMIT p_limit;
END $$;

CREATE FUNCTION pay_due_provider_reviews() RETURNS TABLE (tenant_id uuid, provider_config_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT c.tenant_id, c.id FROM provider_config c
    WHERE c.kind IN ('payout', 'payment') AND c.state = 'recorded' AND c.review_due_on IS NOT NULL
    ORDER BY c.review_due_on, c.tenant_id, c.id;
END $$;

REVOKE ALL ON FUNCTION pay_provider_for_webhook(uuid), pay_due_instructions(int), pay_due_provider_reviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pay_provider_for_webhook(uuid), pay_due_instructions(int), pay_due_provider_reviews() TO nmp_app;

-- D-B4-18: the payout, adjustment and write-off policies are money settings approved by settings.approve.
CREATE OR REPLACE FUNCTION money_setting_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['money.rounding_mode', 'money.clawback_policy', 'payouts.market_policy',
               'payouts.bank_detail_cooling_off_hours', 'adjustments.policy', 'write_offs.policy']
$$;

CREATE OR REPLACE FUNCTION approval_setting_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['money.rounding_mode', 'money.clawback_policy', 'genealogy.visibility_policy', 'payouts.market_policy',
               'payouts.bank_detail_cooling_off_hours', 'adjustments.policy', 'write_offs.policy']
$$;

-- AC-TEN2-3: the B4 tables with a key to market.
CREATE OR REPLACE FUNCTION market_references(p_market_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'calendars', (SELECT count(*) FROM calendar WHERE market_id = p_market_id),
    'imports', (SELECT count(*) FROM import_batch WHERE market_id = p_market_id),
    'snapshots', (SELECT count(*) FROM compliance_report_snapshot WHERE market_id = p_market_id),
    'fact_participants', (SELECT count(*) FROM cpl_fact_participant WHERE market_id = p_market_id),
    'providers', (SELECT count(*) FROM provider_config WHERE market_id = p_market_id AND kind <> 'commerce'),
    'connectors', (SELECT count(*) FROM provider_config WHERE market_id = p_market_id AND kind = 'commerce'),
    'checklist_entries', (SELECT count(*) FROM market_checklist_entry WHERE market_id = p_market_id),
    'go_live_requests', (SELECT count(*) FROM market_go_live_request WHERE market_id = p_market_id),
    'cases', (SELECT count(*) FROM case_file WHERE market_id = p_market_id),
    'participants', (SELECT count(*) FROM participant WHERE market_id = p_market_id),
    'positions', (SELECT count(*) FROM position WHERE market_id = p_market_id),
    'orders', (SELECT count(*) FROM sales_order WHERE market_id = p_market_id),
    'product_volumes', (SELECT count(*) FROM product_volume_map WHERE market_id = p_market_id),
    'agreement_versions', (SELECT count(*) FROM agreement_version WHERE market_id = p_market_id),
    'plans', (SELECT count(*) FROM plan_market WHERE market_id = p_market_id),
    'ledger_accounts', (SELECT count(*) FROM ledger_account WHERE market_id = p_market_id),
    'journal_entries', (SELECT count(*) FROM journal_entry WHERE market_id = p_market_id),
    'gl_mappings', (SELECT count(*) FROM gl_account_map WHERE market_id = p_market_id),
    'journal_exports', (SELECT count(*) FROM journal_export WHERE market_id = p_market_id),
    'payout_batches', (SELECT count(*) FROM payout_batch WHERE market_id = p_market_id),
    'payout_holds', (SELECT count(*) FROM payout_hold WHERE market_id = p_market_id),
    'grants', (SELECT count(*) FROM role_assignment WHERE p_market_id = ANY (market_ids))
            + (SELECT count(*) FROM role_grant_request WHERE p_market_id = ANY (market_ids)))
$$;
