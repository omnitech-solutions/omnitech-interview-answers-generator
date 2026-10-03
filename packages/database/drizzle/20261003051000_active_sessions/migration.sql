CREATE TABLE "interview"."active_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"retention_mode" text DEFAULT 'delete_at_end' NOT NULL,
	"processing_policy" text NOT NULL,
	"fence" bigint DEFAULT 0 NOT NULL,
	"lease_holder_id" text,
	"lease_expires_at" timestamp with time zone,
	"credential_hash" text,
	"credential_expires_at" timestamp with time zone,
	"credential_revoked_at" timestamp with time zone,
	"sources" jsonb,
	"rehearsal_run_id" text,
	"strict" boolean DEFAULT false NOT NULL,
	"interview_id" uuid,
	"candidacy_id" uuid,
	"profile_id" text,
	"profile_revision" bigint,
	"workspace_draft_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"purge_started_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"purge_outcome" text,
	"purge_counts" jsonb,
	"shown_draft_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "active_sessions_tenant_owner_id_key" UNIQUE("tenant_id","owner_user_id","id"),
	CONSTRAINT "active_sessions_status_check" CHECK (status IN ('created', 'active', 'paused', 'purging', 'ended')),
	CONSTRAINT "active_sessions_retention_check" CHECK (retention_mode IN ('delete_at_end', 'thirty_days', 'until_deleted')),
	CONSTRAINT "active_sessions_policy_check" CHECK (processing_policy IN ('device_only', 'permitted_remote')),
	CONSTRAINT "active_sessions_fence_check" CHECK (fence >= 0),
	CONSTRAINT "active_sessions_profile_pair_check" CHECK ((profile_id IS NULL) = (profile_revision IS NULL)),
	CONSTRAINT "active_sessions_profile_revision_check" CHECK (profile_revision IS NULL OR profile_revision > 0),
	CONSTRAINT "active_sessions_credential_cap_check" CHECK (credential_expires_at IS NULL OR credential_expires_at <= expires_at),
	CONSTRAINT "active_sessions_credential_pair_check" CHECK ((credential_hash IS NULL) OR (credential_expires_at IS NOT NULL)),
	CONSTRAINT "active_sessions_run_id_check" CHECK (rehearsal_run_id IS NULL OR char_length(rehearsal_run_id) BETWEEN 1 AND 128),
	CONSTRAINT "active_sessions_shown_check" CHECK (shown_draft_count >= 0),
	CONSTRAINT "active_sessions_purge_outcome_check" CHECK (purge_outcome IS NULL OR purge_outcome IN ('complete', 'partial')),
	CONSTRAINT "active_sessions_tombstone_check" CHECK (purged_at IS NULL OR (status = 'ended' AND purge_outcome IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "interview"."active_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."session_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"task_revision" integer NOT NULL,
	"action_kind" text NOT NULL,
	"dispatch_status" text DEFAULT 'in_flight' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"job_id" uuid,
	"job_created" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"fence_at_dispatch" bigint NOT NULL,
	"suppression_reason" text,
	"shown" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_actions_tenant_owner_id_key" UNIQUE("tenant_id","owner_user_id","id"),
	CONSTRAINT "session_actions_job_key" UNIQUE("tenant_id","job_id"),
	CONSTRAINT "session_actions_status_check" CHECK (dispatch_status IN ('in_flight', 'succeeded', 'failed', 'suppressed')),
	CONSTRAINT "session_actions_revision_check" CHECK (task_revision >= 0),
	CONSTRAINT "session_actions_attempt_check" CHECK (attempt >= 1),
	CONSTRAINT "session_actions_fence_check" CHECK (fence_at_dispatch >= 0),
	CONSTRAINT "session_actions_job_created_check" CHECK (NOT job_created OR job_id IS NOT NULL),
	CONSTRAINT "session_actions_result_check" CHECK ((result IS NULL OR dispatch_status = 'succeeded') AND (NOT shown OR dispatch_status = 'succeeded')),
	CONSTRAINT "session_actions_suppression_check" CHECK (dispatch_status <> 'suppressed' OR suppression_reason IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "interview"."session_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview"."session_observations" (
	"tenant_id" uuid,
	"owner_user_id" uuid,
	"session_id" uuid,
	"source_id" text,
	"event_id" text,
	"sequence" bigint NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ack" jsonb NOT NULL,
	"screenshot_artifact_id" uuid,
	CONSTRAINT "session_observations_pkey" PRIMARY KEY("tenant_id","owner_user_id","session_id","source_id","event_id"),
	CONSTRAINT "session_observations_sequence_key" UNIQUE("tenant_id","owner_user_id","session_id","sequence"),
	CONSTRAINT "session_observations_kind_check" CHECK (kind IN ('transcript.final', 'screen.snapshot', 'source.disconnected', 'capture.gap')),
	CONSTRAINT "session_observations_sequence_check" CHECK (sequence >= 0),
	CONSTRAINT "session_observations_artifact_kind_check" CHECK (screenshot_artifact_id IS NULL OR kind = 'screen.snapshot')
);
--> statement-breakpoint
ALTER TABLE "interview"."session_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "active_sessions_one_open_per_owner" ON "interview"."active_sessions" ("tenant_id","owner_user_id") WHERE status NOT IN ('ended', 'purging');--> statement-breakpoint
CREATE UNIQUE INDEX "active_sessions_credential_hash_key" ON "interview"."active_sessions" ("credential_hash") WHERE credential_hash IS NOT NULL;--> statement-breakpoint
CREATE INDEX "active_sessions_claim_idx" ON "interview"."active_sessions" ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "active_sessions_rehearsal_run_idx" ON "interview"."active_sessions" ("tenant_id","owner_user_id","rehearsal_run_id");--> statement-breakpoint
CREATE INDEX "active_sessions_candidacy_idx" ON "interview"."active_sessions" ("tenant_id","candidacy_id");--> statement-breakpoint
CREATE INDEX "active_sessions_interview_idx" ON "interview"."active_sessions" ("tenant_id","interview_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_actions_dispatch_key" ON "interview"."session_actions" ("tenant_id","owner_user_id","session_id","task_id","task_revision","action_kind") WHERE dispatch_status IN ('in_flight', 'succeeded');--> statement-breakpoint
CREATE INDEX "session_actions_session_idx" ON "interview"."session_actions" ("tenant_id","owner_user_id","session_id");--> statement-breakpoint
CREATE INDEX "session_observations_artifact_idx" ON "interview"."session_observations" ("tenant_id","screenshot_artifact_id");--> statement-breakpoint
ALTER TABLE "interview"."active_sessions" ADD CONSTRAINT "active_sessions_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id");--> statement-breakpoint
ALTER TABLE "interview"."active_sessions" ADD CONSTRAINT "active_sessions_candidacy_fkey" FOREIGN KEY ("tenant_id","candidacy_id") REFERENCES "interview"."candidacies"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "interview"."active_sessions" ADD CONSTRAINT "active_sessions_interview_candidacy_fkey" FOREIGN KEY ("tenant_id","interview_id","candidacy_id") REFERENCES "interview"."interviews"("tenant_id","id","candidacy_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "interview"."session_actions" ADD CONSTRAINT "session_actions_session_fkey" FOREIGN KEY ("tenant_id","owner_user_id","session_id") REFERENCES "interview"."active_sessions"("tenant_id","owner_user_id","id");--> statement-breakpoint
ALTER TABLE "interview"."session_observations" ADD CONSTRAINT "session_observations_session_fkey" FOREIGN KEY ("tenant_id","owner_user_id","session_id") REFERENCES "interview"."active_sessions"("tenant_id","owner_user_id","id");--> statement-breakpoint
ALTER TABLE "interview"."session_observations" ADD CONSTRAINT "session_observations_artifact_fkey" FOREIGN KEY ("tenant_id","screenshot_artifact_id") REFERENCES "platform"."artifacts"("tenant_id","id");--> statement-breakpoint
CREATE POLICY "artifact_payloads_session_delete" ON "platform"."artifact_payloads" AS PERMISSIVE FOR DELETE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.session_purge', true) = 'on' AND EXISTS (SELECT 1 FROM platform.artifacts a WHERE a.tenant_id = artifact_payloads.tenant_id AND a.id = artifact_payloads.artifact_id AND a.product_id = 'omnitech.interview' AND a.artifact_type = 'interview.session-screenshot' AND a.owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_artifacts_select" ON "platform"."artifacts" AS RESTRICTIVE FOR SELECT TO public USING ((product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot' OR owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_artifacts_insert" ON "platform"."artifacts" AS RESTRICTIVE FOR INSERT TO public WITH CHECK ((product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot' OR owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_artifacts_update" ON "platform"."artifacts" AS RESTRICTIVE FOR UPDATE TO public USING ((product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot')) WITH CHECK ((product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot'));--> statement-breakpoint
CREATE POLICY "session_artifacts_delete" ON "platform"."artifacts" AS RESTRICTIVE FOR DELETE TO public USING ((product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot' OR (owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid AND current_setting('app.session_purge', true) = 'on')));--> statement-breakpoint
CREATE POLICY "active_sessions_owner_select" ON "interview"."active_sessions" AS PERMISSIVE FOR SELECT TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "active_sessions_owner_insert" ON "interview"."active_sessions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "active_sessions_owner_update" ON "interview"."active_sessions" AS PERMISSIVE FOR UPDATE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "active_sessions_owner_delete" ON "interview"."active_sessions" AS PERMISSIVE FOR DELETE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid AND current_setting('app.session_purge', true) = 'on');--> statement-breakpoint
CREATE POLICY "active_sessions_claim_select" ON "interview"."active_sessions" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.session_worker', true) = 'on');--> statement-breakpoint
CREATE POLICY "active_sessions_claim_update" ON "interview"."active_sessions" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.session_worker', true) = 'on') WITH CHECK (current_setting('app.session_worker', true) = 'on');--> statement-breakpoint
CREATE POLICY "active_sessions_credential_lookup" ON "interview"."active_sessions" AS PERMISSIVE FOR SELECT TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND credential_hash IS NOT NULL AND credential_hash = nullif(current_setting('app.session_credential_hash', true), '') AND credential_revoked_at IS NULL AND credential_expires_at > now());--> statement-breakpoint
CREATE POLICY "session_actions_owner_select" ON "interview"."session_actions" AS PERMISSIVE FOR SELECT TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "session_actions_owner_insert" ON "interview"."session_actions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "session_actions_owner_update" ON "interview"."session_actions" AS PERMISSIVE FOR UPDATE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "session_actions_owner_delete" ON "interview"."session_actions" AS PERMISSIVE FOR DELETE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid AND current_setting('app.session_purge', true) = 'on');--> statement-breakpoint
CREATE POLICY "session_observations_owner_select" ON "interview"."session_observations" AS PERMISSIVE FOR SELECT TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "session_observations_owner_insert" ON "interview"."session_observations" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "session_observations_owner_delete" ON "interview"."session_observations" AS PERMISSIVE FOR DELETE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid AND current_setting('app.session_purge', true) = 'on');--> statement-breakpoint

-- Active Session persistence (ADR-0011, ADR-0012). Everything below is
-- hand-appended, as in the Documents migration: forced row security, the
-- claim projection, and the triggers that refuse what a policy cannot express.

-- The app role owns these tables; FORCE binds it to the owner-scoped policies
-- (rule:actor-private-session-rows).
ALTER TABLE interview.active_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.session_observations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.session_actions FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- The claim projection (rule:session-claim-setting): the worker's cross-tenant
-- port selects from this view, so tenant, owner, status, lease and fence are
-- all it can see. It omits credential_hash, the sources snapshot, the links
-- and the rehearsal fields. security_invoker keeps row security in force: the
-- view shows rows only under the app.session_worker policy (or the caller's own
-- owner scope).
CREATE VIEW interview.active_session_claims WITH (security_invoker = true) AS
 SELECT id, tenant_id, owner_user_id, status, processing_policy, retention_mode,
        fence, lease_holder_id, lease_expires_at, expires_at, last_heartbeat_at,
        credential_expires_at, credential_revoked_at, ended_at,
        purge_started_at, purged_at
 FROM interview.active_sessions;--> statement-breakpoint

-- (e) A tombstone accepts no writes other than purge state
-- (rule:tombstone-keeps-hint-count). It keeps owner, rehearsal run id, strict
-- flag and the shown-draft count.
CREATE FUNCTION interview.guard_session_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.purged_at IS NOT NULL THEN
  IF NEW.purged_at IS NULL
     OR (to_jsonb(NEW) - 'purge_started_at' - 'purged_at' - 'purge_outcome' - 'purge_counts')
        IS DISTINCT FROM
        (to_jsonb(OLD) - 'purge_started_at' - 'purged_at' - 'purge_outcome' - 'purge_counts') THEN
   RAISE EXCEPTION 'A purged session accepts only purge state' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER active_sessions_a_tombstone BEFORE UPDATE ON interview.active_sessions
 FOR EACH ROW EXECUTE FUNCTION interview.guard_session_tombstone();--> statement-breakpoint

-- (f) Under the claim setting only lease and fence columns change
-- (rule:claim-writes-lease-and-fence-only). The restriction holds whether or
-- not an actor context is also set, so the setting never widens a write.
CREATE FUNCTION interview.guard_session_claim_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('app.session_worker', true) = 'on'
    AND (to_jsonb(NEW) - 'fence' - 'lease_holder_id' - 'lease_expires_at')
        IS DISTINCT FROM
        (to_jsonb(OLD) - 'fence' - 'lease_holder_id' - 'lease_expires_at') THEN
  RAISE EXCEPTION 'The session claim changes only lease and fence' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER active_sessions_b_claim_columns BEFORE UPDATE ON interview.active_sessions
 FOR EACH ROW EXECUTE FUNCTION interview.guard_session_claim_columns();--> statement-breakpoint

-- (a) Immutable privacy columns (rule:immutable-privacy-columns): identity,
-- rehearsal run id, strict flag and creation fields never change; links and
-- the sources snapshot never change either, except to NULL while purging, and
-- the credential hash may then only be cleared.
CREATE FUNCTION interview.guard_session_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id, NEW.tenant_id, NEW.owner_user_id, NEW.rehearsal_run_id, NEW."strict",
     NEW.created_at, NEW.expires_at)
    IS DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.owner_user_id, OLD.rehearsal_run_id, OLD."strict",
     OLD.created_at, OLD.expires_at) THEN
  RAISE EXCEPTION 'Session identity, rehearsal link and creation fields are immutable' USING ERRCODE='55000';
 END IF;
 IF (NEW.interview_id, NEW.candidacy_id, NEW.profile_id, NEW.profile_revision,
     NEW.workspace_draft_id, NEW.sources)
    IS DISTINCT FROM
    (OLD.interview_id, OLD.candidacy_id, OLD.profile_id, OLD.profile_revision,
     OLD.workspace_draft_id, OLD.sources) THEN
  IF OLD.status <> 'purging' THEN
   RAISE EXCEPTION 'Session links and sources are set at start and never change' USING ERRCODE='55000';
  END IF;
  IF (NEW.interview_id IS NOT NULL AND NEW.interview_id IS DISTINCT FROM OLD.interview_id)
     OR (NEW.candidacy_id IS NOT NULL AND NEW.candidacy_id IS DISTINCT FROM OLD.candidacy_id)
     OR (NEW.profile_id IS NOT NULL AND NEW.profile_id IS DISTINCT FROM OLD.profile_id)
     OR (NEW.profile_revision IS NOT NULL AND NEW.profile_revision IS DISTINCT FROM OLD.profile_revision)
     OR (NEW.workspace_draft_id IS NOT NULL AND NEW.workspace_draft_id IS DISTINCT FROM OLD.workspace_draft_id)
     OR (NEW.sources IS NOT NULL AND NEW.sources IS DISTINCT FROM OLD.sources) THEN
   RAISE EXCEPTION 'A purging session may only clear its links and sources' USING ERRCODE='55000';
  END IF;
 END IF;
 IF OLD.status = 'purging' AND NEW.credential_hash IS NOT NULL
    AND NEW.credential_hash IS DISTINCT FROM OLD.credential_hash THEN
  RAISE EXCEPTION 'A purging session may only clear its credential' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER active_sessions_c_immutable BEFORE UPDATE ON interview.active_sessions
 FOR EACH ROW EXECUTE FUNCTION interview.guard_session_immutable();--> statement-breakpoint

-- (b) Monotonic privacy columns (rule:monotonic-privacy-columns): the policy
-- never loosens, retention never lengthens. The fence never falls, and the
-- status follows the lifecycle (an ended or purging session is never revived).
CREATE FUNCTION interview.guard_session_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_rank integer; new_rank integer;
BEGIN
 IF OLD.processing_policy = 'device_only' AND NEW.processing_policy <> 'device_only' THEN
  RAISE EXCEPTION 'A device-only session never loosens its processing policy' USING ERRCODE='55000';
 END IF;
 old_rank := CASE OLD.retention_mode WHEN 'delete_at_end' THEN 0 WHEN 'thirty_days' THEN 1 ELSE 2 END;
 new_rank := CASE NEW.retention_mode WHEN 'delete_at_end' THEN 0 WHEN 'thirty_days' THEN 1 ELSE 2 END;
 IF new_rank > old_rank THEN
  RAISE EXCEPTION 'A session never lengthens its retention' USING ERRCODE='55000';
 END IF;
 IF NEW.fence < OLD.fence THEN
  RAISE EXCEPTION 'A session fence never falls' USING ERRCODE='55000';
 END IF;
 IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'created' AND NEW.status IN ('active', 'ended', 'purging'))
    OR (OLD.status = 'active' AND NEW.status IN ('paused', 'ended', 'purging'))
    OR (OLD.status = 'paused' AND NEW.status IN ('active', 'ended', 'purging'))
    OR (OLD.status = 'ended' AND NEW.status = 'purging')
    OR (OLD.status = 'purging' AND NEW.status = 'ended')) THEN
  RAISE EXCEPTION 'Session status % cannot become %', OLD.status, NEW.status USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER active_sessions_d_monotonic BEFORE UPDATE ON interview.active_sessions
 FOR EACH ROW EXECUTE FUNCTION interview.guard_session_monotonic();--> statement-breakpoint

