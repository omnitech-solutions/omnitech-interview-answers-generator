CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS presentation;

ALTER TABLE platform.users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'disabled'));

CREATE TABLE IF NOT EXISTS ai.provider_configurations (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  adapter_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  secret_reference text,
  configuration jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai.model_definitions (
  id text PRIMARY KEY,
  provider_configuration_id text NOT NULL
    REFERENCES ai.provider_configurations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  provider_model_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('language', 'embedding', 'image', 'multimodal')),
  capabilities text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai.profiles (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  execution_family text NOT NULL
    CHECK (execution_family IN ('direct-model', 'workflow', 'agent-runtime')),
  target_id text NOT NULL,
  configuration jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai.tenant_policies (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES ai.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  secret_reference text,
  usage_limits jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, profile_id)
);

CREATE TABLE IF NOT EXISTS ai.usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform.users(id),
  product_id text NOT NULL,
  profile_id text NOT NULL,
  execution_family text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(14, 6),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai.agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform.users(id),
  product_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'queued', 'claimed', 'starting', 'running', 'awaiting-input',
      'cancelling', 'succeeded', 'failed', 'cancelled', 'timed-out'
    )
  ),
  profile_snapshot jsonb NOT NULL,
  prompt_reference text NOT NULL,
  result_reference text,
  session_id text,
  claimed_by text,
  lease_expires_at timestamptz,
  next_event_sequence integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_jobs_claim_idx
  ON ai.agent_jobs (status, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS ai.agent_job_events (
  job_id uuid NOT NULL REFERENCES ai.agent_jobs(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, sequence)
);

CREATE TABLE IF NOT EXISTS ai.agent_job_payloads (
  reference text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  ciphertext jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ai.agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform.users(id),
  runtime text NOT NULL CHECK (runtime IN ('codex', 'claude-code')),
  runtime_session_id text NOT NULL,
  profile_snapshot jsonb NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (runtime, runtime_session_id)
);

CREATE TABLE IF NOT EXISTS ai.agent_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES ai.agent_jobs(id) ON DELETE CASCADE,
  artifact_reference text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai.workflow_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  subject_id text NOT NULL,
  engine text NOT NULL,
  engine_thread_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, subject_id, engine)
);

CREATE TABLE IF NOT EXISTS presentation.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES platform.users(id),
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'presentation',
  content jsonb NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1,
  source_import_id text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_import_id)
);

CREATE TABLE IF NOT EXISTS presentation.presentations (
  document_id uuid PRIMARY KEY
    REFERENCES presentation.documents(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  outline jsonb NOT NULL DEFAULT '[]',
  theme_id uuid,
  settings jsonb NOT NULL DEFAULT '{}',
  generation_state jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presentation.slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL
    REFERENCES presentation.documents(id) ON DELETE CASCADE,
  position integer NOT NULL,
  source_xml text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, position)
);

CREATE TABLE IF NOT EXISTS presentation.themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES platform.users(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  definition jsonb NOT NULL,
  built_in boolean NOT NULL DEFAULT false,
  source_import_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE presentation.presentations
  ADD CONSTRAINT presentations_theme_fk
  FOREIGN KEY (theme_id) REFERENCES presentation.themes(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS presentation.theme_favorites (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  theme_id uuid NOT NULL REFERENCES presentation.themes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, theme_id)
);

CREATE TABLE IF NOT EXISTS presentation.theme_likes (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  theme_id uuid NOT NULL REFERENCES presentation.themes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, theme_id)
);

CREATE TABLE IF NOT EXISTS presentation.font_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES platform.users(id),
  heading_font text NOT NULL,
  body_font text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presentation.document_favorites (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL
    REFERENCES presentation.documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, document_id)
);

CREATE TABLE IF NOT EXISTS presentation.generated_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES platform.users(id),
  asset_reference text NOT NULL,
  prompt_reference text NOT NULL,
  provider_id text NOT NULL,
  model_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  source_import_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_import_id)
);

CREATE TABLE IF NOT EXISTS presentation.shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL
    REFERENCES presentation.documents(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presentation.recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL
    REFERENCES presentation.documents(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES platform.users(id),
  asset_reference text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presentation.exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL
    REFERENCES presentation.documents(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  format text NOT NULL CHECK (format IN ('pptx', 'pdf')),
  status text NOT NULL,
  asset_reference text,
  error_code text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS presentation.generation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  document_id uuid REFERENCES presentation.documents(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES platform.users(id),
  profile_id text NOT NULL,
  status text NOT NULL,
  state jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presentation.agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL
    REFERENCES presentation.documents(id) ON DELETE CASCADE,
  workflow_thread_id uuid REFERENCES ai.workflow_threads(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presentation.import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  status text NOT NULL,
  source_schema_version text NOT NULL,
  configuration jsonb NOT NULL,
  report jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presentation.import_ledger (
  run_id uuid NOT NULL REFERENCES presentation.import_runs(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  source_id text NOT NULL,
  target_id text NOT NULL,
  target_revision integer,
  created_by_run boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, entity_type, source_id)
);

ALTER TABLE ai.tenant_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.agent_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.agent_job_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.workflow_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.generated_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.generation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation.agent_conversations ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('ai', 'tenant_policies'),
      ('ai', 'usage_records'),
      ('ai', 'agent_jobs'),
      ('ai', 'agent_sessions'),
      ('ai', 'agent_job_payloads'),
      ('ai', 'workflow_threads'),
      ('presentation', 'documents'),
      ('presentation', 'presentations'),
      ('presentation', 'slides'),
      ('presentation', 'generated_images'),
      ('presentation', 'shares'),
      ('presentation', 'recordings'),
      ('presentation', 'exports'),
      ('presentation', 'generation_sessions'),
      ('presentation', 'agent_conversations')
    ) AS values_table(schema_name, table_name)
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_scope ON %I.%I',
      item.schema_name,
      item.table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_scope ON %I.%I
       USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)
       WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      item.schema_name,
      item.table_name
    );
  END LOOP;
END $policies$;

DROP POLICY IF EXISTS tenant_theme_scope ON presentation.themes;
CREATE POLICY tenant_theme_scope ON presentation.themes
  USING (
    tenant_id IS NULL OR
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );
