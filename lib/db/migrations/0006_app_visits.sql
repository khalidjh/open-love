CREATE TABLE IF NOT EXISTS "app_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"visitor_id" text,
	"path" text,
	"referrer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_visits" ADD CONSTRAINT "app_visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_visits_project_idx" ON "app_visits" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_visits_project_created_idx" ON "app_visits" USING btree ("project_id","created_at");
