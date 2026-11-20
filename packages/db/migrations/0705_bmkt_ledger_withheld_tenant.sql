-- B-MKT review: tax_ledger_withheld runs inside tax_generate_forms (SECURITY DEFINER, no RLS) and journal_entry.origin_id
-- has no foreign key to run, so the entry is tied to the market's tenant explicitly (as every other definer-path join).
CREATE OR REPLACE FUNCTION tax_ledger_withheld(p_market uuid, p_year int) RETURNS bigint
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(sum(po.credit_minor - po.debit_minor), 0)::bigint
  FROM market m
  CROSS JOIN tax_year_bounds(p_market, p_year) b
  CROSS JOIN tax_committed_runs(p_market, b.starts_on, b.ends_on) r
  JOIN journal_entry e ON e.tenant_id = m.tenant_id AND e.event_type = 'run_committed' AND e.origin_type = 'run' AND e.origin_id = r.run_id
  JOIN posting po ON po.tenant_id = e.tenant_id AND po.entry_id = e.id
  JOIN ledger_account a ON a.tenant_id = po.tenant_id AND a.id = po.account_id AND a.type = 'withholding_payable'
  WHERE m.id = p_market
$$;
