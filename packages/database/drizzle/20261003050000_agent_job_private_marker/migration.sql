ALTER TABLE "ai"."agent_jobs" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE POLICY "agent_artifacts_private_parent_select" ON "ai"."agent_artifacts" AS RESTRICTIVE FOR SELECT TO public USING ((EXISTS (SELECT 1 FROM ai.agent_jobs j WHERE j.tenant_id = agent_artifacts.tenant_id AND j.id = agent_artifacts.job_id)));--> statement-breakpoint
CREATE POLICY "agent_artifacts_private_parent_update" ON "ai"."agent_artifacts" AS RESTRICTIVE FOR UPDATE TO public USING ((EXISTS (SELECT 1 FROM ai.agent_jobs j WHERE j.tenant_id = agent_artifacts.tenant_id AND j.id = agent_artifacts.job_id))) WITH CHECK ((EXISTS (SELECT 1 FROM ai.agent_jobs j WHERE j.tenant_id = agent_artifacts.tenant_id AND j.id = agent_artifacts.job_id)));--> statement-breakpoint
CREATE POLICY "agent_artifacts_private_parent_delete" ON "ai"."agent_artifacts" AS RESTRICTIVE FOR DELETE TO public USING ((EXISTS (SELECT 1 FROM ai.agent_jobs j WHERE j.tenant_id = agent_artifacts.tenant_id AND j.id = agent_artifacts.job_id)));--> statement-breakpoint
CREATE POLICY "agent_job_events_private_parent_select" ON "ai"."agent_job_events" AS RESTRICTIVE FOR SELECT TO public USING ((EXISTS (SELECT 1 FROM ai.agent_jobs j WHERE j.tenant_id = agent_job_events.tenant_id AND j.id = agent_job_events.job_id)));--> statement-breakpoint
CREATE POLICY "agent_job_events_private_parent_update" ON "ai"."agent_job_events" AS RESTRICTIVE FOR UPDATE TO public USING ((EXISTS (SELECT 1 FROM ai.agent_jobs j WHERE j.tenant_id = agent_job_events.tenant_id AND j.id = agent_job_events.job_id))) WITH CHECK ((EXISTS (SELECT 1 FROM ai.agent_jobs j WHERE j.tenant_id = agent_job_events.tenant_id AND j.id = agent_job_events.job_id)));--> statement-breakpoint
CREATE POLICY "agent_job_events_private_parent_delete" ON "ai"."agent_job_events" AS RESTRICTIVE FOR DELETE TO public USING ((EXISTS (SELECT 1 FROM ai.agent_jobs j WHERE j.tenant_id = agent_job_events.tenant_id AND j.id = agent_job_events.job_id)));--> statement-breakpoint
CREATE POLICY "agent_job_private_select" ON "ai"."agent_jobs" AS RESTRICTIVE FOR SELECT TO public USING ((NOT private OR user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR current_setting('app.agent_worker', true) = 'on'));--> statement-breakpoint
CREATE POLICY "agent_job_private_update" ON "ai"."agent_jobs" AS RESTRICTIVE FOR UPDATE TO public USING ((NOT private OR user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR current_setting('app.agent_worker', true) = 'on')) WITH CHECK ((NOT private OR user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR current_setting('app.agent_worker', true) = 'on'));--> statement-breakpoint
CREATE POLICY "agent_job_private_delete" ON "ai"."agent_jobs" AS RESTRICTIVE FOR DELETE TO public USING ((NOT private OR user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR current_setting('app.agent_worker', true) = 'on'));--> statement-breakpoint

-- The private marker is immutable, and only the session dispatch path sets it.
-- That path is the one function that creates a private job
-- (PostgresAgentJobRepository.create with private: true): it sets the
-- transaction-local app.session_dispatch, which exactly one file owns
-- (scripts/tenant-context-boundary.test.ts), in the creating user's own
-- actor-scoped transaction. So a job is private only if a session dispatch
-- created it, and only its creator (user_id = the actor) or the agent worker
-- can ever read it.
CREATE FUNCTION ai.guard_agent_job_private_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF NEW.private THEN
   IF current_setting('app.session_dispatch', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'A private agent job is created only by the session dispatch path' USING ERRCODE='55000';
   END IF;
   IF NEW.user_id IS DISTINCT FROM NULLIF(current_setting('app.actor_id', true), '')::uuid THEN
    RAISE EXCEPTION 'A private agent job belongs to the actor that creates it' USING ERRCODE='55000';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.private IS DISTINCT FROM OLD.private THEN
  RAISE EXCEPTION 'The agent job private marker is immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER agent_jobs_private_marker BEFORE INSERT OR UPDATE ON ai.agent_jobs
 FOR EACH ROW EXECUTE FUNCTION ai.guard_agent_job_private_marker();