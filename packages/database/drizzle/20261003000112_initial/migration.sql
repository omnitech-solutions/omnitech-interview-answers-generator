CREATE SCHEMA "ai";
--> statement-breakpoint
CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE SCHEMA "presentation";
--> statement-breakpoint
CREATE SCHEMA "interview";
--> statement-breakpoint
CREATE SCHEMA "practice";
--> statement-breakpoint
CREATE TYPE "platform"."tenant_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "platform"."theme_preference" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "interview"."candidacy_source" AS ENUM('recruiter_outreach', 'referral', 'applied', 'inbound');--> statement-breakpoint
CREATE TYPE "interview"."candidacy_status" AS ENUM('exploring', 'applied', 'interviewing', 'offer', 'accepted', 'declined', 'rejected', 'withdrawn', 'on_hold');--> statement-breakpoint
CREATE TYPE "practice"."exercise_difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "practice"."exercise_kind" AS ENUM('algorithm', 'data_structure', 'backend', 'frontend', 'react', 'sql', 'testing', 'other');--> statement-breakpoint
CREATE TYPE "practice"."exercise_source" AS ENUM('original', 'generated', 'user_submitted');--> statement-breakpoint
CREATE TYPE "interview"."interview_format" AS ENUM('video', 'phone', 'onsite');--> statement-breakpoint
CREATE TYPE "interview"."interview_kind" AS ENUM('recruiter_screen', 'hiring_manager', 'technical', 'system_design', 'take_home', 'panel', 'final', 'other');--> statement-breakpoint
CREATE TYPE "interview"."interview_status" AS ENUM('scheduled', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "interview"."participant_role" AS ENUM('candidate', 'interviewer', 'recruiter', 'hiring_manager', 'coordinator', 'observer', 'other');--> statement-breakpoint
CREATE TABLE "ai"."agent_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"job_id" uuid NOT NULL,
	"artifact_reference" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."agent_job_events" (
	"job_id" uuid,
	"sequence" integer,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_job_events_pkey" PRIMARY KEY("job_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "ai"."agent_job_payloads" (
	"reference" text PRIMARY KEY,
	"tenant_id" uuid NOT NULL,
	"ciphertext" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai"."agent_job_payloads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai"."agent_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"status" text NOT NULL,
	"profile_snapshot" jsonb NOT NULL,
	"prompt_reference" text NOT NULL,
	"result_reference" text,
	"session_id" text,
	"claimed_by" text,
	"lease_expires_at" timestamp with time zone,
	"next_event_sequence" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_jobs_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'claimed'::text, 'starting'::text, 'running'::text, 'awaiting-input'::text, 'cancelling'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text, 'timed-out'::text])))
);
--> statement-breakpoint
ALTER TABLE "ai"."agent_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai"."agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"runtime" text NOT NULL,
	"runtime_session_id" text NOT NULL,
	"profile_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_sessions_runtime_runtime_session_id_key" UNIQUE("runtime","runtime_session_id"),
	CONSTRAINT "agent_sessions_runtime_check" CHECK ((runtime = ANY (ARRAY['codex'::text, 'claude-code'::text])))
);
--> statement-breakpoint
ALTER TABLE "ai"."agent_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai"."model_definitions" (
	"id" text PRIMARY KEY,
	"provider_configuration_id" text NOT NULL,
	"display_name" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"kind" text NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_definitions_kind_check" CHECK ((kind = ANY (ARRAY['language'::text, 'embedding'::text, 'image'::text, 'multimodal'::text])))
);
--> statement-breakpoint
CREATE TABLE "ai"."profiles" (
	"id" text PRIMARY KEY,
	"display_name" text NOT NULL,
	"execution_family" text NOT NULL,
	"target_id" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_execution_family_check" CHECK ((execution_family = ANY (ARRAY['direct-model'::text, 'workflow'::text, 'agent-runtime'::text])))
);
--> statement-breakpoint
CREATE TABLE "ai"."provider_configurations" (
	"id" text PRIMARY KEY,
	"display_name" text NOT NULL,
	"adapter_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret_reference" text,
	"configuration" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai"."tenant_policies" (
	"tenant_id" uuid,
	"profile_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret_reference" text,
	"usage_limits" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_policies_pkey" PRIMARY KEY("tenant_id","profile_id")
);
--> statement-breakpoint
ALTER TABLE "ai"."tenant_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai"."usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"execution_family" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(14,6),
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai"."usage_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai"."workflow_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"engine" text NOT NULL,
	"engine_thread_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_threads_tenant_id_product_id_subject_id_engine_key" UNIQUE("tenant_id","product_id","subject_id","engine")
);
--> statement-breakpoint
ALTER TABLE "ai"."workflow_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"artifact_type" text NOT NULL,
	"title" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"payload_reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_token_hash" text NOT NULL CONSTRAINT "auth_sessions_session_token_hash_key" UNIQUE,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"status" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"access_token_ciphertext" jsonb NOT NULL,
	"refresh_token_ciphertext" jsonb,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connected_accounts_user_id_provider_key" UNIQUE("user_id","provider"),
	CONSTRAINT "connected_accounts_provider_check" CHECK ((provider = ANY (ARRAY['google'::text, 'linkedin'::text]))),
	CONSTRAINT "connected_accounts_status_check" CHECK ((status = ANY (ARRAY['connected'::text, 'expired'::text, 'revoked'::text])))
);
--> statement-breakpoint
CREATE TABLE "platform"."login_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_identities_provider_provider_account_id_key" UNIQUE("provider","provider_account_id"),
	CONSTRAINT "login_identities_provider_check" CHECK ((provider = ANY (ARRAY['google'::text, 'linkedin'::text])))
);
--> statement-breakpoint
CREATE TABLE "platform"."product_installations" (
	"tenant_id" uuid,
	"product_id" text,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"configuration" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_installations_pkey" PRIMARY KEY("tenant_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "platform"."product_installations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."tenant_memberships" (
	"tenant_id" uuid,
	"user_id" uuid,
	"role" "platform"."tenant_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL CONSTRAINT "tenants_slug_key" UNIQUE,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_check" CHECK ((slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text))
);
--> statement-breakpoint
CREATE TABLE "platform"."user_preferences" (
	"user_id" uuid PRIMARY KEY,
	"theme" "platform"."theme_preference" DEFAULT 'system'::"platform"."theme_preference" NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_profile_id" text
);
--> statement-breakpoint
CREATE TABLE "platform"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL CONSTRAINT "users_email_key" UNIQUE,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_verified_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "users_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'disabled'::text])))
);
--> statement-breakpoint
CREATE TABLE "presentation"."agent_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"workflow_thread_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation"."agent_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."document_favorites" (
	"tenant_id" uuid,
	"user_id" uuid,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_favorites_pkey" PRIMARY KEY("tenant_id","user_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "presentation"."document_favorites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"document_type" text DEFAULT 'presentation' NOT NULL,
	"content" jsonb DEFAULT '{}' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_import_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_tenant_id_source_import_id_key" UNIQUE("tenant_id","source_import_id")
);
--> statement-breakpoint
ALTER TABLE "presentation"."documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"format" text NOT NULL,
	"status" text NOT NULL,
	"asset_reference" text,
	"error_code" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_tenant_id_idempotency_key_key" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "exports_format_check" CHECK ((format = ANY (ARRAY['pptx'::text, 'pdf'::text])))
);
--> statement-breakpoint
ALTER TABLE "presentation"."exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."font_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"heading_font" text NOT NULL,
	"body_font" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation"."font_pairs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."generated_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"asset_reference" text NOT NULL,
	"prompt_reference" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"source_import_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generated_images_tenant_id_source_import_id_key" UNIQUE("tenant_id","source_import_id")
);
--> statement-breakpoint
ALTER TABLE "presentation"."generated_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."generation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"document_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"profile_id" text NOT NULL,
	"status" text NOT NULL,
	"state" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation"."generation_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."import_ledger" (
	"run_id" uuid,
	"entity_type" text,
	"source_id" text,
	"target_id" text NOT NULL,
	"target_revision" integer,
	"created_by_run" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_ledger_pkey" PRIMARY KEY("run_id","entity_type","source_id")
);
--> statement-breakpoint
ALTER TABLE "presentation"."import_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source_schema_version" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"report" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation"."import_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."presentations" (
	"document_id" uuid PRIMARY KEY,
	"tenant_id" uuid NOT NULL,
	"outline" jsonb DEFAULT '[]' NOT NULL,
	"theme_id" uuid,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"generation_state" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation"."presentations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"asset_reference" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation"."recordings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"token_hash" text NOT NULL CONSTRAINT "shares_token_hash_key" UNIQUE,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation"."shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."slides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_xml" text NOT NULL,
	"content" jsonb DEFAULT '{}' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slides_document_id_position_key" UNIQUE("document_id","position")
);
--> statement-breakpoint
ALTER TABLE "presentation"."slides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."theme_favorites" (
	"tenant_id" uuid,
	"user_id" uuid,
	"theme_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_favorites_pkey" PRIMARY KEY("tenant_id","user_id","theme_id")
);
--> statement-breakpoint
ALTER TABLE "presentation"."theme_favorites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."theme_likes" (
	"tenant_id" uuid,
	"user_id" uuid,
	"theme_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_likes_pkey" PRIMARY KEY("tenant_id","user_id","theme_id")
);
--> statement-breakpoint
ALTER TABLE "presentation"."theme_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presentation"."themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"definition" jsonb NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"source_import_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation"."themes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."assistant_answer_revisions" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"workspace_id" text,
	"artifact_id" text,
	"saved_revision" bigint,
	"draft_revision" bigint NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance" jsonb,
	CONSTRAINT "assistant_answer_revisions_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","workspace_id","artifact_id","saved_revision"),
	CONSTRAINT "assistant_answer_revisions_draft_revision_check" CHECK ((draft_revision >= 0)),
	CONSTRAINT "assistant_answer_revisions_saved_revision_check" CHECK ((saved_revision > 0))
);
--> statement-breakpoint
ALTER TABLE "interview"."assistant_answer_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."assistant_drafts" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"workspace_id" text,
	"artifact_id" text,
	"revision" bigint DEFAULT 0 NOT NULL,
	"saved_revision" bigint DEFAULT 0 NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance" jsonb,
	CONSTRAINT "assistant_drafts_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","workspace_id","artifact_id"),
	CONSTRAINT "assistant_drafts_revision_check" CHECK ((revision >= 0))
);
--> statement-breakpoint
ALTER TABLE "interview"."assistant_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."assistant_effect_receipts" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"operation" text,
	"request_id" text,
	"id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_effect_receipts_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","operation","request_id"),
	CONSTRAINT "assistant_effect_receipts_check" CHECK ((((state = 'completed'::text) AND (result IS NOT NULL)) OR ((state <> 'completed'::text) AND (result IS NULL)))),
	CONSTRAINT "assistant_effect_receipts_fingerprint_check" CHECK ((fingerprint ~ '^[a-f0-9]{64}$'::text)),
	CONSTRAINT "assistant_effect_receipts_operation_check" CHECK ((operation = ANY (ARRAY['save'::text, 'run-code'::text]))),
	CONSTRAINT "assistant_effect_receipts_state_check" CHECK ((state = ANY (ARRAY['started'::text, 'completed'::text, 'interrupted'::text])))
);
--> statement-breakpoint
ALTER TABLE "interview"."assistant_effect_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."assistant_evidence" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"id" text,
	"revision" bigint,
	"sha256" text NOT NULL,
	"locator" text NOT NULL,
	"text" text NOT NULL,
	"source_kind" text NOT NULL,
	"classification" text NOT NULL,
	"audience" text[] NOT NULL,
	"metrics" jsonb DEFAULT '[]' NOT NULL,
	CONSTRAINT "assistant_evidence_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","id","revision"),
	CONSTRAINT "assistant_evidence_audience_check" CHECK ((cardinality(audience) > 0)),
	CONSTRAINT "assistant_evidence_classification_check" CHECK ((classification = ANY (ARRAY['public'::text, 'internal'::text, 'confidential'::text, 'restricted'::text]))),
	CONSTRAINT "assistant_evidence_revision_check" CHECK ((revision >= 0)),
	CONSTRAINT "assistant_evidence_sha256_check" CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text)),
	CONSTRAINT "assistant_evidence_source_kind_check" CHECK ((source_kind = ANY (ARRAY['candidate'::text, 'technical-reference'::text])))
);
--> statement-breakpoint
ALTER TABLE "interview"."assistant_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."assistant_reverts" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"proposal_id" text,
	"workspace_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"applied_revision" bigint NOT NULL,
	"previous_value" jsonb NOT NULL,
	"previous_provenance" jsonb,
	"reverted_revision" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_reverts_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","proposal_id"),
	CONSTRAINT "assistant_reverts_applied_revision_check" CHECK ((applied_revision >= 0)),
	CONSTRAINT "assistant_reverts_reverted_revision_check" CHECK ((reverted_revision >= 0))
);
--> statement-breakpoint
ALTER TABLE "interview"."assistant_reverts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."briefing_proposals" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"id" text,
	"artifact_id" text NOT NULL,
	"base_revision" bigint NOT NULL,
	"profile_id" text NOT NULL,
	"profile_revision" bigint NOT NULL,
	"profile_sha256" text NOT NULL,
	"value" jsonb NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefing_proposals_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","id"),
	CONSTRAINT "briefing_proposals_base_revision_check" CHECK ((base_revision >= 0))
);
--> statement-breakpoint
ALTER TABLE "interview"."briefing_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."candidate_profile_revisions" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"id" text,
	"revision" bigint,
	"name" text NOT NULL,
	"sha256" text NOT NULL,
	"matrix" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_profile_revisions_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","id","revision"),
	CONSTRAINT "candidate_profile_revisions_revision_check" CHECK ((revision >= 1)),
	CONSTRAINT "candidate_profile_revisions_sha256_check" CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text))
);
--> statement-breakpoint
ALTER TABLE "interview"."candidate_profile_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."candidate_profiles" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"id" text,
	"name" text NOT NULL,
	"revision" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","id"),
	CONSTRAINT "candidate_profiles_revision_check" CHECK ((revision >= 1))
);
--> statement-breakpoint
ALTER TABLE "interview"."candidate_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."concept_briefs" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"id" text,
	"kind" text NOT NULL,
	"topic" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_briefs_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","id"),
	CONSTRAINT "concept_briefs_kind_check" CHECK ((kind = ANY (ARRAY['concept'::text, 'system-design'::text])))
);
--> statement-breakpoint
ALTER TABLE "interview"."concept_briefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."interview_plan_items" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"id" text,
	"plan_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_plan_items_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","id"),
	CONSTRAINT "interview_plan_items_kind_check" CHECK ((kind = ANY (ARRAY['question'::text, 'briefing'::text, 'rehearsal'::text, 'task'::text])))
);
--> statement-breakpoint
ALTER TABLE "interview"."interview_plan_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."interview_plans" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"id" text,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"duration_minutes" integer,
	"format" text DEFAULT '' NOT NULL,
	"topics" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_plans_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","id"),
	CONSTRAINT "interview_plans_duration_minutes_check" CHECK (((duration_minutes >= 5) AND (duration_minutes <= 600)))
);
--> statement-breakpoint
ALTER TABLE "interview"."interview_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."rehearsal_sessions" (
	"tenant_id" text,
	"actor_id" text,
	"product_id" text,
	"id" text,
	"format" text NOT NULL,
	"score" integer NOT NULL,
	"value" jsonb NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rehearsal_sessions_pkey" PRIMARY KEY("tenant_id","actor_id","product_id","id"),
	CONSTRAINT "rehearsal_sessions_format_check" CHECK ((format = ANY (ARRAY['full'::text, 'coding'::text, 'concept'::text]))),
	CONSTRAINT "rehearsal_sessions_score_check" CHECK (((score >= 0) AND (score <= 100)))
);
--> statement-breakpoint
ALTER TABLE "interview"."rehearsal_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE INDEX "agent_jobs_claim_idx" ON "ai"."agent_jobs" ("status","lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "artifacts_tenant_product_updated_idx" ON "platform"."artifacts" ("tenant_id","product_id","updated_at" DESC);--> statement-breakpoint
CREATE INDEX "audit_events_tenant_created_idx" ON "platform"."audit_events" ("tenant_id","created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "presentation_theme_source_idx" ON "presentation"."themes" ("tenant_id","source_import_id") WHERE (source_import_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "assistant_evidence_search" ON "interview"."assistant_evidence" USING gin (to_tsvector('english'::regconfig, text));--> statement-breakpoint
CREATE UNIQUE INDEX "companies_tenant_domain_key" ON "interview"."companies" ("tenant_id","domain") WHERE "domain" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_scope_slug_key" ON "practice"."exercises" (coalesce("tenant_id"::text, ''),"slug");--> statement-breakpoint
CREATE INDEX "exercises_tenant_prompt_key_idx" ON "practice"."exercises" ("tenant_id","prompt_key");--> statement-breakpoint
ALTER TABLE "ai"."agent_artifacts" ADD CONSTRAINT "agent_artifacts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai"."agent_jobs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."agent_job_events" ADD CONSTRAINT "agent_job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai"."agent_jobs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."agent_job_payloads" ADD CONSTRAINT "agent_job_payloads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."agent_jobs" ADD CONSTRAINT "agent_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."agent_jobs" ADD CONSTRAINT "agent_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "ai"."agent_sessions" ADD CONSTRAINT "agent_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "ai"."model_definitions" ADD CONSTRAINT "model_definitions_provider_configuration_id_fkey" FOREIGN KEY ("provider_configuration_id") REFERENCES "ai"."provider_configurations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."tenant_policies" ADD CONSTRAINT "tenant_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."tenant_policies" ADD CONSTRAINT "tenant_policies_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "ai"."profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."usage_records" ADD CONSTRAINT "usage_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai"."usage_records" ADD CONSTRAINT "usage_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "ai"."workflow_threads" ADD CONSTRAINT "workflow_threads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform"."artifacts" ADD CONSTRAINT "artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform"."artifacts" ADD CONSTRAINT "artifacts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "platform"."audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform"."audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "platform"."auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform"."connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform"."login_identities" ADD CONSTRAINT "login_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform"."product_installations" ADD CONSTRAINT "product_installations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform"."tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform"."tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."agent_conversations" ADD CONSTRAINT "agent_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."agent_conversations" ADD CONSTRAINT "agent_conversations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "presentation"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."agent_conversations" ADD CONSTRAINT "agent_conversations_workflow_thread_id_fkey" FOREIGN KEY ("workflow_thread_id") REFERENCES "ai"."workflow_threads"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "presentation"."agent_conversations" ADD CONSTRAINT "agent_conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "presentation"."document_favorites" ADD CONSTRAINT "document_favorites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."document_favorites" ADD CONSTRAINT "document_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."document_favorites" ADD CONSTRAINT "document_favorites_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "presentation"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."documents" ADD CONSTRAINT "documents_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "presentation"."exports" ADD CONSTRAINT "exports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."exports" ADD CONSTRAINT "exports_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "presentation"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."exports" ADD CONSTRAINT "exports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "presentation"."font_pairs" ADD CONSTRAINT "font_pairs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."font_pairs" ADD CONSTRAINT "font_pairs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "presentation"."generated_images" ADD CONSTRAINT "generated_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."generated_images" ADD CONSTRAINT "generated_images_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "presentation"."generation_sessions" ADD CONSTRAINT "generation_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."generation_sessions" ADD CONSTRAINT "generation_sessions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "presentation"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."generation_sessions" ADD CONSTRAINT "generation_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "presentation"."import_ledger" ADD CONSTRAINT "import_ledger_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "presentation"."import_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."import_runs" ADD CONSTRAINT "import_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."presentations" ADD CONSTRAINT "presentations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "presentation"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."presentations" ADD CONSTRAINT "presentations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."presentations" ADD CONSTRAINT "presentations_theme_fk" FOREIGN KEY ("theme_id") REFERENCES "presentation"."themes"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "presentation"."recordings" ADD CONSTRAINT "recordings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."recordings" ADD CONSTRAINT "recordings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "presentation"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."recordings" ADD CONSTRAINT "recordings_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "presentation"."shares" ADD CONSTRAINT "shares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."shares" ADD CONSTRAINT "shares_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "presentation"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."shares" ADD CONSTRAINT "shares_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "presentation"."slides" ADD CONSTRAINT "slides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."slides" ADD CONSTRAINT "slides_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "presentation"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."theme_favorites" ADD CONSTRAINT "theme_favorites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."theme_favorites" ADD CONSTRAINT "theme_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."theme_favorites" ADD CONSTRAINT "theme_favorites_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "presentation"."themes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."theme_likes" ADD CONSTRAINT "theme_likes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."theme_likes" ADD CONSTRAINT "theme_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."theme_likes" ADD CONSTRAINT "theme_likes_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "presentation"."themes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."themes" ADD CONSTRAINT "themes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "presentation"."themes" ADD CONSTRAINT "themes_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform"."users"("id");--> statement-breakpoint
ALTER TABLE "interview"."assistant_answer_revisions" ADD CONSTRAINT "assistant_answer_revisions_tenant_id_actor_id_product_id_w_fkey" FOREIGN KEY ("tenant_id","actor_id","product_id","workspace_id","artifact_id") REFERENCES "interview"."assistant_drafts"("tenant_id","actor_id","product_id","workspace_id","artifact_id");--> statement-breakpoint
ALTER TABLE "interview"."assistant_reverts" ADD CONSTRAINT "assistant_reverts_tenant_id_actor_id_product_id_workspace__fkey" FOREIGN KEY ("tenant_id","actor_id","product_id","workspace_id","artifact_id") REFERENCES "interview"."assistant_drafts"("tenant_id","actor_id","product_id","workspace_id","artifact_id");--> statement-breakpoint
ALTER TABLE "interview"."candidate_profile_revisions" ADD CONSTRAINT "candidate_profile_revisions_tenant_id_actor_id_product_id__fkey" FOREIGN KEY ("tenant_id","actor_id","product_id","id") REFERENCES "interview"."candidate_profiles"("tenant_id","actor_id","product_id","id");--> statement-breakpoint
ALTER TABLE "interview"."interview_plan_items" ADD CONSTRAINT "interview_plan_items_tenant_id_actor_id_product_id_plan_id_fkey" FOREIGN KEY ("tenant_id","actor_id","product_id","plan_id") REFERENCES "interview"."interview_plans"("tenant_id","actor_id","product_id","id") ON DELETE CASCADE;--> statement-breakpoint
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
CREATE POLICY "tenant_scope" ON "ai"."agent_job_payloads" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "ai"."agent_jobs" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "ai"."agent_sessions" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "ai"."tenant_policies" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "ai"."usage_records" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "ai"."workflow_threads" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_artifacts" ON "platform"."artifacts" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_audit_events" ON "platform"."audit_events" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_product_installations" ON "platform"."product_installations" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."agent_conversations" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."document_favorites" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."documents" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."exports" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."font_pairs" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."generated_images" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."generation_sessions" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."import_runs" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."presentations" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."recordings" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."shares" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."slides" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."theme_favorites" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "presentation"."theme_likes" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "tenant_theme_scope" ON "presentation"."themes" AS PERMISSIVE FOR ALL TO public USING (((tenant_id IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid))) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));--> statement-breakpoint
CREATE POLICY "assistant_private_scope" ON "interview"."assistant_answer_revisions" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "assistant_private_scope" ON "interview"."assistant_drafts" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "assistant_private_scope" ON "interview"."assistant_effect_receipts" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "assistant_private_scope" ON "interview"."assistant_evidence" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "assistant_private_scope" ON "interview"."assistant_reverts" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "briefing_private_scope" ON "interview"."briefing_proposals" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "briefing_private_scope" ON "interview"."candidate_profile_revisions" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "briefing_private_scope" ON "interview"."candidate_profiles" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "brief_private_scope" ON "interview"."concept_briefs" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "plan_private_scope" ON "interview"."interview_plan_items" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "plan_private_scope" ON "interview"."interview_plans" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
CREATE POLICY "rehearsal_private_scope" ON "interview"."rehearsal_sessions" AS PERMISSIVE FOR ALL TO public USING (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true)))) WITH CHECK (((tenant_id = current_setting('app.tenant_id'::text, true)) AND (actor_id = current_setting('app.actor_id'::text, true)) AND (product_id = current_setting('app.product_id'::text, true))));--> statement-breakpoint
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