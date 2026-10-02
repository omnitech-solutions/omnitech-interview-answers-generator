-- Spoken briefings on technical topics (concepts, system design): a headline,
-- three points, an example, a pitfall and likely follow-ups. Behavioural
-- preparation lives in the evidence-backed briefing packs (0006).
CREATE TABLE IF NOT EXISTS interview.concept_briefs (
 tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
 id text NOT NULL, kind text NOT NULL CHECK(kind IN ('concept','system-design')),
 topic text NOT NULL, value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,product_id,id)
);
ALTER TABLE interview.concept_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview.concept_briefs FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='interview' AND tablename='concept_briefs' AND policyname='brief_private_scope') THEN
  CREATE POLICY brief_private_scope ON interview.concept_briefs USING (tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.actor_id',true) AND product_id=current_setting('app.product_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.actor_id',true) AND product_id=current_setting('app.product_id',true));
 END IF;
END $$;
