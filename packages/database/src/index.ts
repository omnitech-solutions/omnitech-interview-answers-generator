export {
  createPlatformDatabase,
  type DatabaseClient,
  getPlatformDatabase,
  migrateDatabase,
  type PlatformDatabase,
} from "./connection.js";
export {
  type TenantContext,
  type TenantDatabase,
  withTenant,
} from "./with-tenant.js";
export {
  actorPredicate,
  type PlatformTables,
  tenantColumns,
  tenantPolicy,
  tenantPredicate,
  tenantReference,
  tenantUnique,
  timestamps,
} from "./conventions.js";
