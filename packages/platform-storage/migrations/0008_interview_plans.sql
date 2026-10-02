-- Interviews a person is preparing for, and the plan of work for each. Plan
-- items link to the work (a question, a briefing, a rehearsal) whose state
-- they report; nothing here copies that work.
CREATE TABLE IF NOT EXISTS interview.interview_plans (
 tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
 id text NOT NULL, company text NOT NULL, role text NOT NULL,
 scheduled_at timestamptz, duration_minutes integer CHECK(duration_minutes BETWEEN 5 AND 600),
 format text NOT NULL DEFAULT '', topics jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,product_id,id)
);
CREATE TABLE IF NOT EXISTS interview.interview_plan_items (
 tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
 id text NOT NULL, plan_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('question','briefing','rehearsal','task')),
 ref text, title text NOT NULL, done boolean NOT NULL DEFAULT false,
 position integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,product_id,id),
 FOREIGN KEY(tenant_id,actor_id,product_id,plan_id)
   REFERENCES interview.interview_plans(tenant_id,actor_id,product_id,id) ON DELETE CASCADE
);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['interview_plans','interview_plan_items'] LOOP
  EXECUTE format('ALTER TABLE interview.%I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('ALTER TABLE interview.%I FORCE ROW LEVEL SECURITY', table_name);
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='interview' AND tablename=table_name AND policyname='plan_private_scope') THEN
   EXECUTE format('CREATE POLICY plan_private_scope ON interview.%I USING (tenant_id=current_setting(''app.tenant_id'',true) AND actor_id=current_setting(''app.actor_id'',true) AND product_id=current_setting(''app.product_id'',true)) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true) AND actor_id=current_setting(''app.actor_id'',true) AND product_id=current_setting(''app.product_id'',true))',table_name);
  END IF;
 END LOOP;
END $$;
