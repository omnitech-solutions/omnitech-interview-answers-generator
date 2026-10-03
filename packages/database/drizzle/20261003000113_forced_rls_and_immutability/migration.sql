-- Row-level security binds the tables' owner too, so a connection that owns
-- them still sees only its tenant's rows.
ALTER TABLE interview.assistant_answer_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.assistant_drafts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.assistant_effect_receipts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.assistant_evidence FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.assistant_reverts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.briefing_links FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.briefing_proposals FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.candidacies FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.candidate_profile_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.candidate_profiles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.companies FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.concept_briefs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.interview_participants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.interview_plan_items FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.interview_plans FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.interviews FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.member_people FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.people FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE interview.rehearsal_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE practice.exercise_attempts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE practice.exercises FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Recorded answers, evidence and briefing revisions never change once written.
CREATE FUNCTION interview.refuse_assistant_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Assistant answer and evidence revisions are immutable' USING ERRCODE='55000'; END $$;--> statement-breakpoint
CREATE TRIGGER assistant_immutable BEFORE DELETE OR UPDATE ON interview.assistant_answer_revisions
  FOR EACH ROW EXECUTE FUNCTION interview.refuse_assistant_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER assistant_immutable BEFORE DELETE OR UPDATE ON interview.assistant_evidence
  FOR EACH ROW EXECUTE FUNCTION interview.refuse_assistant_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER briefing_immutable BEFORE DELETE OR UPDATE ON interview.briefing_proposals
  FOR EACH ROW EXECUTE FUNCTION interview.refuse_assistant_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER briefing_immutable BEFORE DELETE OR UPDATE ON interview.candidate_profile_revisions
  FOR EACH ROW EXECUTE FUNCTION interview.refuse_assistant_immutable_mutation();--> statement-breakpoint

-- An effect receipt may only move out of 'started'; its identity and payload
-- never change, and a finished receipt is never rewritten or deleted.
CREATE FUNCTION interview.refuse_assistant_effect_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state<>'started' THEN
  RAISE EXCEPTION 'Completed or interrupted assistant effect receipts are immutable' USING ERRCODE='55000';
 END IF;
 IF (NEW.tenant_id,NEW.actor_id,NEW.product_id,NEW.operation,NEW.request_id,NEW.id,NEW.fingerprint,NEW.payload)
 IS DISTINCT FROM (OLD.tenant_id,OLD.actor_id,OLD.product_id,OLD.operation,OLD.request_id,OLD.id,OLD.fingerprint,OLD.payload) THEN
  RAISE EXCEPTION 'Assistant effect identity and payload are immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER assistant_effect_immutable BEFORE DELETE OR UPDATE ON interview.assistant_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION interview.refuse_assistant_effect_rewrite();
