export {
  createPlatformDatabase,
  type DatabaseClient,
  enterTenant,
  getPlatformDatabase,
  type PlatformDatabase,
  type PlatformDatabaseOptions,
  roleBypassesRowLevelSecurityMessage,
  verifyDatabaseRole,
} from "./connection";
export {
  actorPredicate,
  type PlatformTables,
  tenantColumns,
  tenantPolicy,
  tenantPredicate,
  tenantReference,
  tenantUnique,
  timestamps,
} from "./conventions";
export {
  currentMigrationStatus,
  MigrationMismatchError,
  type MigrationStatus,
  migrationRefusal,
  migrationStatus,
  verifyMigrations,
} from "./migration-check";
export {
  type TenantContext,
  type TenantDatabase,
  withTenant,
} from "./with-tenant";
