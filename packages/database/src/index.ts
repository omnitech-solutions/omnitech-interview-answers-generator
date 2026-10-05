export {
  createPlatformDatabase,
  type DatabaseClient,
  enterTenant,
  getPlatformDatabase,
  type PlatformDatabase,
  type PlatformDatabaseOptions,
  roleBypassesRowLevelSecurityMessage,
  verifyDatabaseRole,
} from "./connection.js";
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
export {
  type TenantContext,
  type TenantDatabase,
  withTenant,
} from "./with-tenant.js";
