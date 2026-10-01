-- Additive assistant workspace storage. Legacy JSON/library rows are not imported.
CREATE SCHEMA IF NOT EXISTS interview;
CREATE TABLE IF NOT EXISTS interview.assistant_drafts (
  tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
  workspace_id text NOT NULL, artifact_id text NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0), saved_revision bigint NOT NULL DEFAULT 0,
  value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_id, product_id, workspace_id, artifact_id)
);
CREATE TABLE IF NOT EXISTS interview.assistant_answer_revisions (
  tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
  workspace_id text NOT NULL, artifact_id text NOT NULL,
  saved_revision bigint NOT NULL CHECK (saved_revision>0), draft_revision bigint NOT NULL CHECK (draft_revision>=0),
  value jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_id, product_id, workspace_id, artifact_id, saved_revision),
  FOREIGN KEY (tenant_id, actor_id, product_id, workspace_id, artifact_id)
    REFERENCES interview.assistant_drafts (tenant_id, actor_id, product_id, workspace_id, artifact_id)
);
CREATE TABLE IF NOT EXISTS interview.assistant_evidence (
  tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
  id text NOT NULL, revision bigint NOT NULL CHECK (revision>=0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), locator text NOT NULL, text text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('candidate','technical-reference')),
  classification text NOT NULL CHECK (classification IN ('public','internal','confidential','restricted')),
  audience text[] NOT NULL CHECK (cardinality(audience)>0),
  PRIMARY KEY (tenant_id, actor_id, product_id, id, revision)
);
CREATE INDEX IF NOT EXISTS assistant_evidence_search ON interview.assistant_evidence USING gin(to_tsvector('english',text));
CREATE OR REPLACE FUNCTION interview.refuse_assistant_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Assistant answer and evidence revisions are immutable' USING ERRCODE='55000'; END $$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['assistant_drafts','assistant_answer_revisions','assistant_evidence'] LOOP
    EXECUTE format('ALTER TABLE interview.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE interview.%I FORCE ROW LEVEL SECURITY',table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='interview' AND tablename=table_name AND policyname='assistant_private_scope') THEN
      EXECUTE format('CREATE POLICY assistant_private_scope ON interview.%I USING (tenant_id=current_setting(''app.tenant_id'',true) AND actor_id=current_setting(''app.actor_id'',true) AND product_id=current_setting(''app.product_id'',true)) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true) AND actor_id=current_setting(''app.actor_id'',true) AND product_id=current_setting(''app.product_id'',true))',table_name);
    END IF;
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['assistant_answer_revisions','assistant_evidence'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=format('interview.%I',table_name)::regclass AND tgname='assistant_immutable') THEN
      EXECUTE format('CREATE TRIGGER assistant_immutable BEFORE UPDATE OR DELETE ON interview.%I FOR EACH ROW EXECUTE FUNCTION interview.refuse_assistant_immutable_mutation()',table_name);
    END IF;
  END LOOP;
END $$;
