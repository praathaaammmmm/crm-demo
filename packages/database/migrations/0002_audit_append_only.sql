-- 0002_audit_append_only: audit events can never be changed or removed, by any role including the owner.
CREATE FUNCTION "public"."audit_events_reject_change"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_update_delete"
BEFORE UPDATE OR DELETE ON "public"."audit_events"
FOR EACH ROW EXECUTE FUNCTION "public"."audit_events_reject_change"();
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_truncate"
BEFORE TRUNCATE ON "public"."audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."audit_events_reject_change"();