-- (c) Linked-resource authorization (rule:linked-resource-authorization). The
-- composite foreign keys keep every link inside the tenant; this check adds
-- the owner. A candidacy qualifies through the actor's own person record
-- (member_people, as ADR-0009 documents do), an interview only through that
-- candidacy, and a profile revision by its actor_id. The draft is a text key
-- the repository checks in the same transaction. A session starts clean.
CREATE FUNCTION interview.check_session_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status NOT IN ('created', 'active') OR NEW.fence <> 0
    OR NEW.lease_holder_id IS NOT NULL OR NEW.lease_expires_at IS NOT NULL
    OR NEW.ended_at IS NOT NULL OR NEW.purge_started_at IS NOT NULL
    OR NEW.purged_at IS NOT NULL OR NEW.purge_outcome IS NOT NULL
    OR NEW.purge_counts IS NOT NULL OR NEW.shown_draft_count <> 0 THEN
  RAISE EXCEPTION 'A session starts with a clean lease and no purge state' USING ERRCODE='55000';
 END IF;
 IF NEW.interview_id IS NOT NULL AND NEW.candidacy_id IS NULL THEN
  RAISE EXCEPTION 'A session interview is linked only through its candidacy' USING ERRCODE='23503';
 END IF;
 IF NEW.candidacy_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM interview.candidacies c
  JOIN interview.member_people mp ON mp.tenant_id = c.tenant_id
    AND mp.person_id = c.candidate_person_id
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidacy_id
    AND mp.user_id = NEW.owner_user_id
 ) THEN
  RAISE EXCEPTION 'Session candidacy does not belong to its owner' USING ERRCODE='23503';
 END IF;
 IF NEW.profile_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM interview.candidate_profile_revisions r
  JOIN interview.candidate_profiles p
    ON (p.tenant_id, p.actor_id, p.product_id, p.id) = (r.tenant_id, r.actor_id, r.product_id, r.id)
  WHERE r.tenant_id = NEW.tenant_id::text AND r.actor_id = NEW.owner_user_id::text
    AND r.product_id = 'omnitech.interview' AND r.id = NEW.profile_id
    AND r.revision = NEW.profile_revision AND p.revoked_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Session profile revision does not belong to its owner' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER active_sessions_links BEFORE INSERT ON interview.active_sessions
 FOR EACH ROW EXECUTE FUNCTION interview.check_session_insert();--> statement-breakpoint

