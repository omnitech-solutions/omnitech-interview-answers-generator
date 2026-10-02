import { assistantMigrations } from "@omnitech-assistant/storage-postgres";

const own = (file: string) => new URL(`../migrations/${file}`, import.meta.url);

// The idempotent SQL that predates Drizzle, in the order it has always run.
export function legacyMigrations(): readonly URL[] {
  return [
    ...[
      "0001_platform.sql",
      "0002_ai_presentation.sql",
      "0003_ai_profile_preference.sql",
    ].map(own),
    ...assistantMigrations,
    ...[
      "0004_assistant_interview.sql",
      "0005_assistant_provenance.sql",
      "0006_interview_briefings.sql",
      "0007_assistant_reverts.sql",
      "0008_interview_plans.sql",
      "0009_concept_briefs.sql",
      "0010_rehearsal_sessions.sql",
      "0011_assistant_run_worker.sql",
    ].map(own),
  ];
}
