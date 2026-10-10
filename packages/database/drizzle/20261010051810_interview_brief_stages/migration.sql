CREATE TABLE "interview"."employer_said_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"candidacy_id" uuid NOT NULL,
	"said" text NOT NULL,
	"said_by" text,
	"channel" text,
	"said_on" date,
	"content_sha256" text NOT NULL,
	CONSTRAINT "employer_said_entries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "employer_said_entries_channel_check" CHECK ("channel" IS NULL OR "channel" IN ('email', 'call', 'message', 'other'))
);
--> statement-breakpoint
ALTER TABLE "interview"."employer_said_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."interview_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"interview_id" uuid NOT NULL,
	"title" text NOT NULL,
	"origin" text NOT NULL,
	"origin_name" text,
	"capture_policy" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"content" text NOT NULL,
	"content_sha256" text NOT NULL,
	"chars" integer NOT NULL,
	"turns" integer NOT NULL,
	CONSTRAINT "interview_transcripts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "interview_transcripts_stage_content_key" UNIQUE("tenant_id","interview_id","content_sha256"),
	CONSTRAINT "interview_transcripts_origin_check" CHECK ("origin" IN ('recorded', 'uploaded', 'pasted')),
	CONSTRAINT "interview_transcripts_policy_check" CHECK ("capture_policy" IN ('device-only', 'permitted-remote'))
);
--> statement-breakpoint
ALTER TABLE "interview"."interview_transcripts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."research_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"candidacy_id" uuid,
	"title" text NOT NULL,
	"origin" text NOT NULL,
	"origin_ref" text,
	"content" text NOT NULL,
	"content_sha256" text NOT NULL,
	"chars" integer NOT NULL,
	CONSTRAINT "research_documents_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "research_documents_origin_check" CHECK ("origin" IN ('url', 'file', 'pasted'))
);
--> statement-breakpoint
ALTER TABLE "interview"."research_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview"."interviews" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "interview"."interviews" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "interview"."interviews" ADD COLUMN "next_steps" text;--> statement-breakpoint
CREATE INDEX "employer_said_entries_candidacy_idx" ON "interview"."employer_said_entries" ("tenant_id","candidacy_id");--> statement-breakpoint
CREATE INDEX "interview_transcripts_interview_idx" ON "interview"."interview_transcripts" ("tenant_id","interview_id");--> statement-breakpoint
CREATE INDEX "research_documents_company_idx" ON "interview"."research_documents" ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "research_documents_candidacy_idx" ON "interview"."research_documents" ("tenant_id","candidacy_id");--> statement-breakpoint
ALTER TABLE "interview"."employer_said_entries" ADD CONSTRAINT "employer_said_entries_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."employer_said_entries" ADD CONSTRAINT "employer_said_entries_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."employer_said_entries" ADD CONSTRAINT "employer_said_entries_owner_user_id_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."employer_said_entries" ADD CONSTRAINT "employer_said_entries_candidacy_fkey" FOREIGN KEY ("tenant_id","candidacy_id") REFERENCES "interview"."candidacies"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."interview_transcripts" ADD CONSTRAINT "interview_transcripts_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."interview_transcripts" ADD CONSTRAINT "interview_transcripts_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."interview_transcripts" ADD CONSTRAINT "interview_transcripts_owner_user_id_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."interview_transcripts" ADD CONSTRAINT "interview_transcripts_interview_fkey" FOREIGN KEY ("tenant_id","interview_id") REFERENCES "interview"."interviews"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."research_documents" ADD CONSTRAINT "research_documents_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."research_documents" ADD CONSTRAINT "research_documents_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."research_documents" ADD CONSTRAINT "research_documents_owner_user_id_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."research_documents" ADD CONSTRAINT "research_documents_company_fkey" FOREIGN KEY ("tenant_id","company_id") REFERENCES "interview"."companies"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."research_documents" ADD CONSTRAINT "research_documents_candidacy_fkey" FOREIGN KEY ("tenant_id","candidacy_id") REFERENCES "interview"."candidacies"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "tenant_user_employer_said_entries" ON "interview"."employer_said_entries" AS PERMISSIVE FOR ALL TO public USING ("interview"."employer_said_entries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."employer_said_entries"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK ("interview"."employer_said_entries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."employer_said_entries"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_user_interview_transcripts" ON "interview"."interview_transcripts" AS PERMISSIVE FOR ALL TO public USING ("interview"."interview_transcripts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."interview_transcripts"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK ("interview"."interview_transcripts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."interview_transcripts"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_user_research_documents" ON "interview"."research_documents" AS PERMISSIVE FOR ALL TO public USING ("interview"."research_documents"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."research_documents"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK ("interview"."research_documents"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."research_documents"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
-- The application role owns these tables; FORCE binds it to the owner-scoped
-- policies too (ADR-0005), so a member reads only their own transcripts,
-- employer-said entries and research documents.
ALTER TABLE "interview"."interview_transcripts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview"."employer_said_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview"."research_documents" FORCE ROW LEVEL SECURITY;
