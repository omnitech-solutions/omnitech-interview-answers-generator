import { defineConfig } from "drizzle-kit";

// One migration stream for the whole database. Schemas stay owned by their
// packages; this file only names them (tooling configuration, not an import).
export default defineConfig({
  dialect: "postgresql",
  schema: [
    "../platform-storage/src/schema/index.ts",
    "../../products/presentation/src/backend/db/schema.ts",
    "../../products/interview/src/backend/db/studio.ts",
    "../../products/interview/src/backend/db/schema.ts",
    "../../products/interview/src/backend/db/documents.ts",
    "../../products/interview/src/backend/db/live-session.ts",
  ],
  out: "./drizzle",
  schemaFilter: ["platform", "ai", "presentation", "interview", "practice"],
  migrations: { schema: "drizzle", table: "__drizzle_migrations" },
  dbCredentials: {
    url:
      process.env["DATABASE_URL"] ??
      "postgresql://omnitech:omnitech@127.0.0.1:54320/omnitech",
  },
});
