CREATE TABLE "interview"."companion_capabilities" (
	"tenant_id" uuid,
	"owner_user_id" uuid,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"speech_locale" text NOT NULL,
	"speech_on_device_available" boolean NOT NULL,
	"speech_recognizer_available" boolean NOT NULL,
	"speech_authorization_status" text NOT NULL,
	"microphone" text NOT NULL,
	"screen" text NOT NULL,
	CONSTRAINT "companion_capabilities_pkey" PRIMARY KEY("tenant_id","owner_user_id"),
	CONSTRAINT "companion_capabilities_locale_check" CHECK (speech_locale ~ '^[A-Za-z0-9_-]{1,35}$'),
	CONSTRAINT "companion_capabilities_speech_auth_check" CHECK (speech_authorization_status IN ('authorized', 'denied', 'restricted', 'not-determined')),
	CONSTRAINT "companion_capabilities_microphone_check" CHECK (microphone IN ('granted', 'denied', 'not-determined')),
	CONSTRAINT "companion_capabilities_screen_check" CHECK (screen IN ('granted', 'denied', 'not-determined'))
);
--> statement-breakpoint
ALTER TABLE "interview"."companion_capabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview"."companion_capabilities" ADD CONSTRAINT "companion_capabilities_membership_fkey" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "platform"."tenant_memberships"("tenant_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "companion_capabilities_owner_select" ON "interview"."companion_capabilities" AS PERMISSIVE FOR SELECT TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "companion_capabilities_owner_insert" ON "interview"."companion_capabilities" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "companion_capabilities_owner_update" ON "interview"."companion_capabilities" AS PERMISSIVE FOR UPDATE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid);

-- The app role owns the table; FORCE binds it to the owner-scoped policies,
-- as for the other Active Session tables. The row is device capability, not
-- session content: the session purge does not touch it.
--> statement-breakpoint
ALTER TABLE interview.companion_capabilities FORCE ROW LEVEL SECURITY;
