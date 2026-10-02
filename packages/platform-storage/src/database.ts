// Connectivity moved to @omnitech/database; existing imports keep working.
export {
  createPlatformDatabase,
  type DatabaseClient,
  getPlatformDatabase,
  migrateDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
export type { PoolClient } from "pg";