-- Deleting a profile revision is refused while a session that is not a
-- tombstone pins it. A tombstone has cleared its links. Candidacies and
-- interviews are protected by their ON DELETE RESTRICT composite keys.
CREATE FUNCTION interview.refuse_pinned_profile_revision_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM interview.active_sessions s
  WHERE s.tenant_id::text = OLD.tenant_id AND s.owner_user_id::text = OLD.actor_id
    AND s.profile_id = OLD.id AND s.profile_revision = OLD.revision
 ) THEN
  RAISE EXCEPTION 'The profile revision is pinned by an Active Session' USING ERRCODE='23503';
 END IF;
 RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER candidate_profile_revisions_session_pin BEFORE DELETE ON interview.candidate_profile_revisions
 FOR EACH ROW EXECUTE FUNCTION interview.refuse_pinned_profile_revision_delete();--> statement-breakpoint

-- (d) No content after purging (rule:no-content-after-purging). The session row
-- is read FOR SHARE so a concurrent flip to purging waits for this insert, and
-- an insert that follows the flip sees it.
CREATE FUNCTION interview.check_session_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_status text; artifact_owner uuid; artifact_product text; artifact_type text; artifact_session text;
BEGIN
 SELECT s.status INTO session_status FROM interview.active_sessions s
 WHERE s.tenant_id = NEW.tenant_id AND s.owner_user_id = NEW.owner_user_id AND s.id = NEW.session_id
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Observation names no session of its owner' USING ERRCODE='23503';
 END IF;
 IF session_status IN ('ended', 'purging') THEN
  RAISE EXCEPTION 'A session that is % accepts no new observations', session_status USING ERRCODE='55000';
 END IF;
 IF NEW.screenshot_artifact_id IS NOT NULL THEN
  SELECT a.owner_user_id, a.product_id, a.artifact_type, a.metadata->>'session_id'
  INTO artifact_owner, artifact_product, artifact_type, artifact_session
  FROM platform.artifacts a
  WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.screenshot_artifact_id;
  IF NOT FOUND OR artifact_owner IS DISTINCT FROM NEW.owner_user_id
     OR artifact_product <> 'omnitech.interview'
     OR artifact_type <> 'interview.session-screenshot'
     OR artifact_session IS DISTINCT FROM NEW.session_id::text THEN
   RAISE EXCEPTION 'Observation screenshot artifact mismatch' USING ERRCODE='23503';
  END IF;
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER session_observations_open BEFORE INSERT ON interview.session_observations
 FOR EACH ROW EXECUTE FUNCTION interview.check_session_observation();--> statement-breakpoint

