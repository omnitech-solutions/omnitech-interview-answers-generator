CREATE TABLE "interview"."document_generation_requests" (
	"tenant_id" uuid,
	"owner_user_id" uuid,
	"retry_key" text,
	"binding_hash" text NOT NULL,
	"source_digest" text NOT NULL,
	"document_id" uuid,
	"revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_generation_requests_pkey" PRIMARY KEY("tenant_id","owner_user_id","retry_key"),
	CONSTRAINT "document_generation_requests_result_pair" CHECK (("document_id" IS NULL) = ("revision" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "interview"."document_generation_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview"."document_generation_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview"."document_generation_requests" ADD CONSTRAINT "document_generation_requests_revision_fkey" FOREIGN KEY ("tenant_id","owner_user_id","document_id","revision") REFERENCES "interview"."document_revisions"("tenant_id","owner_user_id","document_id","revision");--> statement-breakpoint
CREATE POLICY "document_generation_requests_private_scope" ON "interview"."document_generation_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);
