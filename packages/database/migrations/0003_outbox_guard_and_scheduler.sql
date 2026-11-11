-- 0003_outbox_guard_and_scheduler: outbox status rules and the restricted scheduling function.
-- See docs/architecture/outbox.md.
CREATE FUNCTION "public"."outbox_events_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'outbox_events rows cannot be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'outbox_events: id, event_type, payload, dedupe_key, max_attempts and created_at cannot change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status IN ('done', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'outbox event % is final (%)', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status = 'processing')
    OR (OLD.status = 'processing' AND NEW.status IN ('done', 'cancelled', 'failed', 'pending', 'processing'))
  ) THEN
    RAISE EXCEPTION 'invalid outbox status change: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- A processing event can only be reclaimed after its lock has expired.
  IF OLD.status = 'processing' AND NEW.status = 'processing' AND OLD.locked_until >= now() THEN
    RAISE EXCEPTION 'outbox event % is still locked until %', OLD.id, OLD.locked_until
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'outbox_events.attempts cannot decrease'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "outbox_events_guard_row"
BEFORE UPDATE OR DELETE ON "public"."outbox_events"
FOR EACH ROW EXECUTE FUNCTION "public"."outbox_events_guard"();
--> statement-breakpoint
CREATE TRIGGER "outbox_events_guard_truncate"
BEFORE TRUNCATE ON "public"."outbox_events"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."outbox_events_guard"();
--> statement-breakpoint
-- The only way crm_worker can add outbox rows. Fixed allowlist; the caller supplies no payload.
CREATE FUNCTION "public"."outbox_schedule_system_event"(p_event_type text, p_slot timestamptz) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  slot_interval interval;
BEGIN
  slot_interval := CASE p_event_type
    WHEN 'identity.session_expiry_sweep' THEN interval '5 minutes'
    WHEN 'system.health_check' THEN interval '5 minutes'
  END;

  IF slot_interval IS NULL THEN
    RAISE EXCEPTION 'event type % cannot be scheduled', p_event_type
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_slot IS NULL
     OR date_bin(slot_interval, p_slot, timestamptz '2000-01-01 00:00:00+00') <> p_slot THEN
    RAISE EXCEPTION 'slot % is not aligned to %', p_slot, slot_interval
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_slot < now() - slot_interval OR p_slot > now() + slot_interval THEN
    RAISE EXCEPTION 'slot % is more than % from now', p_slot, slot_interval
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.outbox_events (event_type, payload, dedupe_key, available_at)
  VALUES (
    p_event_type,
    '{}'::jsonb,
    p_event_type || ':' || to_char(p_slot AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    p_slot
  )
  ON CONFLICT DO NOTHING;
END;
$$;
--> statement-breakpoint
-- PostgreSQL requires the new owner of a function to hold CREATE on its schema.
-- The grant exists only inside this migration's transaction and is revoked two statements later.
GRANT CREATE ON SCHEMA "public" TO crm_outbox_owner;
--> statement-breakpoint
ALTER FUNCTION "public"."outbox_schedule_system_event"(text, timestamptz) OWNER TO crm_outbox_owner;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "public" FROM crm_outbox_owner;
