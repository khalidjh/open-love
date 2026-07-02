CREATE TABLE "tenant_auth" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text DEFAULT 'zitadel' NOT NULL,
	"org_id" text,
	"client_id" text,
	"issuer" text,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb,
	"encrypted_credentials" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_auth" ADD CONSTRAINT "tenant_auth_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_auth_project_idx" ON "tenant_auth" USING btree ("project_id");