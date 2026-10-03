-- The app role owns these tables, and PostgreSQL exempts an owner from
-- row-level security unless it is forced (ADR-0005 Decision 3).
ALTER TABLE ai.agent_artifacts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai.agent_job_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE platform.tenant_memberships FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- The agent worker may advance any job's lifecycle, but a job's identity,
-- tenant, owner, product and profile never change once it exists. Its prompt
-- changes only when its own tenant resumes it, never under the worker.
CREATE FUNCTION ai.refuse_agent_job_identity_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id, NEW.tenant_id, NEW.user_id, NEW.product_id, NEW.profile_snapshot)
 IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.user_id, OLD.product_id, OLD.profile_snapshot) THEN
  RAISE EXCEPTION 'Agent job identity, tenant and profile are immutable' USING ERRCODE='55000';
 END IF;
 IF NEW.prompt_reference IS DISTINCT FROM OLD.prompt_reference
    AND OLD.tenant_id IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
  RAISE EXCEPTION 'Agent job prompt is immutable outside its own tenant' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER agent_jobs_identity BEFORE UPDATE ON ai.agent_jobs
  FOR EACH ROW EXECUTE FUNCTION ai.refuse_agent_job_identity_rewrite();--> statement-breakpoint

-- Themes and exercises may be tenant-less shared catalog rows, which a
-- composite (tenant_id, id) key cannot reach. A row that references one keeps
-- its single-column key and admits only a shared row or one of its own
-- tenant's. Arguments: the catalog table, then the referencing column.
CREATE FUNCTION platform.refuse_foreign_catalog_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 referenced uuid := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
 owner uuid;
 visible integer;
BEGIN
 IF referenced IS NULL THEN RETURN NEW; END IF;
 -- Under row-level security another tenant's row is invisible, so a row
 -- that cannot be seen is refused as surely as one owned elsewhere.
 EXECUTE format('SELECT tenant_id FROM %s WHERE id = $1', TG_ARGV[0]) INTO owner USING referenced;
 GET DIAGNOSTICS visible = ROW_COUNT;
 IF visible = 0 OR (owner IS NOT NULL AND owner IS DISTINCT FROM NEW.tenant_id) THEN
  RAISE EXCEPTION 'A row cannot reference another workspace''s %', TG_ARGV[0] USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER catalog_in_tenant BEFORE INSERT OR UPDATE ON presentation.presentations
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_foreign_catalog_row('presentation.themes', 'theme_id');--> statement-breakpoint
CREATE TRIGGER catalog_in_tenant BEFORE INSERT OR UPDATE ON presentation.theme_favorites
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_foreign_catalog_row('presentation.themes', 'theme_id');--> statement-breakpoint
CREATE TRIGGER catalog_in_tenant BEFORE INSERT OR UPDATE ON presentation.theme_likes
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_foreign_catalog_row('presentation.themes', 'theme_id');--> statement-breakpoint
CREATE TRIGGER catalog_in_tenant BEFORE INSERT OR UPDATE ON practice.exercise_attempts
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_foreign_catalog_row('practice.exercises', 'exercise_id');
