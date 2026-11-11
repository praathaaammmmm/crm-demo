-- 0001_users_hierarchy: every non-Super-Admin user reports directly to the Super Admin (ADR 0005).
-- The trigger overrides any supplied reporting values, so application roles never need grants on those columns.
CREATE FUNCTION "public"."users_set_reports_to"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  super_admin_id uuid;
BEGIN
  IF NEW.is_super_admin THEN
    NEW.reports_to_user_id := NULL;
    NEW.reports_to_is_super_admin := NULL;
    RETURN NEW;
  END IF;

  SELECT u.id INTO super_admin_id FROM public.users AS u WHERE u.is_super_admin;
  IF super_admin_id IS NULL THEN
    RAISE EXCEPTION 'A Super Admin must exist before other users are created'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.reports_to_user_id := super_admin_id;
  NEW.reports_to_is_super_admin := true;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "users_set_reports_to"
BEFORE INSERT ON "public"."users"
FOR EACH ROW EXECUTE FUNCTION "public"."users_set_reports_to"();
