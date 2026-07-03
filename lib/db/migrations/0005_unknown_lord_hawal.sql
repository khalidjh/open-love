CREATE TABLE "tenant_ai" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text DEFAULT 'etlaq-gateway' NOT NULL,
	"model" text,
	"token_hash" text,
	"encrypted_credentials" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_ai" ADD CONSTRAINT "tenant_ai_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_ai_project_idx" ON "tenant_ai" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tenant_ai_token_hash_idx" ON "tenant_ai" USING btree ("token_hash");