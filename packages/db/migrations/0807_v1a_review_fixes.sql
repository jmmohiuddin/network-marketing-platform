-- V1-A review fixes (0800-0806 as applied): offboarding state moves only through its trigger; tenant-scoped retention
-- schedules inside definers; an expiry empties exactly its lot and a redemption never takes a due lot; the offboarding
-- export is pinned against erasure; the purged tenant's kept record holds no key to deleted rows; archived tenants get no
-- scheduled export; provisional and final commits serialise; joint/entity holders recorded on every account change;
-- read-only flag per realm; acknowledged warnings known; no-effect order events carry nothing; converted orders name
-- their pair's rate.

-- 1. tenant.state follows the offboarding only through its archive/restore trigger: the helper is no longer callable by
-- the runtime role (any tenant could replay a stale 'restored' record), so the trigger function runs it as the owner.
ALTER FUNCTION tenant_offboarding_moves_tenant() SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE EXECUTE ON FUNCTION tenant_set_offboarding_state(uuid) FROM nmp_app;

-- 2. The schedule in force is the acting tenant's (an INVOKER helper called from the retention definers, which bypass RLS).
CREATE OR REPLACE FUNCTION retention_schedule_in_force(p_class text, p_market uuid, p_on date) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT s.id FROM retention_schedule s
  WHERE s.tenant_id = app_tenant_id() AND s.data_class = p_class AND s.state = 'approved' AND s.effective_from <= p_on
    AND (s.market_id = p_market OR s.market_id IS NULL)
  ORDER BY s.market_id IS NULL, s.effective_from DESC, s.decided_at DESC, s.id
  LIMIT 1
$$;

-- 3. AC-FIN6-5 (liability = Σ lot remainders): an expiry empties exactly its lot's remainder, and a redemption commits
-- only when its lots cover it (a due lot not yet expired never does: LED expires first).
CREATE OR REPLACE FUNCTION credit_lot_event_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal_entry e
                 WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.entry_id AND e.event_type = 'credit_expired'
                   AND e.origin_type = 'credit_award' AND e.origin_id = NEW.award_id)
     OR NEW.amount_minor <= 0
     OR NEW.amount_minor IS DISTINCT FROM (
          SELECT l.remaining_minor FROM credit_award a
          CROSS JOIN LATERAL credit_lots(a.payee_participant_id, a.credit_type_id, a.market_id) l
          WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.award_id AND l.award_id = a.id) THEN
    RAISE EXCEPTION 'an expiry names its award''s expiry entry and empties the lot''s remainder' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION credit_redemption_posted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal_entry e
                 WHERE e.tenant_id = NEW.tenant_id AND e.idempotency_key = 'credit-redeem:' || NEW.id
                   AND e.origin_type = 'credit_redemption' AND e.origin_id = NEW.id)
     OR (SELECT coalesce(sum(x.credit_minor - x.debit_minor), 0) FROM ledger_account a JOIN posting x ON x.account_id = a.id
         WHERE a.tenant_id = NEW.tenant_id AND a.market_id = NEW.market_id AND a.type = 'credit_liability'
           AND a.payee_participant_id = NEW.participant_id AND a.credit_type_id = NEW.credit_type_id)
        <> (SELECT coalesce(sum(l.remaining_minor), 0) FROM credit_lots(NEW.participant_id, NEW.credit_type_id, NEW.market_id) l) THEN
    RAISE EXCEPTION 'redemption % is posted in its transaction and taken from lots not yet due', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

-- 4. The purged tenant's offboarding records stay as the vendor's record while the tenant's users and exports go: their
-- confirming/closing users and export are checked by tenant_offboarding_guard when written, not kept as keys.
ALTER TABLE tenant_offboarding
  DROP CONSTRAINT tenant_offboarding_tenant_id_confirmed_by_fkey,
  DROP CONSTRAINT tenant_offboarding_tenant_id_export_id_fkey,
  DROP CONSTRAINT tenant_offboarding_closed_by_fkey,
  ADD CONSTRAINT tenant_offboarding_warnings CHECK (acknowledged_warnings <@ ARRAY['credits_outstanding']);

