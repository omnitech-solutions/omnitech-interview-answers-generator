CREATE TABLE "interview"."document_generation_batches" (
	"tenant_id" uuid,
	"owner_user_id" uuid,
	"retry_key" text,
	"batch_id" text,
	"fields_hash" text NOT NULL,
	"values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_generation_batches_pkey" PRIMARY KEY("tenant_id","owner_user_id","retry_key","batch_id")
);
--> statement-breakpoint
ALTER TABLE "interview"."document_generation_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview"."document_generation_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview"."document_generation_batches" ADD CONSTRAINT "document_generation_batches_request_fkey" FOREIGN KEY ("tenant_id","owner_user_id","retry_key") REFERENCES "interview"."document_generation_requests"("tenant_id","owner_user_id","retry_key");--> statement-breakpoint
CREATE POLICY "document_generation_batches_private_scope" ON "interview"."document_generation_batches" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);