-- Observations are append-only: dedup returns the stored acknowledgement.
CREATE FUNCTION interview.refuse_observation_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Session observations are append-only' USING ERRCODE='55000';
END $$;--> statement-breakpoint
CREATE TRIGGER session_observations_append_only BEFORE UPDATE ON interview.session_observations
 FOR EACH ROW EXECUTE FUNCTION interview.refuse_observation_update();--> statement-breakpoint

-- (d) An action that publishes (a result, a shown draft, a succeeded or newly
-- in-flight dispatch) is refused once the session is ended or purging; nothing
-- at all is inserted after the purging mark. A paused session may still record
-- outcome and suppression rows.
CREATE FUNCTION interview.check_session_action_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_status text; session_purged timestamptz; publishes boolean;
BEGIN
 SELECT s.status, s.purged_at INTO session_status, session_purged FROM interview.active_sessions s
 WHERE s.tenant_id = NEW.tenant_id AND s.owner_user_id = NEW.owner_user_id AND s.id = NEW.session_id
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Action names no session of its owner' USING ERRCODE='23503';
 END IF;
 IF TG_OP = 'INSERT' THEN
  IF session_status = 'purging' OR session_purged IS NOT NULL THEN
   RAISE EXCEPTION 'A purging session accepts no new actions' USING ERRCODE='55000';
  END IF;
  publishes := NEW.result IS NOT NULL OR NEW.shown
    OR NEW.dispatch_status IN ('succeeded', 'in_flight');
 ELSE
  publishes := (NEW.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result)
    OR (NEW.shown AND NOT OLD.shown)
    OR (NEW.dispatch_status = 'succeeded' AND OLD.dispatch_status <> 'succeeded');
 END IF;
 IF publishes AND session_status IN ('ended', 'purging') THEN
  RAISE EXCEPTION 'A session that is % accepts no published results', session_status USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER session_actions_open BEFORE INSERT OR UPDATE ON interview.session_actions
 FOR EACH ROW EXECUTE FUNCTION interview.check_session_action_open();--> statement-breakpoint