-- 5. Read-only is read by session/key resolution (system realm), the vendor, or the tenant's own transactions.
CREATE OR REPLACE FUNCTION tenant_read_only(p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT coalesce(app_realm() IN ('system', 'vendor') OR (app_realm() = 'tenant' AND app_tenant_id() = p_tenant), false) THEN
    RAISE EXCEPTION 'a tenant''s read-only state is read by itself, the vendor or the system' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN EXISTS (SELECT 1 FROM tenant t WHERE t.id = p_tenant AND t.state = 'archived')
      OR EXISTS (SELECT 1 FROM tenant_offboarding o WHERE o.tenant_id = p_tenant AND o.state = 'confirmed');
END $$;

-- 6. The scheduled full export (0602) skips archived tenants too (PLAN V1-A 1.6).
CREATE OR REPLACE FUNCTION int_due_full_exports() RETURNS TABLE (tenant_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  RETURN QUERY
    SELECT t.id FROM tenant t
    CROSS JOIN LATERAL (SELECT int_full_export_window(setting_in_force(t.id, 'exports.full_schedule'), now()) AS since) w
    WHERE t.state <> 'archived' AND w.since IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM data_export d WHERE d.tenant_id = t.id AND d.trigger = 'schedule' AND d.created_at >= w.since)
    ORDER BY t.id;
END $$;

-- 7. Backstop under concurrency (D-V1A-02): a commit takes the market periods lock (comp/period.ts lockMarketPeriods;
-- re-entrant for the API, which holds it already), so a provisional and a final commit of the market serialise and each
-- check reads the other's outcome; a final run commits only with an offset of every committed advance in its period.
CREATE OR REPLACE FUNCTION run_final_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'committed' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('periods:' || NEW.tenant_id || ':' || c.market_id, 0))
    FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
    WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.period_id;
  END IF;
  IF EXISTS (SELECT 1 FROM run f WHERE f.tenant_id = NEW.tenant_id AND f.period_id = provisional_final_period(NEW.period_id)
               AND f.state = 'committed') THEN
    RAISE EXCEPTION 'the final period of provisional run % is committed', NEW.id USING ERRCODE = 'check_violation',
      DETAIL = 'final_period_committed';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.state = 'committed' AND EXISTS (
       SELECT 1 FROM provisional_periods_of(NEW.period_id) pp
       JOIN result_line l ON l.tenant_id = NEW.tenant_id AND l.run_id = pp.run_id
       WHERE pp.run_state = 'committed'
       GROUP BY pp.run_id, l.payee_position_id, l.rule_key
       HAVING sum(l.amount_minor) <> 0 AND NOT EXISTS (
         SELECT 1 FROM adjustment_origin o
         WHERE o.tenant_id = NEW.tenant_id AND o.run_id = NEW.id AND o.provisional_run_id = pp.run_id
           AND o.payee_position_id = l.payee_position_id AND o.rule_key = l.rule_key)) THEN
    RAISE EXCEPTION 'final run % commits with an offset of every committed advance of its period', NEW.id
      USING ERRCODE = 'check_violation', DETAIL = 'provisional_changed';
  END IF;
  RETURN NEW;
END $$;

