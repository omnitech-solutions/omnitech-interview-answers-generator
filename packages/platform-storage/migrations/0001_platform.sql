CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS interview;

DO $$ BEGIN
  CREATE TYPE platform.tenant_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE platform.theme_preference AS ENUM ('system', 'light', 'dark');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS platform.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.login_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'linkedin')),
  provider_account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS platform.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  role platform.tenant_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES platform.users(id) ON DELETE CASCADE,
  theme platform.theme_preference NOT NULL DEFAULT 'system',
  locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.product_installations (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  configuration jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_id)
);

CREATE TABLE IF NOT EXISTS platform.connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'linkedin')),
  provider_account_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('connected', 'expired', 'revoked')),
  scopes text[] NOT NULL DEFAULT '{}',
  access_token_ciphertext jsonb NOT NULL,
  refresh_token_ciphertext jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS platform.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES platform.users(id),
  product_id text NOT NULL,
  artifact_type text NOT NULL,
  title text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  payload_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artifacts_tenant_product_updated_idx
  ON platform.artifacts (tenant_id, product_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS platform.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES platform.users(id),
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_tenant_created_idx
  ON platform.audit_events (tenant_id, created_at DESC);

ALTER TABLE platform.product_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_product_installations ON platform.product_installations;
CREATE POLICY tenant_product_installations ON platform.product_installations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_artifacts ON platform.artifacts;
CREATE POLICY tenant_artifacts ON platform.artifacts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_audit_events ON platform.audit_events;
CREATE POLICY tenant_audit_events ON platform.audit_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
