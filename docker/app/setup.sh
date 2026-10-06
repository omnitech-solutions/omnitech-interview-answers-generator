#!/bin/sh
# One-shot database setup for the Docker stack. It is the same sequence `pnpm dev`
# runs on the host (scripts/dev.mjs): roles, migrations as the owner, roles again
# (grants for new tables), then the local tenant and owner. Every step is
# idempotent, so running it on an existing database changes nothing and never
# touches data.
set -eu

ensure_roles() {
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -q \
    -f /app/docker/postgres/ensure-roles.sql
}

ensure_roles
# Only the migration receives the owner; the app services never see this URL.
DATABASE_OWNER_URL="$OWNER_DATABASE_URL" pnpm --filter @omnitech/database db:migrate
ensure_roles
pnpm --filter @omnitech/platform-storage db:bootstrap
echo "setup: database ready"
