DROP POLICY "tenant_scope" ON "presentation"."import_runs";--> statement-breakpoint
ALTER TABLE "presentation"."import_ledger" DROP CONSTRAINT "import_ledger_run_id_fkey";--> statement-breakpoint
DROP TABLE "presentation"."import_ledger";--> statement-breakpoint
DROP TABLE "presentation"."import_runs";--> statement-breakpoint
ALTER TABLE "presentation"."documents" DROP CONSTRAINT "documents_tenant_id_source_import_id_key";--> statement-breakpoint
ALTER TABLE "presentation"."generated_images" DROP CONSTRAINT "generated_images_tenant_id_source_import_id_key";--> statement-breakpoint
ALTER TABLE "presentation"."documents" DROP COLUMN "source_import_id";--> statement-breakpoint
ALTER TABLE "presentation"."generated_images" DROP COLUMN "source_import_id";