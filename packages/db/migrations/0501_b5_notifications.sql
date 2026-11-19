-- B5 notifications (PLAN B5 sections 1.2 and 1.5; D-B5-14, D-B5-24): one row per channel, written only by the notify_*
-- functions inside the business transaction that causes them (the row is its own outbox); email preferences per topic.

-- An instant as the API serialises every other instant inside jsonb: UTC, milliseconds, Z (BUG-104).
CREATE FUNCTION json_instant(p timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- The template map (D-B5-14): every template's topic and whether its email can be switched off.
CREATE FUNCTION notification_template(p_template text, OUT topic text, OUT mandatory boolean)
LANGUAGE sql IMMUTABLE AS $$
  SELECT t.topic, t.mandatory FROM (VALUES
    ('statement.ready', 'statement', false), ('payout.sent', 'payout', false), ('payout.held', 'payout', false),
    ('payout.returned', 'payout', false), ('bank_detail.changed', 'security', true),
    ('tax_profile.changed', 'security', true), ('dispute.updated', 'dispute', false),
    ('privacy_request.updated', 'privacy', true), ('plan.change_scheduled', 'plan_change', true)
  ) AS t (template, topic, mandatory)
  WHERE t.template = p_template
$$;

-- 1. notification: params carry ids, decimal strings, instants, currency and masked values only. Security notices are
-- evidence: no DELETE; only delivery fields of a queued email row and read_at of an in-app row change.
CREATE TABLE notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  recipient_participant_id uuid NOT NULL,
  template text NOT NULL,
  topic text NOT NULL CHECK (topic IN ('statement', 'payout', 'dispute', 'security', 'privacy', 'plan_change')),
  params jsonb NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  locale text NOT NULL DEFAULT 'en' CHECK (locale = 'en'),
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'messaging', 'in_app')),
  mandatory boolean NOT NULL,
  state text NOT NULL CHECK (state IN ('delivered', 'queued', 'sent', 'failed', 'suppressed', 'undeliverable')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_template_known
    CHECK (coalesce((notification_template(template)).topic = topic
                    AND (notification_template(template)).mandatory = mandatory, false)),
  CONSTRAINT notification_in_app_delivered CHECK (channel <> 'in_app' OR state = 'delivered'),
  CONSTRAINT notification_read_in_app CHECK (read_at IS NULL OR channel = 'in_app'),
  FOREIGN KEY (tenant_id, recipient_participant_id) REFERENCES participant (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX notification_recipient_idx ON notification (tenant_id, recipient_participant_id, created_at DESC);
CREATE INDEX notification_due_idx ON notification (state, next_attempt_at) WHERE state = 'queued';

CREATE FUNCTION notification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  delivery_fields constant text[] := ARRAY['state', 'attempts', 'next_attempt_at', 'last_error', 'sent_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on notification is not allowed (notices are evidence)';
  END IF;
  IF to_jsonb(NEW) - delivery_fields - 'read_at' IS DISTINCT FROM to_jsonb(OLD) - delivery_fields - 'read_at'
     OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
     OR ((to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at')
         AND (OLD.state <> 'queued' OR NEW.state = 'delivered')) THEN
    RAISE EXCEPTION 'a notification is delivered once from queued (retried while queued) and read once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_delivered_once BEFORE UPDATE OR DELETE ON notification
  FOR EACH ROW EXECUTE FUNCTION notification_guard();

-- 2. notification_preference: email on or off for the topics a participant may switch off; an absent row is on.
CREATE TABLE notification_preference (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  participant_id uuid NOT NULL,
  topic text NOT NULL CHECK (topic IN ('statement', 'payout', 'dispute')),
  email boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL DEFAULT app_user_id(),
  PRIMARY KEY (tenant_id, participant_id, topic),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES participant (tenant_id, id),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id)
);
CREATE TRIGGER notification_preference_updated_by_actor BEFORE INSERT OR UPDATE ON notification_preference
  FOR EACH ROW WHEN (current_user = 'nmp_app') EXECUTE FUNCTION actor_is_acting_user('updated_by');

SELECT apply_tenant_rls(t) FROM unnest(ARRAY['notification', 'notification_preference']::regclass[]) AS t;
CREATE POLICY portal_self ON notification AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR recipient_participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR recipient_participant_id = app_participant_id());
CREATE POLICY portal_self ON notification_preference AS RESTRICTIVE
  USING (app_participant_id() IS NULL OR participant_id = app_participant_id())
  WITH CHECK (app_participant_id() IS NULL OR participant_id = app_participant_id());

GRANT SELECT, INSERT ON notification, notification_preference TO nmp_app;
GRANT UPDATE (state, attempts, next_attempt_at, last_error, sent_at, read_at) ON notification TO nmp_app;
GRANT UPDATE (email, updated_at, updated_by) ON notification_preference TO nmp_app;

-- 3. Writers (INVOKER: the business transaction's RLS applies). No rows for a pseudonymised participant; the in-app row
-- is the inbox (delivered at once); an email row is queued when the participant has a contact email and the topic is
-- mandatory or not switched off. Returns the in-app row id.
CREATE FUNCTION notify_participant(p_participant uuid, p_template text, p_params jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  kind record;
  recipient record;
  in_app uuid;
BEGIN
  SELECT * INTO kind FROM notification_template(p_template);
  IF kind.topic IS NULL THEN
    RAISE EXCEPTION 'unknown notification template %', p_template USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.tenant_id, x.contact ->> 'email' AS email, x.pseudonymised_at INTO recipient FROM participant x WHERE x.id = p_participant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a notification goes to a participant of the tenant' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF recipient.pseudonymised_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO notification (tenant_id, recipient_participant_id, template, topic, params, channel, mandatory, state, sent_at)
  VALUES (recipient.tenant_id, p_participant, p_template, kind.topic, p_params, 'in_app', kind.mandatory, 'delivered', now())
  RETURNING id INTO in_app;
  IF recipient.email IS NOT NULL AND (kind.mandatory OR NOT EXISTS (
       SELECT 1 FROM notification_preference n
       WHERE n.participant_id = p_participant AND n.topic = kind.topic AND NOT n.email)) THEN
    INSERT INTO notification (tenant_id, recipient_participant_id, template, topic, params, channel, mandatory, state,
                              next_attempt_at)
    VALUES (recipient.tenant_id, p_participant, p_template, kind.topic, p_params, 'email', kind.mandatory, 'queued', now());
  END IF;
  RETURN in_app;
END $$;

-- statement.ready per settled payee of a committed run; returns the participants notified.
CREATE FUNCTION notify_run_statements(p_run uuid) RETURNS int
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  payee record;
  notified int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM run r WHERE r.id = p_run AND r.state = 'committed') THEN
    RAISE EXCEPTION 'statements are announced for a committed run' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR payee IN
    SELECT s.payee_participant_id AS participant_id,
           jsonb_build_object('run_id', r.id, 'period_id', p.id, 'starts_at', json_instant(p.starts_at),
                              'ends_at', json_instant(p.ends_at), 'net_minor', s.net_payable_minor::text,
                              'currency', m.currency, 'minor_unit', m.minor_unit) AS params
    FROM run r
    JOIN period p ON p.tenant_id = r.tenant_id AND p.id = r.period_id
    JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
    JOIN market m ON m.tenant_id = c.tenant_id AND m.id = c.market_id
    JOIN run_settlement s ON s.tenant_id = r.tenant_id AND s.run_id = r.id
    WHERE r.id = p_run
    ORDER BY s.payee_participant_id
  LOOP
    IF notify_participant(payee.participant_id, 'statement.ready', payee.params) IS NOT NULL THEN
      notified := notified + 1;
    END IF;
  END LOOP;
  RETURN notified;
END $$;

-- D-B5-24, called in the batch approval transaction after its instructions are written: payout.sent per first
-- instruction, payout.held per excluded payee with a hold-kind reason. Reasons are codes only (never a hold's text,
-- placed_by or placed_at). Returns the participants notified.
CREATE FUNCTION notify_batch(p_batch uuid) RETURNS int
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  batch record;
  payee record;
  notified int := 0;
BEGIN
  SELECT b.id, b.market_id, b.state, b.exclusions, m.currency, m.minor_unit INTO batch
  FROM payout_batch b JOIN market m ON m.tenant_id = b.tenant_id AND m.id = b.market_id WHERE b.id = p_batch;
  IF NOT FOUND OR batch.state NOT IN ('approved', 'instructing') THEN
    RAISE EXCEPTION 'payout notices are written for an approved batch' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR payee IN
    SELECT i.payee_participant_id AS participant_id,
           jsonb_build_object('batch_id', batch.id, 'instruction_id', i.id, 'amount_minor', i.amount_minor::text,
                              'currency', batch.currency, 'minor_unit', batch.minor_unit, 'masked', v.masked) AS params
    FROM payout_instruction i
    JOIN bank_detail_version v ON v.tenant_id = i.tenant_id AND v.id = i.bank_detail_version_id
    WHERE i.batch_id = p_batch AND i.retry_of IS NULL
    ORDER BY i.payee_participant_id
  LOOP
    IF notify_participant(payee.participant_id, 'payout.sent', payee.params) IS NOT NULL THEN
      notified := notified + 1;
    END IF;
  END LOOP;
  FOR payee IN
    SELECT h.participant_id,
           jsonb_strip_nulls(jsonb_build_object(
             'batch_id', batch.id, 'amount_minor', led_balance(batch.market_id, h.participant_id, 'payee_payable')::text,
             'currency', batch.currency, 'minor_unit', batch.minor_unit, 'reasons', h.reasons,
             'until', jsonb_path_query_first(h.reasons, '$[*] ? (@.reason == "bank_detail_cooling_off").until'))) AS params
    FROM (
      SELECT (e ->> 'participant_id')::uuid AS participant_id,
             jsonb_agg(jsonb_strip_nulls(jsonb_build_object('reason', r ->> 'reason', 'until', r -> 'detail' -> 'until',
                                                            'case_id', r -> 'detail' -> 'case_id')) ORDER BY x.n) AS reasons
      FROM jsonb_array_elements(batch.exclusions) e
      CROSS JOIN LATERAL jsonb_array_elements(e -> 'reasons') WITH ORDINALITY AS x (r, n)
      WHERE r ->> 'reason' IN ('bank_detail_cooling_off', 'hold', 'no_bank_details', 'tax_profile_missing',
                               'returned_payment_open')
      GROUP BY 1
    ) h
    ORDER BY h.participant_id
  LOOP
    IF notify_participant(payee.participant_id, 'payout.held', payee.params) IS NOT NULL THEN
      notified := notified + 1;
    END IF;
  END LOOP;
  RETURN notified;
END $$;

-- plan.change_scheduled, called in the schedule transaction: every participant owning a non-terminated position in a
-- market of the plan, once, with the time zone of its own market. Returns the participants notified.
CREATE FUNCTION notify_plan_change(p_plan_version uuid) RETURNS int
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  owner record;
  notified int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plan_version v WHERE v.id = p_plan_version AND v.state = 'scheduled') THEN
    RAISE EXCEPTION 'a plan change is announced for a scheduled version' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR owner IN
    SELECT x.id AS participant_id,
           jsonb_build_object('plan_id', v.plan_id, 'plan_version_id', v.id, 'version', v.version,
                              'effective_from', json_instant(v.effective_from), 'time_zone', m.time_zone) AS params
    FROM plan_version v
    JOIN participant x ON EXISTS (
      SELECT 1 FROM plan_market pm
      JOIN position p ON p.tenant_id = pm.tenant_id AND p.market_id = pm.market_id AND p.status <> 'terminated'
      JOIN position_ownership o ON o.tenant_id = p.tenant_id AND o.position_id = p.id AND o.valid_from <= now()
        AND (o.valid_to IS NULL OR o.valid_to > now())
      WHERE pm.tenant_id = v.tenant_id AND pm.plan_id = v.plan_id AND o.participant_id = x.id)
    JOIN market m ON m.tenant_id = x.tenant_id AND m.id = x.market_id
    WHERE v.id = p_plan_version
    ORDER BY x.id
  LOOP
    IF notify_participant(owner.participant_id, 'plan.change_scheduled', owner.params) IS NOT NULL THEN
      notified := notified + 1;
    END IF;
  END LOOP;
  RETURN notified;
END $$;

-- System realm only: the queued email rows due now, oldest first, for dist.notifications.deliver.
CREATE FUNCTION dist_due_notifications(p_limit int) RETURNS TABLE (tenant_id uuid, notification_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM require_system_realm();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT n.tenant_id, n.id FROM notification n
    WHERE n.state = 'queued' AND n.channel = 'email' AND n.next_attempt_at <= now()
    ORDER BY n.next_attempt_at, n.id
    LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION dist_due_notifications(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dist_due_notifications(int) TO nmp_app;
