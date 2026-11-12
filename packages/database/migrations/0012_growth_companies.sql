-- 0012_growth_companies: Growth companies and contacts (Phase 4A.1), the active-CGO owner guard and the
-- archive guards. Runs as crm_migrator. Must stay consistent with packages/database/src/schema/growth.ts.
CREATE TABLE "growth_companies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"industry" text,
	"notes" text,
	"owner_id" uuid NOT NULL,
	"owner_is_super_admin" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "growth_companies_owner_not_super_admin" CHECK (owner_is_super_admin = false),
	CONSTRAINT "growth_companies_name_normalized" CHECK (name = regexp_replace(btrim(name), '\s+', ' ', 'g') AND char_length(name) BETWEEN 1 AND 200),
	CONSTRAINT "growth_companies_industry" CHECK (industry IS NULL OR (industry = btrim(industry) AND char_length(industry) BETWEEN 1 AND 100)),
	CONSTRAINT "growth_companies_notes" CHECK (notes IS NULL OR (notes = btrim(notes) AND char_length(notes) BETWEEN 1 AND 5000)),
	CONSTRAINT "growth_companies_website_https" CHECK (website_url IS NULL OR (website_url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(website_url) <= 2000))
);
--> statement-breakpoint
-- The CEO/CTO can never own Growth records; MATCH FULL forbids a partly-null owner.
ALTER TABLE "growth_companies" ADD CONSTRAINT "growth_companies_owner_fk" FOREIGN KEY ("owner_id","owner_is_super_admin") REFERENCES "public"."users"("id","is_super_admin") MATCH FULL ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_companies" ADD CONSTRAINT "growth_companies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Names are stored normalised, so case and spacing cannot create duplicates among active companies.
CREATE UNIQUE INDEX "growth_companies_name_unique" ON "growth_companies" USING btree (lower("name")) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE INDEX "growth_companies_owner_idx" ON "growth_companies" USING btree ("owner_id");
--> statement-breakpoint
CREATE TABLE "growth_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"role_title" text,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"website_url" text,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_is_super_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "growth_contacts_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "growth_contacts_owner_not_super_admin" CHECK (owner_is_super_admin = false),
	CONSTRAINT "growth_contacts_name_normalized" CHECK (full_name = regexp_replace(btrim(full_name), '\s+', ' ', 'g') AND char_length(full_name) BETWEEN 1 AND 200),
	CONSTRAINT "growth_contacts_role_title" CHECK (role_title IS NULL OR (role_title = btrim(role_title) AND char_length(role_title) BETWEEN 1 AND 100)),
	CONSTRAINT "growth_contacts_email" CHECK (email IS NULL OR (email = lower(btrim(email)) AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' AND char_length(email) <= 254)),
	CONSTRAINT "growth_contacts_phone" CHECK (phone IS NULL OR (phone = btrim(phone) AND phone ~ '^[0-9+()\- ]{5,32}$')),
	CONSTRAINT "growth_contacts_linkedin" CHECK (linkedin_url IS NULL OR (linkedin_url ~ '^https://([a-z]+\.)?linkedin\.com/' AND char_length(linkedin_url) <= 2000)),
	CONSTRAINT "growth_contacts_website_https" CHECK (website_url IS NULL OR (website_url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(website_url) <= 2000)),
	CONSTRAINT "growth_contacts_has_method" CHECK (num_nonnulls(email, phone, linkedin_url, website_url) >= 1)
);
--> statement-breakpoint
ALTER TABLE "growth_contacts" ADD CONSTRAINT "growth_contacts_company_id_growth_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."growth_companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_contacts" ADD CONSTRAINT "growth_contacts_owner_fk" FOREIGN KEY ("owner_id","owner_is_super_admin") REFERENCES "public"."users"("id","is_super_admin") MATCH FULL ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "growth_contacts_company_email_unique" ON "growth_contacts" USING btree ("company_id", lower("email")) WHERE archived_at IS NULL AND email IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "growth_contacts_company_idx" ON "growth_contacts" USING btree ("company_id");
--> statement-breakpoint
-- An owner can be assigned only while they are an active CGO. Updates that keep the owner are not checked,
-- so a later role change or deactivation never blocks existing records (they are flagged instead).
CREATE FUNCTION "public"."growth_owner_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = NEW.owner_id AND u.status = 'active' AND u.role = 'cgo'
  ) THEN
    RAISE EXCEPTION 'growth records can only be assigned to an active CGO'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_companies_owner_guard_row"
BEFORE INSERT OR UPDATE OF "owner_id" ON "public"."growth_companies"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_owner_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_contacts_owner_guard_row"
BEFORE INSERT OR UPDATE OF "owner_id" ON "public"."growth_contacts"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_owner_guard"();
--> statement-breakpoint
-- An archived company is read-only: no update of any kind, including un-archiving.
CREATE FUNCTION "public"."growth_companies_archived_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'an archived company is read-only'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_companies_archived_guard_row"
BEFORE UPDATE ON "public"."growth_companies"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_companies_archived_guard"();
--> statement-breakpoint
-- Contacts cannot be added to, or changed under, an archived company, and archived contacts are read-only.
-- FOR SHARE on the parent serialises with a concurrent company archive.
CREATE FUNCTION "public"."growth_contacts_parent_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  parent_archived timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'an archived contact is read-only'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT c.archived_at INTO parent_archived FROM public.growth_companies c WHERE c.id = NEW.company_id FOR SHARE;
  IF parent_archived IS NOT NULL THEN
    RAISE EXCEPTION 'contacts of an archived company are read-only'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_contacts_parent_guard_row"
BEFORE INSERT OR UPDATE ON "public"."growth_contacts"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_contacts_parent_guard"();
