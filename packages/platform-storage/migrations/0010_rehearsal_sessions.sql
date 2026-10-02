-- Completed rehearsals: what was practised and how it went. The score is
-- computed from the checklist and the hints opened, never sent by the client.
CREATE TABLE IF NOT EXISTS interview.rehearsal_sessions (
 tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
 id text NOT NULL, format text NOT NULL CHECK(format IN ('full','coding','concept')),
 score integer NOT NULL CHECK(score BETWEEN 0 AND 100), value jsonb NOT NULL,
 ended_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,product_id,id)
);
ALTER TABLE interview.rehearsal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview.rehearsal_sessions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='interview' AND tablename='rehearsal_sessions' AND policyname='rehearsal_private_scope') THEN
  CREATE POLICY rehearsal_private_scope ON interview.rehearsal_sessions USING (tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.actor_id',true) AND product_id=current_setting('app.product_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.actor_id',true) AND product_id=current_setting('app.product_id',true));
 END IF;
END $$;
