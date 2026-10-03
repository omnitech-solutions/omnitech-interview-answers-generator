ALTER TABLE "interview"."active_sessions" ADD COLUMN "processed_through" bigint;
--> statement-breakpoint
-- An action's source segment ids are set at insert and never change, like the
-- rest of its identity.
CREATE OR REPLACE FUNCTION interview.guard_session_action_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id, NEW.tenant_id, NEW.owner_user_id, NEW.session_id, NEW.task_id,
     NEW.task_revision, NEW.action_kind, NEW.attempt, NEW.fence_at_dispatch, NEW.created_at,
     NEW.source_event_ids)
    IS DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.owner_user_id, OLD.session_id, OLD.task_id,
     OLD.task_revision, OLD.action_kind, OLD.attempt, OLD.fence_at_dispatch, OLD.created_at,
     OLD.source_event_ids) THEN
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
END $$;
