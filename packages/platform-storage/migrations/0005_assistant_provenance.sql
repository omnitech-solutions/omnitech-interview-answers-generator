-- Additive lineage and explicit effect receipts. No legacy rows are imported.
ALTER TABLE interview.assistant_drafts ADD COLUMN IF NOT EXISTS provenance jsonb;
ALTER TABLE interview.assistant_answer_revisions ADD COLUMN IF NOT EXISTS provenance jsonb;
ALTER TABLE interview.assistant_evidence ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS interview.assistant_effect_receipts (
 tenant_id text NOT NULL, actor_id text NOT NULL, product_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('save','run-code')),request_id text NOT NULL,id text NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),payload jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('started','completed','interrupted')),result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,product_id,operation,request_id),
 CHECK((state='completed' AND result IS NOT NULL) OR (state<>'completed' AND result IS NULL))
);
ALTER TABLE interview.assistant_effect_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview.assistant_effect_receipts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='interview' AND tablename='assistant_effect_receipts' AND policyname='assistant_private_scope') THEN
 CREATE POLICY assistant_private_scope ON interview.assistant_effect_receipts
 USING(tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.actor_id',true) AND product_id=current_setting('app.product_id',true))
 WITH CHECK(tenant_id=current_setting('app.tenant_id',true) AND actor_id=current_setting('app.actor_id',true) AND product_id=current_setting('app.product_id',true));
 END IF;
END $$;
CREATE OR REPLACE FUNCTION interview.refuse_assistant_effect_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state<>'started' THEN
  RAISE EXCEPTION 'Completed or interrupted assistant effect receipts are immutable' USING ERRCODE='55000';
 END IF;
 IF (NEW.tenant_id,NEW.actor_id,NEW.product_id,NEW.operation,NEW.request_id,NEW.id,NEW.fingerprint,NEW.payload)
 IS DISTINCT FROM (OLD.tenant_id,OLD.actor_id,OLD.product_id,OLD.operation,OLD.request_id,OLD.id,OLD.fingerprint,OLD.payload) THEN
  RAISE EXCEPTION 'Assistant effect identity and payload are immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='interview.assistant_effect_receipts'::regclass AND tgname='assistant_effect_immutable') THEN
  CREATE TRIGGER assistant_effect_immutable BEFORE UPDATE OR DELETE ON interview.assistant_effect_receipts FOR EACH ROW EXECUTE FUNCTION interview.refuse_assistant_effect_rewrite();
 END IF;
END $$;
