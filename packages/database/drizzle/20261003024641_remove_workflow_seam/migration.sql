DROP POLICY "tenant_scope" ON "ai"."workflow_threads";--> statement-breakpoint
ALTER TABLE "presentation"."agent_conversations" DROP CONSTRAINT "agent_conversations_workflow_thread_id_fkey";--> statement-breakpoint
DROP TABLE "ai"."workflow_threads";--> statement-breakpoint
ALTER TABLE "presentation"."agent_conversations" DROP COLUMN "workflow_thread_id";--> statement-breakpoint
ALTER TABLE "ai"."profiles" DROP CONSTRAINT "profiles_execution_family_check", ADD CONSTRAINT "profiles_execution_family_check" CHECK ((execution_family = ANY (ARRAY['direct-model'::text, 'agent-runtime'::text])));