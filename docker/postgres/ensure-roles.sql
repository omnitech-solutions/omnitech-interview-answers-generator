-- Interview Studio's database roles, as one IDEMPOTENT step (ADR-0005 d4,
-- the role split). Run it as the cluster administrator, connected to the
-- application database. Running it again changes nothing.
--
--   omnitech_owner  owns the database, its schemas and every table; it runs
--                   migrations (DATABASE_OWNER_URL). Only an owner can disable
--                   row-level security, drop a policy or alter FORCE, so the
--                   app never holds this role.
--   omnitech        the runtime role (DATABASE_URL): LOGIN, USAGE and
--                   SELECT/INSERT/UPDATE/DELETE only. It owns nothing, so it
--                   cannot run DDL on the owner's schemas. It may CREATE in
--                   the database, because pg-boss creates its own `pgboss`
--                   schema at start; that schema is the only thing it owns.
--
-- Both roles are NOSUPERUSER NOBYPASSRLS. Passwords are the local-development
-- values and are set only when a role is created; an existing password is
-- never reset. Data is never touched: only ownership and privileges change.
-- Existing objects owned by the runtime role (a database created before the
-- split) are handed to the owner; the `pgboss` schema stays with the runtime.

-- Nothing an app role can create may shadow a built-in this script calls.
SET search_path = pg_catalog;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnitech_owner') THEN
    CREATE ROLE omnitech_owner LOGIN PASSWORD 'omnitech_owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnitech') THEN
    CREATE ROLE omnitech LOGIN PASSWORD 'omnitech';
  END IF;
END
$roles$;

ALTER ROLE omnitech_owner NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
ALTER ROLE omnitech NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

DO $ensure$
DECLARE
  item record;
  schema_name text;
  pre_split boolean;
BEGIN
  -- Only a database the runtime role still OWNS predates the split. Read before
  -- the database is handed over: afterwards anything the runtime creates is its
  -- own and must stay its own.
  SELECT pg_get_userbyid(datdba) = 'omnitech' INTO pre_split
    FROM pg_database WHERE datname = current_database();

  -- The database belongs to the owner; the runtime may connect and create its
  -- own schema (pg-boss), nothing more.
  EXECUTE format('ALTER DATABASE %I OWNER TO omnitech_owner', current_database());
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO omnitech', current_database());

  IF pre_split THEN
    -- Hand over what the runtime role used to own (a database created before
    -- the split), once, while the runtime still owns the database. Later runs
    -- skip it, so a schema or function a compromised app creates itself is never
    -- given to the owner (which could run it as a SECURITY DEFINER function).
    -- The `pgboss` schema stays with the runtime role.
    FOR item IN
      SELECT nspname FROM pg_namespace
      WHERE pg_get_userbyid(nspowner) = 'omnitech'
        AND nspname <> 'pgboss' AND nspname NOT LIKE 'pg\_%'
    LOOP
      EXECUTE format('ALTER SCHEMA %I OWNER TO omnitech_owner', item.nspname);
    END LOOP;
    FOR item IN
      SELECT n.nspname, c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE pg_get_userbyid(c.relowner) = 'omnitech'
        AND n.nspname NOT IN ('pgboss', 'information_schema')
        AND n.nspname NOT LIKE 'pg\_%'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    LOOP
      EXECUTE format('ALTER %s %I.%I OWNER TO omnitech_owner',
        CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
          WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
        item.nspname, item.relname);
    END LOOP;
    -- A sequence owned by a column follows its table; only free ones move here.
    FOR item IN
      SELECT n.nspname, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE pg_get_userbyid(c.relowner) = 'omnitech' AND c.relkind = 'S'
        AND n.nspname NOT IN ('pgboss', 'information_schema')
        AND n.nspname NOT LIKE 'pg\_%'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))
    LOOP
      EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO omnitech_owner', item.nspname, item.relname);
    END LOOP;
    FOR item IN
      SELECT n.nspname, p.proname, p.prokind,
             pg_get_function_identity_arguments(p.oid) AS arguments
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE pg_get_userbyid(p.proowner) = 'omnitech'
        AND p.prokind IN ('f', 'p')
        AND n.nspname NOT IN ('pgboss', 'information_schema')
        AND n.nspname NOT LIKE 'pg\_%'
    LOOP
      EXECUTE format('ALTER %s %I.%I(%s) OWNER TO omnitech_owner',
        CASE item.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
        item.nspname, item.proname, item.arguments);
    END LOOP;
    FOR item IN
      SELECT n.nspname, t.typname
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE pg_get_userbyid(t.typowner) = 'omnitech'
        AND t.typtype IN ('e', 'd')
        AND n.nspname NOT IN ('pgboss', 'information_schema')
        AND n.nspname NOT LIKE 'pg\_%'
    LOOP
      EXECUTE format('ALTER TYPE %I.%I OWNER TO omnitech_owner', item.nspname, item.typname);
    END LOOP;
  END IF;

  -- The runtime's whole authority: use every owner schema and read and write
  -- its tables and sequences. `public` and `pgboss` are not the owner's.
  FOR schema_name IN
    SELECT nspname FROM pg_namespace
    WHERE pg_get_userbyid(nspowner) = 'omnitech_owner'
      AND nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg\_%'
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO omnitech', schema_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO omnitech', schema_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO omnitech', schema_name);
  END LOOP;

  -- The migration history is read by the boot-time check and written only by
  -- the owner's migrator.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA drizzle FROM omnitech;
  END IF;
END
$ensure$;

-- Anything the owner creates later (the next migration's tables, sequences and
-- schemas) is usable by the runtime without another grant. The migration
-- history table is the one exception, trimmed back to read-only when this step
-- runs again (`pnpm dev` runs it before and after migrating).
ALTER DEFAULT PRIVILEGES FOR ROLE omnitech_owner
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omnitech;
ALTER DEFAULT PRIVILEGES FOR ROLE omnitech_owner
  GRANT USAGE, SELECT ON SEQUENCES TO omnitech;
ALTER DEFAULT PRIVILEGES FOR ROLE omnitech_owner
  GRANT USAGE ON SCHEMAS TO omnitech;
