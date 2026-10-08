ALTER TABLE "interview"."candidacies" ADD COLUMN "employer_brief" jsonb;--> statement-breakpoint
ALTER TABLE "interview"."candidacies" ADD COLUMN "employer_brief_sha256" text;