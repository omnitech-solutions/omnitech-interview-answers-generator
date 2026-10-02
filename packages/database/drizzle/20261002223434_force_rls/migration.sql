-- Forced row-level security binds the table owner too. Reviewed by hand,
-- never generated: one ENABLE + FORCE pair per new table.
ALTER TABLE "interview"."companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."companies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."people" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."member_people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."member_people" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."candidacies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."candidacies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."interviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."interviews" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."interview_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."interview_participants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."briefing_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."briefing_links" FORCE ROW LEVEL SECURITY;
ALTER TABLE "practice"."exercises" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice"."exercises" FORCE ROW LEVEL SECURITY;
ALTER TABLE "practice"."exercise_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice"."exercise_attempts" FORCE ROW LEVEL SECURITY;
