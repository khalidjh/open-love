CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text,
	"files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_url" text,
	"model" text,
	"sandbox_id" text,
	"sandbox_provider" text,
	"netlify_site_id" text,
	"deploy_url" text,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text DEFAULT 'supabase' NOT NULL,
	"external_ref" text,
	"encrypted_credentials" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_databases" ADD CONSTRAINT "tenant_databases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_project_idx" ON "messages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "org_members_org_idx" ON "org_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_versions_project_idx" ON "project_versions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tenant_databases_project_idx" ON "tenant_databases" USING btree ("project_id");