-- 8. 0803's guard: an account change records joint holders / authorised signatories for joint and entity accounts and none
-- for individual ones (rows not recorded before stay valid until their type or holders change).
CREATE OR REPLACE FUNCTION participant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  merge_fields constant text[] := ARRAY['status', 'merged_into_id'];
  account_fields constant text[] := ARRAY['account_type', 'account_holders'];
  personal_fields constant text[] := ARRAY['display_name', 'contact', 'identity_doc_id', 'account_holders', 'pseudonymised_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on participant is not allowed';
  END IF;
  IF (OLD.status = 'active' AND NEW.status = 'merged' AND to_jsonb(NEW) - merge_fields = to_jsonb(OLD) - merge_fields)
     OR (OLD.status = 'active' AND OLD.pseudonymised_at IS NULL AND to_jsonb(NEW) - account_fields = to_jsonb(OLD) - account_fields
         AND ((NEW.account_type, NEW.account_holders) IS NOT DISTINCT FROM (OLD.account_type, OLD.account_holders)
              OR (NEW.account_type = 'individual') = (NEW.account_holders IS NULL)))
     OR (acting_as_owner() AND OLD.pseudonymised_at IS NULL
         AND to_jsonb(NEW) - personal_fields = to_jsonb(OLD) - personal_fields
         AND CASE WHEN NEW.pseudonymised_at IS NULL
                  THEN (NEW.identity_doc_id, NEW.account_holders) IS NOT DISTINCT FROM (OLD.identity_doc_id, OLD.account_holders)
                  ELSE num_nulls(NEW.display_name, NEW.contact, NEW.identity_doc_id, NEW.account_holders) = 4 END) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a participant changes only by a merge, once, by its account type and holders, or by its erasure or correction'
    USING ERRCODE = 'check_violation';
END $$;

-- 9. D-V1A-05: subscription and dispute outcomes carry no lines, amounts or volume; a converted order names a rate from its
-- original currency to its (market) currency (D-V1A-04).
ALTER TABLE order_event ADD CONSTRAINT order_event_no_effect CHECK (
  type NOT IN ('renewal_failed', 'subscription_cancelled', 'dispute_lost')
  OR (lines = '[]' AND refund_minor = 0 AND fee_minor = 0 AND volume_effect = '{}'
      AND coalesce(original_refund_minor, 0) = 0 AND coalesce(original_fee_minor, 0) = 0));

CREATE FUNCTION sales_order_fx_rate_pair() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fx_rate f WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.fx_rate_id
                   AND f.base = NEW.original_currency AND f.quote = NEW.currency) THEN
    RAISE EXCEPTION 'a converted order names a rate from its original currency to its currency' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sales_order_fx_rate_pair BEFORE INSERT ON sales_order
  FOR EACH ROW WHEN (NEW.fx_rate_id IS NOT NULL) EXECUTE FUNCTION sales_order_fx_rate_pair();