-- (c) The job id is generated and committed with the action before the job
-- exists (rule:action-before-job), so a reservation names no row yet. A job
-- that does exist under the id must be this owner's private Interview job in
-- this tenant, and job_created may become true only for such a job. A foreign
-- job's id cannot be taken over later: ai.agent_jobs.id is globally unique,
-- so creating a job under it fails.
CREATE FUNCTION interview.check_session_action_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job_user uuid; job_product text; job_private boolean; job_found boolean;
BEGIN
 IF NEW.job_id IS NULL THEN
  RETURN NEW;
 END IF;
 SELECT j.user_id, j.product_id, j.private INTO job_user, job_product, job_private
 FROM ai.agent_jobs j WHERE j.tenant_id = NEW.tenant_id AND j.id = NEW.job_id;
 job_found := FOUND;
 IF job_found AND (job_user <> NEW.owner_user_id OR job_product <> 'omnitech.interview' OR NOT job_private) THEN
  RAISE EXCEPTION 'Action job does not belong to the session owner' USING ERRCODE='23503';
 END IF;
 IF NEW.job_created AND NOT job_found THEN
  RAISE EXCEPTION 'Action job does not exist for the session owner' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER session_actions_job_link BEFORE INSERT OR UPDATE ON interview.session_actions
 FOR EACH ROW EXECUTE FUNCTION interview.check_session_action_job();--> statement-breakpoint

