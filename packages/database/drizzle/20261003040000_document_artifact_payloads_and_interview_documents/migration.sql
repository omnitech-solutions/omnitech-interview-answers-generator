CREATE TABLE "platform"."artifact_payloads" (
	"tenant_id" uuid,
	"artifact_id" uuid,
	"bytes" bytea NOT NULL,
	"byte_length" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_payloads_pkey" PRIMARY KEY("tenant_id","artifact_id"),
	CONSTRAINT "artifact_payloads_size_check" CHECK (byte_length >= 0 AND byte_length <= 10485760 AND octet_length(bytes) = byte_length)
);
--> statement-breakpoint
ALTER TABLE "platform"."artifact_payloads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."document_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"format" text NOT NULL,
	"artifact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_exports_format_check" CHECK ("format" IN ('docx', 'md'))
);
--> statement-breakpoint
ALTER TABLE "interview"."document_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."document_revisions" (
	"tenant_id" uuid,
	"owner_user_id" uuid,
	"document_id" uuid,
	"revision" integer,
	"values" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"ai_usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_revisions_pkey" PRIMARY KEY("tenant_id","owner_user_id","document_id","revision"),
	CONSTRAINT "document_revisions_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "interview"."document_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."document_template_revisions" (
	"tenant_id" uuid,
	"template_id" uuid,
	"revision" integer,
	"owner_user_id" uuid,
	"source_artifact_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"instructions" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_template_revisions_pkey" PRIMARY KEY("tenant_id","template_id","revision"),
	CONSTRAINT "document_template_revisions_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "interview"."document_template_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_templates_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "document_templates_kind_check" CHECK ("kind" IN ('resume', 'cover_letter', 'interview_prep', 'custom')),
	CONSTRAINT "document_templates_format_check" CHECK ("format" IN ('docx', 'md'))
);
--> statement-breakpoint
ALTER TABLE "interview"."document_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_revision" integer NOT NULL,
	"profile_id" text NOT NULL,
	"profile_revision" bigint NOT NULL,
	"candidacy_id" uuid,
	"interview_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_tenant_owner_id_key" UNIQUE("tenant_id","owner_user_id","id"),
	CONSTRAINT "documents_selection_key" UNIQUE NULLS NOT DISTINCT ("tenant_id","owner_user_id","template_id","template_revision","profile_id","profile_revision","candidacy_id","interview_id"),
	CONSTRAINT "documents_interview_requires_candidacy" CHECK ("interview_id" IS NULL OR "candidacy_id" IS NOT NULL),
	CONSTRAINT "documents_status_check" CHECK ("status" IN ('ready', 'invalid', 'archived')),
	CONSTRAINT "documents_profile_revision_check" CHECK ("profile_revision" > 0),
	CONSTRAINT "documents_current_revision_check" CHECK ("current_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "interview"."documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview"."candidacies" ADD COLUMN "job_description" text;--> statement-breakpoint
ALTER TABLE "platform"."artifacts" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."artifacts" ADD CONSTRAINT "artifacts_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."interviews" ADD CONSTRAINT "interviews_tenant_id_id_candidacy_id_key" UNIQUE("tenant_id","id","candidacy_id");--> statement-breakpoint
CREATE INDEX "document_exports_revision_idx" ON "interview"."document_exports" ("tenant_id","owner_user_id","document_id","revision");--> statement-breakpoint
CREATE INDEX "document_template_revisions_artifact_idx" ON "interview"."document_template_revisions" ("tenant_id","source_artifact_id");--> statement-breakpoint
CREATE INDEX "document_templates_owner_idx" ON "interview"."document_templates" ("tenant_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "documents_owner_updated_idx" ON "interview"."documents" ("tenant_id","owner_user_id","updated_at");--> statement-breakpoint
ALTER TABLE "platform"."artifact_payloads" ADD CONSTRAINT "artifact_payloads_artifact_fkey" FOREIGN KEY ("tenant_id","artifact_id") REFERENCES "platform"."artifacts"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview"."document_exports" ADD CONSTRAINT "document_exports_revision_fkey" FOREIGN KEY ("tenant_id","owner_user_id","document_id","revision") REFERENCES "interview"."document_revisions"("tenant_id","owner_user_id","document_id","revision");--> statement-breakpoint
ALTER TABLE "interview"."document_exports" ADD CONSTRAINT "document_exports_artifact_fkey" FOREIGN KEY ("tenant_id","artifact_id") REFERENCES "platform"."artifacts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."document_revisions" ADD CONSTRAINT "document_revisions_document_fkey" FOREIGN KEY ("tenant_id","owner_user_id","document_id") REFERENCES "interview"."documents"("tenant_id","owner_user_id","id");--> statement-breakpoint
ALTER TABLE "interview"."document_template_revisions" ADD CONSTRAINT "document_template_revisions_template_fkey" FOREIGN KEY ("tenant_id","template_id") REFERENCES "interview"."document_templates"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."document_template_revisions" ADD CONSTRAINT "document_template_revisions_artifact_fkey" FOREIGN KEY ("tenant_id","source_artifact_id") REFERENCES "platform"."artifacts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."document_templates" ADD CONSTRAINT "document_templates_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id");--> statement-breakpoint
ALTER TABLE "interview"."documents" ADD CONSTRAINT "documents_template_revision_fkey" FOREIGN KEY ("tenant_id","template_id","template_revision") REFERENCES "interview"."document_template_revisions"("tenant_id","template_id","revision");--> statement-breakpoint
ALTER TABLE "interview"."documents" ADD CONSTRAINT "documents_candidacy_fkey" FOREIGN KEY ("tenant_id","candidacy_id") REFERENCES "interview"."candidacies"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interview"."documents" ADD CONSTRAINT "documents_interview_candidacy_fkey" FOREIGN KEY ("tenant_id","interview_id","candidacy_id") REFERENCES "interview"."interviews"("tenant_id","id","candidacy_id");--> statement-breakpoint
ALTER TABLE "platform"."artifacts" ADD CONSTRAINT "artifacts_ownerless_builtin_check" CHECK ((owner_user_id IS NOT NULL AND artifact_type <> 'interview.document-template-builtin') OR (owner_user_id IS NULL AND product_id = 'omnitech.interview' AND artifact_type = 'interview.document-template-builtin'));--> statement-breakpoint
CREATE POLICY "artifact_payloads_select" ON "platform"."artifact_payloads" AS PERMISSIVE FOR SELECT TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM platform.artifacts a WHERE a.tenant_id = artifact_payloads.tenant_id AND a.id = artifact_payloads.artifact_id AND a.product_id = 'omnitech.interview' AND (a.owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR (a.artifact_type = 'interview.document-template-builtin' AND a.owner_user_id IS NULL))));--> statement-breakpoint
CREATE POLICY "artifact_payloads_insert" ON "platform"."artifact_payloads" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM platform.artifacts a WHERE a.tenant_id = artifact_payloads.tenant_id AND a.id = artifact_payloads.artifact_id AND a.product_id = 'omnitech.interview' AND (a.owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR (a.artifact_type = 'interview.document-template-builtin' AND a.owner_user_id IS NULL AND current_setting('app.document_catalog_provisioner', true) = 'on'))));--> statement-breakpoint
CREATE POLICY "document_artifacts_select" ON "platform"."artifacts" AS RESTRICTIVE FOR SELECT TO public USING ((product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export') OR owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR (artifact_type = 'interview.document-template-builtin' AND owner_user_id IS NULL)));--> statement-breakpoint
CREATE POLICY "document_artifacts_insert" ON "platform"."artifacts" AS RESTRICTIVE FOR INSERT TO public WITH CHECK ((product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export') OR (owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid AND artifact_type <> 'interview.document-template-builtin') OR (artifact_type = 'interview.document-template-builtin' AND owner_user_id IS NULL AND current_setting('app.document_catalog_provisioner', true) = 'on')));--> statement-breakpoint
CREATE POLICY "document_artifacts_update" ON "platform"."artifacts" AS RESTRICTIVE FOR UPDATE TO public USING ((product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export'))) WITH CHECK ((product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export')));--> statement-breakpoint
CREATE POLICY "document_artifacts_delete" ON "platform"."artifacts" AS RESTRICTIVE FOR DELETE TO public USING ((product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export')));--> statement-breakpoint
CREATE POLICY "document_exports_private_scope" ON "interview"."document_exports" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_revisions_private_scope" ON "interview"."document_revisions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_template_revisions_read" ON "interview"."document_template_revisions" AS PERMISSIVE FOR SELECT TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND ("interview"."document_template_revisions"."owner_user_id" IS NULL OR "interview"."document_template_revisions"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "document_template_revisions_insert" ON "interview"."document_template_revisions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."document_template_revisions"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_templates_read" ON "interview"."document_templates" AS PERMISSIVE FOR SELECT TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND ("interview"."document_templates"."owner_user_id" IS NULL OR "interview"."document_templates"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "document_templates_insert" ON "interview"."document_templates" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."document_templates"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_templates_update" ON "interview"."document_templates" AS PERMISSIVE FOR UPDATE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."document_templates"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."document_templates"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_templates_delete" ON "interview"."document_templates" AS PERMISSIVE FOR DELETE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND "interview"."document_templates"."owner_user_id" = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "documents_private_scope" ON "interview"."documents" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);
-- Payload bytes must obey actor-scoped policies even when the app role owns this table.
ALTER TABLE platform.artifact_payloads FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Interview documents carry private candidate material. FORCE also binds the
-- table owner used by the app, matching the existing Interview tables.
ALTER TABLE interview.document_templates FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.document_template_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.documents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.document_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.document_exports FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Foreign keys preserve tenant identity. These checks also preserve the
-- member/artifact relationship, which a tenant-only foreign key cannot express.
CREATE FUNCTION interview.check_document_template_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE template_owner uuid; artifact_owner uuid; artifact_product text; source_type text;
BEGIN
 SELECT owner_user_id INTO template_owner FROM interview.document_templates
 WHERE tenant_id=NEW.tenant_id AND id=NEW.template_id;
 IF NOT FOUND OR template_owner IS DISTINCT FROM NEW.owner_user_id THEN
  RAISE EXCEPTION 'Document template revision owner mismatch' USING ERRCODE='23503';
 END IF;
 SELECT a.owner_user_id, a.product_id, a.artifact_type INTO artifact_owner, artifact_product, source_type
 FROM platform.artifacts a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.source_artifact_id;
 IF NOT FOUND OR artifact_product <> 'omnitech.interview'
    OR artifact_owner IS DISTINCT FROM NEW.owner_user_id
    OR (NEW.owner_user_id IS NULL AND source_type <> 'interview.document-template-builtin')
    OR (NEW.owner_user_id IS NOT NULL AND source_type <> 'interview.document-template-source') THEN
  RAISE EXCEPTION 'Document template source artifact mismatch' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER document_template_revision_links BEFORE INSERT ON interview.document_template_revisions
 FOR EACH ROW EXECUTE FUNCTION interview.check_document_template_revision();--> statement-breakpoint

CREATE FUNCTION interview.check_document_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE template_owner uuid;
BEGIN
 SELECT owner_user_id INTO template_owner FROM interview.document_template_revisions
 WHERE tenant_id=NEW.tenant_id AND template_id=NEW.template_id AND revision=NEW.template_revision;
 IF NOT FOUND OR (template_owner IS NOT NULL AND template_owner <> NEW.owner_user_id) THEN
  RAISE EXCEPTION 'Document template belongs to another member' USING ERRCODE='23503';
 END IF;
 -- Profile scope uses legacy text keys; match the UUID context textually
 -- inside the same actor-scoped transaction instead of an invalid mixed FK.
 IF NOT EXISTS (
  SELECT 1 FROM interview.candidate_profile_revisions r
  JOIN interview.candidate_profiles p
    ON (p.tenant_id,p.actor_id,p.product_id,p.id)=(r.tenant_id,r.actor_id,r.product_id,r.id)
  WHERE r.tenant_id=NEW.tenant_id::text AND r.actor_id=NEW.owner_user_id::text
    AND r.product_id='omnitech.interview' AND r.id=NEW.profile_id
    AND r.revision=NEW.profile_revision AND p.revoked_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Document profile revision does not belong to member' USING ERRCODE='23503';
 END IF;
 IF NEW.candidacy_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM interview.candidacies c
  JOIN interview.member_people mp ON mp.tenant_id=c.tenant_id
    AND mp.person_id=c.candidate_person_id
  WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.candidacy_id
    AND mp.user_id=NEW.owner_user_id
 ) THEN
  RAISE EXCEPTION 'Document candidacy does not belong to member' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER document_links BEFORE INSERT ON interview.documents
 FOR EACH ROW EXECUTE FUNCTION interview.check_document_links();--> statement-breakpoint

CREATE FUNCTION interview.check_document_export() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_owner uuid; artifact_product text; export_type text;
BEGIN
 SELECT a.owner_user_id, a.product_id, a.artifact_type INTO artifact_owner, artifact_product, export_type
 FROM platform.artifacts a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.artifact_id;
 IF NOT FOUND OR artifact_owner IS DISTINCT FROM NEW.owner_user_id
    OR artifact_product <> 'omnitech.interview'
    OR export_type <> 'interview.document-export' THEN
  RAISE EXCEPTION 'Document export artifact mismatch' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER document_export_link BEFORE INSERT ON interview.document_exports
 FOR EACH ROW EXECUTE FUNCTION interview.check_document_export();--> statement-breakpoint

CREATE FUNCTION interview.refuse_document_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Document revisions and exports are immutable' USING ERRCODE='55000';
END $$;--> statement-breakpoint
CREATE TRIGGER document_template_revision_immutable BEFORE UPDATE OR DELETE ON interview.document_template_revisions
 FOR EACH ROW EXECUTE FUNCTION interview.refuse_document_revision_mutation();--> statement-breakpoint
CREATE TRIGGER document_revision_immutable BEFORE UPDATE OR DELETE ON interview.document_revisions
 FOR EACH ROW EXECUTE FUNCTION interview.refuse_document_revision_mutation();--> statement-breakpoint
CREATE TRIGGER document_export_immutable BEFORE UPDATE OR DELETE ON interview.document_exports
 FOR EACH ROW EXECUTE FUNCTION interview.refuse_document_revision_mutation();--> statement-breakpoint

CREATE FUNCTION interview.refuse_document_identity_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.owner_user_id,NEW.kind,NEW.format)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.owner_user_id,OLD.kind,OLD.format) THEN
  RAISE EXCEPTION 'Document template identity is immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER document_template_identity BEFORE UPDATE ON interview.document_templates
 FOR EACH ROW EXECUTE FUNCTION interview.refuse_document_identity_rewrite();--> statement-breakpoint
CREATE FUNCTION interview.refuse_document_context_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.owner_user_id,NEW.template_id,NEW.template_revision,
     NEW.profile_id,NEW.profile_revision,NEW.candidacy_id,NEW.interview_id)
    IS DISTINCT FROM
    (OLD.id,OLD.tenant_id,OLD.owner_user_id,OLD.template_id,OLD.template_revision,
     OLD.profile_id,OLD.profile_revision,OLD.candidacy_id,OLD.interview_id) THEN
  RAISE EXCEPTION 'Document source context is immutable' USING ERRCODE='55000';
 END IF;
 IF NEW.current_revision < OLD.current_revision THEN
  RAISE EXCEPTION 'Document revision cannot move backwards' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER document_context_identity BEFORE UPDATE ON interview.documents
 FOR EACH ROW EXECUTE FUNCTION interview.refuse_document_context_rewrite();
--> statement-breakpoint
-- Only the trusted catalog provisioner can create ownerless built-in templates.
CREATE POLICY "document_templates_catalog_insert" ON "interview"."document_templates" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id IS NULL AND current_setting('app.document_catalog_provisioner', true) = 'on');--> statement-breakpoint
CREATE POLICY "document_template_revisions_catalog_insert" ON "interview"."document_template_revisions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id IS NULL AND current_setting('app.document_catalog_provisioner', true) = 'on');
