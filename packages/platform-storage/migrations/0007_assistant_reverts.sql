-- What an applied assistant proposal replaced, so it can be undone; and the
-- draft revision the undo produced, so the same proposal can be applied again.
CREATE TABLE IF NOT EXISTS interview.assistant_reverts (
  tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
  proposal_id text NOT NULL, workspace_id text NOT NULL, artifact_id text NOT NULL,
  applied_revision bigint NOT NULL CHECK (applied_revision>=0),
  previous_value jsonb NOT NULL, previous_provenance jsonb,
  reverted_revision bigint CHECK (reverted_revision>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_id, product_id, proposal_id),
  FOREIGN KEY (tenant_id, actor_id, product_id, workspace_id, artifact_id)
    REFERENCES interview.assistant_drafts (tenant_id, actor_id, product_id, workspace_id, artifact_id)
);
ALTER TABLE interview.assistant_reverts ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview.assistant_reverts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='interview' AND tablename='assistant_reverts' AND policyname='assistant_private_scope') THEN
    CREATE POLICY assistant_private_scope ON interview.assistant_reverts USING (tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.actor_id',true) AND product_id=current_setting('app.product_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.actor_id',true) AND product_id=current_setting('app.product_id',true));
  END IF;
END $$;