-- An action keeps its identity and job link; a terminal dispatch status is
-- final; a shown draft stays shown (the hint count never falls back).
CREATE FUNCTION interview.guard_session_action_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id, NEW.tenant_id, NEW.owner_user_id, NEW.session_id, NEW.task_id,
     NEW.task_revision, NEW.action_kind, NEW.attempt, NEW.fence_at_dispatch, NEW.created_at)
    IS DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.owner_user_id, OLD.session_id, OLD.task_id,
     OLD.task_revision, OLD.action_kind, OLD.attempt, OLD.fence_at_dispatch, OLD.created_at) THEN
  RAISE EXCEPTION 'Session action identity is immutable' USING ERRCODE='55000';
 END IF;
 IF NEW.job_id IS DISTINCT FROM OLD.job_id OR (OLD.job_created AND NOT NEW.job_created) THEN
  RAISE EXCEPTION 'The session action job link is immutable' USING ERRCODE='55000';
 END IF;
 IF OLD.dispatch_status <> 'in_flight' AND NEW.dispatch_status <> OLD.dispatch_status THEN
  RAISE EXCEPTION 'A terminal dispatch status is final' USING ERRCODE='55000';
 END IF;
 IF OLD.shown AND NOT NEW.shown THEN
  RAISE EXCEPTION 'A shown draft stays shown' USING ERRCODE='55000';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER session_actions_identity BEFORE UPDATE ON interview.session_actions
 FOR EACH ROW EXECUTE FUNCTION interview.guard_session_action_identity();--> statement-breakpoint

