CREATE SCHEMA "practice";
--> statement-breakpoint
CREATE TYPE "interview"."candidacy_source" AS ENUM('recruiter_outreach', 'referral', 'applied', 'inbound');--> statement-breakpoint
CREATE TYPE "interview"."candidacy_status" AS ENUM('exploring', 'applied', 'interviewing', 'offer', 'accepted', 'declined', 'rejected', 'withdrawn', 'on_hold');--> statement-breakpoint
CREATE TYPE "practice"."exercise_difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "practice"."exercise_kind" AS ENUM('algorithm', 'data_structure', 'backend', 'frontend', 'react', 'sql', 'testing', 'other');--> statement-breakpoint
CREATE TYPE "practice"."exercise_source" AS ENUM('original', 'generated', 'user_submitted');--> statement-breakpoint
CREATE TYPE "interview"."interview_format" AS ENUM('video', 'phone', 'onsite');--> statement-breakpoint
CREATE TYPE "interview"."interview_kind" AS ENUM('recruiter_screen', 'hiring_manager', 'technical', 'system_design', 'take_home', 'panel', 'final', 'other');--> statement-breakpoint
CREATE TYPE "interview"."interview_status" AS ENUM('scheduled', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "interview"."participant_role" AS ENUM('candidate', 'interviewer', 'recruiter', 'hiring_manager', 'coordinator', 'observer', 'other');--> statement-breakpoint
CREATE TABLE "interview"."briefing_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"briefing_id" text NOT NULL,
	"candidacy_id" uuid,
	"interview_id" uuid,
	CONSTRAINT "briefing_links_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "briefing_links_briefing_key" UNIQUE("tenant_id","briefing_id"),
	CONSTRAINT "briefing_links_target_check" CHECK ("candidacy_id" IS NOT NULL OR "interview_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "interview"."briefing_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."candidacies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" uuid NOT NULL,
	"candidate_person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "interview"."candidacy_status" DEFAULT 'exploring'::"interview"."candidacy_status" NOT NULL,
	"source" "interview"."candidacy_source",
	"posting_url" text,
	"notes" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "candidacies_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "interview"."candidacies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"notes" text,
	"research" text,
	CONSTRAINT "companies_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "interview"."companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "practice"."exercise_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"language" text NOT NULL,
	"draft_id" text NOT NULL,
	CONSTRAINT "exercise_attempts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "exercise_attempts_draft_key" UNIQUE("tenant_id","user_id","draft_id")
);
--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "practice"."exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"prompt_key" text NOT NULL,
	"kind" "practice"."exercise_kind" NOT NULL,
	"difficulty" "practice"."exercise_difficulty",
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_kind" "practice"."exercise_source" NOT NULL,
	"source_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "practice"."exercises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."interview_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"interview_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "interview"."participant_role" NOT NULL,
	"role_label" text,
	CONSTRAINT "interview_participants_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "interview_participants_unique_key" UNIQUE("interview_id","person_id","role"),
	CONSTRAINT "interview_participants_other_label_check" CHECK ("role" <> 'other' OR "role_label" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "interview"."interview_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"candidacy_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" "interview"."interview_kind" NOT NULL,
	"label" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"duration_minutes" integer,
	"format" "interview"."interview_format",
	"status" "interview"."interview_status" DEFAULT 'scheduled'::"interview"."interview_status" NOT NULL,
	CONSTRAINT "interviews_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "interviews_candidacy_ordinal_key" UNIQUE("candidacy_id","ordinal"),
	CONSTRAINT "interviews_duration_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" BETWEEN 5 AND 480)
);
--> statement-breakpoint
ALTER TABLE "interview"."interviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."member_people" (
	"tenant_id" uuid,
	"user_id" uuid,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_people_pkey" PRIMARY KEY("tenant_id","user_id"),
	CONSTRAINT "member_people_tenant_person_key" UNIQUE("tenant_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "interview"."member_people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"full_name" text NOT NULL,
	"title" text,
	"company_id" uuid,
	"linkedin_url" text,
	"linked_user_id" uuid,
	"notes" text,
	CONSTRAINT "people_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "interview"."people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_tenant_domain_key" ON "interview"."companies" ("tenant_id","domain") WHERE "domain" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_scope_slug_key" ON "practice"."exercises" (coalesce("tenant_id"::text, ''),"slug");--> statement-breakpoint
CREATE INDEX "exercises_tenant_prompt_key_idx" ON "practice"."exercises" ("tenant_id","prompt_key");--> statement-breakpoint
ALTER TABLE "interview"."briefing_links" ADD CONSTRAINT "briefing_links_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."briefing_links" ADD CONSTRAINT "briefing_links_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."briefing_links" ADD CONSTRAINT "briefing_links_candidacy_fkey" FOREIGN KEY ("tenant_id","candidacy_id") REFERENCES "interview"."candidacies"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."briefing_links" ADD CONSTRAINT "briefing_links_interview_fkey" FOREIGN KEY ("tenant_id","interview_id") REFERENCES "interview"."interviews"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."candidacies" ADD CONSTRAINT "candidacies_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."candidacies" ADD CONSTRAINT "candidacies_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."candidacies" ADD CONSTRAINT "candidacies_company_fkey" FOREIGN KEY ("tenant_id","company_id") REFERENCES "interview"."companies"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."candidacies" ADD CONSTRAINT "candidacies_candidate_fkey" FOREIGN KEY ("tenant_id","candidate_person_id") REFERENCES "interview"."people"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."companies" ADD CONSTRAINT "companies_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."companies" ADD CONSTRAINT "companies_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "practice"."exercises"("id");--> statement-breakpoint
ALTER TABLE "practice"."exercises" ADD CONSTRAINT "exercises_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "practice"."exercises" ADD CONSTRAINT "exercises_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."interview_participants" ADD CONSTRAINT "interview_participants_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."interview_participants" ADD CONSTRAINT "interview_participants_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."interview_participants" ADD CONSTRAINT "interview_participants_interview_fkey" FOREIGN KEY ("tenant_id","interview_id") REFERENCES "interview"."interviews"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."interview_participants" ADD CONSTRAINT "interview_participants_person_fkey" FOREIGN KEY ("tenant_id","person_id") REFERENCES "interview"."people"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."interviews" ADD CONSTRAINT "interviews_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."interviews" ADD CONSTRAINT "interviews_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."interviews" ADD CONSTRAINT "interviews_candidacy_fkey" FOREIGN KEY ("tenant_id","candidacy_id") REFERENCES "interview"."candidacies"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."member_people" ADD CONSTRAINT "member_people_membership_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "platform"."tenant_memberships"("tenant_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."member_people" ADD CONSTRAINT "member_people_person_fkey" FOREIGN KEY ("tenant_id","person_id") REFERENCES "interview"."people"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."people" ADD CONSTRAINT "people_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."people" ADD CONSTRAINT "people_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."people" ADD CONSTRAINT "people_linked_user_id_users_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."people" ADD CONSTRAINT "people_company_fkey" FOREIGN KEY ("tenant_id","company_id") REFERENCES "interview"."companies"("tenant_id","id");--> statement-breakpoint
CREATE POLICY "tenant_briefing_links" ON "interview"."briefing_links" AS PERMISSIVE FOR ALL TO public USING ("interview"."briefing_links"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("interview"."briefing_links"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_candidacies" ON "interview"."candidacies" AS PERMISSIVE FOR ALL TO public USING ("interview"."candidacies"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("interview"."candidacies"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_companies" ON "interview"."companies" AS PERMISSIVE FOR ALL TO public USING ("interview"."companies"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("interview"."companies"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_user_exercise_attempts" ON "practice"."exercise_attempts" AS PERMISSIVE FOR ALL TO public USING ("practice"."exercise_attempts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid AND "practice"."exercise_attempts"."user_id" = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK ("practice"."exercise_attempts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid AND "practice"."exercise_attempts"."user_id" = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exercises_read" ON "practice"."exercises" AS PERMISSIVE FOR SELECT TO public USING ("practice"."exercises"."tenant_id" IS NULL OR "practice"."exercises"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exercises_write" ON "practice"."exercises" AS PERMISSIVE FOR ALL TO public USING ("practice"."exercises"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("practice"."exercises"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_interview_participants" ON "interview"."interview_participants" AS PERMISSIVE FOR ALL TO public USING ("interview"."interview_participants"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("interview"."interview_participants"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_interviews" ON "interview"."interviews" AS PERMISSIVE FOR ALL TO public USING ("interview"."interviews"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("interview"."interviews"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_member_people" ON "interview"."member_people" AS PERMISSIVE FOR ALL TO public USING ("interview"."member_people"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("interview"."member_people"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_people" ON "interview"."people" AS PERMISSIVE FOR ALL TO public USING ("interview"."people"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("interview"."people"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);