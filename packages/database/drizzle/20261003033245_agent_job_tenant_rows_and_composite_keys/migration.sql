ALTER TABLE "ai"."agent_artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai"."agent_job_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."tenant_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The app role owns agent_jobs and presentation.documents, and their forced
-- row-level security hides every row from a statement that names no tenant:
-- the backfills below would match nothing, and the new composite foreign keys
-- could not see the rows they reference. The force is lifted for this
-- migration and restored on both tables as its last statements, inside the
-- migration's one transaction.
ALTER TABLE "ai"."agent_jobs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "presentation"."documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Existing agent artifacts take their job's tenant before the column is required.
ALTER TABLE "ai"."agent_artifacts" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "ai"."agent_artifacts" child SET "tenant_id" = job."tenant_id" FROM "ai"."agent_jobs" job WHERE job."id" = child."job_id";--> statement-breakpoint
ALTER TABLE "ai"."agent_artifacts" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
-- Existing agent job events take their job's tenant before the column is required.
ALTER TABLE "ai"."agent_job_events" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "ai"."agent_job_events" child SET "tenant_id" = job."tenant_id" FROM "ai"."agent_jobs" job WHERE job."id" = child."job_id";--> statement-breakpoint
ALTER TABLE "ai"."agent_job_events" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai"."agent_jobs" ADD CONSTRAINT "agent_jobs_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "presentation"."documents" ADD CONSTRAINT "documents_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE INDEX "agent_artifacts_job_id_idx" ON "ai"."agent_artifacts" ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "agent_job_events_job_id_idx" ON "ai"."agent_job_events" ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "agent_conversations_document_id_idx" ON "presentation"."agent_conversations" ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "document_favorites_document_id_idx" ON "presentation"."document_favorites" ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "exports_document_id_idx" ON "presentation"."exports" ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "generation_sessions_document_id_idx" ON "presentation"."generation_sessions" ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "presentations_document_id_idx" ON "presentation"."presentations" ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "recordings_document_id_idx" ON "presentation"."recordings" ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "shares_document_id_idx" ON "presentation"."shares" ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "slides_document_id_idx" ON "presentation"."slides" ("tenant_id","document_id");--> statement-breakpoint
ALTER TABLE "ai"."agent_artifacts" DROP CONSTRAINT "agent_artifacts_job_id_fkey", ADD CONSTRAINT "agent_artifacts_job_id_fkey" FOREIGN KEY ("tenant_id","job_id") REFERENCES "ai"."agent_jobs"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."agent_job_events" DROP CONSTRAINT "agent_job_events_job_id_fkey", ADD CONSTRAINT "agent_job_events_job_id_fkey" FOREIGN KEY ("tenant_id","job_id") REFERENCES "ai"."agent_jobs"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."agent_conversations" DROP CONSTRAINT "agent_conversations_document_id_fkey", ADD CONSTRAINT "agent_conversations_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "presentation"."documents"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."document_favorites" DROP CONSTRAINT "document_favorites_document_id_fkey", ADD CONSTRAINT "document_favorites_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "presentation"."documents"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."exports" DROP CONSTRAINT "exports_document_id_fkey", ADD CONSTRAINT "exports_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "presentation"."documents"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."generation_sessions" DROP CONSTRAINT "generation_sessions_document_id_fkey", ADD CONSTRAINT "generation_sessions_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "presentation"."documents"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."presentations" DROP CONSTRAINT "presentations_document_id_fkey", ADD CONSTRAINT "presentations_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "presentation"."documents"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."recordings" DROP CONSTRAINT "recordings_document_id_fkey", ADD CONSTRAINT "recordings_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "presentation"."documents"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."shares" DROP CONSTRAINT "shares_document_id_fkey", ADD CONSTRAINT "shares_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "presentation"."documents"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."slides" DROP CONSTRAINT "slides_document_id_fkey", ADD CONSTRAINT "slides_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "presentation"."documents"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "ai"."agent_artifacts" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "ai"."agent_job_events" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "agent_worker_append" ON "ai"."agent_job_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((current_setting('app.agent_worker'::text, true) = 'on'::text));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "platform"."tenant_memberships" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
ALTER TABLE "ai"."agent_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "presentation"."documents" FORCE ROW LEVEL SECURITY;