-- 10. Erasure (0804) keeps the offboarding export pinned (D-V1A-07, C-V1A-12); the subject's data in it goes with the purge.
CREATE OR REPLACE FUNCTION prv_erase_subject(own_tenant uuid, p_subject uuid, p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  blockers jsonb;
  account record;
  exports jsonb;
BEGIN
  PERFORM 1 FROM participant x WHERE x.tenant_id = own_tenant AND x.id = p_subject AND x.pseudonymised_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'erasure needs a subject not yet pseudonymised' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || own_tenant || ':' || m.market_id, 0))
  FROM (SELECT a.market_id FROM ledger_account a WHERE a.tenant_id = own_tenant AND a.payee_participant_id = p_subject
        UNION
        SELECT p.market_id FROM position_ownership o JOIN position p ON p.tenant_id = o.tenant_id AND p.id = o.position_id
        WHERE o.tenant_id = own_tenant AND o.participant_id = p_subject
        ORDER BY 1) m;
  -- TK-B5-18: an adjustment or dispute being opened for the subject holds this lock shared until it commits.
  PERFORM pg_advisory_xact_lock(hashtextextended('erase:' || own_tenant || ':' || p_subject, 0));
  blockers := prv_erasure_blockers(p_subject);
  IF jsonb_array_length(blockers) > 0 THEN
    RAISE EXCEPTION 'erasure deferred' USING ERRCODE = 'PV001', DETAIL = blockers::text;
  END IF;

  UPDATE participant SET display_name = NULL, contact = NULL, identity_doc_id = NULL, account_holders = NULL, pseudonymised_at = now()
  WHERE tenant_id = own_tenant AND id = p_subject;
  FOR account IN
    SELECT u.id, 'portal:' || t.slug || ':' || u.email AS account_key FROM user_account u JOIN tenant t ON t.id = u.tenant_id
    WHERE u.tenant_id = own_tenant AND u.participant_id = p_subject
  LOOP
    DELETE FROM login_attempt WHERE account_key = account.account_key;
    DELETE FROM password_credential WHERE user_id = account.id;
    DELETE FROM mfa_credential WHERE user_id = account.id;
    DELETE FROM portal_sign_in_code WHERE tenant_id = own_tenant AND user_id = account.id;
    UPDATE user_invitation SET revoked_at = now()
    WHERE tenant_id = own_tenant AND user_id = account.id AND used_at IS NULL AND revoked_at IS NULL;
    UPDATE session SET ip = NULL, user_agent = NULL
    WHERE tenant_id = own_tenant AND user_id = account.id AND (ip IS NOT NULL OR user_agent IS NOT NULL);
    UPDATE user_account SET email = 'erased+' || id || '@erased.invalid', idp_subject = 'erased:' || id, display_name = NULL,
                            firebase_subject = NULL, mfa_enrolled = false, state = 'deactivated',
                            locale = NULL
    WHERE id = account.id;
  END LOOP;
  DELETE FROM participant_signal WHERE tenant_id = own_tenant AND participant_id = p_subject;
  UPDATE bank_detail_request SET details_sealed = NULL, contact_email_sealed = NULL, masked = 'erased'
  WHERE tenant_id = own_tenant AND participant_id = p_subject AND masked <> 'erased';
  UPDATE bank_detail_version SET details_sealed = NULL, masked = 'erased'
  WHERE tenant_id = own_tenant AND participant_id = p_subject AND masked <> 'erased';
  UPDATE tax_profile SET tax_id_sealed = NULL, tax_id_masked = NULL
  WHERE tenant_id = own_tenant AND participant_id = p_subject AND tax_id_sealed IS NOT NULL;
  UPDATE notification SET params = params || erased_notice_params(params)
  WHERE tenant_id = own_tenant AND recipient_participant_id = p_subject AND params ->> 'masked' <> 'erased';
  UPDATE notification SET state = 'suppressed'
  WHERE tenant_id = own_tenant AND recipient_participant_id = p_subject AND state = 'queued';
  DELETE FROM privacy_export e USING privacy_request r
  WHERE e.tenant_id = own_tenant AND r.tenant_id = own_tenant AND r.id = e.request_id AND r.subject_participant_id = p_subject;
  UPDATE privacy_request SET corrections_sealed = NULL
  WHERE tenant_id = own_tenant AND subject_participant_id = p_subject AND corrections_sealed IS NOT NULL;
  -- The fulfilled request's own requester details stay until prv.send-outcome has mailed the outcome (D-B5-16).
  UPDATE privacy_request SET requester_sealed = NULL
  WHERE tenant_id = own_tenant AND subject_participant_id = p_subject AND id IS DISTINCT FROM p_request
    AND requester_sealed IS NOT NULL;
  -- D-B6-13: every full export holds the subject's data: completed ones expire, unfinished ones fail (files deleted);
  -- D-V1A-07: except the export pinned by an archived offboarding (kept until the purge).
  WITH changed AS (
    UPDATE data_export SET state = CASE state WHEN 'completed' THEN 'expired' ELSE 'failed' END,
                           error = CASE state WHEN 'completed' THEN NULL ELSE '{"code": "ERASED_DURING_EXPORT"}'::jsonb END,
                           finished_at = coalesce(finished_at, now())
    WHERE tenant_id = own_tenant AND state IN ('queued', 'running', 'completed')
      AND id NOT IN (SELECT o.export_id FROM tenant_offboarding o WHERE o.tenant_id = own_tenant AND o.export_id IS NOT NULL
                       AND o.state NOT IN ('cancelled', 'restored', 'purged'))
    RETURNING id, state)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'state', state) ORDER BY id), '[]') INTO exports FROM changed;
  DELETE FROM data_export_file f USING data_export d
  WHERE f.tenant_id = own_tenant AND d.tenant_id = own_tenant AND d.id = f.export_id AND d.state IN ('failed', 'expired');

  RETURN jsonb_build_object(
    'cleared', jsonb_build_array('participant.display_name', 'participant.contact', 'participant.identity_doc_id',
      'participant.account_holders',
      'user_account.email', 'user_account.idp_subject', 'user_account.display_name', 'user_account.firebase_subject', 'user_account.locale',
      'password_credential', 'mfa_credential', 'portal_sign_in_code', 'user_invitation (open: revoked)', 'login_attempt',
      'session.ip', 'session.user_agent', 'participant_signal', 'bank_detail_request.details_sealed',
      'bank_detail_request.contact_email_sealed', 'bank_detail_version.details_sealed', 'tax_profile.tax_id_sealed',
      'tax_profile.tax_id_masked', 'notification.params.masked', 'notification.params.previous_masked',
      'notification (queued email: suppressed)', 'privacy_export',
      'privacy_request.corrections_sealed', 'privacy_request.requester_sealed (other requests)', 'data_export_file.content'),
    'retained', jsonb_build_array('position', 'relationship', 'result_line', 'qualification_state', 'run_snapshot',
      'journal_entry', 'posting', 'payout_instruction', 'bank_detail fingerprints', 'tax_profile.residency',
      'tax_profile.entity_type', 'notification', 'case_file', 'audit'),
    'exports', exports);
END $$;
