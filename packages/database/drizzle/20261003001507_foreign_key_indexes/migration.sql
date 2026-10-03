CREATE INDEX "briefing_links_candidacy_idx" ON "interview"."briefing_links" ("tenant_id","candidacy_id");--> statement-breakpoint
CREATE INDEX "briefing_links_interview_idx" ON "interview"."briefing_links" ("tenant_id","interview_id");--> statement-breakpoint
CREATE INDEX "candidacies_company_idx" ON "interview"."candidacies" ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "candidacies_candidate_idx" ON "interview"."candidacies" ("tenant_id","candidate_person_id");--> statement-breakpoint
CREATE INDEX "exercise_attempts_exercise_idx" ON "practice"."exercise_attempts" ("exercise_id");--> statement-breakpoint
CREATE INDEX "interview_participants_interview_idx" ON "interview"."interview_participants" ("tenant_id","interview_id");--> statement-breakpoint
CREATE INDEX "interview_participants_person_idx" ON "interview"."interview_participants" ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "interviews_candidacy_idx" ON "interview"."interviews" ("tenant_id","candidacy_id");--> statement-breakpoint
CREATE INDEX "member_people_person_idx" ON "interview"."member_people" ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "people_company_idx" ON "interview"."people" ("tenant_id","company_id");