-- (d) Screenshot artifacts: a session artifact names its session in
-- metadata.session_id, which must be the owner's own, and not ended or
-- purging (rule:no-content-after-purging). The payload insert repeats the check.
CREATE FUNCTION interview.assert_session_artifact_open(p_tenant uuid, p_owner uuid, session_ref text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE session_uuid uuid; session_status text;
BEGIN
 BEGIN
  session_uuid := session_ref::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  session_uuid := NULL;
 END;
 SELECT s.status INTO session_status FROM interview.active_sessions s
 WHERE s.tenant_id = p_tenant AND s.owner_user_id = p_owner AND s.id = session_uuid
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Session artifact names no session of its owner' USING ERRCODE='23503';
 END IF;
 IF session_status IN ('ended', 'purging') THEN
  RAISE EXCEPTION 'A session that is % accepts no screenshots', session_status USING ERRCODE='55000';
 END IF;
END $$;--> statement-breakpoint
CREATE FUNCTION interview.check_session_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.artifact_type <> 'interview.session-screenshot' THEN
  RETURN NEW;
 END IF;
 IF NEW.product_id <> 'omnitech.interview' OR NEW.owner_user_id IS NULL THEN
  RAISE EXCEPTION 'A session screenshot is an owned Interview artifact' USING ERRCODE='23503';
 END IF;
 PERFORM interview.assert_session_artifact_open(NEW.tenant_id, NEW.owner_user_id, NEW.metadata->>'session_id');
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER session_artifact_open BEFORE INSERT ON platform.artifacts
 FOR EACH ROW EXECUTE FUNCTION interview.check_session_artifact();--> statement-breakpoint
CREATE FUNCTION interview.check_session_artifact_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_type text; parent_owner uuid; parent_session text;
BEGIN
 SELECT a.artifact_type, a.owner_user_id, a.metadata->>'session_id'
 INTO parent_type, parent_owner, parent_session
 FROM platform.artifacts a WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.artifact_id;
 IF FOUND AND parent_type = 'interview.session-screenshot' THEN
  PERFORM interview.assert_session_artifact_open(NEW.tenant_id, parent_owner, parent_session);
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER session_artifact_payload_open BEFORE INSERT ON platform.artifact_payloads
 FOR EACH ROW EXECUTE FUNCTION interview.check_session_artifact_payload();
