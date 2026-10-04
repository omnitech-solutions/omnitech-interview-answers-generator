ALTER TABLE "ai"."agent_jobs" ADD COLUMN "execution_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "ai"."agent_job_events" ADD COLUMN "execution_id" uuid;--> statement-breakpoint
ALTER TABLE "ai"."agent_job_events" ADD COLUMN "attempt_id" text;--> statement-breakpoint
-- The migration runs in one transaction; both FORCE settings roll back on
-- failure and are restored before it commits.
ALTER TABLE ai.agent_jobs NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai.agent_job_events NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE ai.agent_job_events e
SET execution_id = j.execution_id
FROM ai.agent_jobs j
WHERE e.tenant_id = j.tenant_id AND e.job_id = j.id;--> statement-breakpoint
ALTER TABLE ai.agent_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai.agent_job_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai"."agent_job_events" ALTER COLUMN "execution_id" SET NOT NULL;
--> statement-breakpoint
CREATE FUNCTION ai.set_agent_event_execution_id() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prior_worker text;
BEGIN
  prior_worker := current_setting('app.agent_worker', true);
  PERFORM set_config('app.agent_worker', 'on', true);
  SELECT execution_id INTO NEW.execution_id
  FROM ai.agent_jobs
  WHERE tenant_id = NEW.tenant_id AND id = NEW.job_id;
  PERFORM set_config('app.agent_worker', coalesce(prior_worker, ''), true);
  IF NEW.execution_id IS NULL THEN
    RAISE foreign_key_violation USING MESSAGE = 'Agent event violates foreign key to parent job';
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.agent_worker', coalesce(prior_worker, ''), true);
  RAISE;
END $$;
--> statement-breakpoint
CREATE TRIGGER agent_job_events_execution_identity
BEFORE INSERT ON ai.agent_job_events
FOR EACH ROW EXECUTE FUNCTION ai.set_agent_event_execution_id();
