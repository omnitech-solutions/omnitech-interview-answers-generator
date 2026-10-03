-- The app role owns these tables, and PostgreSQL exempts an owner from
-- row-level security unless it is forced. Forcing it makes their tenant
-- policies bind the app, as they already do for interview and practice.
ALTER TABLE ai.agent_job_payloads FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai.agent_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai.agent_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai.tenant_policies FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai.usage_records FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai.workflow_threads FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE platform.artifacts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE platform.audit_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE platform.product_installations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.agent_conversations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.document_favorites FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.documents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.exports FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.font_pairs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.generated_images FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.generation_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.presentations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.recordings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.shares FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.slides FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.theme_favorites FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.theme_likes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE presentation.themes FORCE ROW LEVEL SECURITY;
