import { defineConfig } from "drizzle-kit";

// One migration stream for the whole database. Schemas stay owned by their
// packages; this file only names them (tooling configuration, not an import).
export default defineConfig({
  dialect: "postgresql",
  schema: [
    "../platform-storage/src/schema/platform.ts",
    "../../products/interview/src/backend/db/legacy.ts",
    "../../products/interview/src/backend/db/schema.ts",
  ],
  out: "./drizzle",
  schemaFilter: ["platform", "interview", "practice"],
  migrations: { schema: "drizzle", table: "__drizzle_migrations" },
  dbCredentials: {
    url:
      process.env["DATABASE_URL"] ??
      "postgresql://omnitech:omnitech@127.0.0.1:5432/omnitech",
  },
});
