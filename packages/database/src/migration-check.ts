import type { PlatformDatabase } from "./connection";
import { expectedMigrations } from "./migration-names";

// The boot-time pending-migration check (Rails refuses to boot with pending
// migrations; Nest's database module validates at bootstrap). Migrations are a
// separate deploy step (`pnpm db:migrate`) and never run at app start. The
// expected stream is embedded (migration-names.ts) because bundled apps cannot
// read the drizzle folder; scripts guard its freshness. Messages carry only
// migration folder names: no SQL, connection string or data.

export type MigrationStatus =
  | { state: "ok" }
  | { state: "pending"; names: readonly string[] }
  | { state: "ahead"; names: readonly string[] }
  | { state: "mismatch"; names: readonly string[] };

// The applied history must be a prefix of the expected stream. Pending is the
// unapplied tail; ahead is applied names the build does not know after the
// whole expected stream; anything else (gap, reorder, rename) is a mismatch.
export function migrationStatus(
  expected: readonly string[],
  applied: readonly string[],
): MigrationStatus {
  let shared = 0;
  while (
    shared < expected.length &&
    shared < applied.length &&
    expected[shared] === applied[shared]
  )
    shared += 1;
  const extra = applied.slice(shared);
  if (extra.length === 0)
    return shared === expected.length
      ? { state: "ok" }
      : { state: "pending", names: expected.slice(shared) };
  return shared === expected.length
    ? { state: "ahead", names: extra }
    : { state: "mismatch", names: extra };
}

const listed = (names: readonly string[]): string =>
  names.length > 5
    ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more`
    : names.join(", ");

// The fixed refusal text for a status, or undefined when it is ok.
export function migrationRefusal(status: MigrationStatus): string | undefined {
  switch (status.state) {
    case "ok":
      return undefined;
    case "pending":
      return `${status.names.length} pending migration(s) (${listed(status.names)}): run pnpm db:migrate`;
    case "ahead":
      return `database is ahead of this build: it has applied migration(s) this code does not know (${listed(status.names)}); deploy the newer build`;
    case "mismatch":
      return `applied migrations do not match this build (${listed(status.names)} unexpected): the history was reordered or renamed; run pnpm db:migrate against the right database or deploy the matching build`;
  }
}

export class MigrationMismatchError extends Error {
  constructor(readonly status: Exclude<MigrationStatus, { state: "ok" }>) {
    super(migrationRefusal(status));
    this.name = "MigrationMismatchError";
  }
}

// An absent history table (or schema) means nothing is applied.
const undefinedTable = "42P01";

/** The applied history compared with this build's expected migrations. */
export async function currentMigrationStatus(
  database: PlatformDatabase,
  expected: readonly string[] = expectedMigrations,
): Promise<MigrationStatus> {
  const applied = await database
    .query<{ name: string }>(
      "SELECT name FROM drizzle.__drizzle_migrations ORDER BY id",
    )
    .then((result) => result.rows.map((row) => row.name))
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === undefinedTable) return [];
      throw error;
    });
  return migrationStatus(expected, applied);
}

// Fails fast at process start: resolves when the database has applied exactly
// this build's migrations, rejects with a MigrationMismatchError otherwise. A
// failed lookup (database unreachable, permission) rejects with that error.
export async function verifyMigrations(
  database: PlatformDatabase,
  expected: readonly string[] = expectedMigrations,
): Promise<void> {
  const status = await currentMigrationStatus(database, expected);
  if (status.state !== "ok") throw new MigrationMismatchError(status);
}
