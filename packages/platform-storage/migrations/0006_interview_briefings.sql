-- Private, versioned candidate profiles and immutable briefing proposals.
CREATE TABLE IF NOT EXISTS interview.candidate_profiles (
 tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
 id text NOT NULL, name text NOT NULL, revision bigint NOT NULL CHECK(revision>=1),
 updated_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 PRIMARY KEY(tenant_id,actor_id,product_id,id)
);
CREATE TABLE IF NOT EXISTS interview.candidate_profile_revisions (
 tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
 id text NOT NULL, revision bigint NOT NULL CHECK(revision>=1), name text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), matrix jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,product_id,id,revision),
 FOREIGN KEY(tenant_id,actor_id,product_id,id) REFERENCES interview.candidate_profiles(tenant_id,actor_id,product_id,id)
);
CREATE TABLE IF NOT EXISTS interview.briefing_proposals (
 tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
 id text NOT NULL, artifact_id text NOT NULL, base_revision bigint NOT NULL CHECK(base_revision>=0),
 profile_id text NOT NULL, profile_revision bigint NOT NULL, profile_sha256 text NOT NULL,
 value jsonb NOT NULL, source_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,product_id,id)
);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['candidate_profiles','candidate_profile_revisions','briefing_proposals'] LOOP
  EXECUTE format('ALTER TABLE interview.%I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('ALTER TABLE interview.%I FORCE ROW LEVEL SECURITY', table_name);
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='interview' AND tablename=table_name AND policyname='briefing_private_scope') THEN
   EXECUTE format('CREATE POLICY briefing_private_scope ON interview.%I USING (tenant_id=current_setting(''app.tenant_id'',true) AND actor_id=current_setting(''app.actor_id'',true) AND product_id=current_setting(''app.product_id'',true)) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true) AND actor_id=current_setting(''app.actor_id'',true) AND product_id=current_setting(''app.product_id'',true))',table_name);
  END IF;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['candidate_profile_revisions','briefing_proposals'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=format('interview.%I',table_name)::regclass AND tgname='briefing_immutable') THEN
   EXECUTE format('CREATE TRIGGER briefing_immutable BEFORE UPDATE OR DELETE ON interview.%I FOR EACH ROW EXECUTE FUNCTION interview.refuse_assistant_immutable_mutation()',table_name);
  END IF;
 END LOOP;
END $$;
